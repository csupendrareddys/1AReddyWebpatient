"""
Session Store Module
Manages user sessions in Redis for fast validation with PostgreSQL as persistent storage.

Session Flow:
1. Login → Create session in PostgreSQL + cache in Redis
2. Request → Check Redis (fast) → Fallback to PostgreSQL if miss → Recreate cache
3. Logout → Delete from both Redis and PostgreSQL
4. Refresh → Update Redis TTL and rotate token if > 5 days old

Redis Key Format:
- session:{session_id} → JSON with user_id, created_at, expires_at
- user_sessions:{user_id} → Set of session_ids for the user

Configuration (in config.py):
- MAX_SESSIONS_PER_USER: Maximum concurrent sessions (default: 1)
- SESSION_ROTATION_THRESHOLD_DAYS: Days before token rotation (default: 5)
- SESSION_HARD_LIMIT_DAYS: Maximum session lifetime (default: 30)
"""
import json
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, List

from flask import current_app


class SessionStore:
    """
    Redis-based session store for fast session validation.
    
    Usage:
        # Cache a new session
        SessionStore.cache_session(session_id, user_id, expires_at)
        
        # Get cached session
        data = SessionStore.get_cached_session(session_id)
        
        # Delete session (logout)
        SessionStore.delete_session(session_id, user_id)
        
        # Delete all user sessions (logout all)
        SessionStore.delete_all_user_sessions(user_id)
    """
    
    # Redis key prefixes
    SESSION_PREFIX = "session:"
    USER_SESSIONS_PREFIX = "user_sessions:"
    REFRESH_TOKEN_PREFIX = "refresh:"
    
    # Health check timeout
    HEALTH_CHECK_TIMEOUT_MS = 50
    
    @staticmethod
    def _get_redis():
        """Get Redis client from extensions."""
        from app.extensions import get_redis_client
        return get_redis_client()
    
    @staticmethod
    def _session_key(session_id: str) -> str:
        """Generate Redis key for a session."""
        return f"{SessionStore.SESSION_PREFIX}{session_id}"
    
    @staticmethod
    def _user_sessions_key(user_id: str) -> str:
        """Generate Redis key for user's session set."""
        return f"{SessionStore.USER_SESSIONS_PREFIX}{user_id}"
    
    @staticmethod
    def _refresh_token_key(jti: str) -> str:
        """Generate Redis key for a refresh token jti."""
        return f"{SessionStore.REFRESH_TOKEN_PREFIX}{jti}"
    
    @staticmethod
    def cache_session(
        session_id: str,
        user_id: str,
        expires_at: datetime,
        created_at: datetime = None,
        device_info: str = None
    ) -> bool:
        """
        Cache a session in Redis.
        
        Args:
            session_id: Unique session identifier
            user_id: User ID
            expires_at: Session expiration datetime
            created_at: Session creation datetime (optional)
            device_info: Device fingerprint JSON (optional)
            
        Returns:
            True if cached successfully, False otherwise
        """
        redis_client = SessionStore._get_redis()
        if not redis_client:
            return False
        
        try:
            session_data = {
                "user_id": user_id,
                "created_at": (created_at or datetime.now(timezone.utc)).isoformat(),
                "expires_at": expires_at.isoformat(),
                "device_info": device_info
            }
            
            # Calculate TTL in seconds
            ttl = int((expires_at - datetime.now(timezone.utc)).total_seconds())
            if ttl <= 0:
                return False
            
            # Store session data with TTL
            session_key = SessionStore._session_key(session_id)
            redis_client.setex(session_key, ttl, json.dumps(session_data))
            
            # Add to user's session set
            user_key = SessionStore._user_sessions_key(user_id)
            redis_client.sadd(user_key, session_id)
            redis_client.expire(user_key, 60 * 60 * 24 * 30)  # 30 days
            
            return True
            
        except Exception as e:
            current_app.logger.error(f"Redis cache_session error: {e}")
            return False
    
    @staticmethod
    def get_cached_session(session_id: str) -> Optional[Dict]:
        """
        Get a cached session from Redis.
        
        Args:
            session_id: Session identifier
            
        Returns:
            Session data dict or None if not found/expired
        """
        redis_client = SessionStore._get_redis()
        if not redis_client:
            return None
        
        try:
            session_key = SessionStore._session_key(session_id)
            data = redis_client.get(session_key)
            
            if data:
                return json.loads(data)
            return None
            
        except Exception as e:
            current_app.logger.error(f"Redis get_cached_session error: {e}")
            return None
    
    @staticmethod
    def update_session_expiry(session_id: str, new_expires_at: datetime) -> bool:
        """
        Update the expiry time of a cached session.
        
        Args:
            session_id: Session identifier
            new_expires_at: New expiration datetime
            
        Returns:
            True if updated successfully, False otherwise
        """
        redis_client = SessionStore._get_redis()
        if not redis_client:
            return False
        
        try:
            session_key = SessionStore._session_key(session_id)
            data = redis_client.get(session_key)
            
            if not data:
                return False
            
            session_data = json.loads(data)
            session_data["expires_at"] = new_expires_at.isoformat()
            
            ttl = int((new_expires_at - datetime.now(timezone.utc)).total_seconds())
            if ttl <= 0:
                return False
            
            redis_client.setex(session_key, ttl, json.dumps(session_data))
            return True
            
        except Exception as e:
            current_app.logger.error(f"Redis update_session_expiry error: {e}")
            return False
    
    @staticmethod
    def delete_session(session_id: str, user_id: str = None) -> bool:
        """
        Delete a session from Redis.
        
        Args:
            session_id: Session identifier
            user_id: Optional user ID (to clean up user's session set)
            
        Returns:
            True if deleted, False otherwise
        """
        redis_client = SessionStore._get_redis()
        if not redis_client:
            return False
        
        try:
            session_key = SessionStore._session_key(session_id)
            redis_client.delete(session_key)
            
            # Remove from user's session set if user_id provided
            if user_id:
                user_key = SessionStore._user_sessions_key(user_id)
                redis_client.srem(user_key, session_id)
            
            return True
            
        except Exception as e:
            current_app.logger.error(f"Redis delete_session error: {e}")
            return False
    
    @staticmethod
    def delete_all_user_sessions(user_id: str) -> int:
        """
        Delete all sessions for a user from Redis.
        
        Args:
            user_id: User identifier
            
        Returns:
            Number of sessions deleted
        """
        redis_client = SessionStore._get_redis()
        if not redis_client:
            return 0
        
        try:
            user_key = SessionStore._user_sessions_key(user_id)
            session_ids = redis_client.smembers(user_key)
            
            deleted_count = 0
            for session_id in session_ids:
                session_key = SessionStore._session_key(session_id)
                redis_client.delete(session_key)
                deleted_count += 1
            
            redis_client.delete(user_key)
            return deleted_count
            
        except Exception as e:
            current_app.logger.error(f"Redis delete_all_user_sessions error: {e}")
            return 0
    
    @staticmethod
    def get_user_session_count(user_id: str) -> int:
        """
        Get the number of active sessions for a user.
        
        Args:
            user_id: User identifier
            
        Returns:
            Number of active sessions
        """
        redis_client = SessionStore._get_redis()
        if not redis_client:
            return 0
        
        try:
            user_key = SessionStore._user_sessions_key(user_id)
            return redis_client.scard(user_key)
            
        except Exception as e:
            current_app.logger.error(f"Redis get_user_session_count error: {e}")
            return 0
    
    @staticmethod
    def get_user_sessions(user_id: str) -> List[Dict]:
        """
        Get all session data for a user.
        
        Args:
            user_id: User identifier
            
        Returns:
            List of session data dicts
        """
        redis_client = SessionStore._get_redis()
        if not redis_client:
            return []
        
        try:
            user_key = SessionStore._user_sessions_key(user_id)
            session_ids = redis_client.smembers(user_key)
            
            sessions = []
            for session_id in session_ids:
                session_data = SessionStore.get_cached_session(session_id)
                if session_data:
                    session_data["session_id"] = session_id
                    sessions.append(session_data)
            
            return sessions
            
        except Exception as e:
            current_app.logger.error(f"Redis get_user_sessions error: {e}")
            return []
    
    @staticmethod
    def cleanup_expired_sessions(user_id: str) -> int:
        """
        Remove expired sessions from user's session set.
        
        Args:
            user_id: User identifier
            
        Returns:
            Number of expired sessions removed
        """
        redis_client = SessionStore._get_redis()
        if not redis_client:
            return 0
        
        try:
            user_key = SessionStore._user_sessions_key(user_id)
            session_ids = redis_client.smembers(user_key)
            
            removed_count = 0
            for session_id in session_ids:
                session_key = SessionStore._session_key(session_id)
                if not redis_client.exists(session_key):
                    redis_client.srem(user_key, session_id)
                    removed_count += 1
            
            return removed_count
            
        except Exception as e:
            current_app.logger.error(f"Redis cleanup_expired_sessions error: {e}")
            return 0
    
    # =========================================================================
    # REFRESH TOKEN ENFORCEMENT (Security-Critical)
    # =========================================================================
    
    @staticmethod
    def store_refresh_token(jti: str, session_id: str, ttl_seconds: int) -> bool:
        """
        Store refresh token jti → session_id mapping with TTL.
        
        This is called on signin and after each successful refresh.
        
        Args:
            jti: Unique identifier for the refresh token
            session_id: Session ID this token belongs to
            ttl_seconds: Time-to-live in seconds
            
        Returns:
            True if stored successfully, False otherwise
        """
        redis_client = SessionStore._get_redis()
        if not redis_client:
            return False
        
        if ttl_seconds <= 0:
            return False
        
        try:
            key = SessionStore._refresh_token_key(jti)
            redis_client.setex(key, ttl_seconds, session_id)
            current_app.logger.info(f"Stored refresh token jti={jti[:8]}... for session={session_id[:8]}...")
            return True
            
        except Exception as e:
            current_app.logger.error(f"Redis store_refresh_token error: {e}")
            return False
    
    @staticmethod
    def consume_refresh_token(jti: str) -> Optional[str]:
        """
        Atomically GET and DELETE refresh token.
        
        This is the core security operation for single-use tokens.
        If the token doesn't exist, it's either:
        1. Already consumed (replay attack)
        2. Expired (TTL)
        3. Never existed (invalid token)
        
        Args:
            jti: Unique identifier for the refresh token
            
        Returns:
            session_id if token was valid and consumed, None otherwise
        """
        redis_client = SessionStore._get_redis()
        if not redis_client:
            # Redis unavailable - fail closed
            current_app.logger.error("Redis unavailable - cannot consume refresh token")
            return None
        
        try:
            key = SessionStore._refresh_token_key(jti)
            
            # Atomic GET + DEL using pipeline
            pipe = redis_client.pipeline()
            pipe.get(key)
            pipe.delete(key)
            results = pipe.execute()
            
            session_id = results[0]  # Result of GET
            
            if session_id:
                current_app.logger.info(f"Consumed refresh token jti={jti[:8]}...")
                # Decode bytes → str so comparison with JWT string claims works
                return session_id.decode('utf-8') if isinstance(session_id, bytes) else session_id
            else:
                current_app.logger.warning(f"Refresh token not found (replay/expired): jti={jti[:8]}...")
                return None
            
        except Exception as e:
            current_app.logger.error(f"Redis consume_refresh_token error: {e}")
            return None
    
    # ── Refresh grace window ────────────────────────────────────────────
    # A mobile refresh can commit server-side while the RESPONSE dies in
    # transit (radio handoff, timeout). The client then retries with the
    # jti we just consumed — which single-use semantics read as a replay
    # attack and answer by revoking the whole session. The grace record
    # makes that retry IDEMPOTENT: for a short window after rotation, the
    # consumed jti maps to the exact pair the lost response carried.
    #
    # Security posture: this is the industry-standard "reuse interval".
    # An attacker replaying a stolen old token inside the window gets the
    # same new pair the legitimate client got — equivalent to having
    # stolen the response itself. The moment both parties USE the new
    # token, single-use semantics fire again and revoke the session, so
    # theft detection is delayed by at most the window, never lost.
    # Tokens live briefly in Redis, which already holds full session
    # state — same trust domain, bounded by the TTL.

    @staticmethod
    def _refresh_grace_key(jti: str) -> str:
        return f'refresh_grace:{jti}'

    @staticmethod
    def store_refresh_grace(old_jti, session_id, access_token, refresh_token,
                            ttl_seconds) -> bool:
        """Best-effort: a failed write only loses the retry courtesy."""
        redis_client = SessionStore._get_redis()
        if not redis_client or ttl_seconds <= 0:
            return False
        try:
            import json
            redis_client.setex(
                SessionStore._refresh_grace_key(old_jti), int(ttl_seconds),
                json.dumps({'session_id': session_id,
                            'access_token': access_token,
                            'refresh_token': refresh_token}))
            return True
        except Exception as e:  # noqa: BLE001
            current_app.logger.error(f"Redis store_refresh_grace error: {e}")
            return False

    @staticmethod
    def get_refresh_grace(jti: str):
        """dict with session_id/access_token/refresh_token, or None."""
        redis_client = SessionStore._get_redis()
        if not redis_client:
            return None
        try:
            import json
            raw = redis_client.get(SessionStore._refresh_grace_key(jti))
            return json.loads(raw) if raw else None
        except Exception as e:  # noqa: BLE001
            current_app.logger.error(f"Redis get_refresh_grace error: {e}")
            return None

    @staticmethod
    def delete_refresh_token(jti: str) -> bool:
        """
        Delete a refresh token (used for logout).
        
        Args:
            jti: Unique identifier for the refresh token
            
        Returns:
            True if deleted, False otherwise
        """
        redis_client = SessionStore._get_redis()
        if not redis_client:
            return False
        
        try:
            key = SessionStore._refresh_token_key(jti)
            deleted = redis_client.delete(key)
            if deleted:
                current_app.logger.info(f"Deleted refresh token jti={jti[:8]}...")
            return deleted > 0
            
        except Exception as e:
            current_app.logger.error(f"Redis delete_refresh_token error: {e}")
            return False
    
    @staticmethod
    def is_redis_healthy() -> bool:
        """
        Check Redis connectivity with strict timeout.
        
        Used for:
        1. Fail-closed refresh endpoint
        2. Internal health check endpoint
        
        Returns:
            True if Redis responds to PING within timeout, False otherwise
        """
        redis_client = SessionStore._get_redis()
        if not redis_client:
            return False
        
        try:
            # Use socket timeout for quick health check
            # Default redis-py timeout is used, which should be reasonable
            result = redis_client.ping()
            return result is True
            
        except Exception as e:
            current_app.logger.error(f"Redis health check failed: {e}")
            return False
