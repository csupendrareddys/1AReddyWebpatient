"""
Internal Health Check Endpoints

These endpoints are for internal use only (load balancers, orchestrators, monitoring).
They should NOT be exposed publicly and should NOT be used by frontend applications.

Routes:
- GET /internal/auth-health - Check Redis connectivity for auth system
"""
from flask import Blueprint, jsonify

from app.auth.session_store import SessionStore

internal_bp = Blueprint('internal', __name__, url_prefix='/internal')


@internal_bp.route('/auth-health', methods=['GET'])
def auth_health():
    """
    Check Redis connectivity for the authentication system.
    
    Use cases:
    - Load balancer health checks
    - Orchestrator routing decisions
    - Ops visibility and alerting
    
    This endpoint should NOT be used by frontend applications.
    Auth failure semantics (401) already handle user-facing behavior.
    
    Returns:
        200: Redis is healthy and responding
        503: Redis is unavailable or degraded
    """
    if SessionStore.is_redis_healthy():
        return jsonify({
            'status': 'healthy',
            'service': 'auth-redis',
            'message': 'Redis is responding to health checks'
        }), 200
    else:
        return jsonify({
            'status': 'degraded',
            'service': 'auth-redis',
            'message': 'Redis is unavailable'
        }), 503
