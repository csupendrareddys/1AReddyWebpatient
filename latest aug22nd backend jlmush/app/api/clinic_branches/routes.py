"""Clinic Branches API (/api/clinic/branches) — a main clinic manages its
login-less branch clinics, and (Phase B) switches into one to operate it.

A BRANCH is a full ``Clinic`` row with ``parent_clinic_id`` set and a MANAGED
(credential-less) admin ``User`` — the provider-side analogue of a minor
sub-profile. Only the OWNER clinic admin (``@role_required(CLINIC)``) manages
branches; a support-staff account (role PROVIDER_STAFF) can never reach these
routes — that is the anti-escalation wall, free from the role gate.

A branch id is only ever honoured after verifying ``branch.parent_clinic_id ==
caller_clinic.id`` — no branch is addressable across clinics.
"""
from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.extensions import db
from app.api.clinic_branches import clinic_branches_bp
from app.common.decorators import role_required
from app.common.responses import (
    success_response, error_response, created_response, not_found_response,
    forbidden_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.common.managed_clinic import create_managed_clinic_user
from app.models import Clinic, UserRole, StaffProviderType, ProviderStaffBranchScope
from app.models._enums import UserVerificationStatus
from app.models._base import get_or_create_profile_owner, soft_delete_record

# Address fields are NOT NULL on ``clinics`` — a branch needs a real location.
_REQUIRED = ('address', 'city', 'state', 'pincode')


def _my_clinic():
    """The caller's own (main) clinic. A clinic admin's ``User`` is the clinic's
    ``admin_user_id`` — O(1) via the index."""
    return Clinic.query.filter_by(
        admin_user_id=current_user.id,
        tenant_id=current_tenant_id_strict(),
        is_deleted=False,
    ).first()


def _owned_branch(branch_id, clinic):
    """A branch that belongs to ``clinic``, or None. Scoping the lookup to the
    parent IS the authorization check — no branch is addressable elsewhere."""
    if not clinic:
        return None
    return Clinic.query.filter_by(
        id=branch_id, parent_clinic_id=clinic.id, is_deleted=False,
    ).first()


def _apply_fields(branch, data):
    """Copy the editable branch fields off ``data`` (only when present)."""
    for key in ('name', 'registration_number', 'phone', 'email', 'website',
                'address', 'city', 'state', 'pincode'):
        if key in data:
            val = (data.get(key) or '').strip()
            # name/address/city/state/pincode are NOT NULL — don't blank them.
            if not val and key in ('name',) + _REQUIRED:
                continue
            setattr(branch, key, val or None)


@clinic_branches_bp.route('/branches', methods=['GET'])
@jwt_required()
@role_required(UserRole.CLINIC)
def list_branches():
    clinic = _my_clinic()
    if not clinic:
        return not_found_response('Clinic')
    branches = (Clinic.query
                .filter_by(parent_clinic_id=clinic.id, is_deleted=False)
                .order_by(Clinic.created_at.desc()).all())
    return success_response(data={'branches': [b.to_dict() for b in branches]})


@clinic_branches_bp.route('/branches', methods=['POST'])
@jwt_required()
@role_required(UserRole.CLINIC)
def create_branch():
    clinic = _my_clinic()
    if not clinic:
        return not_found_response('Clinic')
    # A branch can't itself spawn branches (its owner is login-less and never
    # reaches here) — but guard anyway so the tree stays one level deep.
    if clinic.parent_clinic_id is not None:
        return error_response('A branch cannot create its own branches.', status_code=400)

    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return error_response('A branch name is required.', status_code=400)
    missing = [k for k in _REQUIRED if not (data.get(k) or '').strip()]
    if missing:
        return error_response(
            f"Missing required location field(s): {', '.join(missing)}.", status_code=400)

    owner = create_managed_clinic_user(clinic.tenant_id, name)
    branch = Clinic(
        tenant_id=clinic.tenant_id,
        parent_clinic_id=clinic.id,
        admin_user_id=owner.id,
        name=name,
        registration_number=(data.get('registration_number') or '').strip() or None,
        phone=(data.get('phone') or '').strip() or None,
        email=(data.get('email') or '').strip() or None,
        website=(data.get('website') or '').strip() or None,
        address=(data.get('address') or '').strip(),
        city=(data.get('city') or '').strip(),
        state=(data.get('state') or '').strip(),
        pincode=(data.get('pincode') or '').strip(),
        verification_status=UserVerificationStatus.PENDING,
        is_active=True,
        created_by_id=current_user.id,
    )
    db.session.add(branch)
    db.session.flush()
    # Own ProfileOwner so the branch's EntityProfile reads resolve (branches
    # don't go through signup_clinic, which normally mints this).
    get_or_create_profile_owner('clinic', branch.id, clinic.tenant_id)
    db.session.commit()
    return created_response(data=branch.to_dict(), message='Branch created')


@clinic_branches_bp.route('/branches/<branch_id>', methods=['GET'])
@jwt_required()
@role_required(UserRole.CLINIC)
def get_branch(branch_id):
    branch = _owned_branch(branch_id, _my_clinic())
    if not branch:
        return not_found_response('Branch')
    return success_response(data=branch.to_dict())


@clinic_branches_bp.route('/branches/<branch_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.CLINIC)
def update_branch(branch_id):
    branch = _owned_branch(branch_id, _my_clinic())
    if not branch:
        return not_found_response('Branch')
    _apply_fields(branch, request.get_json() or {})
    db.session.commit()
    return success_response(data=branch.to_dict(), message='Branch updated')


@clinic_branches_bp.route('/branches/<branch_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.CLINIC)
def delete_branch(branch_id):
    branch = _owned_branch(branch_id, _my_clinic())
    if not branch:
        return not_found_response('Branch')
    branch.is_active = False
    soft_delete_record(branch)
    db.session.commit()
    return success_response(message='Branch removed')


# ══════════════════════════════════════════════════════════════════════════════
# Switch into a branch — the parent (or a branch-scoped staff member) operates it
# ══════════════════════════════════════════════════════════════════════════════

# Branch surface → clinic module group. A branch-scoped staff member may act on a
# branch endpoint only if their role grants the same group they'd need on the
# main clinic.
_BRANCH_PATH_GROUP = (
    ('entity-profile', 'entity_profile'),
    ('membership', 'billing'),
    ('affiliation/facility', 'doctors_network'),  # Manage Doctors
    ('facility/network', 'doctors_network'),       # Network Requests inbox
)


def _branch_group_for(subpath):
    subpath = (subpath or '').strip('/')
    for prefix, group in _BRANCH_PATH_GROUP:
        if subpath == prefix or subpath.startswith(prefix + '/'):
            return group
    return None


def _staff_allowed_on_branch(principal, subpath, method):
    """A branch-scoped staff member may call ``subpath`` iff their role grants the
    matching clinic module group (GET → a view grant; write → an edit/create
    grant; ``full_access`` satisfies either). Fail closed on an unmapped path."""
    group = _branch_group_for(subpath)
    if not group:
        return False
    write = method != 'GET'
    for key, grant in (principal.grants or {}).items():
        if key != group and not key.startswith(group + '.'):
            continue
        if grant.get('full_access'):
            return True
        if write and (grant.get('can_edit') or grant.get('can_create') or grant.get('can_update')):
            return True
        if not write and grant.get('can_view'):
            return True
    return False


@clinic_branches_bp.route('/branches/<branch_id>/act/<path:subpath>',
                          methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
@jwt_required()
@role_required([UserRole.CLINIC, UserRole.PROVIDER_STAFF])
def branch_act(branch_id, subpath):
    """Operate a login-less BRANCH as itself, from the parent clinic.

    OWNER (the clinic admin) → full access to any of their branches. STAFF → only
    branches in their ``ProviderStaffBranchScope``, and only endpoints their
    clinic role grants (module-gated). Then the shared ``_proxy`` runs the
    branch's own self-service endpoint with ``current_user`` swapped to the
    branch's managed owner."""
    from app.api.admin.operations.act_on_behalf import _proxy, _COMPILED_BRANCH_PATHS
    from app.common.provider_access import current_principal, ProviderAccessError

    try:
        principal = current_principal()
    except ProviderAccessError as e:
        return forbidden_response(str(e))
    if principal.provider is None or principal.provider_type != StaffProviderType.CLINIC:
        return forbidden_response('Branches are a clinic feature.')

    branch = Clinic.query.filter_by(
        id=branch_id, parent_clinic_id=principal.provider.id, is_deleted=False,
    ).first()
    if not branch:
        return not_found_response('Branch')

    if principal.is_staff:
        scoped = ProviderStaffBranchScope.query.filter_by(
            staff_id=principal.staff.id, clinic_id=branch.id,
        ).first()
        if not scoped:
            return forbidden_response('You have not been given access to this branch.')
        if not _staff_allowed_on_branch(principal, subpath, request.method):
            return forbidden_response('Your role does not permit this action.')

    return _proxy(branch, 'clinic', 'Branch', _COMPILED_BRANCH_PATHS, subpath)
