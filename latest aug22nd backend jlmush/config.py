"""
Application Configuration Module
Contains configuration classes for different environments
"""
import os
from datetime import timedelta


def _token_lifetime(env_name, unit, default):
    """Resolve a JWT lifetime from an environment variable, else ``default``.

    ``env_name`` holds a plain number in ``unit`` (``'minutes'`` or ``'days'``),
    e.g. ``JWT_ACCESS_TOKEN_EXPIRES_MINUTES=60`` for a 1-hour access token.

    Falls back to ``default`` (a ``timedelta``) whenever the var is unset,
    blank, non-numeric, or <= 0, so a missing/typo'd value can never silently
    produce a near-zero (or absurd) expiry — the historical failure mode where
    an env setting was ignored and the hardcoded default was used instead.
    """
    raw = os.environ.get(env_name)
    if raw is None or str(raw).strip() == '':
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return default
    if value <= 0:
        return default
    return timedelta(**{unit: value})


class Config:
    """Base configuration class with common settings."""
    
    # Flask Core
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-in-production'
    
    # Database
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ECHO = False
    
    # Redis
    REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
    # Disposable-state redis (rate limits, Socket.IO queue, response caches)
    # — a SEPARATE instance with allkeys-lru, so cache pressure can never
    # evict auth state (REDIS_URL side is noeviction). Falls back to the
    # auth instance when unset, so single-redis deployments keep working.
    CACHE_REDIS_URL = os.environ.get('CACHE_REDIS_URL') or os.environ.get(
        'REDIS_URL', 'redis://localhost:6379/0')
    
    # JWT Configuration — accept JWT from BOTH cookies (same-site users
    # on the platform domain) AND ``Authorization: Bearer ...`` headers
    # (cross-site users on tenant custom domains, where browsers block
    # third-party cookies). Frontend axios prefers Bearer when a token
    # is present in localStorage; cookies remain the fallback for
    # browsers/tabs that don't have a stored token yet.
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY') or 'jwt-secret-key-change-in-production'
    JWT_TOKEN_LOCATION = ['headers', 'cookies']
    # Token lifetimes are env-configurable (see _token_lifetime). Set
    # JWT_ACCESS_TOKEN_EXPIRES_MINUTES / JWT_REFRESH_TOKEN_EXPIRES_DAYS in the
    # environment to override these defaults, e.g. =60 for a 1-hour access token.
    # 60min default: the 10-minute token relied on the transparent refresh
    # to be invisible, and the refresh was broken for months (cookie path
    # below still said '/auth' after the /api/v1 cutover, so the browser
    # never sent the refresh token) — every session hard-died at expiry.
    JWT_ACCESS_TOKEN_EXPIRES = _token_lifetime('JWT_ACCESS_TOKEN_EXPIRES_MINUTES', 'minutes', timedelta(minutes=60))
    JWT_REFRESH_TOKEN_EXPIRES = _token_lifetime('JWT_REFRESH_TOKEN_EXPIRES_DAYS', 'days', timedelta(days=10))
    # Idempotent-replay window after a refresh rotation: a retry with the
    # just-consumed refresh token gets the SAME new pair instead of
    # tripping replay detection (mobile networks lose responses). 0 = off.
    REFRESH_GRACE_SECONDS = int(os.environ.get('REFRESH_GRACE_SECONDS', '60'))
    JWT_COOKIE_SECURE = False  # Set True in production with HTTPS
    JWT_COOKIE_SAMESITE = 'Lax'
    JWT_ACCESS_COOKIE_NAME = 'access_token'
    JWT_REFRESH_COOKIE_NAME = 'refresh_token'
    JWT_ACCESS_COOKIE_PATH = '/'
    # Scope the refresh cookie to the auth endpoints ONLY — at their REAL
    # mount. This said '/auth' long after the hard /api/v1 cutover, so the
    # browser never attached the refresh cookie to /api/v1/auth/refresh:
    # every refresh 401'd ("Authorization required") and users were logged
    # out at each access-token expiry instead of refreshing silently.
    JWT_REFRESH_COOKIE_PATH = '/api/v1/auth'
    
    # CSRF protection via flask-jwt-extended
    JWT_COOKIE_CSRF_PROTECT = True
    JWT_CSRF_IN_COOKIES = True  # Stores CSRF token in non-HTTP-only cookie for JS access
    JWT_ACCESS_CSRF_COOKIE_NAME = 'csrf_access_token'
    JWT_REFRESH_CSRF_COOKIE_NAME = 'csrf_refresh_token'
    JWT_CSRF_CHECK_FORM = True
    JWT_CSRF_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']
    
    # Session Management (Redis-backed refresh tokens)
    # Note: SESSION_ROTATION_THRESHOLD_DAYS removed - tokens now ALWAYS rotate (single-use)
    SESSION_HARD_LIMIT_DAYS = 30  # Force re-login after this many days (absolute expiry)
    MAX_SESSIONS_PER_USER = 5  # Maximum concurrent sessions per user
    REDIS_HEALTH_CHECK_TIMEOUT_MS = 50  # Timeout for Redis health checks
    
    # Rate Limiting
    RATELIMIT_ENABLED = True
    RATELIMIT_STORAGE_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
    RATELIMIT_STRATEGY = 'fixed-window'
    RATELIMIT_DEFAULT = '100 per minute'
    RATELIMIT_HEADERS_ENABLED = True

    
    # Specific rate limits
    RATELIMIT_LOGIN = '10 per minute'
    RATELIMIT_SIGNUP = '3 per minute'
    RATELIMIT_REFRESH = '10 per minute'
    RATELIMIT_API = '100 per minute'
    
    # Encryption
    ENCRYPTION_KEY = os.environ.get('ENCRYPTION_KEY')  # Required - Fernet key
    
    # Frontend URL (used in email templates for reset links, etc.)
    FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:3000')

    # CORS
    CORS_ORIGINS = os.environ.get('CORS_ORIGINS', 'http://localhost:3000').split(',')
    
    # Pagination
    DEFAULT_PAGE_SIZE = 20
    MAX_PAGE_SIZE = 100
    
    # File Uploads
    # Must exceed the largest per-type media cap below (+ multipart overhead)
    # or Flask rejects the request with 413 before S3Service ever validates it.
    MAX_CONTENT_LENGTH = 25 * 1024 * 1024  # 25MB max request body
    UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
    ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'pdf'}

    # Per-asset-type upload size caps (bytes). SINGLE SOURCE OF TRUTH for the
    # backend — ``S3Service.upload_file`` reads these, so changing a limit here
    # changes it everywhere (gallery images/videos, thumbnails). Overridable
    # per environment via the env vars below. The frontend mirrors these for
    # instant pick-time feedback, but the backend remains authoritative.
    MEDIA_UPLOAD_MAX_BYTES = {
        'video': int(os.environ.get('MEDIA_MAX_VIDEO_BYTES', 20 * 1024 * 1024)),      # 20 MB
        'image': int(os.environ.get('MEDIA_MAX_IMAGE_BYTES', 2 * 1024 * 1024)),       # 2 MB
        'thumbnail': int(os.environ.get('MEDIA_MAX_THUMBNAIL_BYTES', 1 * 1024 * 1024)),  # 1 MB
        # Service-communication channel documents. The per-purchase config's
        # max_attachment_mb is the product-level cap; this is the hard platform
        # ceiling S3Service enforces.
        'medical_document': int(os.environ.get('MEDIA_MAX_DOCUMENT_BYTES', 5 * 1024 * 1024)),  # 5 MB
    }
    
    # AWS S3 Configuration - Dual Buckets
    AWS_ACCESS_KEY_ID = os.environ.get('AWS_ACCESS_KEY_ID')
    AWS_SECRET_ACCESS_KEY = os.environ.get('AWS_SECRET_ACCESS_KEY')
    AWS_S3_REGION = os.environ.get('AWS_S3_REGION', 'ap-south-2')
    
    # Public bucket - for assets accessible without auth (logos, T&C, homepage assets, symptom photos)
    AWS_S3_PUBLIC_BUCKET = os.environ.get('AWS_S3_PUBLIC_BUCKET', 'jlmush-assests-public')
    
    # Private bucket - for sensitive user data (certificates, prescriptions, appointment documents)
    AWS_S3_PRIVATE_BUCKET = os.environ.get('AWS_S3_PRIVATE_BUCKET', 'jlmush-data-private')
    
    # Presigned URL expiration times (in seconds)
    AWS_PRESIGNED_URL_EXPIRATION_PUBLIC = 3600  # 1 hour for public assets
    AWS_PRESIGNED_URL_EXPIRATION_PRIVATE = 1800  # 30 minutes for sensitive data

    # MinIO — local S3 stand-in for the PRIVATE bucket only.
    #
    # Setting ``MINIO_ENDPOINT_URL`` routes every private-bucket operation
    # (certificates, prescriptions, doctor identity documents, signatures,
    # service-communication attachments) at a local MinIO instead of AWS, so
    # those flows are exercisable with no AWS credentials and no patient data
    # leaving the machine.
    #
    # The PUBLIC bucket is deliberately NOT routed: a prod DB dump restored
    # locally keeps pulling live logos / homepage assets straight from S3.
    # Leave these unset in production and behaviour is byte-for-byte unchanged.
    MINIO_ENDPOINT_URL = os.environ.get('MINIO_ENDPOINT_URL')

    # The endpoint the BROWSER resolves. SigV4 signs the Host header, so a URL
    # presigned against the in-network host (``minio:9000``) is rejected when
    # the browser fetches it from ``localhost``. Presigning uses this instead.
    MINIO_PUBLIC_ENDPOINT_URL = os.environ.get(
        'MINIO_PUBLIC_ENDPOINT_URL', 'http://localhost:9000'
    )
    MINIO_ACCESS_KEY = os.environ.get('MINIO_ACCESS_KEY', 'minioadmin')
    MINIO_SECRET_KEY = os.environ.get('MINIO_SECRET_KEY', 'minioadmin')
    MINIO_REGION = os.environ.get('MINIO_REGION', 'us-east-1')

    # Cloudflare for SaaS — custom-domain Custom Hostname provisioning.
    # Configured via ``CLOUDFLARE_API_TOKEN``, ``CLOUDFLARE_SAAS_ZONE_ID``
    # (falls back to ``CLOUDFLARE_ZONE_ID``), and
    # ``CLOUDFLARE_SAAS_FALLBACK_ORIGIN`` (the edge Worker hostname).
    # See ``app/services/cloudflare_saas.py::_config()`` for the runtime
    # check. AWS Amplify was retired when the SPA moved to Pages.

    # Twilio Video Configuration
    TWILIO_ACCOUNT_SID = os.environ.get('TWILIO_ACCOUNT_SID')
    TWILIO_API_KEY_SID = os.environ.get('TWILIO_API_KEY_SID')
    TWILIO_API_KEY_SECRET = os.environ.get('TWILIO_API_KEY_SECRET')
    
    # Combirds (Edumarc) SMS — replaces AWS SES.
    # Only the API key + endpoint URLs live in env; per-template wiring
    # (template IDs, bodies, sender headers) is stored in the
    # ``notification_templates`` table so it can be edited at runtime
    # without a redeploy. See app/models/notification_template.py.
    COMBIRDS_API_KEY = os.environ.get('COMBIRDS_API_KEY')
    COMBIRDS_SMS_URL = os.environ.get(
        'COMBIRDS_SMS_URL', 'https://smsapi.edumarcsms.com/api/v1/sendsms'
    )
    COMBIRDS_STATUS_URL = os.environ.get(
        'COMBIRDS_STATUS_URL', 'https://api.edumarcsms.com/api/v1/org/transaction'
    )

    # SendClean transactional email — replaces AWS SES for the email channel.
    # Per-template HTML/subject lives in the ``notification_templates`` table
    # (channel='email'); SendClean only handles delivery via /messages/sendMail.
    # All tenants currently send from a single platform-level from-address;
    # custom per-tenant sending domains will get a separate column when added.
    SENDCLEAN_OWNER_ID = os.environ.get('SENDCLEAN_OWNER_ID')
    SENDCLEAN_TOKEN = os.environ.get('SENDCLEAN_TOKEN')
    SENDCLEAN_APP_DOMAIN = os.environ.get(
        'SENDCLEAN_APP_DOMAIN', 'sendclean.net'
    )
    SENDCLEAN_SMTP_USER = os.environ.get('SENDCLEAN_SMTP_USER')
    SENDCLEAN_FROM_EMAIL = os.environ.get('SENDCLEAN_FROM_EMAIL', 'noreply@example.com')
    SENDCLEAN_FROM_NAME = os.environ.get('SENDCLEAN_FROM_NAME', 'LARAZEN')

    # ── Test-environment containment (ENVIRONMENT_DESIGN.md §7) ─────────
    # Combirds and SendClean have no real sandbox, so on the TEST env the
    # app itself is the sandbox. All default OFF ⇒ inert in production;
    # the test env's .env flips them on. Committed features, not ad-hoc
    # ``if env == test`` branches.
    #
    # SMS_DRY_RUN        : log the rendered SMS and report it sent — no
    #                      HTTP call, no credentials needed, no spend.
    # SMS_ALLOWLIST      : comma-sep numbers that send for REAL even when
    #                      dry-run is on (the team's own phones).
    # EMAIL_DRY_RUN      : same pattern for SendClean.
    # EMAIL_REDIRECT_ALL_TO : deliver every outbound mail to this one QA
    #                      inbox, original recipient noted in the subject.
    # QA_STATIC_OTP      : fixed OTP accepted ONLY for numbers on
    # QA_OTP_ALLOWLIST   : ...this list — login flows testable without
    #                      SMS, without a universal backdoor.
    SMS_DRY_RUN = (
        os.environ.get('SMS_DRY_RUN', 'false')
        .strip().lower() in ('true', '1', 'yes')
    )
    SMS_ALLOWLIST = os.environ.get('SMS_ALLOWLIST', '')
    EMAIL_DRY_RUN = (
        os.environ.get('EMAIL_DRY_RUN', 'false')
        .strip().lower() in ('true', '1', 'yes')
    )
    EMAIL_REDIRECT_ALL_TO = os.environ.get('EMAIL_REDIRECT_ALL_TO', '')
    QA_STATIC_OTP = os.environ.get('QA_STATIC_OTP', '')
    QA_OTP_ALLOWLIST = os.environ.get('QA_OTP_ALLOWLIST', '')

    # Cloudflare DNS Configuration (per-tenant DNS auto-provisioning).
    # See Backend/app/services/cloudflare_dns.py for semantics.
    # When any of these are missing, the DNS service reports ``disabled``
    # on every tenant and the platform still works — tenants just can't
    # be reached at their subdomain until the env vars are supplied.
    CLOUDFLARE_API_TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN')
    CLOUDFLARE_ZONE_ID = os.environ.get('CLOUDFLARE_ZONE_ID')
    CLOUDFLARE_BASE_DOMAIN = os.environ.get('CLOUDFLARE_BASE_DOMAIN')
    CLOUDFLARE_INGRESS_TARGET = os.environ.get('CLOUDFLARE_INGRESS_TARGET')
    # Default to ``false``: matches the documented intent in
    # cloudflare_dns.py (Amplify ingress already terminates TLS via
    # CloudFront — stacking Cloudflare's orange-cloud proxy on top
    # produces SNI mismatch handshake failures). Operators who want
    # CF in front of their ingress opt in via env var.
    CLOUDFLARE_PROXIED = os.environ.get('CLOUDFLARE_PROXIED', 'false')
    CLOUDFLARE_TTL = int(os.environ.get('CLOUDFLARE_TTL', '1'))

    # Cloudflare Pages — per-tenant custom-domain provisioning
    # (replaces both the retired AWS Amplify CreateDomainAssociation
    # path and the earlier CF for SaaS / Custom Hostnames experiment;
    # the latter loopbacks on Free SSL-for-SaaS, see git history).
    #
    # See ``app/services/cloudflare_saas.py::is_configured()`` for the
    # runtime check. All three required env vars must be set or new
    # tenant custom domains can't be auto-attached and the admin UI
    # shows the "CF Pages not configured" banner.
    #
    #   * ``CLOUDFLARE_API_TOKEN`` — scope:
    #     ``Account → Cloudflare Pages → Edit`` (sufficient — token
    #     does not need DNS or Zone permissions for the domain-add
    #     flow, just Pages). Distinct from the CF DNS token above; can
    #     reuse the same token if its scopes cover both.
    #   * ``CLOUDFLARE_ACCOUNT_ID`` — the account hosting the Pages
    #     project; shown on the CF dashboard sidebar.
    #   * ``CLOUDFLARE_PAGES_PROJECT_NAME`` — e.g. ``jlmushfrontend``;
    #     the project name as seen in Workers & Pages.
    #
    # Optional:
    #   * ``CLOUDFLARE_PAGES_TARGET`` — the hostname tenants are told
    #     to CNAME to at their registrar; defaults to
    #     ``<project>.pages.dev``. Override if you've bound the Pages
    #     project to a hostname inside your own zone (e.g.
    #     ``www.larazen.in``) and want tenants to CNAME there instead.
    CLOUDFLARE_ACCOUNT_ID = os.environ.get('CLOUDFLARE_ACCOUNT_ID')
    CLOUDFLARE_PAGES_PROJECT_NAME = os.environ.get('CLOUDFLARE_PAGES_PROJECT_NAME')
    CLOUDFLARE_PAGES_TARGET = os.environ.get('CLOUDFLARE_PAGES_TARGET')

    # Number of hours migrate-to-cloudflare workflows linger in the
    # ``soaking`` phase before allowing teardown. Documented knob kept
    # for parity with the legacy migration tooling; not consulted by
    # any live code path after the Amplify decommission. Safe to drop
    # in a future cleanup.
    CF_MIGRATION_SOAK_HOURS = int(
        os.environ.get('CF_MIGRATION_SOAK_HOURS', '48'),
    )

    # Phase 1 telemetry — fraction of successful tenant resolutions to
    # log. Default 1% keeps log volume sane on prod; alert-worthy
    # signals (default_fallback, /auth/* paths) always log regardless.
    # Set to ``0`` to disable sampling entirely; ``1.0`` to log every
    # request (useful in dev / during incident response).
    try:
        TENANT_RESOLVE_SAMPLE_RATE = float(
            os.environ.get('TENANT_RESOLVE_SAMPLE_RATE', '0.01')
        )
    except (TypeError, ValueError):
        TENANT_RESOLVE_SAMPLE_RATE = 0.01

    # ─── Phase 3 — trusted-host tenant resolution ────────────────────
    # Phase 0 trusted ``X-Tenant-Host`` (a client-supplied header) as
    # the source of tenant identity. Phase 3 demotes that to a
    # legacy/test-only override and uses the trusted transport layer
    # (``request.host`` after TLS termination, or ProxyFix-validated
    # ``X-Forwarded-Host``) as the primary signal.
    #
    # ``BACKEND_TRUST_X_FORWARDED_HOST``
    #     Enable when the deployment is behind a known reverse proxy
    #     (Cloudflare, ALB, CloudFront) that terminates TLS and forwards
    #     the original Host as ``X-Forwarded-Host``. ``ProxyFix`` is
    #     wired with ``x_host=1`` when this flag is on. Default OFF —
    #     deployments without a proxy chain (direct gunicorn) must
    #     leave it off, otherwise an attacker who can hit the origin
    #     directly can spoof the header.
    BACKEND_TRUST_X_FORWARDED_HOST = (
        str(os.environ.get('BACKEND_TRUST_X_FORWARDED_HOST', 'false'))
        .strip().lower() in ('true', '1', 'yes')
    )

    # ``BACKEND_TRUST_TENANT_HOST_HEADER``
    #     The Phase-0 ``X-Tenant-Host`` header is no longer the primary
    #     signal. We still honour it when this flag is set — useful
    #     for: (a) integration tests that drive the Flask test client,
    #     (b) internal tooling that needs to override the host, (c)
    #     the rollout window where the frontend hasn't yet stopped
    #     sending it. Default ON for now (compat); flip to OFF after
    #     the frontend deploy is confirmed to no longer send it.
    BACKEND_TRUST_TENANT_HOST_HEADER = (
        str(os.environ.get('BACKEND_TRUST_TENANT_HOST_HEADER', 'true'))
        .strip().lower() in ('true', '1', 'yes')
    )

    # ``TRUSTED_PROXY_IPS``
    #     Comma-separated CIDR list of IPs allowed to set
    #     ``X-Forwarded-*`` headers. Only consulted when
    #     ``BACKEND_TRUST_X_FORWARDED_HOST`` is on. Empty list = trust
    #     no proxy (i.e. ProxyFix's count of trusted hops, not strict
    #     IP allowlisting). Operators who run a tighter setup can pin
    #     specific Cloudflare IP ranges here; the ``before_request``
    #     guard rejects any request where ``X-Forwarded-Host`` is
    #     present but ``request.remote_addr`` isn't in this list.
    _trusted_proxy_raw = (
        os.environ.get('TRUSTED_PROXY_IPS', '') or ''
    ).strip()
    TRUSTED_PROXY_IPS = tuple(
        ip.strip() for ip in _trusted_proxy_raw.split(',') if ip.strip()
    )



class DevelopmentConfig(Config):
    """Development configuration."""
    DEBUG = True
    PROPAGATE_EXCEPTIONS = False  # Keep CORS headers on errors (Werkzeug would strip them)
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or \
        'postgresql://postgres:password@localhost:5432/healthcare_dev'
    JWT_COOKIE_SECURE = False  # Allow HTTP in development
    SQLALCHEMY_ECHO = False
    
    # Dev-only token lifetimes. The original 30-second access token was useful
    # for manually exercising the refresh flow but made routine in-browser
    # testing nearly impossible — multi-step admin flows died mid-way. Bumped
    # to 30 min for dev ergonomics. Still env-overridable via the same vars as
    # base Config. ``ProductionConfig`` inherits base (env or 10 min default).
    JWT_ACCESS_TOKEN_EXPIRES = _token_lifetime('JWT_ACCESS_TOKEN_EXPIRES_MINUTES', 'minutes', timedelta(minutes=30))
    JWT_REFRESH_TOKEN_EXPIRES = _token_lifetime('JWT_REFRESH_TOKEN_EXPIRES_DAYS', 'days', timedelta(hours=12))
    
    # Allow all origins for development (e.g. Postman)
    CORS_ORIGINS = '*'

class TestingConfig(Config):
    """Testing configuration."""
    TESTING = True
    SQLALCHEMY_DATABASE_URI = os.environ.get('TEST_DATABASE_URL') or \
        'postgresql://postgres:password@localhost:5432/healthcare_test'
    JWT_COOKIE_CSRF_PROTECT = False
    WTF_CSRF_ENABLED = False
    RATELIMIT_ENABLED = False


class ProductionConfig(Config):
    """
    Production configuration.
    
    Assumptions:
    - DATABASE_URL is provided with ?sslmode=require (SSL enforced via URL, not code)
    - Database, user, and schema are pre-provisioned by infrastructure
    - Migrations have already been applied; schema mismatch causes crash (acceptable)
    
    Pool sizing note:
    Total DB connections = gunicorn_workers × DB_POOL_SIZE
    Example: 4 workers × 5 pool = 20 connections. Size accordingly for RDS instance.
    """
    DEBUG = False
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL')  # Required, no fallback
    JWT_COOKIE_SECURE = True  # HTTPS only
    JWT_COOKIE_SAMESITE = 'None'  # required for cross-subdomain XHR (www.* → api.*)
    # Cookie domain MUST be set explicitly per environment via COOKIE_DOMAIN
    # env var (e.g. ``.larazen.in`` — note the leading dot for subdomain sharing).
    # Setting this wrong silently breaks auth: the browser receives the
    # Set-Cookie header but rejects it because Domain doesn't match the
    # response origin. The default below is None, which lets Flask fall back
    # to the response host — works for single-subdomain setups, breaks
    # cross-subdomain ones. Always set COOKIE_DOMAIN in production.
    JWT_COOKIE_DOMAIN = os.environ.get('COOKIE_DOMAIN')
    SESSION_COOKIE_DOMAIN = os.environ.get('COOKIE_DOMAIN')
    SESSION_COOKIE_SECURE = True
    SESSION_COOKIE_SAMESITE = 'None'
    SQLALCHEMY_ECHO = False
    
    # Connection pool - conservative defaults, configurable
    # SSL is enforced via DATABASE_URL (?sslmode=require), not here
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_pre_ping': True,  # Verify connections before use
        'pool_size': int(os.environ.get('DB_POOL_SIZE', '5')),  # Conservative default
        'pool_recycle': 300,  # Recycle connections after 5 min
        'connect_args': {
            'connect_timeout': 5,  # Fail fast on unreachable DB
        }
    }

    # Override secret keys - must be set in environment
    SECRET_KEY = os.environ.get('SECRET_KEY')
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY')
    ENCRYPTION_KEY = os.environ.get('ENCRYPTION_KEY')


def validate_production_config():
    """
    Validate required environment variables for production.
    Call this during app initialization when FLASK_ENV=production.
    Fails fast with clear error messages.
    """
    required_vars = [
        'DATABASE_URL',
        'SECRET_KEY',
        'JWT_SECRET_KEY',
        'ENCRYPTION_KEY',
    ]
    
    missing = [var for var in required_vars if not os.environ.get(var)]
    
    if missing:
        raise RuntimeError(
            f"Production configuration error: Missing required environment variables: {', '.join(missing)}"
        )
    
    # Warn if DATABASE_URL doesn't include SSL (but don't fail - might be internal network)
    db_url = os.environ.get('DATABASE_URL', '')
    if 'sslmode=' not in db_url:
        import logging
        logging.warning(
            "DATABASE_URL does not include sslmode parameter. "
            "For AWS RDS, use ?sslmode=require"
        )


# Configuration mapping
config = {
    'development': DevelopmentConfig,
    'testing': TestingConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig
}


def get_config(env=None):
    """Get configuration class based on environment."""
    if env is None:
        env = os.environ.get('FLASK_ENV', 'development')
    return config.get(env, DevelopmentConfig)

