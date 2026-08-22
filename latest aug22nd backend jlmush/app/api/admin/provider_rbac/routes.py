"""
Provider-staff RBAC routes.

Decorator stack matches Operations, which this is reached from:
    @jwt_required() → @role_required([SUPER_ADMIN, SUB_ADMIN])
                    → @rbac_required(OPERATIONS_DOCTOR, <action>)

``OPERATIONS_DOCTOR`` covers all three verticals rather than one module per
vertical. Splitting it would mean a sub-admin could be given clinic staff but
not hospital staff — a distinction nobody has asked for, and three modules to
keep in step for as long as nobody does.

Every route resolves ``<provider_type>`` through ``parse_provider_type``, so a
vertical with no staff (``patient``, ``admin``) 404s here instead of falling
through to an empty list that reads like "this tenant has no roles".
"""
import logging

from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.admin.provider_rbac import provider_rbac_bp
from app.api.admin.provider_rbac.service import (
    ProviderPermissionService, ProviderRoleService, ProviderStaffService,
    catalog_payload, parse_provider_type,
)
from app.common.decorators import role_required, rbac_required
from app.common.responses import (
    success_response, error_response, not_found_response, created_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.models import PermissionAction, PermissionModule, UserRole

logger = logging.getLogger(__name__)

_OPS_DOC = PermissionModule.OPERATIONS_DOCTOR


def _actor_id():
    return getattr(current_user, 'id', None)


def _resolve(provider_type):
    """(StaffProviderType, None) or (None, response) — saves every route
    repeating the same 404."""
    parsed = parse_provider_type(provider_type)
    if not parsed:
        return None, error_response(
            f"'{provider_type}' has no staff. Roles and permissions are "
            f"available for doctor, clinic and hospital.",
            status_code=404,
        )
    return parsed, None


# ── Module catalog ─────────────────────────────────────────────────────────
@provider_rbac_bp.route('/<provider_type>/modules', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.VIEW)
def get_module_catalog(provider_type):
    """The tree the matrix renders, plus the column and data-range vocabulary.

    Returned together so the client needs one request to draw an empty matrix.
    """
    parsed, err = _resolve(provider_type)
    if err:
        return err
    return success_response(data=catalog_payload(parsed))


# ── Roles ──────────────────────────────────────────────────────────────────
@provider_rbac_bp.route('/<provider_type>/roles', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.VIEW)
def list_roles(provider_type):
    parsed, err = _resolve(provider_type)
    if err:
        return err
    tenant_id = current_tenant_id_strict()
    # First read of a vertical seeds its starting roles — see ensure_defaults
    # for why this isn't a migration.
    ProviderRoleService.ensure_defaults(tenant_id, parsed, _actor_id())
    return success_response(data={
        'provider_type': parsed.value,
        'roles': ProviderRoleService.list_roles(tenant_id, parsed),
    })


@provider_rbac_bp.route('/<provider_type>/roles', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.CREATE)
def create_role(provider_type):
    parsed, err = _resolve(provider_type)
    if err:
        return err
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return error_response('Role name is required')

    tenant_id = current_tenant_id_strict()
    # Against the shared tier only — one clinic having authored its own "Front
    # Desk" is no reason the admin can't offer a tenant-wide one by that name.
    if ProviderRoleService.name_taken(tenant_id, parsed, name):
        return error_response(f'A shared {parsed.value} role named "{name}" already exists')

    role = ProviderRoleService.create_role(tenant_id, parsed, data, _actor_id())
    return created_response(role.to_dict(include_counts=True))


@provider_rbac_bp.route('/roles/<role_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.EDIT)
def update_role(role_id):
    role = ProviderRoleService.get_role(current_tenant_id_strict(), role_id)
    if not role:
        return not_found_response('Role')
    data = request.get_json() or {}
    if 'name' in data and not (data.get('name') or '').strip():
        return error_response('Role name cannot be empty')
    ProviderRoleService.update_role(role, data, _actor_id())
    return success_response(data=role.to_dict(include_counts=True),
                            message='Role updated')


@provider_rbac_bp.route('/roles/<role_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.DELETE)
def delete_role(role_id):
    role = ProviderRoleService.get_role(current_tenant_id_strict(), role_id)
    if not role:
        return not_found_response('Role')
    ok, message = ProviderRoleService.delete_role(role)
    if not ok:
        return error_response(message)
    return success_response(message='Role deleted')


# ── Permissions ────────────────────────────────────────────────────────────
@provider_rbac_bp.route('/roles/<role_id>/permissions', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.VIEW)
def get_role_permissions(role_id):
    role = ProviderRoleService.get_role(current_tenant_id_strict(), role_id)
    if not role:
        return not_found_response('Role')
    return success_response(data=ProviderPermissionService.get_matrix(role))


@provider_rbac_bp.route('/roles/<role_id>/permissions', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.EDIT)
def save_role_permissions(role_id):
    """Replace this role's grants with what the matrix submitted.

    Whole-matrix replace, not a patch — see ``replace_matrix``.
    """
    role = ProviderRoleService.get_role(current_tenant_id_strict(), role_id)
    if not role:
        return not_found_response('Role')

    payload = request.get_json() or {}
    permissions = payload.get('permissions')
    if not isinstance(permissions, list):
        return error_response('"permissions" must be a list')

    count, message = ProviderPermissionService.replace_matrix(
        role, permissions, _actor_id(),
    )
    if message:
        return error_response(message)
    logger.info('Provider role %s (%s) permissions replaced: %s modules granted',
                role.name, role.id, count)
    return success_response(
        data=ProviderPermissionService.get_matrix(role),
        message=f'{count} module{"" if count == 1 else "s"} granted',
    )


# ── Staff ──────────────────────────────────────────────────────────────────
@provider_rbac_bp.route('/<provider_type>/staff', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.VIEW)
def list_staff(provider_type):
    parsed, err = _resolve(provider_type)
    if err:
        return err
    return success_response(data=ProviderStaffService.list_staff(
        current_tenant_id_strict(),
        provider_type=parsed,
        provider_id=request.args.get('provider_id'),
        search=(request.args.get('search') or '').strip(),
        role_id=request.args.get('role_id'),
        page=request.args.get('page', 1, type=int),
        per_page=request.args.get('per_page', 20, type=int),
    ))


@provider_rbac_bp.route('/<provider_type>/staff', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.CREATE)
def create_staff(provider_type):
    """Create a staff member, optionally with a sign-in.

    Body: first_name, provider_id, [last_name, email, phone_number,
    designation, employee_code, notes, role_ids, password]. A ``password``
    alongside the email is what mints the login — see ``apply_login``.
    """
    parsed, err = _resolve(provider_type)
    if err:
        return err
    data = request.get_json() or {}
    if not (data.get('first_name') or '').strip():
        return error_response('first_name is required')
    provider_id = data.get('provider_id')
    if not provider_id:
        return error_response('provider_id is required — staff belong to one provider')

    tenant_id = current_tenant_id_strict()
    if not ProviderStaffService.provider_exists(tenant_id, parsed, provider_id):
        return not_found_response(parsed.value.capitalize())

    staff, message = ProviderStaffService.create_staff_with_login(
        tenant_id, parsed, provider_id, data, _actor_id(),
    )
    if message:
        return error_response(message)
    return created_response(staff.to_dict())


@provider_rbac_bp.route('/staff/<staff_id>', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.VIEW)
def get_staff(staff_id):
    staff = ProviderStaffService.get_staff(current_tenant_id_strict(), staff_id)
    if not staff:
        return not_found_response('Staff member')
    return success_response(data={
        **staff.to_dict(),
        # What this person can actually do, after merging every role they
        # hold. Empty today for anyone with no roles — and inert regardless,
        # since nothing authenticates as staff yet.
        'effective_permissions': ProviderPermissionService.effective_for_staff(staff),
    })


@provider_rbac_bp.route('/staff/<staff_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.EDIT)
def update_staff(staff_id):
    """Edit the person, and with them their sign-in.

    ``password`` sets or resets one, ``revoke_login: true`` suspends it. The
    two travel with the rest of the form because to an operator it is one
    screen and one Save.
    """
    staff = ProviderStaffService.get_staff(current_tenant_id_strict(), staff_id)
    if not staff:
        return not_found_response('Staff member')
    data = request.get_json() or {}
    updated, message = ProviderStaffService.update_staff(staff, data, _actor_id())
    if message:
        return error_response(message)
    message = ProviderStaffService.apply_login(staff, data)
    if message:
        return error_response(message)
    return success_response(data=updated.to_dict(), message='Staff member updated')


@provider_rbac_bp.route('/staff/<staff_id>/provider', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.EDIT)
def set_staff_provider(staff_id):
    """Link a staff member to a different practice: {provider_type, provider_id}.

    The admin's answer to a receptionist moving branch, and to a staff row
    created against the wrong entity. Roles that don't survive the move are
    dropped and named in the message rather than silently — "why can't she see
    the ward list any more" has to have an answer at the moment of the move.
    """
    tenant_id = current_tenant_id_strict()
    staff = ProviderStaffService.get_staff(tenant_id, staff_id)
    if not staff:
        return not_found_response('Staff member')

    data = request.get_json() or {}
    if not data.get('provider_type'):
        return error_response('provider_type is required')
    parsed, err = _resolve(data['provider_type'])
    if err:
        return err
    provider_id = data.get('provider_id')
    if not provider_id:
        return error_response('provider_id is required')
    if not ProviderStaffService.provider_exists(tenant_id, parsed, provider_id):
        return not_found_response(parsed.value.capitalize())

    updated, dropped = ProviderStaffService.set_staff_provider(
        staff, parsed, provider_id, _actor_id(),
    )
    message = f'{updated.full_name} moved to this {parsed.value}'
    if dropped:
        one = len(dropped) == 1
        message += (
            f'. {len(dropped)} role assignment{"" if one else "s"} no longer '
            f'{"applies" if one else "apply"} here and '
            f'{"was" if one else "were"} removed: {", ".join(dropped)}'
        )
    logger.info('Staff %s re-anchored to %s %s, dropped roles: %s',
                updated.id, parsed.value, provider_id, dropped or 'none')
    return success_response(
        data={**updated.to_dict(), 'dropped_roles': dropped}, message=message,
    )


@provider_rbac_bp.route('/staff/<staff_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.DELETE)
def delete_staff(staff_id):
    staff = ProviderStaffService.get_staff(current_tenant_id_strict(), staff_id)
    if not staff:
        return not_found_response('Staff member')
    ProviderStaffService.delete_staff(staff)
    return success_response(message='Staff member removed')


@provider_rbac_bp.route('/staff/<staff_id>/roles', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.EDIT)
def set_staff_roles(staff_id):
    """Set the roles this staff member holds to exactly the list given."""
    staff = ProviderStaffService.get_staff(current_tenant_id_strict(), staff_id)
    if not staff:
        return not_found_response('Staff member')
    payload = request.get_json() or {}
    role_ids = payload.get('role_ids')
    if not isinstance(role_ids, list):
        return error_response('"role_ids" must be a list')
    updated, message = ProviderStaffService.set_roles(staff, role_ids, _actor_id())
    if message:
        return error_response(message)
    return success_response(data=updated.to_dict(), message='Roles updated')
