"""Operations routes — admin act-on-behalf endpoints.

Decorator stack on every route:
    @jwt_required() → @role_required([SUPER_ADMIN, SUB_ADMIN])
                    → @rbac_required(OPERATIONS_PATIENT, <action>)

``role_required`` is the coarse first cut. ``rbac_required`` is a no-op for
super_admin / platform_owner (they bypass) and is the real gate for a
sub-admin: no operations module on an assigned role, no access. Note the
per-action column — VIEW, EDIT and CREATE are separate grants, so an operator
can be given read-only support access without the ability to change anything.
"""
import logging

from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.admin.operations import operations_bp
from app.api.admin.operations.service import OperationsService
from app.common.decorators import role_required, rbac_required
from app.common.responses import (
    success_response, error_response, not_found_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.models import UserRole, PermissionModule, PermissionAction

logger = logging.getLogger(__name__)

_OPS = PermissionModule.OPERATIONS_PATIENT
_OPS_DOC = PermissionModule.OPERATIONS_DOCTOR
_OPS_ADM = PermissionModule.OPERATIONS_ADMIN


# ── Patient list ───────────────────────────────────────────────────────────
@operations_bp.route('/patients', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS, PermissionAction.VIEW)
def ops_list_patients():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    search = (request.args.get('search') or '').strip()
    data = OperationsService.list_patients(
        current_tenant_id_strict(), page=page, per_page=per_page, search=search,
    )
    return success_response(data=data)


# ── Patient profile: GET (combined sections) ───────────────────────────────
@operations_bp.route('/patients/<patient_id>/profile', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS, PermissionAction.VIEW)
def ops_get_patient_profile(patient_id):
    patient = OperationsService.get_patient(current_tenant_id_strict(), patient_id)
    if not patient:
        return not_found_response('Patient')
    return success_response(data=OperationsService.build_patient_profile(patient))


# ── Patient profile: who last changed it ───────────────────────────────────
@operations_bp.route('/patients/<patient_id>/profile-provenance', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS, PermissionAction.VIEW)
def ops_patient_profile_provenance(patient_id):
    """Who last edited this patient's profile, and when.

    An admin-only read, so it lives here rather than on the patient blueprint:
    a patient has no business knowing which staff member opened their record,
    and routing it through act-on-behalf would have meant exposing it there.
    Reads the ``Patient.profile_updated_*`` columns that both write surfaces
    stamp (see app/common/profile_audit.py) — no impersonation needed.
    """
    from app.common.profile_audit import describe_last_update

    patient = OperationsService.get_patient(current_tenant_id_strict(), patient_id)
    if not patient:
        return not_found_response('Patient')
    return success_response(data=describe_last_update(patient))


# ── Patient profile: PUT one section ───────────────────────────────────────
@operations_bp.route('/patients/<patient_id>/profile/<section>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS, PermissionAction.EDIT)
def ops_update_patient_section(patient_id, section):
    patient = OperationsService.get_patient(current_tenant_id_strict(), patient_id)
    if not patient:
        return not_found_response('Patient')
    body = request.get_json() or {}
    try:
        updated = OperationsService.update_patient_section(
            patient, section, body, actor_id=current_user.id,
        )
    except ValueError as exc:
        return error_response(str(exc), status_code=400)
    return success_response(
        data={'updated': updated}, message=f'{section} updated',
    )


# ── Booking context: doctors + slots ───────────────────────────────────────
@operations_bp.route('/doctors', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS, PermissionAction.VIEW)
def ops_list_doctors():
    search = (request.args.get('search') or '').strip()
    doctors = OperationsService.list_bookable_doctors(
        current_tenant_id_strict(), search=search,
    )
    return success_response(data={'doctors': doctors})


@operations_bp.route('/doctors/<doctor_id>/slots', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS, PermissionAction.VIEW)
def ops_doctor_slots(doctor_id):
    date_str = (request.args.get('date') or '').strip()
    if not date_str:
        return error_response('date (YYYY-MM-DD) is required', status_code=400)
    consultation_type = (request.args.get('consultation_type') or '').strip()
    try:
        slots = OperationsService.get_doctor_slots(doctor_id, date_str, consultation_type)
    except ValueError as exc:
        return error_response(str(exc), status_code=400)
    return success_response(data={'slots': slots})


# ── Book on behalf ─────────────────────────────────────────────────────────
@operations_bp.route('/patients/<patient_id>/appointments', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS, PermissionAction.CREATE)
def ops_book_on_behalf(patient_id):
    patient = OperationsService.get_patient(current_tenant_id_strict(), patient_id)
    if not patient:
        return not_found_response('Patient')
    body = request.get_json() or {}
    try:
        appt = OperationsService.book_on_behalf(patient, body, current_user)
    except ValueError as exc:
        return error_response(str(exc), status_code=400)

    # Persist-first: the booking committed — tell both sides live (the
    # patient learns an appointment was made FOR them; the doctor learns
    # one landed).
    from app.common.notify import notify_appointment_event
    notify_appointment_event(appt, 'booked_for_you')
    notify_appointment_event(appt, 'booked')

    payload = appt.to_dict()
    payload['initiated_by'] = 'admin'
    return success_response(
        data={'appointment': payload},
        message='Appointment booked on behalf of patient',
    )


# ══════════════════════════════════════════════════════════════════════════
# DOCTOR members
# ══════════════════════════════════════════════════════════════════════════
@operations_bp.route('/doctor-members', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.VIEW)
def ops_list_doctor_members():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    search = (request.args.get('search') or '').strip()
    data = OperationsService.list_doctor_members(
        current_tenant_id_strict(), page=page, per_page=per_page, search=search,
    )
    return success_response(data=data)


@operations_bp.route('/doctor-members/<doctor_id>/profile', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.VIEW)
def ops_get_doctor_profile(doctor_id):
    doctor = OperationsService.get_doctor_member(current_tenant_id_strict(), doctor_id)
    if not doctor:
        return not_found_response('Doctor')
    return success_response(data=OperationsService.build_doctor_profile(doctor))


@operations_bp.route('/doctor-members/<doctor_id>/profile/<section>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.EDIT)
def ops_update_doctor_section(doctor_id, section):
    doctor = OperationsService.get_doctor_member(current_tenant_id_strict(), doctor_id)
    if not doctor:
        return not_found_response('Doctor')
    try:
        updated = OperationsService.update_doctor_section(
            doctor, section, request.get_json() or {}, actor_id=current_user.id,
        )
    except ValueError as exc:
        return error_response(str(exc), status_code=400)
    return success_response(data={'updated': updated}, message=f'{section} updated')


# ══════════════════════════════════════════════════════════════════════════
# PROVIDER FACILITIES — clinics and hospitals
#
# One pair of routes over a ``vertical`` path segment rather than two copies:
# the two models are the same shape and expose the same surface, and the
# frontend member list is already generic over member type.
#
# Gated on OPERATIONS_DOCTOR. A facility is a service provider, and the desk
# that handles providers is the one that should handle their clinics — adding
# an OPERATIONS_CLINIC / _HOSPITAL module would mean a new PermissionModule
# value and a permissions reseed for every existing sub-admin, for a split
# nobody has asked for. Revisit if the desks are ever actually separated.
# ══════════════════════════════════════════════════════════════════════════
_FACILITY_VERTICALS = ('clinic', 'hospital')


@operations_bp.route('/<vertical>-members', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_DOC, PermissionAction.VIEW)
def ops_list_facility_members(vertical):
    if vertical not in _FACILITY_VERTICALS:
        return not_found_response('Member type')
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    search = (request.args.get('search') or '').strip()
    data = OperationsService.list_facility_members(
        current_tenant_id_strict(), vertical,
        page=page, per_page=per_page, search=search,
    )
    return success_response(data=data)


# ══════════════════════════════════════════════════════════════════════════
# ADMIN members
# ══════════════════════════════════════════════════════════════════════════
@operations_bp.route('/admin-members', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_ADM, PermissionAction.VIEW)
def ops_list_admin_members():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    search = (request.args.get('search') or '').strip()
    data = OperationsService.list_admin_members(
        current_tenant_id_strict(), page=page, per_page=per_page, search=search,
    )
    return success_response(data=data)


@operations_bp.route('/admin-members/<admin_id>/profile', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_ADM, PermissionAction.VIEW)
def ops_get_admin_profile(admin_id):
    admin = OperationsService.get_admin_member(current_tenant_id_strict(), admin_id)
    if not admin:
        return not_found_response('Admin')
    return success_response(data=OperationsService.build_admin_profile(admin))


@operations_bp.route('/admin-members/<admin_id>/profile/<section>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@rbac_required(_OPS_ADM, PermissionAction.EDIT)
def ops_update_admin_section(admin_id, section):
    admin = OperationsService.get_admin_member(current_tenant_id_strict(), admin_id)
    if not admin:
        return not_found_response('Admin')
    try:
        updated = OperationsService.update_admin_section(
            admin, section, request.get_json() or {}, actor_id=current_user.id,
        )
    except ValueError as exc:
        return error_response(str(exc), status_code=400)
    return success_response(data={'updated': updated}, message=f'{section} updated')
