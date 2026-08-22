"""Service Communication — scheduled expiry + retention.

Two background sweeps, both guarded by a Redis leader-lock so only one worker
runs them (same pattern as ``payout_hold_job``):

  * ``expire_due_services``  — flips elapsed purchases to EXPIRED and their
    channels to READ_ONLY. ``expire_if_due`` already runs lazily whenever a
    channel is read, so this only matters for channels nobody opens.

  * ``purge_expired_channels`` — once a channel has been read-only for its
    ``retention_days``, delete the chat messages and S3 documents, drop any
    Twilio call rooms, mark the channel ARCHIVED and record the event. This is
    the ONLY place data is destroyed, and it is deliberately conservative:
    events (the audit trail) are kept, only message bodies + files go.

APScheduler is an optional import (see ``app/__init__.py``); these jobs simply
don't run if it isn't installed, which is why it is now pinned in
``requirements.txt``.
"""
import logging
from datetime import timedelta

logger = logging.getLogger(__name__)


def expire_due_services(app):
    """Flip elapsed active purchases → EXPIRED, their channels → READ_ONLY."""
    with app.app_context():
        _guarded(_expire_due, 'service_comm_expiry')


def purge_expired_channels(app):
    """Delete messages + S3 files for channels past their retention window."""
    with app.app_context():
        _guarded(_purge_retention, 'service_comm_retention')


def _guarded(fn, lock_name):
    from app.extensions import get_redis_client
    redis = get_redis_client()
    if redis is not None:
        # Short lock so a crash doesn't wedge the job forever.
        if not redis.set(f'job:{lock_name}:lock', '1', nx=True, ex=600):
            return
    try:
        fn()
    except Exception:  # noqa: BLE001 — a job crash must not take the worker down
        logger.exception('[SERVICE-COMM] %s failed', lock_name)


def _expire_due():
    from app.extensions import db
    from app.models import PurchasedService, PurchasedServiceStatus, ServiceChannel
    from app.models._base import utcnow
    from app.api.service_communication.service import ActivationService

    now = utcnow()
    due = (
        PurchasedService.query
        .filter(
            PurchasedService.status == PurchasedServiceStatus.ACTIVE,
            PurchasedService.valid_until.isnot(None),
            PurchasedService.valid_until <= now,
            PurchasedService.is_deleted.is_(False),
        )
        .limit(500)
        .all()
    )
    changed = 0
    for purchase in due:
        channel = ServiceChannel.query.filter_by(
            purchased_service_id=purchase.id, is_deleted=False,
        ).first()
        if ActivationService.expire_if_due(purchase, channel):
            changed += 1
    if changed:
        db.session.commit()
        logger.info('[SERVICE-COMM] expired %s service(s)', changed)


def _purge_retention():
    from app.extensions import db
    from app.models import (
        ChannelDocument, ChannelMessage, PurchasedService, ServiceChannel,
        ServiceChannelStatus, ChannelEventType,
    )
    from app.models._base import utcnow
    from app.api.service_communication.service import record_event

    now = utcnow()
    # Read-only channels are candidates; retention is measured from when they
    # went read-only (fallback: the purchase's expiry).
    candidates = (
        ServiceChannel.query
        .filter(
            ServiceChannel.status == ServiceChannelStatus.READ_ONLY,
            ServiceChannel.is_deleted.is_(False),
        )
        .limit(200)
        .all()
    )
    purged = 0
    for channel in candidates:
        purchase = PurchasedService.query.filter_by(
            id=channel.purchased_service_id,
        ).first()
        retention_days = purchase.retention_days if purchase else 365
        since = channel.read_only_at or (purchase.expired_at if purchase else None)
        if since is None or (now - since) < timedelta(days=retention_days):
            continue

        _purge_one_channel(channel)
        channel.status = ServiceChannelStatus.ARCHIVED
        channel.archived_at = now
        record_event(channel, ChannelEventType.CONVERSATION_ARCHIVED, payload={})
        purged += 1

    if purged:
        db.session.commit()
        logger.info('[SERVICE-COMM] archived + purged %s channel(s)', purged)


def _purge_one_channel(channel):
    """Delete a channel's messages + S3 documents + Twilio rooms.

    Events are intentionally preserved — the audit trail must outlive the
    content. Failures on external deletes (S3 / Twilio) are logged, not raised,
    so one bad object can't block the whole purge.
    """
    from app.extensions import db
    from app.models import ChannelDocument, ChannelMessage, ScheduledCall
    from app.services.s3_service import S3Service

    # 1. S3 objects.
    docs = ChannelDocument.query.filter_by(
        channel_id=channel.id, is_deleted=False,
    ).all()
    for doc in docs:
        try:
            S3Service.delete_file(doc.s3_bucket, doc.s3_key)
        except Exception:  # noqa: BLE001
            logger.warning('[SERVICE-COMM] failed to delete S3 %s/%s',
                           doc.s3_bucket, doc.s3_key)
        doc.is_deleted = True

    # 2. Chat message bodies (rows removed; the count lives on in events).
    ChannelMessage.query.filter_by(channel_id=channel.id).delete(
        synchronize_session=False,
    )

    # 3. Twilio call rooms (best-effort — only when configured).
    try:
        from app.api.common.video.service import VideoService
        client = VideoService._get_twilio_client()
        for call in ScheduledCall.query.filter_by(channel_id=channel.id).all():
            if call.twilio_room_name:
                try:
                    for room in client.video.v1.rooms.list(
                        unique_name=call.twilio_room_name, limit=1,
                    ):
                        room.update(status='completed')
                except Exception:  # noqa: BLE001
                    pass
    except Exception:  # noqa: BLE001 — Twilio unconfigured / transient
        pass
