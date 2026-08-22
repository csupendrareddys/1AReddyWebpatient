#!/usr/bin/env python
"""Phase 1 verification: five-stage health check across every active
tenant + a cross-tenant probe that catches Vary/cache misconfig.

Run as cron (daily) and during incident response:

    python scripts/verify_tenant_domains.py
    python scripts/verify_tenant_domains.py --tenant=acme

Exits 0 on full success, non-zero on any failure. Output is a single
table — green ticks for OK, red X for fail, with the failing reason.

Stages per tenant (must all pass):

  1. DB integrity
       The tenants row exists, status=active, slug populated,
       domain populated.

  2. DNS resolution
       The tenant's domain resolves to at least one A/CNAME.

  3. TLS handshake
       ``https://<domain>`` completes a TLS handshake (cert covers
       the host). HTTP-level response status doesn't matter here —
       just that the connection establishes.

  4. Tenant identity match
       ``GET https://<domain>/api/landing/public`` returns 200, and
       the response body identifies the EXPECTED tenant (slug
       compared against the DB row). A platform-marketing response
       on a tenant domain proves the routing or Vary: Host config
       drifted.

  5. Cross-tenant probe
       ``GET https://<domain>/api/landing/public`` with the
       ``X-Tenant-Host`` header forced to a DIFFERENT tenant's
       domain. Backend should NOT serve the other tenant's content.
       Catches CDN cache key bugs and any future regression where
       the resolver becomes accidentally JWT-then-ignored.

Bypassing /health: that endpoint is middleware-bypassed and tells
us nothing about tenant routing. Use a tenant-aware endpoint.

Notes:
  * The script reads the DB directly (so it requires DATABASE_URL
    in the environment) — same connection string the backend uses.
  * No credentials are required; only public landing endpoints are
    probed. Auth surface is exercised by pytest, not this script.
  * The cross-tenant probe is best-effort: if the DB has fewer than
    two custom-domain tenants, stage 5 is skipped per row with a
    note rather than failed.
"""
import argparse
import json
import os
import socket
import ssl
import sys
import time
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    print('ERROR: pip install requests', file=sys.stderr)
    sys.exit(2)


# ANSI for the CLI report. Falls back to bare text on non-TTY.
def _c(code, s):
    return f'\033[{code}m{s}\033[0m' if sys.stdout.isatty() else s


OK = lambda s='OK': _c('32', f'✓ {s}')      # green
FAIL = lambda s: _c('31', f'✗ {s}')          # red
WARN = lambda s: _c('33', f'• {s}')          # yellow
DIM = lambda s: _c('90', s)


# ─────────────────────────────────────────────────────────────────── #
# Stage helpers
# ─────────────────────────────────────────────────────────────────── #


def stage_db_integrity(tenant):
    """Stage 1 — every required field present + ACTIVE."""
    if not tenant.get('slug'):
        return False, 'slug is empty'
    if not tenant.get('domain'):
        return False, 'domain is empty'
    if (tenant.get('status') or '').lower() != 'active':
        return False, f"status={tenant.get('status')!r} (expected 'active')"
    if tenant.get('is_deleted'):
        return False, 'is_deleted=True'
    return True, 'row OK'


def stage_dns_resolves(domain):
    """Stage 2 — DNS responds (A or CNAME)."""
    try:
        addrs = socket.getaddrinfo(domain, 443, type=socket.SOCK_STREAM)
        if not addrs:
            return False, 'no A/CNAME returned'
        ip = addrs[0][4][0]
        return True, f'resolves → {ip}'
    except socket.gaierror as e:
        return False, f'gaierror: {e}'


def stage_tls_handshake(domain, timeout=8):
    """Stage 3 — TLS completes; cert covers the host."""
    ctx = ssl.create_default_context()
    try:
        with socket.create_connection((domain, 443), timeout=timeout) as sock:
            with ctx.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                # SAN/CN match was already enforced by the wrap_socket
                # call (default ctx verifies). We just confirm we got
                # a cert back.
                return bool(cert), 'TLS handshake OK' if cert else 'no cert'
    except (ssl.SSLError, socket.timeout, ConnectionError, OSError) as e:
        return False, f'{type(e).__name__}: {e}'


def stage_tenant_identity(domain, expected_slug, timeout=10):
    """Stage 4 — public landing identifies THIS tenant."""
    url = f'https://{domain}/api/landing/public'
    try:
        r = requests.get(url, timeout=timeout)
    except requests.RequestException as e:
        return False, f'GET failed: {e}'
    if r.status_code != 200:
        return False, f'GET → HTTP {r.status_code}'
    try:
        body = r.json()
    except json.JSONDecodeError:
        return False, 'response not JSON'
    # The landing payload shape varies a bit across endpoints; check
    # any reasonable identification field.
    candidates = []
    data = (body or {}).get('data') or {}
    for key in ('tenant_slug', 'slug'):
        v = data.get(key) or body.get(key)
        if v:
            candidates.append(str(v).lower())
    if not candidates:
        return False, 'no tenant_slug in response'
    if expected_slug.lower() not in candidates:
        return False, (
            f'mismatch: expected slug={expected_slug!r}, got {candidates!r}'
        )
    return True, f'slug={expected_slug}'


def stage_cross_tenant_probe(domain, foreign_domain, expected_slug,
                             foreign_slug, timeout=10):
    """Stage 5 — forcing X-Tenant-Host to a DIFFERENT tenant's domain
    must NOT yield that tenant's content."""
    url = f'https://{domain}/api/landing/public'
    try:
        r = requests.get(
            url,
            headers={'X-Tenant-Host': foreign_domain},
            timeout=timeout,
        )
    except requests.RequestException as e:
        return False, f'GET failed: {e}'
    # Either backend rejects with a 4xx (good — tenant resolved on
    # server-side host so the fake header was ignored or rejected),
    # or it returns 200 but with THIS tenant's content (also good).
    # The bad outcome is a 200 carrying the FOREIGN tenant's content.
    if r.status_code >= 400:
        return True, f'rejected with HTTP {r.status_code} (good)'
    try:
        body = r.json()
    except json.JSONDecodeError:
        return True, 'non-JSON response (acceptable; not foreign content)'
    data = (body or {}).get('data') or {}
    served_slug = (
        data.get('tenant_slug')
        or data.get('slug')
        or body.get('tenant_slug')
        or body.get('slug')
        or ''
    )
    if not served_slug:
        return True, 'response had no slug (acceptable)'
    served_slug = str(served_slug).lower()
    if served_slug == foreign_slug.lower():
        return False, (
            f'cross-tenant LEAK: header={foreign_domain!r} got '
            f'foreign tenant {foreign_slug!r}'
        )
    return True, f'served own tenant={served_slug!r} (good)'


# ─────────────────────────────────────────────────────────────────── #
# DB readout
# ─────────────────────────────────────────────────────────────────── #


def fetch_tenants():
    """Bypass the Flask app — read the tenants table directly via
    psycopg2. Keeps the script light (no app factory, no migrations
    side-effects, runs from cron without Redis)."""
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        print('ERROR: DATABASE_URL not set', file=sys.stderr)
        sys.exit(2)
    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        print('ERROR: pip install psycopg2-binary', file=sys.stderr)
        sys.exit(2)

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT id, slug, name, domain, status,
                       COALESCE(is_deleted, false) AS is_deleted,
                       COALESCE(is_default, false) AS is_default
                FROM tenants
                WHERE COALESCE(is_deleted, false) = false
                  AND domain IS NOT NULL
                  AND domain <> ''
                ORDER BY is_default DESC, slug
            """)
            return list(cur.fetchall())
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────── #
# Driver
# ─────────────────────────────────────────────────────────────────── #


def run(args):
    tenants = fetch_tenants()
    if args.tenant:
        tenants = [t for t in tenants if t['slug'] == args.tenant]
        if not tenants:
            print(FAIL(f"no tenant with slug={args.tenant!r}"))
            return 2

    # Build the "foreign tenant" pool for stage 5 (any other custom-
    # domain tenant). Skip rows where there's only one tenant total.
    pool = [t for t in tenants if not t.get('is_default') and t.get('domain')]
    print(DIM(
        f'Verifying {len(tenants)} tenant(s); '
        f'{len(pool)} eligible for cross-tenant probe.'
    ))
    print()

    overall_ok = True
    for t in tenants:
        slug = t['slug']
        domain = t['domain']
        print(_c('1', f'━━━ {slug}  ({domain}) ━━━'))

        # Stage 1
        ok, msg = stage_db_integrity(t)
        print(f"  [1] DB integrity     {OK(msg) if ok else FAIL(msg)}")
        if not ok:
            overall_ok = False
            print()
            continue  # later stages would all fail; skip to next.

        # Stage 2
        ok, msg = stage_dns_resolves(domain)
        print(f"  [2] DNS              {OK(msg) if ok else FAIL(msg)}")
        if not ok:
            overall_ok = False
            print()
            continue

        # Stage 3
        ok, msg = stage_tls_handshake(domain)
        print(f"  [3] TLS              {OK(msg) if ok else FAIL(msg)}")
        if not ok:
            overall_ok = False
            print()
            continue

        # Stage 4
        ok, msg = stage_tenant_identity(domain, slug)
        print(f"  [4] Identity match   {OK(msg) if ok else FAIL(msg)}")
        if not ok:
            overall_ok = False
            print()
            continue

        # Stage 5 — pick a foreign tenant. If none exists, skip.
        foreign = next((p for p in pool if p['slug'] != slug), None)
        if not foreign:
            print(f"  [5] Cross-tenant     {WARN('skipped — no other tenant')}")
        else:
            ok, msg = stage_cross_tenant_probe(
                domain, foreign['domain'], slug, foreign['slug'],
            )
            print(f"  [5] Cross-tenant     {OK(msg) if ok else FAIL(msg)}")
            if not ok:
                overall_ok = False

        print()

    if overall_ok:
        print(OK('All tenants healthy.'))
        return 0
    print(FAIL('One or more checks failed. See output above.'))
    return 1


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--tenant', help='Limit to a single tenant slug.')
    p.add_argument(
        '--timeout', type=int, default=8,
        help='Per-stage HTTP/TLS timeout in seconds (default: 8).',
    )
    args = p.parse_args()
    sys.exit(run(args))


if __name__ == '__main__':
    main()
