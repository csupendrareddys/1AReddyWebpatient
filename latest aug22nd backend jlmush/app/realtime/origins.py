"""Connect-time Origin allow-list for Socket.IO.

python-socketio's ``cors_allowed_origins`` only understands exact strings or
'*', so it cannot express the wildcard tenant-subdomain rule the HTTP layer
uses (``re:^https://[a-z0-9-]+\\.larazen\\.in$``). We therefore set the
transport-level CORS permissively and enforce the REAL policy here, in the
connect handler, by re-applying the exact same ``CORS_ORIGINS`` semantics as
app/extensions.py (literal origin, ``re:`` regex, or ``*``).

This is parsed once per process and cached on the app so every handshake is a
cheap match.
"""
import re

_CACHE_ATTR = '_socket_origin_matchers'


def _build_matchers(cors_origins_raw):
    """Turn a CORS_ORIGINS config value into a list of matchers.

    Mirrors the parser in app/extensions.py so HTTP and Socket.IO agree on which
    origins are allowed. A matcher is either the literal string '*', a lowercase
    exact-origin string, or a compiled regex (from a ``re:`` entry).
    """
    if cors_origins_raw == '*' or (
        isinstance(cors_origins_raw, list) and '*' in cors_origins_raw
    ):
        return ['*']

    raw_list = (
        cors_origins_raw if isinstance(cors_origins_raw, list)
        else [o.strip() for o in str(cors_origins_raw or '').split(',') if o.strip()]
    )
    matchers = []
    for entry in raw_list:
        entry = entry.strip()
        if not entry:
            continue
        if entry.startswith('re:'):
            matchers.append(re.compile(entry[3:]))
        else:
            matchers.append(entry.lower())
    return matchers


def origin_allowed(app, origin):
    """True if ``origin`` (the handshake's Origin header) is permitted.

    A missing Origin (native mobile clients, server-to-server) is allowed —
    browser CORS only applies when an Origin is present, and the JWT is still
    required regardless. When Origin IS present it must match the tenant policy.
    """
    if not origin:
        return True

    matchers = getattr(app, _CACHE_ATTR, None)
    if matchers is None:
        matchers = _build_matchers(app.config.get('CORS_ORIGINS', '*'))
        setattr(app, _CACHE_ATTR, matchers)

    origin_l = origin.lower()
    for m in matchers:
        if m == '*':
            return True
        if isinstance(m, str):
            if m == origin_l:
                return True
        elif m.match(origin):  # compiled regex — match against original case
            return True
    # DB-driven fallback, mirroring register_tenant_domain_cors on the
    # HTTP side: an active tenant's custom domain, or a reseller child
    # served from its apex's connected zone (P4), is a legitimate origin
    # even though the static CORS_ORIGINS env can't know about it.
    # Never-break: any DB hiccup just means "not allowed", same as today.
    try:
        from urllib.parse import urlparse
        host = (urlparse(origin_l).hostname or '').lower()
        if not host:
            return False
        from app.models import Tenant, TenantDnsConfig

        def _active(t):
            return t is not None and str(
                getattr(t.status, 'value', t.status)).lower() == 'active'

        candidates = {host}
        candidates.add(host[4:] if host.startswith('www.') else 'www.' + host)
        t = Tenant.query.filter(
            Tenant.domain.in_(candidates), Tenant.is_deleted.is_(False),
        ).first()
        if _active(t):
            return True
        first_label, _, zone_apex = host.partition('.')
        if first_label and zone_apex:
            cfg = TenantDnsConfig.for_base_domain(zone_apex)
            if cfg is not None:
                child = Tenant.query.filter_by(
                    slug=first_label, parent_tenant_id=cfg.tenant_id,
                    is_deleted=False,
                ).first()
                if _active(child):
                    return True
    except Exception:  # noqa: BLE001 — origin checks must never crash connect
        pass
    return False
