"""Server-side broadcast helpers for the communication channel.

Called from REST routes / services AFTER a successful ``db.session.commit()``
(persist-first: Postgres is the source of truth, the socket is transport only).
Safe to call from any gunicorn worker — with the Redis ``message_queue``
configured, ``socketio.emit`` publishes to Redis and the socket worker(s) fan
it out to connected clients, so an emit from an HTTP worker still reaches
everyone.

Every helper is best-effort and swallows its own errors: the REST write already
committed, so a broadcast failure must never turn a successful request into a
5xx. Delivery is at-most-once; clients also keep a low-frequency REST poll as a
fallback, and the message table remains authoritative.

Two fan-out targets per event:
  * the channel room  — clients currently viewing that conversation (instant
    message / read / typing updates);
  * each participant's user room — so a new message bumps the channel-list
    unread badge even when that conversation isn't open.
"""
import logging

from app.realtime.rooms import channel_room, user_room

logger = logging.getLogger(__name__)


def _participant_user_ids(channel_id, tenant_id):
    """User ids of every (non-deleted) participant in a channel.

    Wrapped in the tenant context because it may run AFTER the caller's commit,
    at which point the request's ``SET LOCAL app.current_tenant_id`` has been
    cleared (SET LOCAL is transaction-scoped) and RLS would otherwise deny all
    rows. Best-effort: returns [] on any error.
    """
    try:
        from app.common.tenant_context import with_tenant_context
        from app.models import ChannelParticipant
        with with_tenant_context(tenant_id):
            rows = ChannelParticipant.query.filter_by(
                tenant_id=tenant_id, channel_id=channel_id, is_deleted=False,
            ).all()
            return [str(p.user_id) for p in rows]
    except Exception:  # noqa: BLE001 — never let a broadcast lookup break a request
        logger.exception("[SOCKET] participant lookup failed channel=%s", channel_id)
        return []


def _emit(event, payload, to):
    from app.extensions import socketio
    try:
        socketio.emit(event, payload, to=to)
    except Exception:  # noqa: BLE001
        logger.exception("[SOCKET] emit failed event=%s to=%s", event, to)


def _notify_participant_lists(channel_id, tenant_id, extra=None):
    """Bump the channel-list for every participant (unread badge / ordering)."""
    body = {'channel_id': str(channel_id)}
    if extra:
        body.update(extra)
    for uid in _participant_user_ids(channel_id, tenant_id):
        _emit('channel:activity', body, to=user_room(tenant_id, uid))


def broadcast_message(channel_id, tenant_id, message_dict):
    """A new message was committed → deliver to the open conversation and bump
    every participant's channel list."""
    _emit('message:new', message_dict, to=channel_room(tenant_id, channel_id))
    _notify_participant_lists(channel_id, tenant_id)

    # Mobile leg: a backgrounded app has no socket, so ping the OTHER
    # participants' devices. Deliberately a DEVICE push only — no
    # Notification row (chat has its own unread badge; mirroring every
    # message into the bell would drown it) — and deliberately generic:
    # message content must never ride a push payload (healthcare data
    # transits Apple/Google/Expo servers). Rides the OUTBOX so the N
    # Expo HTTP calls (8s timeout each) never run inside the request.
    try:
        from app.services.outbox import enqueue_now
        sender_id = str(message_dict.get('sender_user_id')
                        or message_dict.get('user_id') or '')
        for uid in _participant_user_ids(channel_id, tenant_id):
            if uid == sender_id:
                continue
            enqueue_now(
                tenant_id=tenant_id, channel='push', recipient=str(uid),
                purpose='chat_message',
                payload={
                    'user_id': str(uid),
                    'title': 'New message',
                    'body': 'You have a new message in your consultation chat.',
                    'data': {'kind': 'chat', 'channel_id': str(channel_id),
                             'url': '/dashboard'},
                },
            )
    except Exception:  # noqa: BLE001 — the socket broadcast already succeeded
        logger.exception('[SOCKET] chat device-push enqueue failed channel=%s',
                         channel_id)


def broadcast_read(channel_id, tenant_id, participant_id, last_read_at):
    """A participant marked the channel read → let the other side clear
    delivered/unread state (read receipts + list badge)."""
    payload = {
        'channel_id': str(channel_id),
        'participant_id': str(participant_id) if participant_id else None,
        'last_read_at': last_read_at,
    }
    _emit('message:read', payload, to=channel_room(tenant_id, channel_id))
    _notify_participant_lists(channel_id, tenant_id)


def broadcast_timeline_event(channel_id, tenant_id, event_type=None):
    """A call/document/form/status change wrote a ChannelEvent → tell clients to
    refresh the timeline (and the list). Generic on purpose: the client just
    refetches the affected RTK-Query tags."""
    payload = {'channel_id': str(channel_id)}
    if event_type:
        payload['event_type'] = str(event_type)
    _emit('timeline:event', payload, to=channel_room(tenant_id, channel_id))
    _notify_participant_lists(channel_id, tenant_id, extra=payload)
