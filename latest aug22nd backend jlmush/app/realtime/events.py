"""Socket.IO event handlers for the communication channel.

Auth model (mirrors the HTTP stack, which the socket path bypasses):
  * The client passes its access token in the handshake ``auth`` payload
    (``io(url, { auth: { token } })``); we also accept ``?token=`` and a Bearer
    Authorization header as fallbacks.
  * We ``decode_token`` it (HS256 / JWT_SECRET_KEY — same as flask-jwt-extended)
    to verify signature + expiry, require ``type == 'access'``, and validate the
    ``session_id`` against the Redis SessionStore so a server-side logout also
    drops the socket.
  * ``tenant_id`` comes from the verified JWT claim (authoritative) and, when an
    Origin is present, must satisfy the same CORS policy as HTTP.

Tenant/RLS: socket handlers do NOT run through the ``before_request`` tenant
hook, so any tenant-scoped DB access is wrapped in
``with_background_tenant_context`` (sets ``g.tenant_id`` + ``SET LOCAL
app.current_tenant_id``). The connection's identity (user_id / tenant_id / role)
is stashed in the per-connection Flask-SocketIO session at connect and read back
on every subsequent event — never trusted from client-supplied data.
"""
import logging

from flask import current_app, request, session
from flask_socketio import join_room, leave_room, emit

from app.extensions import socketio
from app.realtime.origins import origin_allowed
from app.realtime.rooms import channel_room, user_room

logger = logging.getLogger(__name__)


# ── helpers ────────────────────────────────────────────────────────────────

def _extract_token(auth):
    """Pull the access token from the handshake auth payload, query string, or
    Authorization header (in that order)."""
    if isinstance(auth, dict):
        tok = auth.get('token') or auth.get('access_token')
        if tok:
            return tok.strip()
    tok = request.args.get('token')
    if tok:
        return tok.strip()
    header = request.headers.get('Authorization', '')
    if header.startswith('Bearer '):
        return header[7:].strip()
    return None


def _authenticate(token):
    """Validate a raw access token like the HTTP path does.

    Returns a claims dict on success, or None if the token is missing/expired/
    invalid, not an access token, or its session has been revoked.
    """
    if not token:
        return None
    from flask_jwt_extended import decode_token
    from app.auth.session_store import SessionStore
    try:
        claims = decode_token(token)  # verifies HS256 signature + exp
    except Exception:  # noqa: BLE001 — expired / malformed / wrong-key tokens
        return None
    if claims.get('type') != 'access':
        return None  # refuse refresh (or any non-access) tokens
    session_id = claims.get('session_id')
    if not session_id:
        return None
    # Redis is authoritative for live sessions; a logout/revoke removes it here,
    # so this is what makes server-side logout also kill the socket.
    try:
        if not SessionStore.get_cached_session(session_id):
            return None
    except Exception:  # noqa: BLE001 — if the session cache is down, fail closed
        return None
    return claims


def _ctx():
    """The connection's stashed identity (set at connect)."""
    return session.get('user_id'), session.get('tenant_id'), session.get('role')


def _tenant_ctx():
    """Context manager that scopes DB access to this connection's tenant."""
    from app.common.tenant_context import with_background_tenant_context
    return with_background_tenant_context(
        current_app._get_current_object(), session.get('tenant_id'),
    )


# ── handlers ─────────────────────────────────────────────────────────────────

@socketio.on('connect')
def on_connect(auth):
    """Authenticate the handshake; reject (return False) if it fails.

    On success, stash identity and auto-join the user's personal room so
    cross-page signals (unread badges, activity) reach them even before they
    open any specific conversation.
    """
    origin = request.headers.get('Origin')
    if not origin_allowed(current_app._get_current_object(), origin):
        logger.info("[SOCKET] connect rejected — origin not allowed: %s", origin)
        return False

    claims = _authenticate(_extract_token(auth))
    if not claims:
        logger.info("[SOCKET] connect rejected — auth failed sid=%s", request.sid)
        return False

    user_id = claims['sub']
    tenant_id = claims.get('tenant_id')
    if not tenant_id:
        logger.info("[SOCKET] connect rejected — no tenant in token sid=%s", request.sid)
        return False

    session['user_id'] = str(user_id)
    session['tenant_id'] = str(tenant_id)
    session['role'] = claims.get('role')

    join_room(user_room(tenant_id, user_id))
    logger.info("[SOCKET] connected sid=%s user=%s tenant=%s", request.sid, user_id, tenant_id)
    # Let the client know it's live (useful to trigger an initial refetch).
    emit('ready', {'user_id': str(user_id)})
    return True


@socketio.on('disconnect')
def on_disconnect():
    logger.info("[SOCKET] disconnected sid=%s user=%s", request.sid, session.get('user_id'))


@socketio.on('join')
def on_join(data):
    """Join a conversation room after verifying channel membership.

    Membership IS the permission (same rule as the REST endpoints): only a
    ``ChannelParticipant`` may join. tenant_id comes from the verified session,
    never from ``data``, so a socket can't reach another tenant's channel.
    """
    user_id, tenant_id, _ = _ctx()
    if not user_id or not tenant_id:
        return {'ok': False, 'error': 'not_authenticated'}
    channel_id = (data or {}).get('channel_id')
    if not channel_id:
        return {'ok': False, 'error': 'channel_id required'}

    try:
        from app.api.service_communication.service import participant_for_user
        with _tenant_ctx():
            participant = participant_for_user(channel_id, user_id, tenant_id)
    except Exception:  # noqa: BLE001
        logger.exception("[SOCKET] join membership check failed channel=%s", channel_id)
        return {'ok': False, 'error': 'server_error'}

    if participant is None:
        return {'ok': False, 'error': 'not_a_participant'}

    join_room(channel_room(tenant_id, channel_id))
    logger.debug("[SOCKET] user=%s joined channel=%s", user_id, channel_id)
    return {'ok': True, 'channel_id': str(channel_id)}


@socketio.on('leave')
def on_leave(data):
    """Leave a conversation room (client navigated away from the chat)."""
    _, tenant_id, _ = _ctx()
    channel_id = (data or {}).get('channel_id')
    if tenant_id and channel_id:
        leave_room(channel_room(tenant_id, channel_id))
    return {'ok': True}


@socketio.on('typing')
def on_typing(data):
    """Ephemeral typing indicator — broadcast to the room, never persisted.

    Only reaches sockets already in the (tenant-scoped) channel room, and is
    excluded from the sender. No DB write.
    """
    user_id, tenant_id, _ = _ctx()
    channel_id = (data or {}).get('channel_id')
    if not (user_id and tenant_id and channel_id):
        return
    emit(
        'presence:typing',
        {
            'channel_id': str(channel_id),
            'user_id': str(user_id),
            'is_typing': bool((data or {}).get('is_typing')),
        },
        to=channel_room(tenant_id, channel_id),
        skip_sid=request.sid,
    )
