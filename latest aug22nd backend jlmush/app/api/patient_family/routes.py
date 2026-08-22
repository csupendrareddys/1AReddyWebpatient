"""Patient Family API — role authoring + assignment. All OWNER-only: a patient
authors their own roles and grants one to a linked adult family member. A member
can never author or assign roles (anti self-escalation), like provider staff.
"""
from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.patient_family import patient_family_bp
from app.api.patient_family.module_catalog import module_catalog
from app.api.patient_family.service import PatientRoleService
from app.common.decorators import role_required, feature_required
from app.common.responses import (
    success_response, error_response, created_response, not_found_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.models import UserRole, Patient, HouseGroupMember


def _current_patient():
    return Patient.query.filter_by(
        user_id=current_user.id, tenant_id=current_tenant_id_strict(),
        is_deleted=False,
    ).first()


@patient_family_bp.route('/modules', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
@feature_required('patient.family')
def get_modules():
    """The role permission catalog — the surfaces a role can grant."""
    return success_response(data={'modules': module_catalog()})


@patient_family_bp.route('/scopes', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
@feature_required('patient.family')
def list_scopes():
    """The accounts this patient can switch into: their own MINORS (full access)
    and any patient who granted them a ROLE (role-bounded). Drives the switcher."""
    from app.models import PatientRole
    patient = _current_patient()
    if not patient:
        return not_found_response('Patient profile')
    minors = HouseGroupMember.query.filter_by(
        tenant_id=patient.tenant_id, patient_id=patient.id,
        is_child_account=True, is_active=True).all()
    # Accounts I can OPEN — a patient granted ME (the caller) a role.
    linked = HouseGroupMember.query.filter(
        HouseGroupMember.tenant_id == patient.tenant_id,
        HouseGroupMember.linked_user_id == current_user.id,
        HouseGroupMember.role_id.isnot(None),
        HouseGroupMember.is_child_account.is_(False),
        HouseGroupMember.is_active.is_(True),
    ).all()
    # Linked adults I OWN — real reciprocal links on my side I can assign a role
    # to (owner-only authoring). Excludes minors and JSON-only contacts.
    granted = HouseGroupMember.query.filter(
        HouseGroupMember.tenant_id == patient.tenant_id,
        HouseGroupMember.patient_id == patient.id,
        HouseGroupMember.linked_user_id.isnot(None),
        HouseGroupMember.is_child_account.is_(False),
        HouseGroupMember.is_active.is_(True),
    ).all()

    def _linked(m):
        owner = m.patient  # the patient who granted this caller a role
        role = PatientRole.query.get(m.role_id) if m.role_id else None
        return {
            'member_id': str(m.id), 'kind': 'linked_adult',
            'name': owner.full_name if owner else f'{m.first_name} {m.last_name or ""}'.strip(),
            'relation': m.relation, 'role': role.name if role else None,
        }

    return success_response(data={
        'minors': [{
            'member_id': str(m.id), 'kind': 'minor',
            'name': f'{m.first_name} {m.last_name or ""}'.strip(), 'relation': m.relation,
        } for m in minors],
        'linked': [_linked(m) for m in linked],
        'granted': [{
            'member_id': str(m.id), 'kind': 'linked_adult',
            'name': f'{m.first_name} {m.last_name or ""}'.strip(),
            'relation': m.relation, 'role_id': str(m.role_id) if m.role_id else None,
        } for m in granted],
    })


@patient_family_bp.route('/roles', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
@feature_required('patient.family')
def list_roles():
    patient = _current_patient()
    if not patient:
        return not_found_response('Patient profile')
    roles = PatientRoleService.list_for_owner(patient.tenant_id, patient.id)
    return success_response(data={'roles': [r.to_dict() for r in roles]})


@patient_family_bp.route('/roles', methods=['POST'])
@jwt_required()
@role_required(UserRole.PATIENT)
@feature_required('patient.family')
def create_role():
    patient = _current_patient()
    if not patient:
        return not_found_response('Patient profile')
    data = request.get_json() or {}
    from app.api.patient_family.quota import assert_quota_available, PatientQuotaExceeded
    try:
        assert_quota_available(patient, 'roles')
    except PatientQuotaExceeded as e:
        return error_response(str(e), status_code=403)
    try:
        role = PatientRoleService.create(
            patient.tenant_id, patient.id,
            data.get('name'), data.get('description'))
    except ValueError as e:
        return error_response(str(e), status_code=400)
    return created_response(data=role.to_dict(), message='Role created')


@patient_family_bp.route('/roles/<role_id>', methods=['GET'])
@jwt_required()
@role_required(UserRole.PATIENT)
@feature_required('patient.family')
def get_role(role_id):
    patient = _current_patient()
    if not patient:
        return not_found_response('Patient profile')
    role = PatientRoleService.get_owned(patient.tenant_id, patient.id, role_id)
    if not role:
        return not_found_response('Role')
    return success_response(data=role.to_dict(include_permissions=True))


@patient_family_bp.route('/roles/<role_id>/matrix', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PATIENT)
@feature_required('patient.family')
def set_role_matrix(role_id):
    """Replace a role's permission matrix. Owner-only — only the patient who
    authored the role may edit it (never the shared/system tier)."""
    patient = _current_patient()
    if not patient:
        return not_found_response('Patient profile')
    role = PatientRoleService.get_owned(patient.tenant_id, patient.id, role_id)
    if not role:
        return not_found_response('Role')
    data = request.get_json() or {}
    try:
        PatientRoleService.replace_matrix(role, data.get('permissions') or [])
    except ValueError as e:
        return error_response(str(e), status_code=400)
    return success_response(data=role.to_dict(include_permissions=True),
                            message='Permissions updated')


@patient_family_bp.route('/members/<member_id>/role', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PATIENT)
@feature_required('patient.family')
def assign_member_role(member_id):
    """Grant (or clear) the role a LINKED ADULT family member holds over the
    caller's data. Owner-only per side: only the data-owner assigns what someone
    else may do to them — never the grantee. Body: {role_id} (null clears)."""
    from app.extensions import db
    patient = _current_patient()
    if not patient:
        return not_found_response('Patient profile')
    member = HouseGroupMember.query.filter_by(
        id=member_id, patient_id=patient.id, is_active=True).first()
    if not member:
        return not_found_response('Family member')
    if member.is_child_account:
        return error_response('Minors are managed by the guardian, not by roles.',
                              status_code=400)
    data = request.get_json() or {}
    role_id = data.get('role_id')
    if role_id:
        role = PatientRoleService.get_owned(patient.tenant_id, patient.id, role_id)
        # Allow shared roles too (owner_patient_id NULL).
        if not role:
            from app.models import PatientRole
            role = PatientRole.query.filter_by(
                tenant_id=patient.tenant_id, id=role_id, is_deleted=False,
                owner_patient_id=None).first()
        if not role:
            return not_found_response('Role')
        member.role_id = role.id
    else:
        member.role_id = None
    db.session.commit()
    return success_response(data=member.to_dict(), message='Member role updated')
