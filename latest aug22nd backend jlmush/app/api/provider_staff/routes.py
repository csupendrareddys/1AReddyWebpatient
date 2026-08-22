"""
Provider self-service staff routes.

Every route goes through ``_me()``, which turns the authenticated user into
(vertical, provider row) or an error response. That single resolution point is
what keeps a provider inside their own practice: nothing downstream takes a
provider id from the request, so there is no parameter to tamper with.

**A facility's own staff can reach the directory** when their roles grant
``staff.staff_directory`` — a hospital administrator maintaining the staff list
is the ordinary case. Two things they cannot do, whatever they were granted:

  * assign roles (``PUT /<id>/roles``), and
  * create or edit roles and their permission matrices.

Both are unbounded self-escalation. A staff member who could set roles could set
their own, and every grant in this system would reduce to "whoever gets the
directory first gets everything". Those routes stay owner-only, so widening what
a role can do remains a decision the practice makes about its staff rather than
one a staff member can make about themselves. Reading the roles is fine and is
left open — seeing what "Front Desk" means grants nothing.
"""
import logging

from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.admin.provider_rbac.service import (
    ProviderPermissionService, ProviderRoleService, ProviderStaffService,
    catalog_payload,
)
from app.api.membership import limits
from app.api.provider_staff import provider_staff_bp
from app.common.provider_access import (
    ProviderAccessError, current_principal,
)
from app.common.responses import (
    success_response, error_response, not_found_response, created_response,
    forbidden_response,
)
from app.models import Clinic, Doctor, Hospital, StaffProviderType, UserRole

logger = logging.getLogger(__name__)

# Which provider row to look for, per signed-in role.
_BY_ROLE = {
    UserRole.DOCTOR: (StaffProviderType.DOCTOR, Doctor, 'user_id'),
    UserRole.CLINIC: (StaffProviderType.CLINIC, Clinic, 'admin_user_id'),
    UserRole.HOSPITAL: (StaffProviderType.HOSPITAL, Hospital, 'admin_user_id'),
}

M_DIRECTORY = 'staff.staff_directory'
M_ROLES = 'staff.staff_roles'


def _me(module=None, action='can_view'):
    """(provider_type, provider_row, None) or (None, None, response).

    The practice this request acts for — the caller's own if they are a doctor,
    clinic or hospital; their employer's if they are that practice's staff.

    ``module`` is what a *staff* caller must hold to get through; leaving it
    unset makes the route owner-only, which is the default because these routes
    write the permission system itself.
    """
    try:
        principal = current_principal()
    except ProviderAccessError as exc:
        if exc.status == 404:
            return None, None, not_found_response('Your provider profile')
        return None, None, forbidden_response(exc.message)

    if principal.is_staff:
        if not module:
            return None, None, forbidden_response(
                'Only the practice itself can change roles and permissions.')
        if not principal.can(module, action):
            return None, None, forbidden_response(
                f'Your roles do not allow this. Ask '
                f'{principal.provider_name} to grant it.')

    return principal.provider_type, principal.provider, None


@provider_staff_bp.route('/modules', methods=['GET'])
@jwt_required()
def my_module_catalog():
    """The module tree this provider's roles are set over.

    The same payload the admin matrix renders from, because it is the same
    matrix — a provider narrowing their own role has to be looking at the same
    tree the admin curated the shared ones over, or the two screens would
    disagree about what a module is.
    """
    provider_type, _provider, err = _me(module=M_DIRECTORY)
    if err:
        return err
    return success_response(data=catalog_payload(provider_type))


@provider_staff_bp.route('/roles', methods=['GET'])
@jwt_required()
def list_available_roles():
    """The roles this provider may assign: the shared tier plus their own.

    Seeding runs here so a provider who opens the page before any admin has
    doesn't see an empty picker with no way to fill it.

    Inactive roles are hidden by default because the common caller is the
    assignment picker; the role-management screen passes ``include_inactive``
    so a role the practice switched off is still there to switch back on.
    """
    provider_type, provider, err = _me(module=M_DIRECTORY)
    if err:
        return err
    ProviderRoleService.ensure_defaults(provider.tenant_id, provider_type)
    roles = ProviderRoleService.list_roles(
        provider.tenant_id, provider_type, include_counts=True,
        owner_id=provider.id,
    )
    if (request.args.get('include_inactive') or '').lower() not in ('1', 'true', 'yes'):
        roles = [r for r in roles if r['is_active']]
    return success_response(data={
        'provider_type': provider_type.value,
        'roles': roles,
    })


def _own_role(role_id, writable):
    """Load a role this provider is allowed to open, or the reason they can't.

    Returns ``(role, provider, error_response)``. Another practice's role 404s
    rather than 403s, same reasoning as ``_own_staff`` — its existence isn't
    something to probe for. A shared role is readable (a provider should be
    able to see what the admin's "Front Desk" actually grants before handing it
    out) but refuses writes, because one practice editing it would re-scope
    every other practice's staff in the vertical.

    Writes are owner-only regardless of grants: a staff member who could edit a
    role could edit the one they hold. Reads are open to staff holding
    ``staff.staff_roles``.
    """
    provider_type, provider, err = _me(
        module=None if writable else M_ROLES)
    if err:
        return None, None, err
    role = ProviderRoleService.get_role(provider.tenant_id, role_id)
    if not role or role.provider_type != provider_type:
        return None, None, not_found_response('Role')
    if role.owner_id is not None and str(role.owner_id) != str(provider.id):
        return None, None, not_found_response('Role')
    if writable and not ProviderRoleService.can_edit(role, provider.id):
        return None, None, forbidden_response(
            f'"{role.name}" is a shared role managed by your administrator. '
            f'Create your own role to set different permissions.'
        )
    return role, provider, None


@provider_staff_bp.route('/roles', methods=['POST'])
@jwt_required()
def create_my_role():
    """Author a role for this practice alone: {name, description, is_active}.

    Owned by the caller, never shared — a provider adding a role must not be
    able to hand it to every other practice in the tenant.
    """
    provider_type, provider, err = _me()
    if err:
        return err
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return error_response('Role name is required')
    if ProviderRoleService.name_taken(provider.tenant_id, provider_type, name,
                                      owner_id=provider.id):
        return error_response(f'You already have a role named "{name}"')

    role = ProviderRoleService.create_role(
        provider.tenant_id, provider_type, data, current_user.id,
        owner_id=provider.id,
    )
    return created_response(role.to_dict(include_counts=True))


@provider_staff_bp.route('/roles/<role_id>', methods=['PUT'])
@jwt_required()
def update_my_role(role_id):
    role, provider, err = _own_role(role_id, writable=True)
    if err:
        return err
    data = request.get_json() or {}
    if 'name' in data:
        name = (data.get('name') or '').strip()
        if not name:
            return error_response('Role name cannot be empty')
        if ProviderRoleService.name_taken(provider.tenant_id, role.provider_type,
                                          name, owner_id=provider.id,
                                          exclude_id=role.id):
            return error_response(f'You already have a role named "{name}"')
    ProviderRoleService.update_role(role, data, current_user.id)
    return success_response(data=role.to_dict(include_counts=True),
                            message='Role updated')


@provider_staff_bp.route('/roles/<role_id>', methods=['DELETE'])
@jwt_required()
def delete_my_role(role_id):
    role, _provider, err = _own_role(role_id, writable=True)
    if err:
        return err
    ok, message = ProviderRoleService.delete_role(role)
    if not ok:
        return error_response(message)
    return success_response(message='Role deleted')


@provider_staff_bp.route('/roles/<role_id>/permissions', methods=['GET'])
@jwt_required()
def my_role_permissions(role_id):
    role, _provider, err = _own_role(role_id, writable=False)
    if err:
        return err
    return success_response(data=ProviderPermissionService.get_matrix(role))


@provider_staff_bp.route('/roles/<role_id>/permissions', methods=['PUT'])
@jwt_required()
def save_my_role_permissions(role_id):
    """Replace this role's grants with what the matrix submitted.

    Whole-matrix replace, not a patch — see ``replace_matrix``.
    """
    role, _provider, err = _own_role(role_id, writable=True)
    if err:
        return err
    permissions = (request.get_json() or {}).get('permissions')
    if not isinstance(permissions, list):
        return error_response('"permissions" must be a list')

    count, message = ProviderPermissionService.replace_matrix(
        role, permissions, current_user.id,
    )
    if message:
        return error_response(message)
    logger.info('Provider role %s (%s) permissions replaced by owner: %s modules',
                role.name, role.id, count)
    return success_response(
        data=ProviderPermissionService.get_matrix(role),
        message=f'{count} module{"" if count == 1 else "s"} granted',
    )


@provider_staff_bp.route('', methods=['GET'])
@jwt_required()
def list_my_staff():
    provider_type, provider, err = _me(module=M_DIRECTORY, action='can_view')
    if err:
        return err
    return success_response(data=ProviderStaffService.list_staff(
        provider.tenant_id,
        provider_type=provider_type,
        provider_id=provider.id,
        search=(request.args.get('search') or '').strip(),
        page=request.args.get('page', 1, type=int),
        per_page=request.args.get('per_page', 50, type=int),
    ))


@provider_staff_bp.route('', methods=['POST'])
@jwt_required()
def create_my_staff():
    """Add someone to this practice, optionally with a sign-in.

    Body: first_name, [last_name, email, password, phone_number, designation,
    employee_code, notes, role_ids]. Roles and credentials go in through the
    same validated path as the dedicated endpoints — a provider can't smuggle
    in another practice's role by attaching it at creation time.
    """
    provider_type, provider, err = _me(module=M_DIRECTORY, action='can_create')
    if err:
        return err

    # The practice's membership tier caps how many people it may employ here.
    # Checked before the payload is even read: a refusal is about the practice,
    # not about this person, and validating their details first would suggest
    # there was something wrong with them.
    try:
        limits.require_capacity(provider_type, provider.id, limits.SUPPORT_STAFF)
    except limits.PlanLimitExceeded as exc:
        return limits.limit_response(exc)

    data = request.get_json() or {}
    if not (data.get('first_name') or '').strip():
        return error_response('First name is required')
    if err := _no_credential_writes_by_staff(data):
        return err
    if err := _no_role_writes_by_staff(data):
        return err

    staff, message = ProviderStaffService.create_staff_with_login(
        provider.tenant_id, provider_type, provider.id, data, current_user.id,
    )
    if message:
        return error_response(message)
    return created_response(staff.to_dict())


def _no_credential_writes_by_staff(data, target=None):
    """Refuse password / login changes from a staff caller.

    Editing the directory has to stop short of touching logins, or a staff
    member granted ``can_edit`` could reset a colleague's password and sign in
    as someone holding more than they do.

    The email is guarded on the same grounds and for the same reason it is not
    a second field: it IS the sign-in identity. Repointing a colleague's
    address at one you control is a password reset with an extra step, so it is
    refused for anyone who has a login. A staff record with no account is just
    contact detail, and stays editable.
    """
    try:
        principal = current_principal()
    except ProviderAccessError:
        return None
    if not principal.is_staff:
        return None
    if data.get('password') or data.get('revoke_login'):
        return forbidden_response(
            'Only the practice itself can set or revoke a staff sign-in.')
    if target is not None and target.user_id and 'email' in data \
            and (data.get('email') or '').strip().lower() != (target.email or '').lower():
        return forbidden_response(
            'Only the practice itself can change the sign-in address of someone '
            'who has a login.')
    return None


def _no_role_writes_by_staff(data):
    """Refuse role assignment from a staff caller — see the module docstring."""
    try:
        principal = current_principal()
    except ProviderAccessError:
        return None
    if principal.is_staff and data.get('role_ids'):
        return forbidden_response(
            'Only the practice itself can assign roles.')
    return None


def _own_staff(staff_id, module=None, action='can_view'):
    """Load a staff row only if it belongs to the caller's practice."""
    provider_type, provider, err = _me(module=module, action=action)
    if err:
        return None, err
    staff = ProviderStaffService.get_staff(provider.tenant_id, staff_id)
    # 404 rather than 403: whether a row exists in someone else's practice
    # isn't something a provider should be able to probe for.
    if not staff or staff.provider_type != provider_type or staff.provider_id != provider.id:
        return None, not_found_response('Staff member')
    return staff, None


@provider_staff_bp.route('/<staff_id>', methods=['PUT'])
@jwt_required()
def update_my_staff(staff_id):
    """Edit the person, and with them their sign-in.

    ``password`` sets or resets one, ``revoke_login: true`` suspends it — one
    screen and one Save from the practice's side.
    """
    staff, err = _own_staff(staff_id, module=M_DIRECTORY, action='can_edit')
    if err:
        return err
    data = request.get_json() or {}
    if err := _no_credential_writes_by_staff(data, target=staff):
        return err
    if err := _no_role_writes_by_staff(data):
        return err
    updated, message = ProviderStaffService.update_staff(staff, data, current_user.id)
    if message:
        return error_response(message)
    message = ProviderStaffService.apply_login(staff, data)
    if message:
        return error_response(message)
    return success_response(data=updated.to_dict(), message='Staff member updated')


@provider_staff_bp.route('/<staff_id>', methods=['DELETE'])
@jwt_required()
def delete_my_staff(staff_id):
    staff, err = _own_staff(staff_id, module=M_DIRECTORY, action='can_delete')
    if err:
        return err
    ProviderStaffService.delete_staff(staff)
    return success_response(message='Staff member removed')


@provider_staff_bp.route('/<staff_id>/roles', methods=['PUT'])
@jwt_required()
def set_my_staff_roles(staff_id):
    staff, err = _own_staff(staff_id)
    if err:
        return err
    payload = request.get_json() or {}
    role_ids = payload.get('role_ids')
    if not isinstance(role_ids, list):
        return error_response('"role_ids" must be a list')
    updated, message = ProviderStaffService.set_roles(staff, role_ids, current_user.id)
    if message:
        return error_response(message)
    return success_response(data=updated.to_dict(), message='Roles updated')


@provider_staff_bp.route('/<staff_id>/branches', methods=['GET'])
@jwt_required()
def get_my_staff_branches(staff_id):
    """Which of the practice's branch clinics this staff member may act on.
    Readable with the directory grant (seeing the assignment grants nothing)."""
    staff, err = _own_staff(staff_id, module=M_DIRECTORY)
    if err:
        return err
    return success_response(data={
        'branch_ids': sorted(str(s.clinic_id) for s in staff.branch_scopes),
    })


@provider_staff_bp.route('/<staff_id>/branches', methods=['PUT'])
@jwt_required()
def set_my_staff_branches(staff_id):
    """Grant a staff member access to a SET of the practice's BRANCH clinics —
    the granular "which branches" dimension. OWNER-ONLY, like role assignment: a
    staff member can never widen their own branch reach. Only branches of THIS
    clinic are accepted; anything else is dropped."""
    from app.extensions import db
    from app.models import Clinic, ProviderStaffBranchScope
    staff, err = _own_staff(staff_id)  # module=None → owner-only
    if err:
        return err
    if staff.provider_type != StaffProviderType.CLINIC:
        return error_response('Branch access applies to clinic staff only.')
    payload = request.get_json() or {}
    branch_ids = payload.get('branch_ids')
    if not isinstance(branch_ids, list):
        return error_response('"branch_ids" must be a list')

    valid = set()
    if branch_ids:
        rows = Clinic.query.filter(
            Clinic.id.in_(branch_ids),
            Clinic.parent_clinic_id == staff.provider_id,
            Clinic.is_deleted.is_(False),
        ).all()
        valid = {str(c.id) for c in rows}
    existing = {str(s.clinic_id): s for s in staff.branch_scopes}
    for cid, row in existing.items():
        if cid not in valid:
            db.session.delete(row)
    for cid in valid - set(existing):
        db.session.add(ProviderStaffBranchScope(
            tenant_id=staff.tenant_id, staff_id=staff.id, clinic_id=cid,
            granted_by_id=current_user.id))
    db.session.commit()
    db.session.refresh(staff)
    return success_response(
        data={'branch_ids': sorted(str(s.clinic_id) for s in staff.branch_scopes)},
        message='Branch access updated')


@provider_staff_bp.route('/<staff_id>/permissions', methods=['GET'])
@jwt_required()
def my_staff_permissions(staff_id):
    """What this staff member's roles add up to.

    The provider's answer to "what did I actually just give them?" — a role
    name means nothing without it.
    """
    staff, err = _own_staff(staff_id, module=M_DIRECTORY, action='can_view')
    if err:
        return err
    return success_response(data={
        'staff_id': str(staff.id),
        'can_login': staff.user_id is not None,
        'permissions': ProviderPermissionService.effective_for_staff(staff),
    })
