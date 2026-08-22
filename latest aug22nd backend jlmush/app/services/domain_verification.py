"""Custom-domain ownership verification.

Same TXT-record challenge model as Vercel / Netlify / Cloudflare-for-SaaS.
Without verification, anyone could register a tenant with ``domain="google.com"``
and our DNS provisioner would happily route traffic for that name once the
A/AAAA record happened to point at our edge — or worse, an attacker could
intercept users by claiming a domain they don't own.

Flow
----
1. Operator (PLATFORM_OWNER) sets a tenant's custom domain via the platform
   API. ``set_pending`` generates a one-time token and stores the
   ``pending`` status on the tenant row.
2. Operator passes the TXT instructions to the tenant. The tenant adds
   the record at their authoritative DNS provider.
3. Operator (or the tenant themselves, via a future tenant-side UI)
   triggers ``verify``. We resolve ``_lz-verify.<tenant.domain>`` TXT
   records and look for a value that matches the stored token.
4. On match → status flips to ``verified`` and
   ``CloudflareDnsService.sync_tenant`` is allowed to provision the
   custom-domain CNAME. Until then, the custom domain is INERT — DNS
   never gets created, no traffic is routed.

Why a dedicated subdomain prefix (``_lz-verify``)
-------------------------------------------------
- Underscore prefix puts it in the "service record" namespace by
  convention (RFC 8552), so it can never collide with a real hostname.
- Tenant doesn't need to put a TXT at the apex — friendlier when their
  apex is hosting other records (SPF, DMARC, etc.).
- Easy to audit: every record we own follows the same naming scheme.
"""
import logging
import secrets
import time
from datetime import datetime, timezone

from app.extensions import db


logger = logging.getLogger(__name__)


# AWS-published CloudFront IP ranges. Lazy-loaded + cached for a day
# so the probe can authoritatively confirm whether a user's A records
# (which Cloudflare's CNAME flattening produces) actually reach a
# CloudFront edge — even when our backend's resolver and the user's
# resolver land on different /16 blocks (CloudFront has dozens).
_AWS_RANGES_CACHE = {'fetched_at': 0.0, 'cloudfront_v4': []}
_AWS_RANGES_TTL_SEC = 86400  # 24h


def _aws_cloudfront_ranges():
    """Return cached list of ``ipaddress.IPv4Network`` covering all
    CloudFront edge IPs published by AWS. Best-effort — returns the
    last cached value (or empty list on first fetch failure) so a
    transient network blip never blocks the probe."""
    import ipaddress
    import requests

    now = time.time()
    if (now - _AWS_RANGES_CACHE['fetched_at']) < _AWS_RANGES_TTL_SEC \
            and _AWS_RANGES_CACHE['cloudfront_v4']:
        return _AWS_RANGES_CACHE['cloudfront_v4']
    try:
        resp = requests.get(
            'https://ip-ranges.amazonaws.com/ip-ranges.json', timeout=5,
        )
        resp.raise_for_status()
        data = resp.json()
        networks = []
        for prefix in data.get('prefixes', []) or []:
            if prefix.get('service') == 'CLOUDFRONT':
                try:
                    networks.append(ipaddress.ip_network(prefix['ip_prefix']))
                except (ValueError, KeyError):
                    continue
        if networks:
            _AWS_RANGES_CACHE['cloudfront_v4'] = networks
            _AWS_RANGES_CACHE['fetched_at'] = now
        return networks or _AWS_RANGES_CACHE['cloudfront_v4']
    except Exception as exc:  # noqa: BLE001 — best-effort
        logger.warning(
            '[CF-RANGES] Failed to fetch AWS ip-ranges: %s '
            '(falling back to cached or empty)', exc,
        )
        return _AWS_RANGES_CACHE['cloudfront_v4']


def _ips_all_in_cloudfront(ips):
    """True if every IP in ``ips`` is inside at least one published
    CloudFront /16+ prefix. False on any miss or empty list."""
    import ipaddress
    networks = _aws_cloudfront_ranges()
    if not networks or not ips:
        return False
    for ip_str in ips:
        try:
            ip = ipaddress.ip_address(ip_str)
        except (ValueError, TypeError):
            return False
        if not any(ip in net for net in networks):
            return False
    return True


# Short prefix on the token value so it's grep-able in DNS dashboards
# and obviously *ours* (not someone's stray TXT record).
TOKEN_PREFIX = 'lz-verify-'

# DNS-name prefix where we look for the TXT challenge. Combined with the
# tenant's custom domain → ``_lz-verify.ishazen.com``.
RECORD_NAME_PREFIX = '_lz-verify.'

# Status values stored on Tenant.domain_verification_status.
PENDING = 'pending'
VERIFIED = 'verified'
FAILED = 'failed'
REVOKED = 'revoked'


class DomainVerificationService:
    """Static helpers for the DNS TXT challenge flow."""

    DNS_TIMEOUT = 5.0  # seconds — keep tight so verify() doesn't stall the UI.

    # ------------------------------------------------------------------
    # Token + state mutation
    # ------------------------------------------------------------------

    @staticmethod
    def generate_token():
        """Return a fresh URL-safe random token, prefixed for greppability."""
        return f'{TOKEN_PREFIX}{secrets.token_urlsafe(32)}'

    @staticmethod
    def record_name_for(domain):
        """Return the TXT record FQDN for a given custom domain."""
        return f'{RECORD_NAME_PREFIX}{domain}'

    @staticmethod
    def set_pending(tenant, domain):
        """Assign / re-issue a pending verification challenge for a domain.

        Returns a dict the caller can hand back to the operator with the
        exact TXT record they need to publish.
        """
        clean = (domain or '').strip().lower()
        if not clean:
            raise ValueError('Domain is required')

        # Reseller quota: a SUB-TENANT claiming a custom domain consumes
        # one of its apex parent's custom-domain slots. This is the single
        # seam every claim path funnels through (platform create, tenant
        # self-serve, future reseller console). ``exclude_child_id=self``
        # so REPLACING an existing domain doesn't burn a second slot.
        if tenant.parent_tenant_id is not None:
            from app.api.pricing.service import ResellerPolicy
            ResellerPolicy.assert_child_slot(
                tenant.parent_tenant_id, 'custom_domains',
                exclude_child_id=tenant.id,
            )

        tenant.domain = clean
        tenant.domain_verification_token = DomainVerificationService.generate_token()
        tenant.domain_verification_status = PENDING
        tenant.domain_verified_at = None
        db.session.commit()

        record_name = DomainVerificationService.record_name_for(clean)
        return {
            'domain': clean,
            'record_name': record_name,
            'record_type': 'TXT',
            'record_value': tenant.domain_verification_token,
            'instructions': (
                f'Add a TXT record at "{record_name}" with value '
                f'"{tenant.domain_verification_token}" at your DNS provider. '
                f'Then call the verify endpoint to activate the domain.'
            ),
            'status': tenant.domain_verification_status,
        }

    @staticmethod
    def verify(tenant):
        """Resolve the TXT challenge and update ``tenant.domain_verification_status``.

        Returns ``True`` only when the live TXT record matches the stored
        token. Treats every DNS error (NXDOMAIN, no answer, timeout,
        network blip) as a soft failure → ``status='failed'`` so the
        operator can retry without losing the token.
        """
        if not tenant.domain or not tenant.domain_verification_token:
            raise ValueError(
                'Tenant has no custom domain or pending challenge — '
                'call set_pending first.'
            )

        # Local import keeps dnspython optional at import time. Required
        # for production install (see requirements.txt) but skipping the
        # global import means tests / CLI tasks that never touch DNS
        # don't pay for it.
        import dns.resolver  # type: ignore
        import dns.exception  # type: ignore

        record_name = DomainVerificationService.record_name_for(tenant.domain)
        expected = tenant.domain_verification_token

        try:
            answer = dns.resolver.resolve(
                record_name, 'TXT',
                lifetime=DomainVerificationService.DNS_TIMEOUT,
            )
        except dns.resolver.NXDOMAIN:
            logger.info('[DOMAIN_VERIFY] NXDOMAIN for %s', record_name)
            return DomainVerificationService._mark_failed(tenant, 'NXDOMAIN')
        except dns.resolver.NoAnswer:
            logger.info('[DOMAIN_VERIFY] NoAnswer for %s', record_name)
            return DomainVerificationService._mark_failed(tenant, 'NoAnswer')
        except dns.exception.Timeout:
            logger.warning('[DOMAIN_VERIFY] Timeout for %s', record_name)
            return DomainVerificationService._mark_failed(tenant, 'Timeout')
        except Exception as exc:  # noqa: BLE001 — broad on purpose; never crash the route
            logger.warning('[DOMAIN_VERIFY] Resolver error %s: %s', record_name, exc)
            return DomainVerificationService._mark_failed(tenant, f'resolver error: {exc}')

        # Iterate every TXT record + every chunk in each record. dnspython
        # returns the value as bytes (per the DNS RFC); decode as ASCII
        # because verification tokens are URL-safe ASCII by construction.
        for rdata in answer:
            for chunk in rdata.strings:
                value = chunk.decode('ascii', errors='ignore').strip()
                if value == expected:
                    tenant.domain_verification_status = VERIFIED
                    tenant.domain_verified_at = datetime.now(timezone.utc)
                    db.session.commit()
                    logger.info(
                        '[DOMAIN_VERIFY] ✓ verified %s → tenant=%s',
                        record_name, tenant.id,
                    )
                    return True

        return DomainVerificationService._mark_failed(tenant, 'no matching TXT value')

    @staticmethod
    def check_routing_cname(tenant, expected_target=None):
        """Probe the public DNS for the tenant's custom domain and return a
        report on whether its CNAME (or final A/AAAA chain) points at our
        ingress target.

        Used after TXT verification to confirm the operator actually
        published the routing CNAME at their registrar — the platform
        can't manage out-of-zone records, so this is the only signal we
        have that traffic will land at us. Returns a dict ready to be
        returned from the route as-is.

        ``expected_target`` defaults to ``CLOUDFLARE_INGRESS_TARGET``;
        passed in by the route layer to avoid importing config here.
        """
        if not tenant.domain:
            raise ValueError('Tenant has no custom domain set.')

        import dns.resolver  # type: ignore
        import dns.exception  # type: ignore

        target = (expected_target or '').strip().lower()
        domain = tenant.domain.strip().lower()

        report = {
            'domain': domain,
            'expected_target': target or None,
            'resolved_chain': [],   # list of CNAMEs/IPs we walked through
            'matches': False,
            'reason': None,
        }

        try:
            # Walk the CNAME chain manually (max 8 hops to avoid loops).
            current = domain
            seen = set()
            for _ in range(8):
                if current in seen:
                    report['reason'] = 'CNAME loop'
                    return report
                seen.add(current)
                try:
                    answer = dns.resolver.resolve(
                        current, 'CNAME',
                        lifetime=DomainVerificationService.DNS_TIMEOUT,
                    )
                    next_hop = str(answer[0].target).rstrip('.').lower()
                    report['resolved_chain'].append({
                        'name': current, 'type': 'CNAME', 'target': next_hop,
                    })
                    current = next_hop
                    # Match check on every hop — if any segment of the
                    # chain matches our ingress target (or ends with it,
                    # to allow regional Amplify suffixes), we're routing.
                    if target and (
                        current == target
                        or current.endswith('.' + target)
                        or target.endswith('.' + current)
                    ):
                        report['matches'] = True
                        report['reason'] = 'CNAME chain reached ingress'
                        return report
                except dns.resolver.NoAnswer:
                    # No CNAME at this name — try A/AAAA. Cloudflare
                    # (and other DNS providers) FLATTEN CNAMEs at the
                    # zone apex by RFC requirement: ``vedanthzen.com``
                    # can't have a CNAME alongside SOA/NS, so the
                    # provider follows the chain server-side and
                    # returns A records pointing at the same IPs the
                    # ingress resolves to. From the operator's POV the
                    # CNAME *is* there; the probe just sees its
                    # flattened result. Resolve the expected target's
                    # A records and treat any overlap as a match.
                    try:
                        a_answer = dns.resolver.resolve(
                            current, 'A',
                            lifetime=DomainVerificationService.DNS_TIMEOUT,
                        )
                        ips = sorted({r.address for r in a_answer})
                        report['resolved_chain'].append({
                            'name': current, 'type': 'A', 'target': ips,
                        })
                        if target:
                            try:
                                expected_a = dns.resolver.resolve(
                                    target, 'A',
                                    lifetime=DomainVerificationService.DNS_TIMEOUT,
                                )
                                expected_ips = {r.address for r in expected_a}
                                report['resolved_chain'].append({
                                    'name': target, 'type': 'A',
                                    'target': sorted(expected_ips),
                                })
                                # Exact-IP overlap = strong match (same
                                # CloudFront edge served both lookups).
                                if expected_ips & set(ips):
                                    report['matches'] = True
                                    report['reason'] = (
                                        'CNAME flattened to A records by your '
                                        'DNS provider — A records exactly match '
                                        f'{target}, traffic will route correctly.'
                                    )
                                    return report
                                # Fallback: /16 overlap. Amplify is fronted
                                # by CloudFront, which has thousands of
                                # edge IPs that vary by resolver region —
                                # exact-IP overlap is unreliable. If both
                                # sets share an IPv4 /16 we treat that as
                                # confidence that they're hitting the
                                # same backend (CloudFront's published
                                # ranges are /16-and-larger blocks).
                                def _16(ip: str) -> str:
                                    parts = ip.split('.')
                                    return '.'.join(parts[:2]) if len(parts) == 4 else ip
                                user_16 = {_16(ip) for ip in ips}
                                expected_16 = {_16(ip) for ip in expected_ips}
                                if user_16 & expected_16:
                                    shared = ', '.join(sorted(user_16 & expected_16))
                                    report['matches'] = True
                                    report['reason'] = (
                                        f'CNAME flattened to A records — both your '
                                        f'domain and {target} resolve into the same '
                                        f'/16 block ({shared}.x.x), traffic will '
                                        'route correctly. (Amplify/CloudFront '
                                        'rotates exact edge IPs by region.)'
                                    )
                                    return report
                                # AWS-published CloudFront IP ranges
                                # check — authoritative for Amplify/
                                # CloudFront ingresses. CloudFront has
                                # dozens of /16 blocks worldwide, so
                                # /16 overlap can fail when the user's
                                # resolver and our backend land on
                                # different edges. If the EXPECTED
                                # target is a known CloudFront-fronted
                                # hostname AND every user A record
                                # falls inside a published CloudFront
                                # prefix, traffic is reaching the
                                # right backend.
                                tlower = (target or '').lower()
                                is_cf_target = (
                                    tlower.endswith('amplifyapp.com')
                                    or tlower.endswith('cloudfront.net')
                                    or _ips_all_in_cloudfront(list(expected_ips))
                                )
                                if is_cf_target and _ips_all_in_cloudfront(ips):
                                    report['matches'] = True
                                    report['reason'] = (
                                        'CNAME flattened to A records — all your '
                                        'A records fall within AWS CloudFront\'s '
                                        'published IP ranges (the same edge fleet '
                                        f'{target} uses). Traffic is reaching AWS '
                                        'correctly.'
                                    )
                                    return report
                            except Exception:  # noqa: BLE001
                                # Couldn't resolve expected target — fall
                                # through to the generic "A records but
                                # we can't confirm" message.
                                pass
                        # Before crying wolf, trust the PROVIDER's own verdict.
                        # A Cloudflare-proxied apex always flattens to anycast
                        # IPs, so public DNS can never confirm the target — but
                        # if Pages already reports the custom domain ACTIVE,
                        # routing is proven and a warning would be wrong.
                        if str(getattr(tenant, 'cf_hostname_status', '') or '').lower() == 'active':
                            report['matches'] = True
                            report['reason'] = (
                                'Verified with Cloudflare: your domain is active '
                                'and serving. Public DNS shows proxied IPs rather '
                                'than the CNAME target, which is normal for a '
                                'proxied apex domain.'
                            )
                            return report
                        report['reason'] = (
                            'Domain resolves to A records — most likely your '
                            'DNS provider flattened the apex CNAME (normal for '
                            'Cloudflare-hosted apex domains). We couldn\'t '
                            'confirm the IPs match our ingress; if the page '
                            'still 403s, switch to a www subdomain CNAME or '
                            'use ALIAS/ANAME at the apex.'
                        )
                    except Exception:  # noqa: BLE001
                        report['reason'] = (
                            f'No CNAME or A records found for "{current}".'
                        )
                    return report
                except dns.resolver.NXDOMAIN:
                    report['reason'] = (
                        f'NXDOMAIN — "{current}" does not exist in DNS yet. '
                        'Add the CNAME at your registrar and try again '
                        '(propagation can take a few minutes).'
                    )
                    return report
                except dns.exception.Timeout:
                    report['reason'] = 'DNS timeout — try again in a few seconds.'
                    return report

            report['reason'] = 'CNAME chain too deep (8+ hops).'
            return report
        except Exception as exc:  # noqa: BLE001 — never crash the route
            logger.warning(
                '[DOMAIN_VERIFY] check_routing_cname error %s: %s', domain, exc,
            )
            report['reason'] = f'resolver error: {exc}'
            return report

    @staticmethod
    def revoke(tenant):
        """Mark a previously verified domain as revoked.

        Used by the periodic re-check job when the TXT record has
        disappeared from DNS — protects against domain takeover where
        the underlying domain ownership has changed hands.
        """
        tenant.domain_verification_status = REVOKED
        tenant.domain_verified_at = None
        db.session.commit()
        logger.info('[DOMAIN_VERIFY] ✗ revoked tenant=%s domain=%s',
                    tenant.id, tenant.domain)

    @staticmethod
    def clear(tenant):
        """Fully unset the custom domain + verification state."""
        tenant.domain = None
        tenant.domain_verification_token = None
        tenant.domain_verification_status = None
        tenant.domain_verified_at = None
        db.session.commit()

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    @staticmethod
    def _mark_failed(tenant, reason):
        tenant.domain_verification_status = FAILED
        # Stash the reason on dns_error so the platform UI can surface a
        # human-friendly hint without us inventing yet another column.
        tenant.dns_error = f'Domain verification failed: {reason}'
        db.session.commit()
        return False
