# Redis Critique v2

> Audit Date: 2026-04-14
> Scope: Key design, expiry strategy, pattern usage, scalability, consistency
> Status: Post-refactoring re-audit

---

## RESOLVED FROM v1

| v1 Issue | Status |
|----------|--------|
| In-memory OTP dict for patient profile changes | **FIXED** -- Fully migrated to Redis with `patient_otp:{purpose}:{identifier}` keys and TTL via `setex()`. Raises `ValueError("OTP service unavailable")` if Redis is down (fail-closed) |
| Redis N+1 in session operations | **NOT ADDRESSED** -- `delete_all_user_sessions()` and `get_user_sessions()` still iterate with individual Redis commands instead of pipeline |
| No key namespacing | **NOT ADDRESSED** -- Keys still use bare prefixes (`session:`, `email_otp:`, `patient_otp:`, `refresh:`) with no application-level namespace |
| TTL mismatch between Redis session cache and PostgreSQL | **NOT ADDRESSED** -- Redis session TTL still based on `expires_at` only, not `absolute_expiry` |
| No Redis connection pooling configuration | **NOT ADDRESSED** -- Still uses default `redis.from_url()` pool |
| OTP values stored as plaintext | **NOT ADDRESSED** -- Both `email_otp:{email}` and `patient_otp:{key}` store OTP codes in plaintext |
| `user_sessions:{user_id}` set TTL hardcoded | **NOT ADDRESSED** -- Still hardcoded to 30 days |
| Redis failure degrades session validation | **NOT ADDRESSED** -- Access token path still silently falls back to PostgreSQL on Redis failure |
| Rate limiter storage initialized independently | **NOT ADDRESSED** -- Limiter still creates its own Redis connection at import time |

---

## REMAINING ISSUES

### HIGH

#### 1. No Application-Level Key Prefix

**Where**: Keys across the codebase:
- `session:{session_id}` -- session store
- `user_sessions:{user_id}` -- session store
- `refresh:{jti}` -- session store
- `email_otp:{email}` -- email service
- `pre_signup_email_otp:{email}` -- email service
- `patient_otp:{purpose}:{identifier}` -- patient service (NEW)
- `scheduler:leader` -- scheduler guard (NEW)
- `job:payment_expiry:lock` -- payment job (NEW)
- `job:video_room:lock` -- video job (NEW)

None share a common application prefix (e.g., `jlmush:session:{id}`).

**Impact**: If another application (staging, another microservice, a debugging tool) shares the same Redis instance, key collisions are possible. `FLUSHDB` destroys everything without discrimination. Monitoring cannot distinguish application keys from limiter keys.

---

#### 2. Redis N+1 in Session Bulk Operations

**Where**: `app/auth/session_store.py`

- `delete_all_user_sessions()`: Iterates session IDs calling `redis.delete()` one at a time
- `get_user_sessions()`: Calls `redis.get()` individually per session
- `cleanup_expired_sessions()`: Two Redis commands per session in the loop (`exists()` + `srem()`)

The codebase already uses `redis.pipeline()` for the single-use refresh token consumption (`consume_refresh_token()`), proving the team knows the pattern.

**Impact**: A user with 5 sessions generates 5-10 Redis round trips. Under load (e.g., "logout all" for many users), this creates Redis command storms.

---

### MEDIUM

#### 3. OTP Values Stored as Plaintext in Redis

**Where**:
- `app/services/email_service.py`: `redis.setex(f"email_otp:{email}", 600, otp)` -- 6-digit OTP as plain string
- `app/api/service_reciever/patient/service.py`: `redis.setex(key, 600, json.dumps({...otp...}))` -- OTP inside JSON payload

**Impact**: Anyone with Redis access (network sniffing, unauthorized access, RDB dump) can read all pending OTPs and use them to verify emails or reset passwords.

---

#### 4. No Redis Connection Pooling Tuning

**Where**: `app/extensions.py:75` -- `redis.from_url(redis_url, decode_responses=True)`

Uses default `ConnectionPool` settings (unlimited connections, no timeout, no retry). The `Limiter` on line 23 creates a separate Redis connection at import time.

**Impact**: Under load, each Gunicorn worker creates unbounded Redis connections. If Redis becomes slow (network issue, persistence fork), commands block indefinitely. A transient Redis error at startup permanently sets `redis_client = None`, requiring a full restart.

---

#### 5. Background Job Locks Don't Prevent All Race Conditions

**Where**: `app/api/common/payment/expiry_job.py`, `app/api/common/video/room_scheduler.py`

When Redis is unavailable, both jobs skip the lock and run on all workers (graceful degradation). This is intentional but means Redis failure causes the multi-worker race condition to resurface.

Additionally, the lock TTL (240s for payment, 50s for video) creates a gap: if the job finishes in 10s, the lock is held for the remaining 230s/40s. Another job invocation during this window is unnecessarily blocked. Using `finally: redis.delete(lock_key)` solves this, which IS implemented, but if the process crashes mid-job, the lock persists until TTL expires.

**Impact**: Low in practice. Redis failure is rare, and process crashes are caught by Gunicorn. But the pattern is not production-grade distributed locking (which would use Redlock or similar).

---

### LOW

#### 6. TTL Mismatch: Redis Session Cache vs PostgreSQL Hard Limit

**Where**: `app/auth/session_store.py`

Redis session TTL is calculated from `expires_at` (soft expiry). The PostgreSQL `UserSession` also has `absolute_expiry` (30-day hard limit). The Redis cache TTL doesn't account for `absolute_expiry`, so a Redis key could outlive the session's hard limit if `expires_at` is extended beyond it.

---

#### 7. `user_sessions:{user_id}` Set TTL Hardcoded to 30 Days

**Where**: `app/auth/session_store.py:192` -- `redis.expire(user_sessions_key, 2592000)`

Individual sessions may expire much sooner (10-day refresh token lifetime). The set accumulates stale session IDs for up to 30 days. `cleanup_expired_sessions()` handles this but is only triggered during `get_user_sessions()`, not proactively.

---

## IMPROVEMENTS FROM v1

| Area | What Improved |
|------|--------------|
| **OTP storage** | Patient OTP migrated from in-memory dict to Redis with proper TTL. Fail-closed on Redis unavailability |
| **Job coordination** | Both scheduler jobs now use Redis locks (`nx=True`, TTL, `finally` cleanup). Leader election prevents multi-worker scheduler duplication |
| **Key patterns** | New keys follow clear prefix conventions (`patient_otp:`, `scheduler:`, `job:`) |
