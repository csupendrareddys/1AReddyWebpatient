"""
RBAC CRUD Routes — Complete API for Role-Based Access Control
=============================================================
Refactored to use Service Layer pattern.
"""
import logging
from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.admin.rbac import rbac_bp
from app.common.decorators import role_required, feature_required
from app.common.responses import (
    success_response, error_response, created_response,
    not_found_response, forbidden_response
)
from app.common.tenant_context import current_tenant_id_strict
from app.models import UserRole
from app.extensions import db

# Services
from app.api.admin.rbac.services import (
    RoleService, PermissionManagementService, SubAdminService, 
    OverrideService, ApprovalService, AuditService, UserService
)

logger = logging.getLogger(__name__)

# ============================================================================
# ROLES CRUD
# ============================================================================

@rbac_bp.route('/roles', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def list_roles():
    """List all roles with optional filters."""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    include_inactive = request.args.get('include_inactive', 'false').lower() == 'true'
    search = request.args.get('search', '', type=str)

    pagination = RoleService.list_roles(page, per_page, search, include_inactive)

    return success_response(data={
        'roles': [r.to_dict(include_permissions=False) for r in pagination.items],
        'pagination': {'page': pagination.page, 'per_page': pagination.per_page,
                       'total': pagination.total, 'pages': pagination.pages}
    })

@rbac_bp.route('/roles', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def create_role():
    """Create a new role."""
    data = request.get_json()
    try:
        role = RoleService.create_role(data, current_user.id)
        logger.info(f"[RBAC] Role created: {role.name} by user={current_user.id}")
        return created_response(role.to_dict(include_permissions=True))
    except ValueError as e:
        return error_response(str(e), status_code=400)
    except Exception as e:
        logger.error(f"Failed to create role: {e}")
        return error_response('An internal error occurred', status_code=500)

@rbac_bp.route('/roles/<role_id>', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_role(role_id):
    """Get role details including all permissions."""
    try:
        role, _ = PermissionManagementService.get_role_matrix(role_id)
        return success_response(data=role.to_dict(include_permissions=True))
    except LookupError:
        return not_found_response('Role')

@rbac_bp.route('/roles/<role_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def update_role(role_id):
    """Update role metadata."""
    data = request.get_json()
    if not data: return error_response('Request body is required', status_code=400)
    try:
        role = RoleService.update_role(role_id, data)
        return success_response(data=role.to_dict(include_permissions=True), message='Role updated')
    except LookupError:
        return not_found_response('Role')
    except ValueError as e:
        return error_response(str(e), status_code=409)
    except PermissionError as e:
        return error_response(str(e), status_code=403)
    except Exception as e:
        logger.error(f"Failed to update role: {e}")
        return error_response('An internal error occurred', status_code=500)

@rbac_bp.route('/roles/<role_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def delete_role(role_id):
    """Soft-delete a role."""
    try:
        RoleService.delete_role(role_id)
        return success_response(message='Role deleted')
    except LookupError:
        return not_found_response('Role')
    except PermissionError as e:
        return error_response(str(e), status_code=403)
    except ValueError as e:
        return error_response(str(e), status_code=409)
    except Exception as e:
        logger.error(f"Failed to delete role: {e}")
        return error_response('An internal error occurred', status_code=500)

@rbac_bp.route('/roles/<role_id>/clone', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def clone_role(role_id):
    """Clone a role with all its permissions."""
    from app.models import Role
    from app.extensions import db
    role = Role.query.filter_by(id=role_id, is_deleted=False).first()
    if not role: return not_found_response('Role')
    
    data = request.get_json() or {}
    new_name = data.get('name', f'{role.name} (Copy)').strip()
    if Role.query.filter_by(name=new_name, is_deleted=False).first():
        return error_response(f'Role "{new_name}" already exists', status_code=409)
    try:
        new_role = role.clone(new_name, created_by_id=current_user.id)
        db.session.add(new_role)
        db.session.commit()
        return created_response(new_role.to_dict(include_permissions=True))
    except Exception as e:
        db.session.rollback()
        logger.error(f"Failed to clone role: {e}")
        return error_response('An internal error occurred', status_code=500)

# ============================================================================
# ROLE PERMISSIONS
# ============================================================================

@rbac_bp.route('/roles/<role_id>/permissions', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_role_permissions(role_id):
    try:
        role, matrix = PermissionManagementService.get_role_matrix(role_id)
        return success_response(data={
            'role_id': str(role.id), 'role_name': role.name,
            'permissions': matrix,
        })
    except LookupError:
        return not_found_response('Role')

@rbac_bp.route('/roles/<role_id>/permissions', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def bulk_set_permissions(role_id):
    data = request.get_json()
    if not data or 'permissions' not in data:
        return error_response('permissions array is required', status_code=400)
    try:
        role, warnings = PermissionManagementService.bulk_update(role_id, data['permissions'], current_user.id)
        result = {'role': role.to_dict(include_permissions=True), 'message': 'Permissions updated'}
        if warnings: result['warnings'] = warnings
        return success_response(data=result)
    except LookupError:
        return not_found_response('Role')
    except Exception as e:
        logger.error(f"Failed to set permissions: {e}")
        return error_response('An internal error occurred', status_code=500)

@rbac_bp.route('/roles/<role_id>/permissions/<module>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def set_single_permission(role_id, module):
    data = request.get_json()
    if not data: return error_response('Request body is required', status_code=400)
    try:
        perm, warnings = PermissionManagementService.update_single(role_id, module, data, current_user.id)
        result = {'permission': perm.to_dict()}
        if warnings: result['warnings'] = warnings
        return success_response(data=result, message='Permission updated')
    except LookupError:
        return not_found_response('Role')
    except ValueError as e:
        return error_response(str(e), status_code=400)
    except Exception as e:
        logger.error(f"Failed to update permission: {e}")
        return error_response('An internal error occurred', status_code=500)

@rbac_bp.route('/roles/<role_id>/permissions/<module>/revoke', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def revoke_role_permission(role_id, module):
    data = request.get_json() or {}
    try:
        perm = PermissionManagementService.kill_switch_revoke(role_id, module, data.get('actions'), current_user.id)
        return success_response(data=perm.to_dict(), message=f'Access revoked for {module}')
    except LookupError as e:
        return not_found_response(str(e))
    except ValueError as e:
        return error_response(str(e), status_code=400)
    except Exception as e:
        logger.error(f"Failed to revoke: {e}")
        return error_response('An internal error occurred', status_code=500)

@rbac_bp.route('/roles/<role_id>/permissions/<module>/restore', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def restore_role_permission(role_id, module):
    data = request.get_json() or {}
    update_data = {}
    mapping = {
        'view': 'can_view', 'create': 'can_create', 'edit': 'can_edit',
        'update': 'can_update', 'delete': 'can_delete',
        'l1_verifier': 'can_l1_verify', 'l2_verifier': 'can_l2_verify',
         'l3_verifier': 'can_l3_verify', 'lock': 'can_lock', 'unlock': 'can_unlock',
        'full_access': 'full_access'
    }
    for a in data.get('actions', []):
        f = mapping.get(a)
        if f: update_data[f] = True
    if data.get('full_access'): update_data['full_access'] = True
    
    try:
        perm, warnings = PermissionManagementService.update_single(role_id, module, update_data, current_user.id)
        result = {'permission': perm.to_dict()}
        if warnings: result['warnings'] = warnings
        return success_response(data=result, message=f'Access restored for {module}')
    except LookupError as e:
        return not_found_response(str(e))
    except ValueError as e:
        return error_response(str(e), status_code=400)
    except Exception as e:
        logger.error(f"Failed to restore: {e}")
        return error_response('An internal error occurred', status_code=500)

# ============================================================================
# SUB-ADMINS
# ============================================================================

@rbac_bp.route('/sub-admins', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def list_sub_admins():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    from app.models import Admin, User
    from app.extensions import db
    from app.models import SubAdminRole
    tenant_id = current_tenant_id_strict()
    query = db.session.query(Admin).join(User, Admin.user_id == User.id).filter(
        Admin.tenant_id == tenant_id,
        Admin.is_deleted == False, User.role == UserRole.SUB_ADMIN, User.is_deleted == False,
    )
    pagination = query.order_by(Admin.created_at.desc()).paginate(
        page=page, per_page=per_page, error_out=False)

    sub_admins = []
    for admin in pagination.items:
        roles = SubAdminRole.query.filter_by(
            admin_id=admin.id, tenant_id=tenant_id, is_active=True,
        ).all()
        sub_admins.append({
            **admin.to_dict(include_user=True),
            'rbac_roles': [r.to_dict() for r in roles],
        })
    return success_response(data={
        'sub_admins': sub_admins,
        'pagination': {'page': pagination.page, 'per_page': pagination.per_page,
                       'total': pagination.total, 'pages': pagination.pages}
    })

@rbac_bp.route('/sub-admins/<admin_id>/roles', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_admin_roles(admin_id):
    from app.models import Admin
    from app.models import SubAdminRole
    tenant_id = current_tenant_id_strict()
    admin = Admin.query.filter_by(
        id=admin_id, tenant_id=tenant_id, is_deleted=False,
    ).first()
    if not admin: return not_found_response('Admin')
    assignments = SubAdminRole.query.filter_by(
        admin_id=admin_id, tenant_id=tenant_id, is_active=True,
    ).all()
    return success_response(data={
        'admin_id': str(admin.id), 'admin_name': admin.full_name,
        'roles': [a.to_dict() for a in assignments],
    })

@rbac_bp.route('/sub-admins/<admin_id>/roles', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def assign_role(admin_id):
    data = request.get_json()
    if not data or 'role_id' not in data:
        return error_response('role_id is required', status_code=400)
    try:
        assignment, created = SubAdminService.assign_role(admin_id, data['role_id'], current_user.id)
        if created:
            return created_response(assignment.to_dict())
        return success_response(data=assignment.to_dict(), message='Role re-assigned')
    except LookupError as e:
        return not_found_response(str(e))
    except ValueError as e:
        return error_response(str(e), status_code=409)
    except Exception as e:
        logger.error(f"Failed to assign: {e}")
        return error_response('An internal error occurred', status_code=500)

@rbac_bp.route('/sub-admins/<admin_id>/roles/<role_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def unassign_role(admin_id, role_id):
    try:
        SubAdminService.revoke_assignment(admin_id, role_id, current_user.id)
        return success_response(message='Role removed from admin')
    except LookupError:
        return not_found_response('Assignment')
    except Exception as e:
        logger.error(f"Failed to unassign role: {e}")
        return error_response('An internal error occurred', status_code=500)

@rbac_bp.route('/sub-admins/<admin_id>/effective-permissions', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_effective_permissions(admin_id):
    from app.models import Admin
    from app.models import PermissionService, DataRange
    admin = Admin.query.filter_by(id=admin_id, is_deleted=False).first()
    if not admin: return not_found_response('Admin')
    
    if (current_user.role != UserRole.SUPER_ADMIN and
            current_user.admin_profile and str(current_user.admin_profile.id) != admin_id):
        return forbidden_response('You can only view your own permissions')

    effective = PermissionService.get_effective_permissions(admin)
    for perms in effective.values():
        dr = perms.get('data_range')
        if isinstance(dr, DataRange):
            perms['data_range'] = dr.name
    return success_response(data={
        'admin_id': str(admin.id), 'admin_name': admin.full_name, 'permissions': effective,
    })

@rbac_bp.route('/sub-admins/<admin_id>/revoke', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def revoke_sub_admin_access(admin_id):
    data = request.get_json()
    if not data or not data.get('module') or not data.get('reason'):
        return error_response('module and reason are required', status_code=400)
    
    from app.models import OverrideType
    data['override_type'] = OverrideType.DENY.value
    try:
        override = OverrideService.create_override(admin_id, data, current_user.id)
        return created_response(override.to_dict())
    except ValueError as e:
        return error_response(str(e), status_code=400)
    except Exception as e:
        logger.error(f"Failed to revoke sub-admin access: {e}")
        return error_response('An internal error occurred', status_code=500)

@rbac_bp.route('/sub-admins/<admin_id>/restore', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def restore_sub_admin_access(admin_id):
    data = request.get_json()
    if not data or not data.get('module'): return error_response('module required', status_code=400)
    from app.models import AdminPermissionOverride, OverrideType, PermissionModule
    from app.extensions import db
    try:
        mod = PermissionModule(data['module'])
        overrides = AdminPermissionOverride.query.filter_by(
            admin_id=admin_id, module=mod, override_type=OverrideType.DENY, is_active=True
        ).all()
        if not overrides: return error_response('No active DENY overrides found', status_code=404)
        for o in overrides: o.deactivate()
        db.session.commit()
        return success_response(message=f'Restored access for {len(overrides)} override(s)')
    except ValueError:
        return error_response('Invalid module', status_code=400)
    except Exception as e:
        logger.error(f"Failed to restore sub-admin access: {e}")
        return error_response('An internal error occurred', status_code=500)

# ============================================================================
# AUDIT LOGS
# ============================================================================

@rbac_bp.route('/audit-logs', methods=['GET'])
@jwt_required()
@feature_required('admin.audit_logs')
@role_required([UserRole.SUPER_ADMIN])
def list_audit_logs():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    filters = {
        'role_id': request.args.get('role_id'),
        'module': request.args.get('module'),
        'action': request.args.get('action'),
        'changed_by_id': request.args.get('changed_by_id')
    }
    try:
        pagination = AuditService.list_logs(page, per_page, filters)
        return success_response(data={
            'audit_logs': [log.to_dict() for log in pagination.items],
            'pagination': {'page': pagination.page, 'per_page': pagination.per_page,
                           'total': pagination.total, 'pages': pagination.pages}
        })
    except ValueError as e:
        return error_response(str(e), status_code=400)

# ============================================================================
# OVERRIDES
# ============================================================================

@rbac_bp.route('/sub-admins/<admin_id>/overrides', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def list_overrides(admin_id):
    from app.models import Admin
    from app.models import PermissionService
    admin = Admin.query.filter_by(id=admin_id, is_deleted=False).first()
    if not admin: return not_found_response('Admin')
    summary = PermissionService.get_override_summary(admin)
    return success_response(data={'admin_id': str(admin.id), 'admin_name': admin.full_name, **summary})

@rbac_bp.route('/sub-admins/<admin_id>/overrides', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def create_override(admin_id):
    data = request.get_json()
    if not data: return error_response('Request body required', status_code=400)
    try:
        override = OverrideService.create_override(admin_id, data, current_user.id)
        return created_response(override.to_dict())
    except ValueError as e:
        return error_response(str(e), status_code=400)
    except Exception as e:
        logger.error(f"Failed to create override: {e}")
        return error_response('An internal error occurred', status_code=500)

@rbac_bp.route('/sub-admins/<admin_id>/overrides/<override_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def update_override(admin_id, override_id):
    data = request.get_json()
    if not data: return error_response('Request body required', status_code=400)
    try:
        override = OverrideService.update_override(override_id, data)
        if str(override.admin_id) != admin_id:
             return error_response('Override does not belong to this admin', status_code=400)
        return success_response(data=override.to_dict(), message='Override updated')
    except LookupError:
        return not_found_response('Override')
    except ValueError as e:
        return error_response(str(e), status_code=400)
    except Exception as e:
        logger.error(f"Failed to update override: {e}")
        return error_response('An internal error occurred', status_code=500)

@rbac_bp.route('/sub-admins/<admin_id>/overrides/<override_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def deactivate_override(admin_id, override_id):
    try:
        override = OverrideService.deactivate_override(override_id)
        return success_response(message='Override deactivated')
    except LookupError:
        return not_found_response('Override')
    except Exception as e:
        logger.error(f"Failed to deactivate override: {e}")
        return error_response('An internal error occurred', status_code=500)

# ============================================================================
# APPROVALS
# ============================================================================

@rbac_bp.route('/approvals', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def list_approvals():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    status_param = request.args.get('status', 'pending', type=str)
    entity_type = request.args.get('entity_type', type=str)
    
    # If frontend explicitly requests 'all', don't apply a status filter
    status_filter = None if status_param.lower() == 'all' else status_param
    
    try:
        pagination = ApprovalService.list_approvals(page, per_page, status_filter, entity_type)
        return success_response(data={
            'approvals': [a.to_dict(include_actions=False) for a in pagination.items],
            'pagination': {'page': pagination.page, 'per_page': pagination.per_page,
                           'total': pagination.total, 'pages': pagination.pages}
        })
    except ValueError as e:
        return error_response(str(e), status_code=400)

@rbac_bp.route('/approvals/<request_id>', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_approval(request_id):
    from app.models import ApprovalRequest
    approval = ApprovalRequest.query.filter_by(id=request_id).first()
    if not approval: return not_found_response('Approval request')
    return success_response(data=approval.to_dict(include_actions=True))

@rbac_bp.route('/approvals/<request_id>/approve', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def approve_request(request_id):
    data = request.get_json() or {}
    try:
        approval = ApprovalService.process_action(request_id, 'approve', current_user.id, data.get('comments'))
        # Mirror the approval into the Doctor row (for
        # DOCTOR_AVAILABILITY / DOCTOR_FEE) + re-materialise
        # time_slots. The same helper is used by the
        # /api/admin/availability-approvals/<id>/approve endpoint —
        # both paths now leave the doctor row in the same state, so
        # whichever UI the operator approves from, the patient-side
        # slot endpoint sees the freshly-approved schedule.
        ApprovalService.apply_doctor_availability_sync(
            approval, current_user.id,
        )
        return success_response(data=approval.to_dict(include_actions=True),
                                message=f'Approved at level {approval.current_level}')
    except LookupError: return not_found_response('Approval request')
    except ValueError as e: return error_response(str(e), status_code=409)
    except Exception as e:
        # Surface the exception type + message in the 500 body so the
        # platform owner sees a debuggable error instead of a generic
        # one. The same detail is also logged with the full traceback
        # for CloudWatch — both paths exist because the user-visible
        # log was hidden behind the generic "Internal error" string
        # before, leaving the operator no way to act.
        logger.error(f"[APPROVE] Failed: {str(e)}", exc_info=True)
        return error_response(
            f'{type(e).__name__}: {e}',
            status_code=500,
        )

@rbac_bp.route('/approvals/<request_id>/reject', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def reject_request(request_id):
    data = request.get_json() or {}
    if not data.get('comments'): return error_response('Comments required', status_code=400)
    try:
        approval = ApprovalService.process_action(request_id, 'reject', current_user.id, data['comments'])

        # Per-slot rejection: mark just the rejected slot on the doctor's draft
        # and recompute the rollup flag — do NOT flip the whole doctor to
        # REJECTED (that would hide every already-approved slot).
        ApprovalService.apply_doctor_availability_reject(approval, current_user.id)

        return success_response(data=approval.to_dict(include_actions=True), message='Request rejected')
    except LookupError: return not_found_response('Approval request')
    except ValueError as e: return error_response(str(e), status_code=409)
    except Exception as e:
        logger.error(f"Failed to reject approval request: {e}")
        return error_response('An internal error occurred', status_code=500)

@rbac_bp.route('/approvals/<request_id>/cancel', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def cancel_request(request_id):
    # Verify ownership or platform-tier admin. Until Round 11 this
    # whitelist only included SUPER_ADMIN, which blocked
    # PLATFORM_OWNER from cancelling cross-tenant requests they
    # had perfectly legitimate authority over. Mirror the bypass
    # logic from ``role_required`` — both SUPER_ADMIN and
    # PLATFORM_OWNER (and the request's own author) can cancel.
    from app.models import ApprovalRequest
    approval = ApprovalRequest.query.filter_by(id=request_id).first()
    if not approval: return not_found_response('Approval request')
    is_privileged = current_user.role in (
        UserRole.SUPER_ADMIN, UserRole.PLATFORM_OWNER,
    )
    is_requester = str(current_user.id) == str(approval.requested_by_id)
    if not (is_privileged or is_requester):
        return forbidden_response(
            'Only the requester, super admin, or platform owner can cancel'
        )
         
    data = request.get_json() or {}
    try:
        ApprovalService.process_action(request_id, 'cancel', current_user.id, data.get('comments', 'Cancelled'))
        return success_response(data=approval.to_dict(include_actions=True), message='Request cancelled')
    except ValueError as e: return error_response(str(e), status_code=409)
    except Exception as e:
        logger.error(f"Failed to cancel approval request: {e}")
        return error_response('An internal error occurred', status_code=500)

# ============================================================================
# MY PERMISSIONS (Current User)
# ============================================================================

@rbac_bp.route('/me/permissions', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_my_permissions():
    """
    GET /api/admin/rbac/me/permissions
    Returns effective permissions for the currently logged-in admin.
    Frontend calls this once on login, caches in Redux.
    """
    from app.models import PermissionService, DataRange, SubAdminRole
    from app.models import Admin

    admin = Admin.query.filter_by(user_id=current_user.id, is_deleted=False).first()
    if not admin:
        return error_response('Admin profile not found', status_code=404)

    is_super = current_user.role == UserRole.SUPER_ADMIN
    effective = PermissionService.get_effective_permissions(admin)

    # Serialize DataRange enums to strings for JSON (module-wide AND per-instance)
    def _serialize_entry(entry):
        dr = entry.get('data_range')
        if isinstance(dr, DataRange):
            entry['data_range'] = dr.name
            entry['data_range_label'] = dr.label

    for module_perms in effective.values():
        _serialize_entry(module_perms)
        for instance_perms in (module_perms.get('instances') or {}).values():
            _serialize_entry(instance_perms)

    assigned_roles = []
    if is_super:
        assigned_roles = [{'name': 'Super Admin', 'level': 999}]
    else:
        for a in SubAdminRole.query.filter_by(admin_id=admin.id, is_active=True).all():
            if a.role:
                assigned_roles.append({
                    'id': str(a.role.id), 'name': a.role.name, 'level': a.role.level
                })

    return success_response(data={
        'is_super_admin': is_super,
        'admin_id': str(admin.id),
        'admin_name': admin.full_name,
        'assigned_roles': assigned_roles,
        'permissions': effective,
    })

# ============================================================================
# APPROVAL WORKFLOW EXTENSIONS
# ============================================================================

@rbac_bp.route('/approvals/<request_id>/query', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def query_request(request_id):
    """Admin asks requester for clarification on an approval request."""
    data = request.get_json() or {}
    if not data.get('comments'):
        return error_response('Comments are required when raising a query', status_code=400)

    from app.models import ApprovalRequest, ApprovalAction, ApprovalActionType, ApprovalRequestStatus
    from app.extensions import db

    approval = ApprovalRequest.query.filter_by(id=request_id).first()
    if not approval:
        return not_found_response('Approval request')

    if approval.status in (ApprovalRequestStatus.COMPLETED, ApprovalRequestStatus.REJECTED):
        return error_response(f'Cannot query in status: {approval.status.value}', status_code=409)

    approval.status = ApprovalRequestStatus.QUERY
    # tenant_id pinned from the parent ApprovalRequest — see the same
    # fix in approve_level / process_action. The TenantMixin auto-fill
    # would stamp the operator's session tenant (apex platform) which
    # is wrong here; the action belongs to the request's tenant.
    action = ApprovalAction(
        tenant_id=approval.tenant_id,
        request_id=approval.id,
        admin_id=current_user.id,
        action=ApprovalActionType.QUERY,
        level=approval.current_level + 1,
        comments=data['comments'],
    )
    db.session.add(action)
    db.session.commit()

    return success_response(
        data=approval.to_dict(include_actions=True),
        message='Query raised on approval request'
    )

@rbac_bp.route('/approvals/<request_id>/respond', methods=['POST'])
@jwt_required()
def respond_to_query(request_id):
    """Requester responds to admin's clarification query."""
    data = request.get_json() or {}
    if not data.get('comments'):
        return error_response('Response comments are required', status_code=400)

    from app.models import ApprovalRequest, ApprovalAction, ApprovalActionType, ApprovalRequestStatus
    from app.extensions import db

    approval = ApprovalRequest.query.filter_by(id=request_id).first()
    if not approval:
        return not_found_response('Approval request')

    # Only the original requester or super admin can respond
    if (str(current_user.id) != str(approval.requested_by_id) and
            current_user.role != UserRole.SUPER_ADMIN):
        return forbidden_response('Only the original requester can respond')

    if approval.status != ApprovalRequestStatus.QUERY:
        return error_response(
            f'Can only respond to requests in QUERY status. Current: {approval.status.value}',
            status_code=409
        )

    approval.status = ApprovalRequestStatus.UNDER_REVIEW
    action = ApprovalAction(
        tenant_id=approval.tenant_id,
        request_id=approval.id,
        admin_id=current_user.id,
        action=ApprovalActionType.RESPOND,
        level=approval.current_level,
        comments=data['comments'],
        attachments=data.get('attachments'),
    )
    db.session.add(action)
    db.session.commit()

    return success_response(
        data=approval.to_dict(include_actions=True),
        message='Response submitted'
    )

@rbac_bp.route('/approvals/<request_id>/escalate', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def escalate_request(request_id):
    """Escalate approval request to higher verification level."""
    data = request.get_json() or {}

    from app.models import ApprovalRequest, ApprovalAction, ApprovalActionType
    from app.extensions import db

    approval = ApprovalRequest.query.filter_by(id=request_id).first()
    if not approval:
        return not_found_response('Approval request')

    if approval.current_level >= 3:
        return error_response('Already at maximum escalation level', status_code=409)

    action = ApprovalAction(
        tenant_id=approval.tenant_id,
        request_id=approval.id,
        admin_id=current_user.id,
        action=ApprovalActionType.ESCALATE,
        level=approval.current_level + 1,
        comments=data.get('comments', 'Escalated to higher level'),
    )
    approval.required_level = max(approval.required_level, approval.current_level + 2)
    db.session.add(action)
    db.session.commit()

    return success_response(
        data=approval.to_dict(include_actions=True),
        message=f'Escalated. Now requires Level {approval.required_level} approval.'
    )

@rbac_bp.route('/enums', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_rbac_enums():
    from app.models import PermissionModule, PermissionAction, DataRange, OverrideType, ApprovalRequestStatus, ApprovalEntityType
    return success_response(data={
        'modules': [{'value': m.value, 'label': m.value.replace('_', ' ').title()} for m in PermissionModule],
        'actions': [{'value': a.value, 'label': a.value.replace('_', ' ').title()} for a in PermissionAction],
        'data_ranges': [{'value': d.name, 'days': d.value, 'label': d.label} for d in DataRange],
        'override_types': [{'value': o.value, 'label': o.value.title()} for o in OverrideType],
        'approval_statuses': [{'value': s.value, 'label': s.value.replace('_', ' ').title()} for s in ApprovalRequestStatus],
        'entity_types': [{'value': e.value, 'label': e.value.replace('_', ' ').title()} for e in ApprovalEntityType],
    })

@rbac_bp.route('/seed', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def seed_roles():
    try:
        from app.models import seed_default_roles
        roles = seed_default_roles()
        return success_response(data={'roles': [r.to_dict() for r in roles]},
                                message=f'{len(roles)} default roles created/verified')
    except Exception as e:
        logger.error(f"Failed to seed roles: {e}")
        return error_response('An internal error occurred', status_code=500)
