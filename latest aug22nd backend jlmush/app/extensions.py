"""
Flask Extensions Module
Centralizes all Flask extension instances to avoid circular imports
"""
import json
import logging
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_jwt_extended import JWTManager
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_socketio import SocketIO
import redis
import os
import re

logger = logging.getLogger(__name__)
# Initialize extensions without app context
db = SQLAlchemy()
migrate = Migrate()
jwt = JWTManager()
cors = CORS()
def rate_limit_key():
    """Identity-aware limiter key.

    Authenticated traffic is keyed by USER id: a clinic full of patients
    behind one NAT must not share one bucket, and one abusive account must
    not be able to move to a new IP for a fresh one. Unauthenticated
    traffic stays keyed by pure IP — ``X-Device-Id`` is client-supplied,
    so including it would let an attacker rotate ids to mint fresh buckets
    and walk past brute-force limits on signin.

    The JWT is verified (not just decoded): an unverified ``sub`` claim
    would let anyone forge arbitrary keys and dodge their own bucket.
    Cached on ``g`` — flask-limiter may call the key func more than once
    per request.
    """
    from flask import g
    cached = getattr(g, '_rate_limit_key', None)
    if cached:
        return cached
    key = None
    try:
        from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
        verify_jwt_in_request(optional=True)
        identity = get_jwt_identity()
        if identity:
            key = f'u:{identity}'
    except Exception:  # noqa: BLE001 — bad/expired token: fall back to IP
        pass
    if not key:
        key = f'ip:{get_remote_address()}'
    try:
        g._rate_limit_key = key
    except RuntimeError:  # outside a request context (limiter internals)
        pass
    return key


def credential_key():
    """Per-target-credential limiter key for signin-style endpoints.

    IP limits stop spraying from one machine; this stops a distributed
    brute-force of ONE account from many IPs. Keyed on a hash of the
    posted identifier (email/phone) so raw PII never lands in Redis keys.
    Falls back to the IP key when the body carries no identifier.
    """
    import hashlib
    from flask import request
    try:
        body = request.get_json(silent=True) or {}
    except Exception:  # noqa: BLE001
        body = {}
    ident = str(body.get('email') or body.get('phone_number')
                or body.get('identifier') or '').strip().lower()
    if not ident:
        return rate_limit_key()
    return 'cred:' + hashlib.sha256(ident.encode()).hexdigest()[:24]


# Limiter counters live on the CACHE redis (disposable side): losing them
# briefly disables limits — annoying; losing sessions logs everyone out —
# unacceptable. Falls back to the auth instance when no cache redis is set.
limiter = Limiter(
    key_func=rate_limit_key,
    storage_uri=(os.environ.get('CACHE_REDIS_URL')
                 or os.environ.get('REDIS_URL', 'redis://localhost:6379/0')),
)

# Socket.IO server for the real-time communication channel (Service Chats).
# Configured in init_extensions(): Redis message_queue (cross-worker fan-out),
# CORS, and async_mode. Event handlers live in app/realtime/events.py and are
# imported once from create_app (register_socketio) so their @socketio.on
# decorators register without a circular import.
socketio = SocketIO()

# Redis client (initialized in init_extensions)
redis_client = None

def get_redis_client():
    """Get the Redis client instance."""
    global redis_client
    return redis_client


def init_extensions(app):
    """Initialize all Flask extensions with the app instance."""
    global redis_client
    
    db.init_app(app)
    logger.debug("[EXT] SQLAlchemy initialized")
    
    # Validate database connectivity in production (fail fast)
    if app.config.get('ENV') == 'production' or os.environ.get('FLASK_ENV') == 'production':
        validate_database_connection(app)
    
    migrate.init_app(app, db)
    logger.debug("[EXT] Migrate initialized")
    
    jwt.init_app(app)
    logger.debug("[EXT] JWT initialized")
    
    
    # Normalise CORS_ORIGINS so it supports both literal origins and
    # regex patterns — necessary for per-tenant subdomains like
    # ``acme.larazen.in`` that are created at runtime.
    #
    # Env var format (each entry comma-separated):
    #   https://www.example.com            → exact-match string
    #   re:^https://[a-z0-9-]+\.example\.com$  → regex (auto-compiled)
    #   *                                  → match-all (dev only!)
    #
    # Example production value:
    #   CORS_ORIGINS=https://larazen.in,https://www.larazen.in,re:^https://[a-z0-9-]+\.larazen\.in$
    cors_origins_raw = app.config.get('CORS_ORIGINS', '*')
    if cors_origins_raw == '*' or (
        isinstance(cors_origins_raw, list) and '*' in cors_origins_raw
    ):
        cors_origins = [re.compile(r"^.*$")]
    else:
        # config.py already split on "," so we get a list; normalise to list.
        raw_list = (
            cors_origins_raw if isinstance(cors_origins_raw, list)
            else [o.strip() for o in cors_origins_raw.split(',') if o.strip()]
        )
        cors_origins = []
        for entry in raw_list:
            entry = entry.strip()
            if not entry:
                continue
            if entry.startswith('re:'):
                # Explicit regex — safer than guessing from metacharacters.
                cors_origins.append(re.compile(entry[3:]))
            else:
                cors_origins.append(entry)

    cors.init_app(app, resources={
        r"/*": {
            "origins": cors_origins,
            "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization", "X-CSRF-TOKEN", "X-Tenant-Slug", "X-Tenant-Host", "Cache-Control", "Headers", "Pragma", "Expires", "X-Client", "X-Client-Version", "X-Device-Id"],
            "expose_headers": ["Content-Type", "X-CSRF-TOKEN", "X-Request-Id"],
            "supports_credentials": True
        }
    })
    logger.debug(f"[EXT] CORS initialized with origins={app.config.get('CORS_ORIGINS', '*')}")
    
    # Initialize rate limiter with Redis backend
    if app.config.get('RATELIMIT_ENABLED', True):
        limiter.init_app(app)
        logger.debug("[EXT] Rate limiter initialized")
    
    # Initialize Redis client
    redis_url = app.config.get('REDIS_URL', 'redis://localhost:6379/0')
    redis_client = redis.from_url(redis_url, decode_responses=True)
    
    # Test Redis connection
    redis_ok = True
    try:
        redis_client.ping()
        logger.info(f"[EXT] ✅ Redis connected: {redis_url}")
    except redis.ConnectionError as e:
        logger.warning(f"[EXT] ✗ Redis connection failed: {e}. Session caching will be disabled.")
        redis_client = None
        redis_ok = False

    # ── Socket.IO (real-time communication channel) ───────────────────────
    # engineio enforces cors_allowed_origins at the HANDSHAKE (HTTP) layer,
    # BEFORE our connect handler runs, and it does NOT support regex the way
    # flask-cors does. Our wildcard tenant subdomains (re:^https://…\.larazen\.in$)
    # would therefore be rejected at the transport layer if we passed only the
    # literal origins. So we allow all origins at the transport layer and enforce
    # the REAL policy — the exact same CORS_ORIGINS rules, including the tenant
    # subdomain regex — inside the connect handler (app/realtime/origins.py),
    # which rejects a disallowed Origin by refusing the connection. This is safe
    # because socket auth is a Bearer token in the handshake payload (not
    # cookies): the client connects with withCredentials=false, so a permissive
    # transport ACAO does not expose credentials.
    socket_cors = '*'
    # message_queue lets emits from ANY worker/process reach clients on the
    # socket worker. With the production single eventlet worker, the message POST
    # and the sockets share one process so in-process emit already works; the
    # Redis queue keeps it correct if you scale to multiple containers or emit
    # from another process (scheduler/CLI). Falls back to single-process if Redis
    # is down so the app still boots. async_mode defaults to 'threading' (safe
    # for dev/pytest) and is set to 'eventlet' via env in the prod container.
    async_mode = os.environ.get('SOCKETIO_ASYNC_MODE') or 'threading'
    # The pub/sub queue is transient traffic — cache-redis side, so a
    # burst of socket fan-out can't pressure the auth instance. (Queue
    # loss only degrades to REST polling; auth loss logs users out.)
    cache_redis_url = app.config.get('CACHE_REDIS_URL') or redis_url
    socketio.init_app(
        app,
        async_mode=async_mode,
        cors_allowed_origins=socket_cors,
        message_queue=(cache_redis_url if redis_ok else None),
        logger=False,
        engineio_logger=False,
    )
    logger.info(
        "[EXT] ✅ Socket.IO initialized (async_mode=%s, message_queue=%s)",
        async_mode, 'redis' if redis_ok else 'none (single-process)',
    )

    # Setup JWT callbacks
    setup_jwt_callbacks(app)
    logger.debug("[EXT] JWT callbacks configured")


def validate_database_connection(app):
    """
    Single validation point for database connectivity.
    Uses raw engine connection (not ORM session) to avoid lifecycle issues.
    Fail fast if database is unreachable.
    """
    from sqlalchemy import text
    try:
        with app.app_context():
            with db.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        app.logger.info("✅ Database connection validated")
    except Exception as e:
        app.logger.critical(f"❌ Database connection failed: {e}")
        raise RuntimeError("Cannot start: Database unreachable or misconfigured") from e


def setup_jwt_callbacks(app):
    """Setup JWT-related callbacks."""
    @jwt.user_identity_loader
    def user_identity_lookup(user):
        """Callback to define what to store in the JWT identity."""
        identity = str(user.id) if hasattr(user, 'id') else str(user)
        logger.debug(f"[JWT] user_identity_lookup: identity={identity}")
        return identity
    
    @jwt.user_lookup_loader
    def user_lookup_callback(_jwt_header, jwt_data):
        """
        Callback to load user from JWT identity.
        Also validates session in Redis/PostgreSQL.
        """
        from app.models import User, UserSession
        from app.auth.session_store import SessionStore
        
        identity = jwt_data["sub"]
        session_id = jwt_data.get("session_id")
        logger.debug(f"[JWT] user_lookup: identity={identity} session_id={session_id}")
        
        # First verify session is valid
        if session_id:
            # Try Redis first (fast path)
            session_data = SessionStore.get_cached_session(session_id)
            
            if session_data:
                logger.debug(f"[JWT] Session found in Redis: session_id={session_id}")
            else:
                logger.debug(f"[JWT] Session NOT in Redis, checking PostgreSQL: session_id={session_id}")
                # Fallback to PostgreSQL
                db_session = UserSession.query.filter_by(
                    id=session_id,
                    is_revoked=False
                ).first()
                
                if db_session and not db_session.is_expired():
                    logger.debug(f"[JWT] Session found in PostgreSQL, re-caching: session_id={session_id}")
                    # Recreate Redis cache
                    SessionStore.cache_session(
                        session_id=str(db_session.id),
                        user_id=str(db_session.user_id),
                        expires_at=db_session.expires_at
                    )
                else:
                    reason = 'expired' if db_session else 'not found'
                    logger.debug(f"[JWT] Session INVALID ({reason}): session_id={session_id}")
                    return None
        
        user = User.query.filter_by(id=identity, is_deleted=False).first()
        if user:
            logger.debug(f"[JWT] User loaded: id={user.id} role={user.role.value}")
        else:
            logger.debug(f"[JWT] User NOT found or deleted: identity={identity}")
        return user
    
    @jwt.expired_token_loader
    def expired_token_callback(jwt_header, jwt_payload):
        """Callback when token is expired."""
        logger.debug(f"[JWT] Token EXPIRED: sub={jwt_payload.get('sub')} type={jwt_payload.get('type')}")
        return {
            'success': False,
            'error': 'Token has expired',
            'code': 'token_expired'
        }, 401
    
    @jwt.invalid_token_loader
    def invalid_token_callback(error):
        """Callback when token is invalid."""
        logger.debug(f"[JWT] Token INVALID: {error}")
        return {
            'success': False,
            'error': 'Invalid token',
            'code': 'invalid_token'
        }, 401
    
    @jwt.unauthorized_loader
    def missing_token_callback(error):
        """Callback when token is missing."""
        logger.debug(f"[JWT] Token MISSING: {error}")
        return {
            'success': False,
            'error': 'Authorization required',
            'code': 'authorization_required'
        }, 401
    
    @jwt.token_verification_failed_loader
    def token_verification_failed_callback(jwt_header, jwt_payload):
        """Callback when token verification fails."""
        logger.debug(f"[JWT] Token VERIFICATION FAILED: sub={jwt_payload.get('sub')}")
        return {
            'success': False,
            'error': 'Token verification failed',
            'code': 'token_verification_failed'
        }, 401

