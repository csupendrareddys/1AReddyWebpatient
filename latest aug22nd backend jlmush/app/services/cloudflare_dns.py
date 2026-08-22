"""Cloudflare DNS Service.

Provisions per-tenant DNS so every tenant gets a real, working FQDN the
moment it's created in the platform-owner console:

    acme (slug)       →  acme.jlmush.com            (auto-managed CNAME)
    clinicxyz.com (domain)  →  clinicxyz.com         (auto-managed CNAME if
                                                      the zone covers it,
                                                      otherwise just tracked)

No more ``?tenant=acme`` query-param fallback; the frontend resolves the
tenant slug from ``window.location.hostname`` and the browser simply talks
to the right record.

Design principles
-----------------
1. **DNS is a side-effect, never a gatekeeper.** Tenant creation in the
   DB always succeeds. DNS provisioning happens *after* the commit and
   stores its state on the tenant row (``dns_status``, ``dns_error``).
   A retry endpoint re-runs the sync without recreating the tenant.
2. **Idempotent.** Re-running ``sync_tenant`` never duplicates records.
   If a record id is already persisted, we ``PUT`` it; otherwise we
   search Cloudflare by name and reuse; otherwise we ``POST`` a new one.
3. **Narrow blast radius.** Every function is scoped to a single tenant,
   reads the Cloudflare token only at call-time (so rotating the token
   never requires a restart), and logs every non-2xx Cloudflare response
   with the full error body for triage.
4. **Token is never echoed back.** Only the derived ``dns_status`` +
   ``fqdn`` + a friendly error are exposed via the API. The token stays
   server-side.

Required env vars (via ``config.py``):

    CLOUDFLARE_API_TOKEN       - Scoped API token with "Zone:DNS:Edit" for
                                 the target zone. Nothing else.
    CLOUDFLARE_ZONE_ID         - The zone to manage (e.g. jlmush.com).
    CLOUDFLARE_BASE_DOMAIN     - FQDN suffix for slug subdomains
                                 (``acme`` + ``.jlmush.com`` → ``acme.jlmush.com``).
    CLOUDFLARE_INGRESS_TARGET  - Where tenant traffic points. Typically
                                 the frontend origin or a reverse proxy
                                 (``jlmush-frontend.<region>.amplifyapp.com``
                                 or ``ingress.jlmush.com``).
    CLOUDFLARE_PROXIED         - "true"/"false". Whether to enable the
                                 Cloudflare orange-cloud proxy. Defaults
                                 to ``false`` because tenant subdomains
                                 point at Amplify (which already runs on
                                 CloudFront with its own cert); stacking
                                 Cloudflare on top causes SSL handshake
                                 failures (CF↔Amplify SNI mismatch) and
                                 the well-known double-CDN anti-pattern.
                                 Set to ``true`` only if your ingress
                                 target is a bare origin (e.g. EC2/nginx)
                                 and you want CF WAF in front.
    CLOUDFLARE_TTL             - DNS TTL in seconds. Defaults to 1
                                 (Cloudflare's "auto").
"""
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from flask import current_app

from app.extensions import db


logger = logging.getLogger(__name__)


# Module-level HTTP session with a Retry adapter. Closes review items
# 2 (no retry/backoff) and 7 (no session reuse) in one shot:
#   * Connection pooling (TLS handshake reused across CF calls).
#   * Automatic retry on transient 5xx + 429, with exponential backoff,
#     honouring the ``Retry-After`` header for rate-limited responses.
#   * ``allowed_methods`` includes the mutating verbs because Cloudflare
#     DNS upserts/deletes are idempotent (same ``record_id`` produces
#     the same end state on retry — see ``upsert_cname``).
_CF_SESSION = requests.Session()
_CF_RETRY = Retry(
    total=3,
    backoff_factor=0.5,                      # 0.5s, 1s, 2s
    status_forcelist=(429, 500, 502, 503, 504),
    allowed_methods=('GET', 'POST', 'PUT', 'PATCH', 'DELETE'),
    respect_retry_after_header=True,
    raise_on_status=False,                   # let _request inspect status
)
_CF_SESSION.mount('https://', HTTPAdapter(max_retries=_CF_RETRY))
_CF_SESSION.mount('http://', HTTPAdapter(max_retries=_CF_RETRY))


# ----------------------------------------------------------------------
# Status constants — stored verbatim on ``Tenant.dns_status``
# ----------------------------------------------------------------------

DNS_PENDING = 'pending'    # async / not yet attempted
DNS_ACTIVE = 'active'      # record in place, traffic should work
DNS_FAILED = 'failed'      # last attempt returned non-2xx or network err
DNS_DISABLED = 'disabled'  # explicitly not provisioning (e.g. is_platform)


def _is_within_zone(domain: str, base_domain: str) -> bool:
    """Phase 2 #8 — tight subdomain-of check.

    ``domain.endswith(base_domain)`` is broken: ``'evil-larazen.in'``
    ends with ``'larazen.in'`` but is NOT a subdomain of it. This
    helper accepts only:
      * the exact apex (``'larazen.in' == 'larazen.in'``), or
      * a real subdomain (``'acme.larazen.in'`` ends with
        ``'.larazen.in'`` after the dot separator).

    Both arguments are treated case-insensitively because DNS is.
    """
    if not domain or not base_domain:
        return False
    d = domain.strip().lower().rstrip('.')
    b = base_domain.strip().lower().rstrip('.')
    if not d or not b:
        return False
    return d == b or d.endswith('.' + b)


class CloudflareConfigError(RuntimeError):
    """Raised when the Flask config is missing required CF credentials."""


# Phase 2 #9 — TTL boundaries. Cloudflare accepts ``1`` as a sentinel
# for "auto"; any other value must be 60–86400 inclusive (CF rejects
# values outside that band with a 9007 error). Validating at config-
# load time turns a runtime CF API failure into a startup-style error
# the operator can fix immediately.
_CF_TTL_AUTO = 1
_CF_TTL_MIN = 60
_CF_TTL_MAX = 86400  # 24h


def _config():
    """Return a tuple ``(token, zone, base_domain, target, proxied, ttl)``.

    Read from ``current_app.config`` at call time so rotating any of
    these values via the environment takes effect on the next call.
    Raises :class:`CloudflareConfigError` if required pieces are absent
    or if any string config carries non-ASCII characters (CF API and
    urllib3's latin-1 header encoder both reject them — silently
    stripping was item #4 in the architectural review).
    """
    # ``.strip()`` defensively because operators routinely paste env vars
    # from the Cloudflare / AWS console with a trailing newline or space,
    # which then gets baked into the URL path → "Could not route" 404.
    # Phase 2 #4: NON-ASCII characters used to be silently dropped via
    # ``encode('ascii', errors='ignore').decode('ascii')`` — that meant
    # a smart-quote in a paste produced a quietly-mutated value that
    # then mismatched the actual zone id / domain. Now we REJECT
    # explicitly with a useful error message pointing at the offending
    # config key. The operator sees the bug instead of chasing
    # "Cloudflare 404, but the zone id looks right…".
    def _clean(name):
        v = current_app.config.get(name)
        if not isinstance(v, str):
            return v
        v = v.strip()
        try:
            v.encode('ascii')
        except UnicodeEncodeError as exc:
            # Surface the exact byte offset so the operator can find
            # the smart-quote / right-arrow in their .env file.
            raise CloudflareConfigError(
                f'{name} contains non-ASCII character at offset {exc.start} '
                f'(byte={v[exc.start]!r}); Cloudflare credentials, zone ids '
                f'and hostnames are ASCII-only by definition. Re-paste from '
                f'a plain-text source.'
            )
        return v

    token = _clean('CLOUDFLARE_API_TOKEN')
    zone = _clean('CLOUDFLARE_ZONE_ID')
    base = _clean('CLOUDFLARE_BASE_DOMAIN')
    target = _clean('CLOUDFLARE_INGRESS_TARGET')
    proxied_raw = str(current_app.config.get('CLOUDFLARE_PROXIED', 'false')).strip().lower()

    # Phase 2 #9 — TTL validation. Accept ``1`` (auto) or ``60..86400``.
    raw_ttl = current_app.config.get('CLOUDFLARE_TTL', _CF_TTL_AUTO)
    try:
        ttl = int(str(raw_ttl).strip())
    except (TypeError, ValueError):
        raise CloudflareConfigError(
            f'CLOUDFLARE_TTL must be an integer (got {raw_ttl!r}). '
            f'Use {_CF_TTL_AUTO} for "auto" or a value in '
            f'{_CF_TTL_MIN}..{_CF_TTL_MAX} seconds.'
        )
    if ttl != _CF_TTL_AUTO and not (_CF_TTL_MIN <= ttl <= _CF_TTL_MAX):
        raise CloudflareConfigError(
            f'CLOUDFLARE_TTL={ttl} is out of range. '
            f'Allowed: {_CF_TTL_AUTO} (auto) or {_CF_TTL_MIN}..{_CF_TTL_MAX}.'
        )

    missing = [
        name for name, value in [
            ('CLOUDFLARE_API_TOKEN', token),
            ('CLOUDFLARE_ZONE_ID', zone),
            ('CLOUDFLARE_BASE_DOMAIN', base),
            ('CLOUDFLARE_INGRESS_TARGET', target),
        ] if not value
    ]
    if missing:
        raise CloudflareConfigError(
            f'Cloudflare DNS not configured; missing env vars: {", ".join(missing)}'
        )
    return token, zone, base, target, proxied_raw in ('true', '1', 'yes'), ttl


def is_configured() -> bool:
    """Cheap check the routes / service layer uses to decide whether to
    even attempt DNS provisioning. Returns False when any env var is
    missing — the platform still works, tenants just won't get a DNS
    record until configuration is added.

    NOTE: this answers for the PLATFORM zone only. Reseller-P4 paths ask
    :func:`binding_for_tenant` instead, which may return an apex-owned
    zone even when the platform env is unset (and vice versa).
    """
    try:
        _config()
        return True
    except CloudflareConfigError:
        return False


# ----------------------------------------------------------------------
# Zone bindings — WHICH Cloudflare zone (and whose token) a tenant's
# records live in. Reseller P4: children of an apex with a ready
# ``TenantDnsConfig`` provision inside the APEX's zone; everyone else
# keeps the platform env zone.
# ----------------------------------------------------------------------

@dataclass(frozen=True)
class DnsZoneBinding:
    """Resolved zone credentials for one tenant's DNS operations."""
    token: str = field(repr=False)
    zone_id: str
    base_domain: str
    target: str
    proxied: bool
    ttl: int
    source: str                      # 'platform_env' | 'reseller_config'
    config_id: Optional[str] = None  # TenantDnsConfig.id when reseller


def platform_binding() -> DnsZoneBinding:
    """The platform env zone. Raises CloudflareConfigError when unset."""
    token, zone, base, target, proxied, ttl = _config()
    return DnsZoneBinding(token=token, zone_id=zone, base_domain=base,
                          target=target, proxied=proxied, ttl=ttl,
                          source='platform_env')


def binding_for_tenant(tenant) -> DnsZoneBinding:
    """Where THIS tenant's records live.

    A CHILD whose parent apex has a ready :class:`TenantDnsConfig` binds
    to the apex zone (apex token/zone/base; ingress falls back to the
    platform's CLOUDFLARE_INGRESS_TARGET when the config doesn't
    override it; TTL stays the platform default). Everything else —
    top-level tenants, children of unconfigured apexes — binds to the
    platform env zone. Opt-in by construction: connecting a zone never
    silently re-homes existing records (the migration script does that
    explicitly).

    Raises CloudflareConfigError when the selected zone is unusable.
    """
    parent_id = getattr(tenant, 'parent_tenant_id', None)
    if parent_id:
        from app.models import TenantDnsConfig
        cfg = TenantDnsConfig.for_tenant(parent_id)
        if cfg is not None and cfg.dns_ready:
            token = cfg.api_token
            if not token:
                raise CloudflareConfigError(
                    'Reseller DNS config token failed to decrypt — '
                    're-save the API token.')
            target = cfg.ingress_target or (
                current_app.config.get('CLOUDFLARE_INGRESS_TARGET') or ''
            ).strip()
            if not target:
                raise CloudflareConfigError(
                    'Reseller DNS config has no ingress target and the '
                    'platform CLOUDFLARE_INGRESS_TARGET is unset.')
            try:
                ttl = int(str(current_app.config.get(
                    'CLOUDFLARE_TTL', _CF_TTL_AUTO)).strip())
            except (TypeError, ValueError):
                ttl = _CF_TTL_AUTO
            return DnsZoneBinding(
                token=token, zone_id=cfg.zone_id,
                base_domain=cfg.base_domain, target=target,
                proxied=bool(cfg.proxied), ttl=ttl,
                source='reseller_config', config_id=str(cfg.id),
            )
    return platform_binding()


def public_host_for(tenant) -> Optional[str]:
    """The hostname this tenant's site is REACHED at, independent of
    whether the DNS API call has succeeded yet (locally Cloudflare is
    never configured, but ``<slug>.localhost`` still resolves).

    Order: verified custom domain → slug under the parent apex's ready
    zone → slug under the platform base domain → the synced ``fqdn``
    column → None. Used by tenant-ready notifications and the public
    signup response so children on apex zones get pointed at the RIGHT
    host, not the platform-zone placeholder.
    """
    if tenant is None:
        return None
    if getattr(tenant, 'domain', None) and \
            getattr(tenant, 'domain_verification_status', None) == 'verified':
        return tenant.domain
    if getattr(tenant, 'auto_subdomain', True):
        parent_id = getattr(tenant, 'parent_tenant_id', None)
        if parent_id:
            from app.models import TenantDnsConfig
            cfg = TenantDnsConfig.for_tenant(parent_id)
            if cfg is not None and cfg.dns_ready:
                return f'{tenant.slug}.{cfg.base_domain}'
        base = (current_app.config.get('CLOUDFLARE_BASE_DOMAIN') or '').strip()
        if base:
            return f'{tenant.slug}.{base}'
    return getattr(tenant, 'fqdn', None)


class CloudflareDnsService:
    """Static-class wrapper around the Cloudflare v4 REST API."""

    API_BASE = 'https://api.cloudflare.com/client/v4'
    HTTP_TIMEOUT = 10  # seconds — keep tight so DNS failures don't stall
                      # the tenant-create UX.

    # ------------------------------------------------------------------
    # Low-level request helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _headers(binding: DnsZoneBinding):
        return {
            'Authorization': f'Bearer {binding.token}',
            'Content-Type': 'application/json',
        }

    @staticmethod
    def _request(method: str, path: str, *, binding: DnsZoneBinding,
                 json=None, params=None):
        url = f"{CloudflareDnsService.API_BASE}{path}"
        # Use the module-level Session so we get connection pooling +
        # automatic retry/backoff on 429 + 5xx (see ``_CF_SESSION``).
        resp = _CF_SESSION.request(
            method, url,
            headers=CloudflareDnsService._headers(binding),
            json=json, params=params,
            timeout=CloudflareDnsService.HTTP_TIMEOUT,
        )
        try:
            body = resp.json()
        except ValueError:
            body = {'success': False, 'errors': [{'message': resp.text[:500]}]}

        if not resp.ok or not body.get('success', False):
            errors = body.get('errors') or []
            msg = '; '.join(str(e.get('message', e)) for e in errors) or resp.text[:300]
            # Phase 2 #10 — sanitize log output. Keep the structured
            # signal (status + CF error codes + record id when available)
            # but DROP free-text bodies which can leak account-ids,
            # token suffixes, plan-tier strings, and other infra
            # detail that doesn't belong in app logs. The full body is
            # still raised in the RuntimeError below for the caller's
            # error handler to surface to the operator (server-internal,
            # not logged at scale).
            cf_codes = sorted({
                e.get('code') for e in errors
                if isinstance(e, dict) and e.get('code') is not None
            })
            ray_id = resp.headers.get('cf-ray', '-')
            logger.warning(
                '[CF] %s %s failed: status=%s codes=%s ray=%s',
                method, path, resp.status_code, cf_codes or '-', ray_id,
            )
            raise RuntimeError(f'Cloudflare API error: {msg}')
        return body['result']

    # ------------------------------------------------------------------
    # Record-level primitives
    # ------------------------------------------------------------------

    @staticmethod
    def _records_path(zone_id):
        return f'/zones/{zone_id}/dns_records'

    @staticmethod
    def find_record_by_name(name: str, *,
                            binding: DnsZoneBinding) -> Optional[dict]:
        """Return the first DNS record whose ``name`` matches across
        the record types we manage (A / AAAA / CNAME). Used when the
        record_id was lost but we still need to reattach rather than
        duplicate."""
        for rec_type in ('CNAME', 'A', 'AAAA'):
            results = CloudflareDnsService._request(
                'GET',
                CloudflareDnsService._records_path(binding.zone_id),
                binding=binding,
                params={'name': name, 'type': rec_type},
            )
            if results:
                return results[0]
        return None

    @staticmethod
    def _record_type_for_target(target: str) -> str:
        """Pick the right DNS record type for a target.

        - IPv4 ``13.234.56.78``  → ``A``
        - IPv6 ``2606:...``      → ``AAAA``
        - hostname ``foo.bar``   → ``CNAME``

        DNS forbids CNAME records pointing at IPs (the spec is strict),
        so we silently upgrade to an A/AAAA record when the operator
        configures an IP as the ingress target. Saves them a "CNAME
        content invalid" error.
        """
        import ipaddress
        try:
            addr = ipaddress.ip_address(target)
            return 'A' if isinstance(addr, ipaddress.IPv4Address) else 'AAAA'
        except ValueError:
            return 'CNAME'

    @staticmethod
    def _sanitize_target(target: str) -> str:
        """Strip protocol, slashes, whitespace from a CNAME/A target.

        Operators paste full URLs into the env var by accident
        (``https://main.…amplifyapp.com/``); the Cloudflare API then
        rejects them. We strip and pass clean values through.
        """
        if not target:
            return target
        t = target.strip()
        for prefix in ('https://', 'http://'):
            if t.lower().startswith(prefix):
                t = t[len(prefix):]
        # Drop anything after the first slash (path).
        if '/' in t:
            t = t.split('/', 1)[0]
        # Drop port suffix — ``host:5000`` is not a valid DNS target.
        # IPv6 addresses contain ``:`` so only strip if the part before
        # the last ``:`` is a hostname (contains a letter or dot) or an
        # IPv4 address.
        if ':' in t and not t.startswith('['):
            head, _, tail = t.rpartition(':')
            if tail.isdigit() and (
                '.' in head or any(c.isalpha() for c in head)
            ):
                t = head
        return t

    @staticmethod
    def upsert_cname(name: str, target: str, *,
                     binding: DnsZoneBinding,
                     existing_record_id: Optional[str] = None) -> dict:
        """Create or update a DNS record ``name`` -> ``target`` in the
        binding's zone.

        Picks ``A`` / ``AAAA`` automatically when the target is an IP
        (DNS forbids CNAME -> IP). Method name kept for backward
        compatibility with callers who think in CNAME terms.
        """
        zone = binding.zone_id
        clean_target = CloudflareDnsService._sanitize_target(target)
        record_type = CloudflareDnsService._record_type_for_target(clean_target)
        payload = {
            'type': record_type,
            'name': name,
            'content': clean_target,
            'ttl': binding.ttl,
            'proxied': binding.proxied,
            'comment': 'Managed by jlmush tenant service - do not edit manually',
        }
        # Prefer the persisted id when we have it (single-shot PUT).
        if existing_record_id:
            try:
                return CloudflareDnsService._request(
                    'PUT',
                    f'{CloudflareDnsService._records_path(zone)}/{existing_record_id}',
                    binding=binding, json=payload,
                )
            except Exception as exc:  # noqa: BLE001 — inspect and re-raise
                # A stale persisted id: the record was deleted out-of-band,
                # or the zone binding moved (e.g. the test env's base-domain
                # migration off larazen.in) so the id belongs to another
                # zone. Recover by falling through to the by-name lookup /
                # create below instead of failing the whole sync — the
                # caller persists the fresh id we return.
                if 'does not exist' not in str(exc).lower():
                    raise
                logger.warning(
                    '[CF] persisted record id %s is stale for %s — '
                    'recreating in zone %s', existing_record_id, name, zone,
                )
        # Otherwise see if one already exists by name (idempotency).
        existing = CloudflareDnsService.find_record_by_name(
            name, binding=binding)
        if existing:
            return CloudflareDnsService._request(
                'PUT',
                f'{CloudflareDnsService._records_path(zone)}/{existing["id"]}',
                binding=binding, json=payload,
            )
        return CloudflareDnsService._request(
            'POST', CloudflareDnsService._records_path(zone),
            binding=binding, json=payload,
        )

    @staticmethod
    def delete_record(record_id: str, *, binding: DnsZoneBinding) -> None:
        """Best-effort delete — swallows 404 so repeated calls are safe."""
        try:
            CloudflareDnsService._request(
                'DELETE',
                f'{CloudflareDnsService._records_path(binding.zone_id)}/{record_id}',
                binding=binding,
            )
        except RuntimeError as exc:
            if '81044' in str(exc) or 'not found' in str(exc).lower():
                return  # already gone
            raise

    # ------------------------------------------------------------------
    # Tenant-level operations — the only API the rest of the app calls
    # ------------------------------------------------------------------

    @staticmethod
    def check_zone(token: str, zone_id: str) -> dict:
        """Read-only zone fetch — the reseller DNS "test connection"
        probe. Returns the zone object (name, status, ...) or raises
        with Cloudflare's message."""
        probe = DnsZoneBinding(
            token=token, zone_id=zone_id, base_domain='', target='-',
            proxied=False, ttl=_CF_TTL_AUTO, source='probe',
        )
        return CloudflareDnsService._request(
            'GET', f'/zones/{zone_id}', binding=probe)

    @staticmethod
    def sync_subdomain(tenant, *, binding: DnsZoneBinding) -> None:
        """Provision (or tear down) the managed slug subdomain inside
        the binding's zone (platform zone, or the parent apex's zone for
        reseller children — P4).

        Pulled out of :meth:`sync_tenant` so the platform UI can retry
        just this record without disturbing the custom-domain CNAME (and
        vice versa). Caller is responsible for catching exceptions and
        recording ``dns_status`` / ``dns_error``.
        """
        if getattr(tenant, 'is_platform', False):
            return
        slug_fqdn = f'{tenant.slug}.{binding.base_domain}'
        if getattr(tenant, 'auto_subdomain', True):
            slug_rec = CloudflareDnsService.upsert_cname(
                name=slug_fqdn,
                target=binding.target,
                binding=binding,
                existing_record_id=tenant.dns_record_id,
            )
            tenant.dns_record_id = slug_rec['id']
            tenant.fqdn = slug_fqdn
        else:
            if tenant.dns_record_id:
                try:
                    CloudflareDnsService.delete_record(
                        tenant.dns_record_id, binding=binding)
                except Exception:  # noqa: BLE001 — keep tenant fields consistent
                    logger.exception(
                        '[CF] Failed to delete subdomain record for tenant=%s',
                        tenant.slug,
                    )
                tenant.dns_record_id = None
            tenant.fqdn = tenant.domain if (
                tenant.domain and tenant.domain_verification_status == 'verified'
            ) else None

    @staticmethod
    def _target_for_tenant_custom_domain(tenant) -> Optional[str]:
        """Compute the Cloudflare CNAME target for THIS tenant's custom
        domain. Returns ``None`` so callers fall back to the shared
        ``CLOUDFLARE_INGRESS_TARGET`` env value — that's the Worker
        hostname and all tenants share it under Cloudflare for SaaS.

        Kept as a hook in case future provisioning (e.g. dedicated
        per-tenant Workers, regional routing) needs to pin a specific
        target per tenant.
        """
        return None

    @staticmethod
    def sync_custom_domain(tenant, *, binding: DnsZoneBinding) -> None:
        """Provision the tenant's custom-domain CNAME if (and only if):
            1. ownership is verified, AND
            2. the domain is inside our managed Cloudflare zone.

        Out-of-zone verified domains are intentionally a no-op — the
        tenant must point their own CNAME at our ingress (the
        ``DnsInstructionsDialog`` shows them how).

        Target selection: when the tenant has been assigned an
        Amplify app from the pool, point the CNAME at THAT app's
        CloudFront hostname (not the shared
        ``CLOUDFLARE_INGRESS_TARGET``). Falls back to the shared
        target for legacy rows / first-time provisioning where
        Amplify hasn't picked an app yet.
        """
        if getattr(tenant, 'is_platform', False):
            return
        if tenant.domain and getattr(
            tenant, 'domain_verification_status', None,
        ) != 'verified':
            logger.info(
                '[CF] Skipping custom-domain provisioning for tenant=%s '
                'domain=%s — verification_status=%s',
                tenant.slug, tenant.domain,
                getattr(tenant, 'domain_verification_status', None),
            )
            tenant.custom_domain_record_id = None
        elif tenant.domain and _is_within_zone(tenant.domain,
                                               binding.base_domain):
            custom_target = (
                CloudflareDnsService._target_for_tenant_custom_domain(tenant)
                or binding.target
            )
            custom_rec = CloudflareDnsService.upsert_cname(
                name=tenant.domain, target=custom_target,
                binding=binding,
                existing_record_id=tenant.custom_domain_record_id,
            )
            tenant.custom_domain_record_id = custom_rec['id']
        elif tenant.domain:
            tenant.custom_domain_record_id = None

    @staticmethod
    def sync_tenant(tenant, *, scope: str = 'all') -> None:
        """Ensure Cloudflare has up-to-date CNAMEs for this tenant.

        ``scope`` determines which record(s) are touched:
          * ``'all'`` (default) — slug subdomain AND custom domain.
          * ``'subdomain'`` — only the slug subdomain. Useful when the
            operator hits "refresh" on the subdomain chip.
          * ``'custom'`` — only the custom-domain CNAME. Useful when the
            slug record is healthy but the custom CNAME failed.

        Persists ``fqdn``, ``dns_record_id``, ``custom_domain_record_id``,
        ``dns_status``, ``dns_synced_at`` (and ``dns_error`` on failure).
        Failures are caught: the tenant row is never rolled back.
        """
        # The VENDOR has no subdomain of its own — its traffic uses the
        # zone apex, managed outside this service. Customer tenants
        # (including the fallback one) all get a real subdomain.
        if getattr(tenant, 'is_platform', False):
            tenant.dns_status = DNS_DISABLED
            tenant.fqdn = None
            tenant.dns_synced_at = datetime.now(timezone.utc)
            tenant.dns_error = None
            db.session.commit()
            return

        try:
            binding = binding_for_tenant(tenant)
        except CloudflareConfigError as exc:
            tenant.dns_status = DNS_DISABLED
            tenant.dns_error = str(exc)[:500]
            db.session.commit()
            return

        try:
            if scope in ('all', 'subdomain'):
                CloudflareDnsService.sync_subdomain(tenant, binding=binding)
            if scope in ('all', 'custom'):
                CloudflareDnsService.sync_custom_domain(tenant, binding=binding)

            tenant.dns_status = DNS_ACTIVE
            tenant.dns_error = None
            tenant.dns_synced_at = datetime.now(timezone.utc)
            db.session.commit()
            logger.info(
                '[CF] Synced tenant %s (scope=%s, zone=%s) -> %s',
                tenant.slug, scope, binding.source, tenant.fqdn,
            )

        except Exception as exc:
            logger.exception(
                '[CF] sync_tenant(%s, scope=%s) failed', tenant.slug, scope,
            )
            tenant.dns_status = DNS_FAILED
            tenant.dns_error = str(exc)[:500]
            tenant.dns_synced_at = datetime.now(timezone.utc)
            db.session.commit()

    @staticmethod
    def delete_custom_domain(tenant) -> None:
        """Delete ONLY the tenant's custom-domain CNAME (leave slug intact).

        Called when an operator unsets / fails verification for a custom
        domain — we want to stop routing for the custom name immediately
        without disturbing the working ``<slug>.<base_domain>`` record.
        Idempotent: missing records are silently ignored.
        """
        if not tenant.custom_domain_record_id:
            return
        try:
            binding = binding_for_tenant(tenant)
        except CloudflareConfigError:
            return
        try:
            CloudflareDnsService.delete_record(
                tenant.custom_domain_record_id, binding=binding)
        finally:
            tenant.custom_domain_record_id = None
            db.session.commit()

    @staticmethod
    def deprovision_tenant(tenant) -> None:
        """Remove tenant CNAMEs from Cloudflare. Called on soft-delete /
        suspension. Safe to re-run — missing records are ignored.

        Deletion resolves the SAME binding provisioning would, so a
        reseller child's records are removed from the apex zone. If the
        apex disconnected its zone after provisioning, the persisted
        record ids point at a zone we can no longer reach — the delete
        is then attempted against the platform zone and swallowed as
        not-found (the orphan record in the apex's own account is theirs
        to clean; we have no credentials for it by definition).
        """
        try:
            binding = binding_for_tenant(tenant)
        except CloudflareConfigError:
            return
        try:
            if tenant.dns_record_id:
                CloudflareDnsService.delete_record(
                    tenant.dns_record_id, binding=binding)
                tenant.dns_record_id = None
            if tenant.custom_domain_record_id:
                CloudflareDnsService.delete_record(
                    tenant.custom_domain_record_id, binding=binding)
                tenant.custom_domain_record_id = None
            tenant.fqdn = None
            tenant.dns_status = DNS_DISABLED
            tenant.dns_error = None
            tenant.dns_synced_at = datetime.now(timezone.utc)
            db.session.commit()
        except Exception as exc:
            logger.exception('[CF] deprovision_tenant(%s) failed', tenant.slug)
            tenant.dns_error = str(exc)[:500]
            tenant.dns_status = DNS_FAILED
            db.session.commit()
