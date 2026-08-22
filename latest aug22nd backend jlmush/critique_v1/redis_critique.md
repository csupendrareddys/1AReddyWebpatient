# Redis Critique

> Audit Date: 2026-04-13
> Scope: Key design, expiry strategy, pattern misuse, scalability, consistency

---

## CRITICAL

### 1. OTPs for Patient Profile Changes Use In-Memory Dict, Not Redis

**Where**: `app/api/service_reciever/patient/service.py:23-89` -- `OTPService` class uses `_otp_store = {}` (Python dictionary) instead of Redis.

```python
class OTPService:
    _otp_store = {}  # In-memory store
    
    @staticmethod
    def generate_and_store(key, purpose):
        otp = ...
        OTPService._otp_store[store_key] = {...}
```

The auth module's email OTP (`app/services/email_service.py`) correctly uses Redis (`redis.setex(f"email_otp:{email}", 600, otp)`). But the patient module's OTP for phone/email changes uses a class-level dictionary.

**Impact**:
- **Multi-worker**: Gunicorn runs multiple workers. OTP generated in worker 1 is invisible to worker 2. Verification requests are randomly routed, so ~50% fail on a 2-worker setup.
- **Restart**: Any process restart (deploy, crash, autoscale) loses all pending OTPs.
- **Memory leak**: The dict is never cleaned up. Expired OTPs accumulate indefinitely.
- **No TTL**: Unlike Redis `setex`, the dict entries have a manual `expires_at` field checked at read time, but stale entries are never purged.

---

### 2. Redis Failure Degrades to No Session Validation on Some Paths

**Where**: `app/extensions.py:105-107` -- If Redis connection fails at startup, `redis_client` is set to `None`. The `SessionStore` methods check for `redis_client` being None and return `None`/`False`, causing fallback to PostgreSQL for session lookups.

However, the refresh token flow (`app/auth/route.py`) calls `SessionStore.is_redis_healthy()` and returns 401 if Redis is down (fail-closed). But the **access token validation** path (`user_lookup_callback` in `extensions.py:143-189`) falls back to PostgreSQL silently without logging a degradation warning.

**Impact**: When Redis goes down:
- **Refresh tokens**: Correctly blocked (fail-closed). Users cannot get new access tokens.
- **Existing access tokens**: Still work via PostgreSQL fallback, but every single request now hits PostgreSQL for session validation. With a 10-minute access token lifetime and hundreds of concurrent users, this creates a sudden 10x load spike on PostgreSQL. There is no circuit breaker, no connection pooling adjustment, and no alert mechanism.
- The system enters a split-brain state: some security guarantees (single-use refresh) are enforced, while others (session revocation propagation speed) silently degrade.

---

## HIGH

### 3. Redis N+1 in Session Operations

**Where**: `app/auth/session_store.py`

**`delete_all_user_sessions()`** (lines 242-248):
```python
for session_id in session_ids:
    redis_client.delete(f"session:{session_id}")
```
Iterates over session IDs calling `redis.delete()` one at a time.

**`get_user_sessions()`** (lines 298-302):
```python
for sid in session_ids:
    session_data = cls.get_cached_session(sid)  # redis.get() per session
```
Calls `redis.get()` individually for each session.

**`cleanup_expired_sessions()`** (lines 307-323):
```python
for sid in session_ids:
    if not redis_client.exists(f"session:{sid}"):  # redis.exists() per session
        redis_client.srem(user_sessions_key, sid)   # redis.srem() per session
```
Two Redis commands per session in the loop.

**Impact**: A user with 5 sessions generates 5-10 Redis round trips per operation. The `consume_refresh_token()` method correctly uses `redis.pipeline()` for atomic GET+DELETE, proving the team knows the pattern -- but it's not applied to these bulk operations. Under load (e.g., "logout all" for many users), this creates Redis command storms.

---

### 4. No Key Namespacing or Prefix Isolation

**Where**: Redis key patterns across the codebase:
- `session:{session_id}` -- Session store
- `user_sessions:{user_id}` -- Session store
- `refresh:{jti}` -- Session store
- `email_otp:{email}` -- Email service
- `pre_signup_email_otp:{email}` -- Email service
- Flask-Limiter keys (managed internally)

All keys share the same Redis database (database 0). There is no application-level prefix (e.g., `jlmush:session:{id}`).

**Impact**:
- **Multi-app conflict**: If another application shares the same Redis instance (common in development), key collisions are likely. A `session:abc123` key from another app would be treated as a valid session.
- **Monitoring**: Redis `INFO keyspace` shows all keys aggregated. There is no way to distinguish application keys from limiter keys without `SCAN` + prefix filtering.
- **Flushing**: `FLUSHDB` destroys everything -- sessions, OTPs, rate limits. There is no way to selectively clear one category.

---

### 5. TTL Mismatch Between Redis Session Cache and PostgreSQL Sessions

**Where**: `app/auth/session_store.py:cache_session()` (line 183) calculates TTL as:
```python
ttl = max(int((expires_at - datetime.now(timezone.utc)).total_seconds()), 60)
```

The PostgreSQL `UserSession` has both `expires_at` (soft expiry, extendable) and `absolute_expiry` (hard limit, 30 days). The Redis cache TTL is based on `expires_at` only.

**Impact**: If `expires_at` is extended via token refresh (which updates `last_refreshed_at` and extends `expires_at`), the Redis cache might expire before the PostgreSQL session considers itself expired. This triggers unnecessary PostgreSQL fallback lookups. Conversely, the `absolute_expiry` is not factored into the Redis TTL, so a Redis key could outlive the session's hard limit if `expires_at` is extended beyond it.

---

## MEDIUM

### 6. No Redis Connection Pooling Configuration

**Where**: `app/extensions.py:99` -- `redis_client = redis.from_url(redis_url, decode_responses=True)`.

The `redis.from_url()` uses the default `ConnectionPool` with default settings (max_connections=unlimited, no timeout, no retry).

**Impact**:
- **Connection exhaustion**: Under load, each Gunicorn worker creates its own `redis_client` instance with its own connection pool. With 4 workers and default unlimited connections, Redis can be overwhelmed by hundreds of connections.
- **No timeout**: If Redis becomes slow (network issue, persistence fork), Redis commands block indefinitely, holding up Flask request threads.
- **No retry**: A transient Redis error (e.g., during failover) permanently sets `redis_client = None` at startup, requiring a full application restart to reconnect.

---

### 7. OTP Values Stored as Plaintext in Redis

**Where**: `app/services/email_service.py`:
```python
redis_client.setex(f"email_otp:{email}", 600, otp)  # otp is plaintext "123456"
```

The OTP (6-digit code) is stored as a plaintext string. Anyone with Redis access (or a Redis dump) can read all pending OTPs.

**Impact**: If Redis is compromised (network sniffing, unauthorized access, RDB dump leak), all pending email verification and password reset OTPs are exposed. The attacker can use these OTPs to verify arbitrary email addresses or reset passwords. The auth module hashes refresh tokens before storing them in PostgreSQL but does NOT hash OTPs in Redis.

---

### 8. `user_sessions:{user_id}` Set TTL Is Hardcoded to 30 Days

**Where**: `app/auth/session_store.py:192`:
```python
redis_client.expire(user_sessions_key, 2592000)  # 30 days
```

This TTL is refreshed every time a new session is cached. But individual sessions within the set may expire much sooner (10-day refresh token lifetime).

**Impact**: The set `user_sessions:{user_id}` can contain stale session IDs that point to expired or deleted `session:{id}` keys. The `cleanup_expired_sessions()` method handles this, but it's only called during `get_user_sessions()` -- not proactively. A user who logs in once and never returns accumulates a stale set entry for 30 days.

---

## LOW

### 9. No Redis Sentinel or Cluster Configuration

**Where**: `config.py:20` -- `REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')`.

The Redis connection is a single `redis://` URL with no support for Sentinel, Cluster, or read replicas.

**Impact**: Redis is a single point of failure. If the Redis instance goes down, all session validation falls back to PostgreSQL (increased latency), all rate limiting stops (no enforcement), and all pending OTPs are lost. For a healthcare application, this availability gap could violate uptime SLAs.

---

### 10. Rate Limiter Storage Initialized Independently of Application Redis

**Where**: `app/extensions.py:45`:
```python
limiter = Limiter(key_func=get_remote_address, storage_uri=os.environ.get('REDIS_URL', 'redis://localhost:6379/0'))
```

The limiter creates its own Redis connection at module import time (before `create_app()` is called), using `os.environ.get()` directly. The application's `redis_client` is created later in `init_extensions()`.

**Impact**: Two separate Redis connections exist: one for the limiter (created at import time) and one for the application (created at startup). If `REDIS_URL` changes between import and startup, they point to different Redis instances. The limiter's connection is not health-checked or logged.
