"""
Admin Group Service Offering approval routes.

  GET    /admin/service-groups?status=pending|approved|rejected|all
  POST   /admin/service-groups/<id>/approve
  POST   /admin/service-groups/<id>/reject   (reason required)

Mirrors the simple product-catalog approval pattern (availability_products.py),
NOT the multi-level RBAC ApprovalService.
"""
import logging
from flask import request, Blueprint
from flask_jwt_extended import jwt_required, current_user

from app.common.decorators import role_required
from app.common.responses import success_response, error_response
from app.common.tenant_context import current_tenant_id_strict
from app.models import UserRole, MarketplaceServiceGroup
from app.api.service_provider.doctor.service_group_service import ServiceGroupService
from app.extensions import db

logger = logging.getLogger(__name__)

service_groups_bp = Blueprint('service_groups_admin', __name__)

_VALID_STATUSES = {'awaiting_members', 'pending', 'approved', 'rejected'}


@service_groups_bp.route('', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def list_service_groups():
    """List group service offerings, filtered by ?status (default pending)."""
    status = request.args.get('status', 'pending').lower()
    query = MarketplaceServiceGroup.query.filter_by(tenant_id=current_tenant_id_strict())
    if status in _VALID_STATUSES:
        query = query.filter_by(approval_status=status)
    groups = query.order_by(MarketplaceServiceGroup.created_at.desc()).all()
    return success_response(data={'groups': [g.to_dict() for g in groups]})


@service_groups_bp.route('/<group_id>/approve', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def approve_service_group(group_id):
    group = MarketplaceServiceGroup.query.filter_by(
        id=group_id, tenant_id=current_tenant_id_strict(),
    ).first()
    if not group:
        return error_response('Group offering not found', status_code=404)
    group.approval_status = 'approved'
    group.rejection_reason = None
    db.session.commit()
    return success_response(message='Group offering approved', data=group.to_dict())


@service_groups_bp.route('/<group_id>/reject', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def reject_service_group(group_id):
    data = request.get_json() or {}
    reason = (data.get('reason') or '').strip()
    if not reason:
        return error_response('Reason is required for rejection', status_code=400)
    group = MarketplaceServiceGroup.query.filter_by(
        id=group_id, tenant_id=current_tenant_id_strict(),
    ).first()
    if not group:
        return error_response('Group offering not found', status_code=404)
    group.approval_status = 'rejected'
    group.rejection_reason = reason
    db.session.commit()
    return success_response(message='Group offering rejected', data=group.to_dict())


@service_groups_bp.route('/<group_id>/candidates', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def group_candidates(group_id):
    """Doctors matching a specialization the admin can assign to fill a gap
    (Item 3D). ?specialization_id=<category id>."""
    from app.models import Doctor, ProfileEducationSpecialization
    spec_id = request.args.get('specialization_id')
    if not spec_id:
        return error_response('specialization_id is required', status_code=400)
    tid = current_tenant_id_strict()
    already = {
        str(m.doctor_id) for m in MarketplaceServiceGroup.query.filter_by(
            tenant_id=tid, id=group_id).first().members
    } if MarketplaceServiceGroup.query.filter_by(tenant_id=tid, id=group_id).first() else set()
    rows = ProfileEducationSpecialization.query.filter_by(
        tenant_id=tid, category_id=spec_id,
    ).all()
    out = []
    for r in rows:
        d = r.doctor
        if d and not d.is_deleted and str(d.id) not in already:
            out.append({'id': str(d.id), 'name': d.full_name})
    return success_response(data={'candidates': out})


@service_groups_bp.route('/<group_id>/assign-member', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def assign_group_member(group_id):
    """Admin fills a missing specialty by assigning a matching doctor (Item 3D).
    Body: {doctor_id}. The assigned doctor is auto-accepted."""
    doctor_id = (request.get_json() or {}).get('doctor_id')
    if not doctor_id:
        return error_response('doctor_id is required', status_code=400)
    try:
        group = ServiceGroupService.admin_assign_member(group_id, doctor_id)
        return success_response(message='Doctor assigned to the group', data=group.to_dict())
    except ValueError as e:
        return error_response(str(e), status_code=400)
