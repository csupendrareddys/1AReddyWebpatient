import logging

from flask import request
from flask_jwt_extended import current_user, jwt_required

from app.api.notifications import notifications_bp
from app.common.responses import error_response, success_response
from app.extensions import db
from app.models import Notification
from app.models._base import utcnow

logger = logging.getLogger(__name__)


@notifications_bp.route('', methods=['GET'])
@jwt_required()
def list_notifications():
    """Newest-first page of the caller's feed.

    Query params: ``limit`` (default 20, max 50), ``unread_only`` (=1),
    ``before`` (ISO timestamp cursor for older pages).
    """
    try:
        limit = min(int(request.args.get('limit', 20)), 50)
    except (TypeError, ValueError):
        limit = 20

    q = Notification.query.filter_by(user_id=current_user.id)
    if request.args.get('unread_only') in ('1', 'true'):
        q = q.filter(Notification.read_at.is_(None))
    before = request.args.get('before')
    if before:
        q = q.filter(Notification.created_at < before)

    rows = q.order_by(Notification.created_at.desc()).limit(limit).all()
    unread = Notification.query.filter_by(user_id=current_user.id).filter(
        Notification.read_at.is_(None)).count()

    return success_response(data={
        'notifications': [r.to_dict() for r in rows],
        'unread_count': unread,
    })


@notifications_bp.route('/<notification_id>/read', methods=['POST'])
@jwt_required()
def mark_read(notification_id):
    row = Notification.query.filter_by(
        id=notification_id, user_id=current_user.id,
    ).first()
    if row is None:
        return error_response('Notification not found', status_code=404)
    if row.read_at is None:
        row.read_at = utcnow()
        db.session.commit()
    return success_response(data=row.to_dict())


@notifications_bp.route('/read-all', methods=['POST'])
@jwt_required()
def mark_all_read():
    updated = Notification.query.filter_by(user_id=current_user.id).filter(
        Notification.read_at.is_(None),
    ).update({'read_at': utcnow()}, synchronize_session=False)
    db.session.commit()
    return success_response(data={'marked_read': updated})


# ── Device push-token registration (mobile apps) ─────────────────────────


@notifications_bp.route('/devices', methods=['POST'])
@jwt_required()
def register_device():
    """Register (or re-point) this device's push token to the caller.

    Body: ``{"token": "ExponentPushToken[…]", "platform": "android"|"ios"}``.
    Tokens are globally unique — a device that logs into a different
    account moves with it, so pushes never reach a previous user.
    """
    from app.models import DevicePushToken

    data = request.get_json() or {}
    from app.common.decorators import scalar_str
    token = scalar_str(data.get('token'))
    if not token or len(token) > 512:
        return error_response('A push token is required.', status_code=400)
    platform = (scalar_str(data.get('platform')) or 'unknown')[:20]

    row = DevicePushToken.query.filter_by(token=token).first()
    if row is None:
        row = DevicePushToken(
            tenant_id=current_user.tenant_id, user_id=current_user.id,
            token=token, platform=platform,
        )
        db.session.add(row)
    else:
        row.user_id = current_user.id
        row.tenant_id = current_user.tenant_id
        row.platform = platform
    row.last_seen_at = utcnow()
    db.session.commit()
    return success_response(data=row.to_dict(),
                            message='Device registered for notifications.')


@notifications_bp.route('/devices', methods=['DELETE'])
@jwt_required()
def unregister_device():
    """Remove this device's token (call at logout). Body: {"token": …}."""
    from app.models import DevicePushToken

    from app.common.decorators import scalar_str
    token = scalar_str((request.get_json() or {}).get('token'))
    if not token:
        return error_response('A push token is required.', status_code=400)
    deleted = DevicePushToken.query.filter_by(
        token=token, user_id=current_user.id,
    ).delete(synchronize_session=False)
    db.session.commit()
    return success_response(data={'removed': deleted})
