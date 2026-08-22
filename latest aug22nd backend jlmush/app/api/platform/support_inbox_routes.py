"""Vendor-side support inbox — /api/platform/support/* (channel-backed).

The seller half of the seller-support CHANNEL: list which DIRECT
tenants have a support channel (children talk to their apex, not to
us), and open one — which seats the calling staff user on the channel
as its operator (ADMIN participant). The conversation itself — chat,
documents, video calls — happens through the standard
/api/v1/service-communication endpoints with the customer tenant's
context (the frontend sends X-Tenant-Slug for those calls only).

Gated by the SUPPORT_CHAT module so the owner can hand the inbox to
staff.
"""
import logging

from flask_jwt_extended import current_user, jwt_required

from app.api.platform import platform_bp
from app.api.platform.access import platform_access
from app.common.responses import not_found_response, success_response
from app.extensions import db, limiter
from app.models import Tenant
from app.models._enums import PermissionAction, PermissionModule

logger = logging.getLogger(__name__)


def _direct_customer_or_none(tenant_id):
    import uuid as _uuid
    try:
        _uuid.UUID(str(tenant_id))
    except (ValueError, AttributeError, TypeError):
        return None
    tenant = Tenant.query.filter_by(id=tenant_id, is_deleted=False).first()
    if tenant is None or tenant.is_platform or tenant.parent_tenant_id:
        return None
    return tenant


@platform_bp.route('/support/threads', methods=['GET'])
@jwt_required()
@platform_access(PermissionModule.SUPPORT_CHAT, PermissionAction.VIEW)
def list_support_threads():
    from app.api.admin.support_thread import support_channel_rows
    direct_ids = [
        row.id for row in Tenant.query
        .filter_by(is_platform=False, is_deleted=False,
                   parent_tenant_id=None)
        .with_entities(Tenant.id).all()
    ]
    return success_response(
        support_channel_rows(direct_ids, current_user.id))


@platform_bp.route('/support/tenants/<tenant_id>/open', methods=['POST'])
@jwt_required()
@platform_access(PermissionModule.SUPPORT_CHAT, PermissionAction.CREATE)
@limiter.limit('30 per minute')
def open_support_channel(tenant_id):
    """Get-or-create the tenant's support channel and seat ME on it."""
    tenant = _direct_customer_or_none(tenant_id)
    if tenant is None:
        return not_found_response('Tenant')
    from app.api.service_communication.service import (
        SellerSupportChannelService,
    )
    from app.common.tenant_context import with_tenant_context
    with with_tenant_context(tenant.id):
        channel = SellerSupportChannelService.get_or_create(tenant)
        SellerSupportChannelService.ensure_seller_participant(
            channel, current_user.id)
        db.session.commit()
    return success_response({
        'channel_id': str(channel.id),
        'tenant_slug': tenant.slug,
        'tenant_name': tenant.name,
    })
