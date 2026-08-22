"""
Application Factory Module
Creates and configures the Flask application
"""
import time
import random
import logging
from flask import Flask, jsonify, request, g
from config import get_config

logger = logging.getLogger(__name__)


def create_app(config_name=None, config_override=None):
    """
    Application factory function.

    Args:
        config_name: Configuration environment name ('development', 'testing', 'production')
        config_override: Optional dict of config values to override (useful for testing)

    Returns:
        Configured Flask application instance
    """
    import os

    # Crash reporting — dormant unless SENTRY_DSN is set (prod/staging).
    # Guarded import so a container built before sentry-sdk landed in
    # requirements still boots. PII stays out: send_default_pii=False and
    # no request bodies; Sentry sees stack traces + request ids only.
    sentry_dsn = os.environ.get('SENTRY_DSN')
    if sentry_dsn:
        try:
            import sentry_sdk
            from sentry_sdk.integrations.flask import FlaskIntegration
            sentry_sdk.init(
                dsn=sentry_dsn,
                integrations=[FlaskIntegration()],
                environment=os.environ.get('APP_ENV', 'development'),
                release=os.environ.get('APP_RELEASE') or None,
                send_default_pii=False,
                traces_sample_rate=float(os.environ.get('SENTRY_TRACES_RATE', '0')),
            )
            logger.info("[APP] Sentry crash reporting enabled (env=%s)",
                        os.environ.get('APP_ENV', 'development'))
        except ImportError:
            logger.warning("[APP] SENTRY_DSN set but sentry-sdk not installed")

    app = Flask(__name__)

    # Load configuration
    config_class = get_config(config_name)
    app.config.from_object(config_class)

    # Apply any test/runtime overrides
    if config_override:
        app.config.update(config_override)

    logger.info(f"[APP] Config loaded: {config_class.__name__}")

    # Phase 3 — wrap WSGI with ProxyFix when the deployment is behind
    # a trusted reverse proxy (Cloudflare → ALB → app, or similar).
    # Reads ``X-Forwarded-Host`` / ``X-Forwarded-Proto`` and updates
    # ``request.host`` / ``request.scheme`` accordingly so the rest of
    # the app sees the ORIGINAL client-facing host. Without this,
    # ``request.host`` is the internal LB hostname and tenant
    # resolution can't see the real Host the user typed.
    #
    # OFF by default. Operators must explicitly opt in via env after
    # auditing their proxy chain (the proxy must strip incoming
    # X-Forwarded-* headers from external clients — otherwise an
    # attacker can spoof them).
    if app.config.get('BACKEND_TRUST_X_FORWARDED_HOST'):
        from werkzeug.middleware.proxy_fix import ProxyFix
        app.wsgi_app = ProxyFix(
            app.wsgi_app,
            x_for=1,    # one trusted hop sets X-Forwarded-For
            x_proto=1,  # ...and X-Forwarded-Proto
            x_host=1,   # ...and X-Forwarded-Host (the bit we actually need)
            x_port=0,
            x_prefix=0,
        )
        logger.info(
            "[APP] ProxyFix enabled (x_for=x_proto=x_host=1). "
            "TRUSTED_PROXY_IPS=%s",
            list(app.config.get('TRUSTED_PROXY_IPS') or []) or '(none — relying on ProxyFix hop count)',
        )

    # Validate production config (fail fast if required env vars missing)
    if os.environ.get('FLASK_ENV') == 'production':
        from config import validate_production_config
        validate_production_config()
        logger.info("[APP] Production config validated")

    # Initialize extensions (includes DB validation in production)
    from app.extensions import init_extensions, db
    init_extensions(app)
    logger.info("[APP] Extensions initialized")

    # Register blueprints
    register_blueprints(app)
    logger.info("[APP] Blueprints registered")

    # Register Socket.IO event handlers (real-time communication channel).
    # Imported here — after blueprints, inside the factory — so the module's
    # @socketio.on decorators run exactly once per process and can safely import
    # db/models/socketio from app.extensions without a circular import.
    register_socketio(app)
    logger.info("[APP] Socket.IO handlers registered")

    # Register error handlers
    register_error_handlers(app)

    # Client identification (X-Client / X-Client-Version / X-Device-Id),
    # per-request request_id (echoed as X-Request-Id), min-version gate,
    # and the shipped JSON access log. Registered before the debug request
    # logging so every later hook sees g.request_id.
    from app.common.client_context import register_client_context
    register_client_context(app)

    # Register request logging middleware
    register_request_logging(app)

    # Per-tenant custom-domain CORS. Registered BEFORE the tenant-
    # context hook so OPTIONS preflight requests from a tenant's
    # custom domain (e.g. ``https://www.vedanthzen.com``) get a 200
    # immediately, without going through JWT validation / RLS setup.
    # Flask-CORS only handles the static ``CORS_ORIGINS`` list; any
    # tenant the platform owner adds at runtime would otherwise be
    # rejected at the browser preflight.
    register_tenant_domain_cors(app)

    # Add ``Vary: Host`` to every response so CDN/browser caches don't
    # serve one tenant's content under another's hostname. Cheap; one
    # header. Mandatory now that tenant resolution is host-driven.
    register_vary_host(app)

    # Register tenant-context hook (sets g.tenant_id + PostgreSQL RLS variable
    # before each authenticated request so tenant isolation is enforced).
    register_tenant_context(app)

    # Start background scheduler for payment expiry cleanup
    _start_scheduler(app)

    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    # Register a custom JSON provider so Python enums are auto-serialized
    _register_json_provider(app)

    return app


def _register_json_provider(app):
    """
    Override Flask's default JSON provider so that Python ``enum.Enum``
    values are automatically serialised to their ``.value`` string.
    This prevents ``TypeError: Object of type … is not JSON serializable``
    across every route.
    """
    import enum as _enum
    from flask.json.provider import DefaultJSONProvider

    class EnumAwareJSONProvider(DefaultJSONProvider):
        def default(self, o):
            if isinstance(o, _enum.Enum):
                return o.value
            return super().default(o)

    app.json_provider_class = EnumAwareJSONProvider
    app.json = EnumAwareJSONProvider(app)


def _start_scheduler(app):
    """Start APScheduler -- only on one worker (Redis lock)."""
    try:
        from app.extensions import get_redis_client
        redis = get_redis_client()
        if redis:
            # Only one Gunicorn worker acquires the lock; others skip
            acquired = redis.set('scheduler:leader', '1', nx=True, ex=600)
            if not acquired:
                logger.info("[APP] Another worker is running the scheduler, skipping")
                return

        from apscheduler.schedulers.background import BackgroundScheduler
        from app.api.common.payment.expiry_job import expire_unpaid_appointments
        from app.api.common.payment.payout_hold_job import promote_matured_payouts_job

        from app.api.common.video.room_scheduler import create_upcoming_video_rooms
        from app.api.service_communication.retention_job import (
            expire_due_services, purge_expired_channels,
        )

        scheduler = BackgroundScheduler()
        scheduler.add_job(
            func=expire_unpaid_appointments,
            args=[app],
            trigger='interval',
            minutes=5,
            id='payment_expiry_cleanup',
            replace_existing=True,
        )
        scheduler.add_job(
            func=promote_matured_payouts_job,
            args=[app],
            trigger='interval',
            minutes=15,
            id='payout_hold_promotion',
            replace_existing=True,
        )
        scheduler.add_job(
            func=create_upcoming_video_rooms,
            args=[app],
            trigger='interval',
            minutes=1,
            id='video_room_precreation',
            replace_existing=True,
        )
        # Service Communication: flip elapsed services to read-only (15 min),
        # and purge channels past their retention window (hourly).
        scheduler.add_job(
            func=expire_due_services, args=[app], trigger='interval',
            minutes=15, id='service_comm_expiry', replace_existing=True,
        )
        scheduler.add_job(
            func=purge_expired_channels, args=[app], trigger='interval',
            minutes=60, id='service_comm_retention', replace_existing=True,
        )

        # SaaS subscription lifecycle (Phase 5): daily over-limit +
        # billing/dunning reconciliation at a quiet hour.
        from app.api.pricing.subscription_billing import (
            run_daily_subscription_sweeps,
        )
        scheduler.add_job(
            func=run_daily_subscription_sweeps, args=[app], trigger='cron',
            hour=2, minute=30, id='subscription_sweeps',
            replace_existing=True,
        )
        # DPDP retention-expiry purge: monthly, APPLIED (every action is
        # stamped onto the permanent deletion register).
        from app.common.retention import run_scheduled_purge
        scheduler.add_job(
            func=run_scheduled_purge, args=[app], trigger='cron',
            day=1, hour=3, minute=0, id='retention_purge',
            replace_existing=True,
        )

        # Ship JSON access/audit logs to S3 (LOG_S3_BUCKET) hourly; without
        # a bucket it only prunes old local files so dev disks don't fill.
        from app.common.log_shipper import run_log_shipping
        scheduler.add_job(
            func=run_log_shipping, args=[app], trigger='interval',
            minutes=60, id='log_shipping', replace_existing=True,
        )

        # Transactional-outbox sweep: retries failed provider sends
        # (SMS/email/push) with backoff, recovers stuck claims, and
        # dead-letters expired/exhausted rows. The fast path is the
        # post-commit immediate attempt — this is the safety net.
        from app.services.outbox import run_outbox_sweep
        scheduler.add_job(
            func=run_outbox_sweep, args=[app], trigger='interval',
            seconds=60, id='outbox_sweep', replace_existing=True,
        )

        scheduler.start()
        logger.info("[APP] Payment expiry scheduler started (runs every 5 min)")
        logger.info("[APP] Video room pre-creation scheduler started (runs every 1 min)")
        logger.info("[APP] Subscription sweeps scheduled daily 02:30; "
                    "retention purge monthly day=1 03:00")
    except ImportError:
        logger.warning("[APP] apscheduler not installed — expiry cleanup disabled. Run: pip install apscheduler")
    except Exception as e:
        logger.warning("[APP] Could not start scheduler: %s", e)


def register_tenant_domain_cors(app):
    """Allow CORS for tenant-supplied custom domains at runtime.

    The static ``CORS_ORIGINS`` env var only knows about the platform's
    own host(s) plus the slug-subdomain regex. Tenants who attach a
    custom domain (``vedanthzen.com``, ``www.jlmush.in``) are added to
    the DB at runtime — Flask-CORS would silently 403 their preflight
    because their origin doesn't match any pattern.

    This hook does the dynamic part:

      * On any incoming request, look at the ``Origin`` header. If the
        origin's hostname matches an ``active`` row in ``tenants.domain``
        (or a ``www.`` variant of one), allow it.
      * For ``OPTIONS`` preflight requests from a matching origin,
        return ``200`` with the right ``Access-Control-*`` headers
        immediately — without running JWT / tenant-context resolution
        (preflight requests don't carry credentials).
      * For real requests, set ``Access-Control-Allow-Origin`` etc. on
        the response *if* Flask-CORS didn't already (i.e. the origin
        wasn't in the static list).

    Locked-down: only origins that match a real tenant in the DB are
    allowed. Arbitrary third-party origins still get rejected.
    """
    from urllib.parse import urlparse
    from flask import make_response

    # Headers the frontend axios layer might send. Mirror what's in
    # ``app/extensions.py``'s flask-cors config so preflight responses
    # match.
    ALLOWED_HEADERS = (
        'Content-Type, Authorization, X-CSRF-TOKEN, X-Tenant-Slug, '
        'X-Tenant-Host, Cache-Control, Headers, Pragma, Expires, '
        'X-Client, X-Client-Version, X-Device-Id'
    )
    ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'

    def _origin_matches_tenant(origin):
        """Return the matching tenant row if ``origin`` (a full URL with
        scheme) corresponds to an active tenant's custom domain.
        Strips an optional leading ``www.`` so adding ``vedanthzen.com``
        also allows ``www.vedanthzen.com`` and vice versa."""
        if not origin:
            return None
        try:
            host = urlparse(origin).hostname
        except Exception:  # noqa: BLE001 — defensive
            return None
        if not host:
            return None
        host = host.lower()

        # Try exact + with/without www. prefix.
        candidates = {host}
        if host.startswith('www.'):
            candidates.add(host[4:])
        else:
            candidates.add('www.' + host)

        from app.models import Tenant
        # ``domain`` is unique + indexed; this is one cheap lookup per
        # request. No caching — keeps tenant onboarding instant.
        tenant = Tenant.query.filter(
            Tenant.domain.in_(candidates),
            Tenant.is_deleted.is_(False),
        ).first()
        if tenant:
            return tenant
        # Reseller P4: a CHILD served from its apex's own zone
        # (``sunrise.larazen.in``). Same one-lookup shape as host
        # resolution: first label = child slug, remainder = a zone some
        # apex connected via TenantDnsConfig. The status gate downstream
        # applies to the CHILD row, so suspending a child cuts its CORS
        # exactly like any custom-domain tenant.
        first_label, _, zone_apex = host.partition('.')
        if first_label and zone_apex:
            from app.models import TenantDnsConfig
            cfg = TenantDnsConfig.for_base_domain(zone_apex)
            if cfg is not None:
                child = Tenant.query.filter_by(
                    slug=first_label,
                    parent_tenant_id=cfg.tenant_id,
                    is_deleted=False,
                ).first()
                if child:
                    return child
        return None

    @app.before_request
    def _tenant_domain_cors_preflight():
        if request.method != 'OPTIONS':
            return None
        origin = request.headers.get('Origin')
        if not origin:
            return None
        tenant = _origin_matches_tenant(origin)
        if not tenant:
            return None  # Let flask-cors / the route handle it.
        # Active check — suspended/inactive tenants don't get CORS.
        if str(getattr(tenant.status, 'value', tenant.status)).lower() != 'active':
            return None
        resp = make_response('', 200)
        resp.headers['Access-Control-Allow-Origin'] = origin
        resp.headers['Access-Control-Allow-Credentials'] = 'true'
        resp.headers['Access-Control-Allow-Methods'] = ALLOWED_METHODS
        resp.headers['Access-Control-Allow-Headers'] = ALLOWED_HEADERS
        resp.headers['Access-Control-Max-Age'] = '600'
        resp.headers['Vary'] = 'Origin'
        return resp

    @app.after_request
    def _tenant_domain_cors_response(response):
        # Skip if flask-cors already echoed an Allow-Origin (it
        # matched the static list — nothing more to do).
        if response.headers.get('Access-Control-Allow-Origin'):
            return response
        origin = request.headers.get('Origin')
        if not origin:
            return response
        tenant = _origin_matches_tenant(origin)
        if not tenant:
            return response
        if str(getattr(tenant.status, 'value', tenant.status)).lower() != 'active':
            return response
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        # Mirror flask-cors's expose list — without this, JS on a
        # tenant's custom domain can't read X-Request-Id off responses
        # (the static-list path exposes it; this DB-driven path must too).
        response.headers['Access-Control-Expose-Headers'] = (
            'Content-Type, X-CSRF-TOKEN, X-Request-Id'
        )
        # Make caches partition by Origin so we don't serve a wrong
        # CORS header to a different tenant.
        existing_vary = response.headers.get('Vary', '')
        if 'Origin' not in existing_vary:
            response.headers['Vary'] = (
                f'{existing_vary}, Origin' if existing_vary else 'Origin'
            )
        return response


def register_vary_host(app):
    """Add ``Vary: Host`` to every response.

    Why: tenant resolution depends on the request's host (``request.host``
    or the ``X-Tenant-Host`` header). If a CDN or browser cache shares a
    response across hosts, two tenants would collide on the same cache
    key and one tenant's content would leak to another. ``Vary: Host``
    instructs caches to keep responses partitioned by hostname.

    Applies unconditionally — public reads, authenticated reads, all of
    them. Cheap (one header), and the cost of a missed Vary on a tenant-
    scoped response is a cross-tenant data leak via cache. Cloudflare
    cache rules also need ``Host`` in the cache key — verify in CF
    dashboard during deploy.
    """
    @app.after_request
    def _add_vary_host(response):
        existing = response.headers.get('Vary', '')
        if not existing:
            response.headers['Vary'] = 'Host'
        elif 'Host' not in existing.split(','):
            # Preserve existing Vary entries (Origin, Accept-Encoding, …).
            response.headers['Vary'] = f'{existing}, Host'
        return response


def register_tenant_context(app):
    """Resolve the current tenant on every request and attach it to both
    Flask's :data:`g` and the PostgreSQL session (for Row-Level Security).

    Resolution order (first match wins):
      1. ``tenant_id`` claim on the JWT (set at signin) — common authed case.
      2. ``X-Tenant-Slug`` request header — used by unauthenticated requests
         (signup, public endpoints) when the frontend is on a tenant subdomain.
      3. Default tenant (``Tenant.is_default=True``) as a fail-closed fallback
         for anonymous traffic so RLS-enabled tables don't starve public
         flows. Anonymous callers can only ever see the default tenant's
         public data.

    Platform-owner cross-tenant operations (seed a new tenant's landing
    config, list another tenant's admins, etc.) do NOT flow through this
    hook. They live under ``/api/platform/*`` and use
    :func:`app.common.tenant_context.with_tenant_context` to briefly switch
    the session tenant for the explicit scope of one request handler. This
    keeps the platform owner tenant-isolated on the generic ``/api/admin/*``
    surface — they see only their own tenant's patients/doctors/etc, exactly
    like any other tenant super-admin.
    """
    from flask_jwt_extended import verify_jwt_in_request, get_jwt, current_user
    from flask import jsonify
    from app.models._base import set_tenant_context
    from app.extensions import db

    # Endpoint classes that require **strict** tenant resolution
    # (Phase 0 — auth + unauthenticated mutations).
    #
    # Strict means: if we can't resolve a tenant from the request's
    # host/header context, we reject (404) instead of falling back to
    # the platform default tenant. Closes the cross-tenant signin
    # leak where a patient on tenant A could authenticate from tenant
    # B's host because resolution silently routed to default.
    #
    # Public GET endpoints (landing, page-config) keep the
    # default-tenant fallback for now — they need it for anonymous
    # platform-apex visitors to see the marketing landing without an
    # explicit X-Tenant-* header. Tightening reads is Phase 3.
    # Every prefix here must match a REAL route. The previous list
    # carried four stale names (/auth/signin-otp, /auth/signup-otp,
    # /auth/password-reset, /auth/phone/) that matched nothing — so OTP
    # login, forgot-password and the pre-signup OTP flows silently fell
    # back to the DEFAULT tenant whenever a client omitted the host
    # header. Harmless for the web app (axios always sends it); a real
    # cross-tenant risk for mobile clients that forget it.
    _STRICT_PATH_PREFIXES = (
        '/api/v1/auth/signin',             # password login
        '/api/v1/auth/signup',                    # patient + doctor/clinic/hospital
        '/api/v1/auth/login-via-otp',             # passwordless OTP login
        '/api/v1/auth/pre-signup/',               # phone/email OTP send + verify
        '/api/v1/auth/forgot-password',
        '/api/v1/auth/verify-reset-otp',
        '/api/v1/auth/reset-password',
        '/api/v1/auth/send-phone-otp',
        '/api/v1/auth/resend-phone-otp',
        '/api/v1/auth/send-email-otp',
        '/api/v1/auth/verify-email-otp',
        '/api/v1/auth/resend-email-otp',
        '/api/v1/auth/email/send-verification',
        '/api/v1/auth/email/verify',
        # Credential-based session management (unauthenticated mutations).
        '/api/v1/auth/force-logout-all',
        '/api/v1/auth/force-logout-session',
    )

    def _is_strict_path():
        """True iff the current path requires a real tenant match
        (no fallback to default). Auth endpoints + any
        unauthenticated state-changing path."""
        path = request.path or ''
        if any(path.startswith(p) for p in _STRICT_PATH_PREFIXES):
            return True
        # Unauthenticated mutations: POST/PUT/PATCH/DELETE on a
        # non-/auth, non-/api/platform path with no JWT. We don't
        # have a clean enumeration here in Phase 0; rely on the
        # auth-prefix list above + per-route ``g.tenant_id``
        # checks for now. Phase 3 widens this.
        return False

    def _platform_base_domain():
        """The managed DNS zone tenant subdomains live under.

        This is the ZONE -- the thing that makes ``<slug>.<zone>``
        resolve to a tenant -- and NOT the vendor's own host. The two
        were the same string while the vendor was the apex tenant. They
        are not after the split: the zone stays with Larazen along with
        every ``<slug>.larazen.in`` already in the wild, while the
        vendor moves to its own domain. ``_is_platform_host`` answers
        the vendor question separately, off the vendor's row.

        Resolution order, primary -> fallback:
          1. ``CLOUDFLARE_BASE_DOMAIN`` env var. The canonical source;
             also drives Cloudflare DNS provisioning.
          2. ``request.host`` minus a leading ``api.``. Last-resort
             derivation: when the API serves at ``api.<zone>``, the
             zone is ``<zone>``.

        A step between those two used to read the default tenant's
        ``domain``, so an operator who stamped the apex onto the row but
        forgot the env var still got working host resolution. That was
        sound while the default tenant WAS the apex and the apex owned
        the zone. The default tenant is now the vendor, whose domain is
        its marketing site, so the fallback would confidently return the
        wrong zone -- and every tenant would be told its portal lives at
        ``<slug>.<vendor-domain>``, a hostname nothing serves.

        Returning '' is the better failure: callers already treat it as
        "unknown" and skip the subdomain rule rather than match against
        a bogus suffix. The zone is a deployment fact, so it has to be
        configured; docker-compose defaults it to ``localhost`` for dev.

        Returns the lowercase zone, or '' if nothing's resolvable."""
        env_base = (app.config.get('CLOUDFLARE_BASE_DOMAIN') or '').strip().lower()
        if env_base:
            return env_base
        # Fallback: derive from the API's own host.
        try:
            from flask import request as _req
            host = (_req.host or '').split(':', 1)[0].lower()
            if host.startswith('api.'):
                return host[4:]
        except Exception:
            pass
        return ''

    def _is_platform_host(host_clean):
        """True when the host is the SaaS VENDOR's own host.

        This is NOT "the apex of the managed DNS zone". The two were the
        same string while the vendor WAS the apex tenant, so keying on
        ``CLOUDFLARE_BASE_DOMAIN`` was correct then. After the
        vendor/customer split the zone -- the domain under which
        ``<slug>.<zone>`` tenant subdomains live -- can belong to an
        ordinary customer: Larazen keeps ``larazen.in`` and its
        subdomains while the vendor moves to its own domain.

        Keying on the zone there would be actively wrong. Step (a) of
        the resolver deliberately SKIPS host resolution for the platform
        host so the ``is_default`` fallback runs, so a customer whose
        domain happened to be the zone apex would never resolve to its
        own row -- its domain would serve the vendor's site outright,
        not merely mislabel some UI.

        So ask the question the name actually implies: does this host
        belong to the row with ``is_platform=True``? That became
        answerable when the vendor got a row of its own.

        Hosts matching no tenant still return False and fall through to
        the ``is_default`` fallback, exactly as before.
        """
        if not host_clean:
            return False
        # Dev convenience: bare localhost / loopback is the vendor.
        if host_clean == 'localhost' or host_clean.startswith('127.'):
            return True
        # Called up to three times per request; the answer cannot change
        # mid-request, so resolve it once.
        cache = getattr(g, '_platform_host_cache', None)
        if cache is None:
            cache = g._platform_host_cache = {}
        if host_clean in cache:
            return cache[host_clean]
        candidates = {host_clean}
        if host_clean.startswith('www.'):
            candidates.add(host_clean[4:])
        else:
            candidates.add('www.' + host_clean)
        result = False
        try:
            from app.models import Tenant
            result = Tenant.query.filter(
                Tenant.domain.in_(candidates),
                Tenant.is_platform.is_(True),
                Tenant.is_deleted.is_(False),
            ).first() is not None
        except Exception:
            # DB not reachable yet (health checks, early boot). Report
            # "not the vendor" so nothing gets special-cased on a guess.
            result = False
        cache[host_clean] = result
        return result

    def _ip_in_allowlist(ip_str, allowlist):
        """True if ``ip_str`` matches any CIDR / exact IP in
        ``allowlist``. Used to gate ``X-Forwarded-Host`` trust.

        Single IPs (``1.2.3.4``) are matched exactly. CIDR ranges
        (``1.2.3.0/24``) use proper subnet membership. Bad entries
        are silently skipped — the operator's typo shouldn't open
        the gate, and a runtime ``ValueError`` per request would be
        worse than a quiet skip."""
        if not ip_str or not allowlist:
            return False
        import ipaddress
        try:
            addr = ipaddress.ip_address(ip_str.strip())
        except ValueError:
            return False
        for entry in allowlist:
            entry = (entry or '').strip()
            if not entry:
                continue
            try:
                if '/' in entry:
                    if addr in ipaddress.ip_network(entry, strict=False):
                        return True
                else:
                    if addr == ipaddress.ip_address(entry):
                        return True
            except ValueError:
                continue
        return False

    def _resolve_tenant_from_host(host_clean):
        """Match ``host_clean`` against a tenant row — exact custom
        domain, then slug-subdomain rule. Returns tenant_id or None."""
        if not host_clean:
            return None
        from app.models import Tenant
        # 1. Exact custom-domain match (and ``www.`` strip — the
        #    operator might have registered the apex but the user
        #    visits ``www.``).
        candidates = {host_clean}
        if host_clean.startswith('www.'):
            candidates.add(host_clean[4:])
        t = Tenant.query.filter(
            Tenant.domain.in_(candidates),
            Tenant.is_deleted.is_(False),
        ).first()
        if t:
            return t.id
        # 2. Slug subdomain inside our managed zone:
        #    ``acme.larazen.in`` -> slug=``acme``.
        base = _platform_base_domain()
        if base and host_clean.endswith('.' + base):
            slug_from_host = host_clean[: -(len(base) + 1)]
            t = Tenant.query.filter_by(slug=slug_from_host).first()
            if t and not t.is_deleted:
                return t.id
        # 3. Slug subdomain inside an APEX RESELLER's own zone (P4):
        #    ``sunrise.larazen.in`` -> label ``sunrise`` under the zone
        #    ``larazen.in`` some apex connected via TenantDnsConfig.
        #    One label only — child slugs are single labels by the
        #    signup validator, so everything after the first dot is the
        #    candidate zone apex (one indexed lookup, no config scan).
        #    Runs AFTER the platform rule: when the apex zone nests
        #    inside the platform zone (local dev: larazen.localhost
        #    under localhost), rule 2 computes a dotted "slug" that
        #    matches nothing and falls through here.
        #    The child must belong to THAT apex — a same-named tenant
        #    elsewhere must not answer on a zone it doesn't live in.
        first_label, _, zone_apex = host_clean.partition('.')
        if first_label and zone_apex:
            from app.models import TenantDnsConfig
            cfg = TenantDnsConfig.for_base_domain(zone_apex)
            if cfg is not None:
                t = Tenant.query.filter_by(
                    slug=first_label,
                    parent_tenant_id=cfg.tenant_id,
                ).first()
                if t and not t.is_deleted:
                    return t.id
        return None

    @app.before_request
    def _apply_tenant_context():
        # Skip for health / internal endpoints to keep them cheap.
        if request.path in ('/health', '/internal/health'):
            return

        # CORS preflight short-circuit. Browsers send OPTIONS without
        # custom headers (no ``X-Tenant-Host``) and without
        # credentials, so they look like a request from "no tenant"
        # — which then trips the strict 404 below and the browser
        # reports a CORS error on the actual request that follows.
        # Let the registered CORS hook answer the preflight; we don't
        # need tenant context for it.
        if request.method == 'OPTIONS':
            return

        # ── Step 1: collect inputs ─────────────────────────────
        tenant_id = None
        jwt_tenant_id = None
        jwt_present = False
        try:
            verify_jwt_in_request(optional=True)
            claims = get_jwt() or {}
            jwt_present = bool(claims)
            jwt_tenant_id = claims.get('tenant_id')
            if not jwt_tenant_id and current_user is not None:
                jwt_tenant_id = getattr(current_user, 'tenant_id', None)
            if jwt_tenant_id:
                tenant_id = jwt_tenant_id
        except Exception:  # JWT absent/invalid — treat as anonymous
            jwt_present = False

        # ── Step 2: host-based resolution ────────────────────────
        # Phase 3 — trusted-host first, untrusted header second.
        # Resolution order, highest priority → lowest:
        #   (a) ``request.host`` — Flask's view of the literal HTTP
        #       Host header. When ProxyFix is wired (i.e.
        #       BACKEND_TRUST_X_FORWARDED_HOST=true), this is the
        #       client-facing host the proxy forwarded; otherwise it's
        #       the host the user typed (direct gunicorn).
        #   (b) ``X-Tenant-Host`` — client-supplied. DEMOTED in
        #       Phase 3. Only honoured when
        #       BACKEND_TRUST_TENANT_HOST_HEADER=true (the rollout
        #       compatibility flag) AND the trusted-host path didn't
        #       already resolve. Default ON during the rollout window;
        #       flip OFF after frontend stops sending it.
        #   (c) ``X-Tenant-Slug`` — same status as (b). Useful for
        #       internal tooling that explicitly overrides.
        host_resolved_id = None
        is_strict = _is_strict_path()
        request_host_clean = (request.host or '').split(':', 1)[0].lower()

        # ProxyFix spoof guard. ProxyFix already trusts ``x_host=1``
        # hop count, but doesn't IP-allowlist. If the operator pinned
        # ``TRUSTED_PROXY_IPS`` (CIDR list of CF / ALB egress) reject
        # any request that arrives with X-Forwarded-Host set but the
        # source IP isn't in the trusted set. No-op when the allowlist
        # is empty. Off entirely when the trust flag isn't on.
        if app.config.get('BACKEND_TRUST_X_FORWARDED_HOST'):
            xfh_present = bool(request.headers.get('X-Forwarded-Host'))
            allowlist = app.config.get('TRUSTED_PROXY_IPS') or ()
            if xfh_present and allowlist:
                # ``request.access_route[0]`` is the first hop after
                # ProxyFix did its rewrite — that's the proxy IP.
                src = (
                    (request.access_route[0] if request.access_route else None)
                    or request.remote_addr
                    or ''
                )
                if not _ip_in_allowlist(src, allowlist):
                    logger.warning(
                        '[TENANT_TRUSTED_PROXY_REJECT] src=%s not in '
                        'TRUSTED_PROXY_IPS — rejecting X-Forwarded-Host',
                        src,
                    )
                    return jsonify({
                        'success': False,
                        'error': 'Untrusted proxy.',
                        'code': 'untrusted_proxy',
                    }), 400

        # (a) Trusted host. Skip platform-host short-circuit so the
        # default tenant fallback still runs at step 5.
        if request_host_clean and not _is_platform_host(request_host_clean):
            host_resolved_id = _resolve_tenant_from_host(request_host_clean)

        # Phase 3 trust gate for legacy headers.
        trust_tenant_host_header = bool(
            app.config.get('BACKEND_TRUST_TENANT_HOST_HEADER', True)
        )
        host_header = ''
        slug_header = ''
        if trust_tenant_host_header:
            host_header = (request.headers.get('X-Tenant-Host') or '').strip().lower()
            slug_header = (request.headers.get('X-Tenant-Slug') or '').strip()

        # (b) Slug header — only if trusted-host path missed.
        if not host_resolved_id and slug_header:
            from app.models import Tenant
            t = Tenant.query.filter_by(slug=slug_header).first()
            if t and not t.is_deleted:
                host_resolved_id = t.id
        # (c) Host header — same priority demotion.
        if not host_resolved_id and host_header:
            host_resolved_id = _resolve_tenant_from_host(host_header)

        # ── Step 3: JWT-vs-host invariant ─────────────────────
        # When both the JWT and the host resolve to a tenant, they
        # MUST agree. The mismatch case actually splits in two:
        #
        #   (a) Stale-cookie cross-bleed (legitimate user). A user
        #       logged in at tenant A and then opened tenant B's page
        #       in the same browser. Cookies set on api.larazen.in
        #       with SameSite=None ship with every cross-site request,
        #       so requests from B carry A's JWT through no fault of
        #       the user. Returning 403 here breaks anonymous browsing
        #       on every other tenant.
        #
        #   (b) Active replay. A genuine attacker holding tenant A's
        #       JWT and pointing it at tenant B's data. The route's
        #       own auth (RLS-scoped session lookup, role checks)
        #       catches this — see the ``user_lookup_callback`` in
        #       ``app/extensions.py``: ``UserSession.query.filter_by(
        #       id=session_id)`` is RLS-scoped to ``g.tenant_id``, so
        #       a tenant-A session_id replayed against tenant B's
        #       host returns no row → @jwt_required fails → 401.
        #
        # Strategy: SCRUB the JWT context for this request and resolve
        # tenant strictly from the host. Public endpoints work
        # (anonymous traffic, no tenant pollution). Authenticated
        # endpoints get 401 from the user-lookup failure. We log the
        # event at WARN so SOC alerting still has a signal to act on.
        if jwt_tenant_id and host_resolved_id and \
                str(jwt_tenant_id) != str(host_resolved_id):
            logger.warning(
                '[TENANT_MISMATCH] jwt=%s host_resolved=%s host=%s path=%s '
                '— scrubbing JWT for this request',
                jwt_tenant_id, host_resolved_id, host_header, request.path,
            )
            # Scrub local references; route layer will see no tenant
            # via ``g.jwt_tenant_id`` (we never set it) and the
            # user-lookup callback will reject the cross-tenant
            # session row anyway.
            jwt_tenant_id = None
            jwt_present = False
            tenant_id = None

        # If JWT didn't carry tenant context, fall through to host.
        if not tenant_id and host_resolved_id:
            tenant_id = host_resolved_id

        # Stash the platform-host bit on ``g`` so authenticated
        # endpoints (e.g. ``/auth/me``) can return the same answer
        # to the frontend without re-deriving it. Frontend uses this
        # to gate UI (sidebar items) — server-authoritative, no
        # build-time env var required.
        #
        # Derive it from the CLIENT-FACING host, not the raw
        # ``request.host``. In dev the browser hits a tenant subdomain
        # (``bookmycacs.localhost:3000``) but the Vite proxy rewrites the
        # Host to ``localhost:5001`` before it reaches us, and
        # ``_is_platform_host`` treats bare ``localhost`` as the apex
        # (dev convenience). Reading ``request_host_clean`` here would
        # therefore mark EVERY dev request as the platform host, so
        # ``/auth/me`` reports ``is_platform_host: true`` and the whole
        # tenant UI flips to the apex (larazen) once it resolves. The
        # real browser host arrives as ``X-Tenant-Host`` — prefer it,
        # mirroring ``observed_host`` used for the strict check below.
        #
        # The request is "on the platform host" when the client-facing
        # host is the platform apex / ``www`` (or localhost/IP in dev):
        #   * ``host_header`` (``X-Tenant-Host``) when the legacy header
        #     is trusted/present — the true browser host behind a proxy.
        #   * otherwise the trusted ``request.host`` (direct hits /
        #     ProxyFix-forwarded ``X-Forwarded-Host`` in prod).
        platform_host_signal = host_header or request_host_clean
        g.is_platform_host = bool(_is_platform_host(platform_host_signal))

        # ── Step 4: strict vs fallback ────────────────────────
        # Strict paths (auth, unauthenticated mutations) MUST match
        # a real tenant. The request is rejected when:
        #   * a non-platform host was observed (trusted or legacy),
        #     AND
        #   * no tenant resolved from any of those signals.
        observed_host = host_header or request_host_clean
        if not tenant_id and is_strict:
            if (
                observed_host
                and not _is_platform_host(observed_host)
            ):
                logger.info(
                    '[TENANT_STRICT_REJECT] path=%s trusted_host=%s '
                    'legacy_header=%s — no matching tenant',
                    request.path, request_host_clean,
                    host_header or '-',
                )
                return jsonify({
                    'success': False,
                    'error': 'Tenant not found.',
                    'code': 'unknown_tenant',
                }), 404
            # On the platform host (or with no header), strict paths
            # still need a tenant — fall through to default below.

        # Step 5: default-tenant fallback (public reads + platform-host
        # auth flows). Documented as "TEMPORARY until Phase 3" —
        # tightening reads is the next milestone.
        if not tenant_id:
            from app.models import Tenant
            default_tenant = Tenant.query.filter_by(is_default=True).first()
            if default_tenant:
                tenant_id = default_tenant.id

        if tenant_id:
            g.tenant_id = str(tenant_id)
            # Track resolution source for Phase 1 telemetry.
            if jwt_tenant_id and str(jwt_tenant_id) == str(tenant_id):
                g.tenant_source = 'jwt'
            elif host_resolved_id and str(host_resolved_id) == str(tenant_id):
                g.tenant_source = 'host_match'
            else:
                g.tenant_source = 'default_fallback'
            try:
                set_tenant_context(db.session, g.tenant_id)
            except Exception as exc:
                # With RLS enabled, a silent failure here means every tenant-
                # scoped query returns zero rows. Surface it loudly so ops can
                # see it in the log stream instead of chasing "empty list" bugs.
                logger.warning(f"[TENANT] set_tenant_context failed: {exc}")

            # ── Phase 1 telemetry: structured tenant-resolution log ──
            # Always-log signals (no sampling — these are alert-worthy):
            #   * default_fallback (auth path → security incident on its own)
            #   * jwt-vs-host disagreement that we just rejected (handled
            #     above, returns before we reach this line, so not here)
            #   * any [TENANT_RESOLVE] from /auth/* paths
            # Sampled signals (1% by default — high volume, low signal):
            #   * successful host_match / jwt resolution on non-/auth paths
            # Never logs: tokens, Authorization, cookies, request bodies.
            try:
                always_log = (
                    g.tenant_source == 'default_fallback'
                    or request.path.startswith('/api/v1/auth/')
                )
                sample_rate = float(
                    app.config.get('TENANT_RESOLVE_SAMPLE_RATE', 0.01)
                )
                if always_log or (sample_rate > 0 and random.random() < sample_rate):
                    logger.info(
                        '[TENANT_RESOLVE] tenant=%s source=%s '
                        'host=%s path=%s jwt_present=%s strict=%s',
                        g.tenant_id,
                        g.tenant_source,
                        host_header or request_host_clean or '-',
                        request.path,
                        jwt_present,
                        is_strict,
                    )
            except Exception:
                # Telemetry must NEVER break a request. Swallow.
                pass


def register_request_logging(app):
    """Register before/after request hooks for debug logging."""

    @app.before_request
    def log_request_start():
        """Log every incoming request with key details."""
        g.request_start_time = time.time()

        # Skip logging for health checks and static files to avoid noise
        if request.path in ('/health', '/internal/health'):
            return

        # Build a concise log line
        body_preview = ''
        if request.is_json and request.content_length and request.content_length > 0:
            try:
                data = request.get_json(silent=True)
                if data:
                    # Mask sensitive fields
                    safe_data = {k: ('***' if k in ('password', 'current_password', 'new_password', 'token') else v)
                                 for k, v in data.items()}
                    body_preview = f" body={safe_data}"
            except Exception:
                body_preview = ' body=<parse_error>'

        query = f" query={dict(request.args)}" if request.args else ''
        cookies_present = ', '.join([c for c in request.cookies.keys() if c in (
            'access_token', 'refresh_token', 'csrf_access_token', 'csrf_refresh_token'
        )])
        cookie_info = f" cookies=[{cookies_present}]" if cookies_present else ''

        logger.debug(
            f"[REQUEST] ▶ {request.method} {request.path}"
            f"{query}{body_preview}{cookie_info}"
            f" from={request.remote_addr}"
        )

    @app.after_request
    def log_request_end(response):
        """Log response status and timing."""
        if request.path in ('/health', '/internal/health'):
            return response

        duration = 0
        if hasattr(g, 'request_start_time'):
            duration = (time.time() - g.request_start_time) * 1000  # ms

        log_fn = logger.debug if response.status_code < 400 else logger.warning
        log_fn(
            f"[RESPONSE] ◀ {request.method} {request.path}"
            f" → {response.status_code}"
            f" ({duration:.0f}ms)"
            f" size={response.content_length or 0}B"
        )

        return response


def register_socketio(app):
    """Import the Socket.IO event-handler module so its @socketio.on
    decorators register on the shared ``socketio`` instance.

    Kept as its own factory step (mirroring register_blueprints) and importing
    lazily so app/realtime/events.py can import db/models/socketio from
    app.extensions without a circular import at module load.
    """
    from app.realtime import events  # noqa: F401  (import for side effects)


def register_blueprints(app):
    """Register all application blueprints."""

    # All client APIs are VERSIONED under /api/v1 (auth included) —
    # mobile apps pin a version and cannot hot-swap when the API moves.
    # A breaking change ships as /api/v2 next to v1, never by mutating
    # v1 in place. Ops endpoints (/health, /internal/*) stay unversioned.
    from app.auth import auth_bp
    app.register_blueprint(auth_bp, url_prefix='/api/v1/auth')
    logger.debug("[APP] Registered blueprint: auth -> /api/v1/auth")

    from app.api import api_bp
    app.register_blueprint(api_bp, url_prefix='/api/v1')
    logger.debug("[APP] Registered blueprint: api -> /api/v1")

    # Apply a default rate limit to all /api/* endpoints
    # Auth endpoints already carry their own stricter per-route limits.
    from app.extensions import limiter
    limiter.limit("100/minute")(api_bp)
    logger.debug("[APP] Applied rate limit 100/minute to api blueprint")

    # Internal health check blueprints (for ops, load balancers, monitoring)
    from app.api.internal.health import internal_bp
    app.register_blueprint(internal_bp)
    logger.debug("[APP] Registered blueprint: internal")

    # Health check endpoint
    @app.route('/health')
    def health_check():
        return jsonify({'status': 'healthy', 'message': 'Healthcare API is running'})

    # Serve uploaded files
    import os
    from flask import send_from_directory, current_app

    @app.route('/uploads/<path:filename>')
    def serve_uploads(filename):
        """Serve files from the uploads directory."""
        # In Docker, uploads are mounted at /app/uploads (not /app/app/uploads)
        # We use an absolute path since app.root_path is /app/app
        uploads_dir = '/app/uploads'
        full_path = os.path.join(uploads_dir, filename)
        current_app.logger.info(f"Serving file: {full_path}, exists: {os.path.exists(full_path)}")
        return send_from_directory(uploads_dir, filename)


def register_error_handlers(app):
    """Register global error handlers with debug logging."""

    # All framework-raised errors go through error_response so the envelope
    # (success/error/code) is identical to route-raised errors — mobile
    # clients branch on ``code`` and must never meet a code-less body.
    from app.common.responses import error_response as _err

    @app.errorhandler(400)
    def bad_request(error):
        logger.warning(f"[ERROR 400] {request.method} {request.path} — {error}")
        return _err('Bad Request', status_code=400)

    @app.errorhandler(401)
    def unauthorized(error):
        logger.debug(f"[ERROR 401] {request.method} {request.path} — Authentication required")
        return _err('Authentication required', status_code=401)

    @app.errorhandler(403)
    def forbidden(error):
        logger.warning(f"[ERROR 403] {request.method} {request.path} — Access denied")
        return _err('Access denied', status_code=403)

    @app.errorhandler(404)
    def not_found(error):
        logger.debug(f"[ERROR 404] {request.method} {request.path} — Not found")
        return _err('Resource not found', status_code=404)

    @app.errorhandler(405)
    def method_not_allowed(error):
        logger.debug(f"[ERROR 405] {request.method} {request.path}")
        return _err('Method not allowed', status_code=405)

    @app.errorhandler(422)
    def unprocessable_entity(error):
        logger.warning(f"[ERROR 422] {request.method} {request.path} — {error}")
        return _err('Validation failed', status_code=422)

    @app.errorhandler(429)
    def rate_limited(error):
        # flask-limiter's default body is plain text — envelope it, and
        # surface the limit description so clients can show a retry hint.
        logger.warning(f"[ERROR 429] {request.method} {request.path} — {error.description}")
        return _err('Too many requests. Please retry later.',
                    status_code=429, data={'limit': str(error.description)})

    # A DB DataError means the CLIENT sent a value the column type can't hold —
    # a 4xx, never a 500. The common case is a malformed id in a path (e.g.
    # ``/api/appointment/not-a-uuid``): Postgres raises
    # ``InvalidTextRepresentation: invalid input syntax for type uuid`` while
    # casting the segment, which previously bubbled to the 500 handler and
    # LEAKED the raw SQL. A bad id can't match any row, so answer 404; any other
    # DataError (bad enum/number/length) is a 400. Registered on the specific
    # class so Flask routes it here ahead of the generic Exception handler.
    from sqlalchemy.exc import DataError as _DataError

    @app.errorhandler(_DataError)
    def data_error(error):
        # The failed statement aborts the transaction — clear it so teardown
        # (and any pooled reuse) doesn't trip "current transaction is aborted".
        try:
            from app.extensions import db as _db
            _db.session.rollback()
        except Exception:  # noqa: BLE001
            pass
        detail = str(getattr(error, 'orig', None) or error).lower()
        if 'invalid input syntax for type uuid' in detail:
            logger.debug("[DATAERROR→404] %s %s — malformed uuid in path",
                         request.method, request.path)
            return _err('Resource not found', status_code=404)
        logger.warning("[DATAERROR→400] %s %s — %s",
                       request.method, request.path, detail[:200])
        return _err('Invalid request data', status_code=400)

    def _is_production():
        import os as _os
        return _os.environ.get('FLASK_ENV') == 'production' and not app.debug

    def _500_body(original):
        # Exception class + message in the body is a debugging gift in dev
        # and an information leak in prod (SQL fragments, file paths). In
        # production the traceback goes to logs + Sentry; the client gets
        # the request id it can quote to support.
        if _is_production():
            return _err('Something went wrong on our side. Please try again.',
                        status_code=500,
                        data={'request_id': getattr(g, 'request_id', None)})
        return _err(f"{type(original).__name__}: {original}", status_code=500)

    @app.errorhandler(500)
    def internal_error(error):
        # ``error`` is a werkzeug InternalServerError whose ``original_exception``
        # holds the real exception. Log a full traceback (logger.exception walks
        # sys.exc_info).
        original = getattr(error, 'original_exception', None) or error
        logger.exception(
            "[ERROR 500] %s %s — %s: %s",
            request.method, request.path, type(original).__name__, original,
        )
        return _500_body(original)

    @app.errorhandler(Exception)
    def unhandled_exception(error):
        # Belt-and-suspenders: if any non-HTTPException escapes the request
        # handler chain (e.g. raised inside a before_request hook before the
        # 500 handler is wired), we still log the traceback and return a
        # diagnostic body instead of werkzeug's default empty page.
        from werkzeug.exceptions import HTTPException
        if isinstance(error, HTTPException):
            return error
        logger.exception(
            "[UNHANDLED] %s %s — %s: %s",
            request.method, request.path, type(error).__name__, error,
        )
        return _500_body(error)
