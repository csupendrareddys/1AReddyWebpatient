"""
Field Approval Routes
API endpoints for field-level approval workflow.
"""
from flask import request, jsonify
from flask_jwt_extended import jwt_required, current_user

from . import field_approval_bp
from .service import FieldApprovalService
from app.common.decorators import role_required, feature_required
from app.common.tenant_context import current_tenant_id_strict
from app.models import (
    UserRole, PermissionModule, PermissionAction, PermissionService,
    FieldApprovalRequest,
)


# ── Per-module RBAC scoping (Approvals hub) ──────────────────────────────────
# A field-approval request's `section` decides which approve_* permission a
# sub-admin needs: education → approve_education, bank_details → approve_bank,
# everything else → approve_profile. SUPER_ADMIN / PLATFORM_OWNER bypass.
_SECTION_MODULE = {
    'education': PermissionModule.APPROVE_EDUCATION,
    'bank_details': PermissionModule.APPROVE_BANK,
}


def _section_module(section):
    return _SECTION_MODULE.get(section, PermissionModule.APPROVE_PROFILE)


def _can(module, action=PermissionAction.EDIT):
    if current_user.role in (UserRole.SUPER_ADMIN, UserRole.PLATFORM_OWNER):
        return True
    ap = getattr(current_user, 'admin_profile', None)
    return bool(ap) and PermissionService.check(ap, module, action)


def _can_any_approval():
    return any(_can(m, PermissionAction.VIEW) or _can(m) for m in (
        PermissionModule.APPROVE_PROFILE,
        PermissionModule.APPROVE_EDUCATION,
        PermissionModule.APPROVE_BANK,
    ))


def _require_section(request_id):
    """Load the request + enforce the caller may act on its section.
    Returns (req, None) when allowed, or (None, error_response) otherwise."""
    req = FieldApprovalRequest.query.filter_by(
        id=request_id, tenant_id=current_tenant_id_strict(),
    ).first()
    if not req:
        return None, (jsonify({'error': 'Request not found'}), 404)
    if not _can(_section_module(req.section)):
        return None, (jsonify({'error': f'Not permitted to review {req.section} changes'}), 403)
    return req, None


# =============================================================================
# Submitter Endpoints (Doctor / Sub-Admin)
# =============================================================================

@field_approval_bp.route('/submit', methods=['POST'])
@jwt_required()
@feature_required('admin.field_approval')
@role_required([UserRole.DOCTOR, UserRole.SUB_ADMIN, UserRole.SUPER_ADMIN])
def submit_field_changes():
    """Submit field changes for approval."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    entity_type = data.get('entity_type')
    entity_id = data.get('entity_id')
    section = data.get('section')
    changes = data.get('changes')

    if not all([entity_type, entity_id, section, changes]):
        return jsonify({'error': 'entity_type, entity_id, section, and changes are required'}), 400

    if entity_type not in ('doctor', 'admin'):
        return jsonify({'error': 'entity_type must be "doctor" or "admin"'}), 400

    if not isinstance(changes, dict) or not changes:
        return jsonify({'error': 'changes must be a non-empty dict'}), 400

    requests_created = FieldApprovalService.submit_changes(
        submitted_by_id=current_user.id,
        entity_type=entity_type,
        entity_id=entity_id,
        section=section,
        changes=changes,
    )

    return jsonify({
        'message': f'{len(requests_created)} field change(s) submitted for approval',
        'submitted': True,
        'pending_fields': [r.field_name for r in requests_created],
        'request_ids': [str(r.id) for r in requests_created],
    }), 201


@field_approval_bp.route('/my-requests', methods=['GET'])
@jwt_required()
def get_my_requests():
    """Get all approval requests submitted by the current user."""
    entity_type = request.args.get('entity_type')
    status = request.args.get('status')
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)

    result = FieldApprovalService.get_my_requests(
        submitted_by_id=current_user.id,
        entity_type=entity_type,
        status=status,
        page=page,
        per_page=per_page,
    )
    return jsonify(result), 200


@field_approval_bp.route('/status/<entity_type>/<entity_id>', methods=['GET'])
@jwt_required()
def get_field_statuses(entity_type, entity_id):
    """Get approval statuses for all fields of an entity."""
    if entity_type not in ('doctor', 'admin'):
        return jsonify({'error': 'entity_type must be "doctor" or "admin"'}), 400

    result = FieldApprovalService.get_field_statuses(entity_type, entity_id)
    return jsonify(result), 200


@field_approval_bp.route('/account-status/<entity_type>/<entity_id>', methods=['GET'])
@jwt_required()
def get_account_status(entity_type, entity_id):
    """Get full account status: completion + publish + pending approvals."""
    if entity_type not in ('doctor', 'admin'):
        return jsonify({'error': 'entity_type must be "doctor" or "admin"'}), 400

    result = FieldApprovalService.get_account_status(entity_type, entity_id)
    if not result:
        return jsonify({'error': 'Entity not found'}), 404

    return jsonify(result), 200


# =============================================================================
# Super Admin Endpoints (Reviewers)
# =============================================================================

@field_approval_bp.route('/pending', methods=['GET'])
@jwt_required()
@feature_required('admin.field_approval')
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_pending_approvals():
    """List field approval requests for the reviewer queue."""
    if not _can_any_approval():
        return jsonify({'error': 'You do not have any approval permissions'}), 403
    entity_type = request.args.get('entity_type')
    section = request.args.get('section')
    status = request.args.get('status', 'pending')
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)

    result = FieldApprovalService.get_pending_requests(
        entity_type=entity_type,
        section=section,
        page=page,
        per_page=per_page,
        status=status,
    )
    return jsonify(result), 200


@field_approval_bp.route('/<request_id>', methods=['GET'])
@jwt_required()
@feature_required('admin.field_approval')
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_request_detail(request_id):
    """Get details of a specific field approval request."""
    req, err = _require_section(request_id)
    if err:
        return err
    return jsonify(req.to_dict()), 200


@field_approval_bp.route('/<request_id>/approve', methods=['POST'])
@jwt_required()
@feature_required('admin.field_approval')
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def approve_field_change(request_id):
    """Approve a field change request."""
    _, err = _require_section(request_id)
    if err:
        return err
    data = request.get_json() or {}
    comment = data.get('comment')

    result = FieldApprovalService.approve_request(
        request_id=request_id,
        reviewer_id=current_user.id,
        comment=comment,
    )
    if not result:
        return jsonify({'error': 'Request not found or already reviewed'}), 404

    return jsonify({
        'message': 'Field change approved',
        'request': result.to_dict(),
    }), 200


@field_approval_bp.route('/<request_id>/reject', methods=['POST'])
@jwt_required()
@feature_required('admin.field_approval')
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def reject_field_change(request_id):
    """Reject a field change request."""
    _, err = _require_section(request_id)
    if err:
        return err
    data = request.get_json() or {}
    comment = data.get('comment')

    result = FieldApprovalService.reject_request(
        request_id=request_id,
        reviewer_id=current_user.id,
        comment=comment,
    )
    if not result:
        return jsonify({'error': 'Request not found or already reviewed'}), 404

    return jsonify({
        'message': 'Field change rejected',
        'request': result.to_dict(),
    }), 200


@field_approval_bp.route('/<request_id>/query', methods=['POST'])
@jwt_required()
@feature_required('admin.field_approval')
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def query_field_change(request_id):
    """Raise a query on a field change request."""
    _, err = _require_section(request_id)
    if err:
        return err
    data = request.get_json() or {}
    comment = data.get('comment')

    if not comment:
        return jsonify({'error': 'Comment is required when raising a query'}), 400

    result = FieldApprovalService.query_request(
        request_id=request_id,
        reviewer_id=current_user.id,
        comment=comment,
    )
    if not result:
        return jsonify({'error': 'Request not found or already reviewed'}), 404

    return jsonify({
        'message': 'Query raised on field change',
        'request': result.to_dict(),
    }), 200


@field_approval_bp.route('/bulk-approve', methods=['POST'])
@jwt_required()
@feature_required('admin.field_approval')
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def bulk_approve_field_changes():
    """Approve multiple field change requests at once."""
    if not _can_any_approval():
        return jsonify({'error': 'You do not have any approval permissions'}), 403
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    request_ids = data.get('request_ids', [])
    comment = data.get('comment')

    if not request_ids:
        return jsonify({'error': 'request_ids list is required'}), 400

    # Scope to the sections the caller may actually approve (SUPER_ADMIN passes all).
    rows = FieldApprovalRequest.query.filter(
        FieldApprovalRequest.id.in_(request_ids),
        FieldApprovalRequest.tenant_id == current_tenant_id_strict(),
    ).all()
    permitted_ids = [str(r.id) for r in rows if _can(_section_module(r.section))]

    results = FieldApprovalService.bulk_approve(permitted_ids, current_user.id, comment)

    return jsonify({
        'message': f'{len(results)} field change(s) approved',
        'approved_count': len(results),
        'approved_ids': [str(r.id) for r in results],
    }), 200


# =============================================================================
# Publish Status Endpoints (Super Admin only)
# =============================================================================

@field_approval_bp.route('/publish-status/<entity_type>/<entity_id>', methods=['GET'])
@jwt_required()
def get_publish_status(entity_type, entity_id):
    """Get current publish status of an entity."""
    if entity_type not in ('doctor', 'admin'):
        return jsonify({'error': 'entity_type must be "doctor" or "admin"'}), 400

    entity = FieldApprovalService._get_entity(entity_type, entity_id)
    if not entity:
        return jsonify({'error': 'Entity not found'}), 404

    return jsonify({
        'entity_type': entity_type,
        'entity_id': str(entity_id),
        'publish_status': entity.publish_status.value if entity.publish_status else 'inactive',
    }), 200


@field_approval_bp.route('/publish-status/<entity_type>/<entity_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def update_publish_status(entity_type, entity_id):
    """Update publish status (super admin only). Controls patient-facing visibility."""
    if entity_type not in ('doctor', 'admin'):
        return jsonify({'error': 'entity_type must be "doctor" or "admin"'}), 400

    data = request.get_json()
    if not data or 'publish_status' not in data:
        return jsonify({'error': 'publish_status is required'}), 400

    new_status = data['publish_status']
    valid_statuses = ['active', 'inactive', 'on_hold', 'suspended']
    if new_status not in valid_statuses:
        return jsonify({'error': f'publish_status must be one of: {valid_statuses}'}), 400

    entity = FieldApprovalService.update_publish_status(
        entity_type=entity_type,
        entity_id=entity_id,
        new_status=new_status,
        updated_by_id=current_user.id,
    )
    if not entity:
        return jsonify({'error': 'Entity not found'}), 404

    return jsonify({
        'message': f'Publish status updated to {new_status}',
        'publish_status': entity.publish_status.value,
    }), 200


@field_approval_bp.route('/publish-status-by-type/<entity_type>/<entity_id>', methods=['GET'])
@jwt_required()
def get_publish_status_by_type(entity_type, entity_id):
    """Get per-consultation-type publish status of an entity."""
    if entity_type not in ('doctor', 'admin'):
        return jsonify({'error': 'entity_type must be "doctor" or "admin"'}), 400

    entity = FieldApprovalService._get_entity(entity_type, entity_id)
    if not entity:
        return jsonify({'error': 'Entity not found'}), 404

    return jsonify({
        'entity_type': entity_type,
        'entity_id': str(entity_id),
        'publish_status': entity.publish_status.value if entity.publish_status else 'inactive',
        'publish_status_by_type': getattr(entity, 'publish_status_by_type', None) or {},
    }), 200


@field_approval_bp.route('/publish-status-by-type/<entity_type>/<entity_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def update_publish_status_by_type(entity_type, entity_id):
    """
    Update per-consultation-type publish status (super admin only).

    Body: { "status_by_type": { "video": "active", "audio": "on_hold", "marketplace": "inactive" } }
    """
    if entity_type not in ('doctor', 'admin'):
        return jsonify({'error': 'entity_type must be "doctor" or "admin"'}), 400

    data = request.get_json()
    if not data or 'status_by_type' not in data:
        return jsonify({'error': 'status_by_type dict is required'}), 400

    status_by_type = data['status_by_type']
    if not isinstance(status_by_type, dict) or not status_by_type:
        return jsonify({'error': 'status_by_type must be a non-empty dict'}), 400

    try:
        entity = FieldApprovalService.update_publish_status_by_type(
            entity_type=entity_type,
            entity_id=entity_id,
            status_by_type=status_by_type,
            updated_by_id=current_user.id,
        )
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        from app.extensions import db
        db.session.rollback()
        import logging
        logging.getLogger(__name__).error(f'[publish-status-by-type PUT] {type(e).__name__}: {e}')
        return jsonify({'error': 'Internal server error', 'detail': str(e)}), 500

    if not entity:
        return jsonify({'error': 'Entity not found or per-type status not supported'}), 404

    return jsonify({
        'message': 'Per-type publish status updated',
        'publish_status_by_type': getattr(entity, 'publish_status_by_type', {}),
    }), 200
