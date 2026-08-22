"""Tenant-side seller support — /api/v1/admin/support/*.

Rebuilt on the service-communication CHANNEL stack: the tenant's
admins and their SELLER (vendor, or parent apex) share a real
ServiceChannel, so chat, document exchange and scheduled video/audio
calls all ride the existing machinery. This module only bootstraps
the channel and answers "which channel is mine"; messages, documents
and calls go through /api/v1/service-communication/channels/<id>/*.

Deliberately role+RBAC gated and NEVER feature-gated: a SUSPENDED or
INACTIVE tenant with zero features still gets to talk to the seller
about paying or reactivating.
"""
import logging

from flask import Blueprint
from flask_jwt_extended import current_user, jwt_required

from app.common.decorators import role_required
from app.common.responses import error_response, success_response
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import Tenant, UserRole

logger = logging.getLogger(__name__)

support_thread_bp = Blueprint('admin_support_thread', __name__)

_ADMIN_ROLES = [UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN]


def check_support_permission(action):
    """None when the current admin may use support chat, else a 403.

    SUPER_ADMIN passes outright (their usual RBAC bypass); SUB_ADMIN
    needs the ``support_chat`` grant — the "passed down to sub-admins"
    knob. Shared with the apex reseller mirror.
    """
    if current_user.role == UserRole.SUPER_ADMIN:
        return None
    from app.models import (
        PermissionAction, PermissionModule, PermissionService,
    )
    profile = current_user.admin_profile
    if profile is None or not PermissionService.check(
            profile, PermissionModule.SUPPORT_CHAT, PermissionAction(action)):
        return error_response(
            'Support chat is not included in your role.',
            status_code=403, code='support_chat_forbidden')
    return None


def support_channel_rows(tenant_ids, seller_user_id):
    """Inbox rows for the seller console: one per tenant that has a
    support channel, newest activity first, with the seller's unread
    count (messages after MY last_read_at, or all when I never sat on
    the channel yet)."""
    from app.models import ChannelMessage, ChannelParticipant, ServiceChannel

    if not tenant_ids:
        return []
    channels = ServiceChannel.query.filter(
        ServiceChannel.tenant_id.in_(tenant_ids),
        ServiceChannel.support_seller_tenant_id.isnot(None),
        ServiceChannel.is_deleted.is_(False),
    ).all()
    if not channels:
        return []
    tenants = {str(t.id): t for t in Tenant.query.filter(
        Tenant.id.in_([c.tenant_id for c in channels])).all()}
    out = []
    for ch in channels:
        me = ChannelParticipant.query.filter_by(
            channel_id=ch.id, user_id=seller_user_id, is_deleted=False,
        ).first()
        unread_q = ChannelMessage.query.filter(
            ChannelMessage.channel_id == ch.id,
            ChannelMessage.is_deleted.is_(False),
        )
        if me is not None:
            if me.last_read_at is not None:
                unread_q = unread_q.filter(
                    ChannelMessage.created_at > me.last_read_at)
            unread_q = unread_q.filter(
                ChannelMessage.sender_participant_id != me.id)
        last = (ChannelMessage.query.filter_by(
                    channel_id=ch.id, is_deleted=False)
                .order_by(ChannelMessage.created_at.desc()).first())
        t = tenants.get(str(ch.tenant_id))
        out.append({
            'tenant_id': str(ch.tenant_id),
            'tenant_name': t.name if t else str(ch.tenant_id),
            'tenant_slug': t.slug if t else None,
            'channel_id': str(ch.id),
            'unread': unread_q.count(),
            'last_message': ({
                'body': (last.body or '')[:140],
                'created_at': (last.created_at.isoformat()
                               if last.created_at else None),
            } if last else None),
        })
    out.sort(key=lambda r: (r['last_message'] or {}).get('created_at') or '',
             reverse=True)
    return out


@support_thread_bp.route('/channel', methods=['GET'])
@jwt_required()
@role_required(_ADMIN_ROLES)
def get_my_support_channel():
    """Bootstrap (or fetch) this tenant's seller-support channel."""
    err = check_support_permission('view')
    if err:
        return err
    tenant_id = current_tenant_id_strict()
    tenant = Tenant.query.filter_by(id=tenant_id).first()
    if tenant is None or tenant.is_platform:
        return error_response(
            'The vendor has no seller to talk to.', status_code=400)
    from app.api.service_communication.service import (
        SellerSupportChannelService,
    )
    channel = SellerSupportChannelService.get_or_create(tenant)
    db.session.commit()
    seller = SellerSupportChannelService.seller_tenant_for(tenant)
    return success_response({
        'channel_id': str(channel.id),
        'seller_name': seller.name if seller else 'your provider',
    })
