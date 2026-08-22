"""
Doctor Group Service Offering routes — /api/doctor/marketplace/service-groups

A lead doctor offers a catalog product together with co-doctors from their care
network; the group requires admin approval before patients can book it.
"""
from flask import request
from flask_jwt_extended import jwt_required, current_user

from . import doctor_bp
from .service import DoctorService
from .service_group_service import ServiceGroupService
from app.common.decorators import role_required
from app.common.responses import success_response, error_response
from app.models import UserRole


def _current_doctor():
    # Employer's row for a doctor's staff — see provider_access.acting_doctor.
    from app.common.provider_access import acting_doctor
    return acting_doctor()


@doctor_bp.route('/marketplace/service-groups', methods=['GET'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def list_service_groups():
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    groups = ServiceGroupService.get_groups_for_doctor(doctor.id)
    return success_response(data={'groups': [g.to_dict() for g in groups]})


@doctor_bp.route('/marketplace/service-groups', methods=['POST'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def create_service_group():
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    # Plan access control — the doctor's plan must grant ``group_offering.offer``
    # once it uses feature gating (plans that never adopted it stay allowed).
    from app.api.common.payment.billing_service import plan_grants_offering
    if not plan_grants_offering(doctor, 'group_offering.offer'):
        return error_response(
            'Your plan does not include offering group services.',
            status_code=403,
        )
    data = request.get_json() or {}
    try:
        group = ServiceGroupService.create_group(doctor, data)
        return success_response(message='Group offering submitted for approval',
                                data=group.to_dict(), status_code=201)
    except ValueError as e:
        return error_response(str(e), status_code=400)


@doctor_bp.route('/marketplace/service-groups/<group_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def update_service_group(group_id):
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    data = request.get_json() or {}
    try:
        group = ServiceGroupService.update_group(doctor.id, group_id, data)
        if not group:
            return error_response('Group offering not found (only the lead can edit)', status_code=404)
        return success_response(message='Group offering updated', data=group.to_dict())
    except ValueError as e:
        return error_response(str(e), status_code=400)


@doctor_bp.route('/marketplace/service-groups/invitations', methods=['GET'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def list_group_invitations():
    """Group offerings this doctor has been invited to co-serve (Item 3D)."""
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    groups = ServiceGroupService.get_invitations_for_doctor(doctor.id)
    return success_response(data={'invitations': [g.to_dict() for g in groups]})


@doctor_bp.route('/marketplace/service-groups/<group_id>/respond', methods=['POST'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def respond_group_invite(group_id):
    """Accept/decline a group-offering invitation. Body: {accept: bool}."""
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    accept = bool((request.get_json() or {}).get('accept'))
    try:
        group = ServiceGroupService.respond_to_invite(doctor.id, group_id, accept)
        return success_response(
            message='Invitation accepted' if accept else 'Invitation declined',
            data=group.to_dict())
    except ValueError as e:
        return error_response(str(e), status_code=400)


@doctor_bp.route('/marketplace/service-groups/<group_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def delete_service_group(group_id):
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    if ServiceGroupService.delete_group(doctor.id, group_id):
        return success_response(message='Group offering deleted')
    return error_response('Group offering not found (only the lead can delete)', status_code=404)
