"""
Doctor Care Network routes — /api/doctor/network/*

A doctor's professional network of fellow doctors / hospitals / clinics.
Mirrors the patient house-group linking endpoints. Doctor↔doctor connections
gate the group-service-offering co-doctor picker.
"""
from flask import request
from flask_jwt_extended import jwt_required, current_user

from . import doctor_bp
from .service import DoctorService
from .network_service import DoctorNetworkService
from app.api.membership.limits import PlanLimitExceeded, limit_response
from app.common.decorators import role_required
from app.common.provider_access import acting_doctor_user_id
from app.common.responses import success_response, error_response
from app.models import UserRole


def _current_doctor():
    # Resolves to the employer's row for a doctor's staff — see
    # app.common.provider_access.acting_doctor.
    from app.common.provider_access import acting_doctor
    return acting_doctor()


@doctor_bp.route('/network/connections', methods=['GET'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def list_network_connections():
    """List active connections. ?type=doctor|hospital|clinic  ?context=network|link"""
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    conn_type = request.args.get('type')
    context = request.args.get('context', 'network')
    conns = DoctorNetworkService.get_connections(doctor.id, conn_type, context=context)
    return success_response(data={'connections': [c.to_dict() for c in conns]})


@doctor_bp.route('/network/requests', methods=['GET'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def list_network_requests():
    """Sent + received pending connection requests. ?context=network|link"""
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    context = request.args.get('context', 'network')
    sent = DoctorNetworkService.get_sent_requests(doctor.id, context=context)
    received = DoctorNetworkService.get_received_requests(acting_doctor_user_id(), context=context)
    return success_response(data={
        'sent_requests': [r.to_dict() for r in sent],
        'received_requests': [r.to_dict() for r in received],
    })


@doctor_bp.route('/network/discover', methods=['GET'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def discover_network_directory():
    """Browse all providers of ?type=doctor|hospital|clinic — gated by the
    tenant's super-admin provider-visibility toggle."""
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    conn_type = request.args.get('type', 'doctor')
    try:
        providers = DoctorNetworkService.discover(doctor, conn_type)
        return success_response(data={'providers': providers})
    except ValueError as e:
        return error_response(str(e), status_code=403)


@doctor_bp.route('/network/visibility', methods=['GET'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def get_network_visibility():
    """Which Discover directories the tenant has enabled (doctors/hospitals/clinics)."""
    if not _current_doctor():
        return error_response('Doctor profile not found', status_code=404)
    return success_response(data={'visibility': DoctorNetworkService.get_tenant_visibility()})


@doctor_bp.route('/network/requests', methods=['POST'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def send_network_request():
    """Send a connection request (doctor) or add a facility (hospital/clinic)."""
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    data = request.get_json() or {}
    try:
        result = DoctorNetworkService.send_request(doctor, data)
        msg = 'Request sent' if result.get('request') else 'Added to your network'
        return success_response(data=result, message=msg, status_code=201)
    except PlanLimitExceeded as exc:
        return limit_response(exc)
    except ValueError as e:
        return error_response(str(e), status_code=400)


@doctor_bp.route('/network/requests/<request_id>/accept', methods=['POST'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def accept_network_request(request_id):
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    try:
        req = DoctorNetworkService.accept_request(request_id, acting_doctor_user_id(), doctor)
        return success_response(data=req.to_dict(), message='Connection accepted')
    except PlanLimitExceeded as exc:
        return limit_response(exc)
    except ValueError as e:
        return error_response(str(e), status_code=400)


@doctor_bp.route('/network/requests/<request_id>/reject', methods=['POST'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def reject_network_request(request_id):
    if not _current_doctor():
        return error_response('Doctor profile not found', status_code=404)
    try:
        req = DoctorNetworkService.reject_request(request_id, acting_doctor_user_id())
        return success_response(data=req.to_dict(), message='Request rejected')
    except ValueError as e:
        return error_response(str(e), status_code=400)


@doctor_bp.route('/network/requests/<request_id>/cancel', methods=['POST'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def cancel_network_request(request_id):
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    try:
        req = DoctorNetworkService.cancel_request(request_id, doctor.id)
        return success_response(data=req.to_dict(), message='Request cancelled')
    except ValueError as e:
        return error_response(str(e), status_code=400)


#: Which catalog leaf governs severing a connection, by surface. The route is
#: shared between My Network and My Link, and the two are separately grantable
#: — a staff member given "My Network" must not thereby be able to end the
#: practice's employment affiliations, which is a governance act on a different
#: screen. Owners never consult this.
_DELETE_MODULE = {'link': 'practice.my_link', 'network': 'practice.my_network'}


@doctor_bp.route('/network/connections/<connection_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def remove_network_connection(connection_id):
    """Delink — leave a network, or end a professional affiliation.

    Scoped to the caller's own row, so a doctor can only sever a connection
    they are a party to. Doctor<->doctor links drop both directions; see
    ``DoctorNetworkService.remove_connection``.

    This is the doctor's half of the revocation. A My Link relationship is what
    lets a clinic operate them (``app/api/provider_link``), and until this
    existed there was consent to start that and no way to withdraw it.
    """
    from app.common.provider_access import ProviderAccessError, current_principal
    from app.common.responses import forbidden_response
    from app.common.tenant_context import current_tenant_id_strict
    from app.models import CareNetworkConnection

    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)

    conn = CareNetworkConnection.query.filter_by(
        id=connection_id, tenant_id=current_tenant_id_strict(),
        doctor_id=doctor.id, status='active',
    ).first()
    if not conn:
        return error_response('Connection not found', status_code=404)

    # The prefix gate already cleared this request against ``my_network``; a
    # My Link row needs the My Link grant instead. Owners aren't staff and skip
    # the check entirely.
    try:
        principal = current_principal()
    except ProviderAccessError:
        principal = None
    if principal is not None and principal.is_staff:
        module = _DELETE_MODULE.get(conn.context, 'practice.my_network')
        if not principal.can(module, 'can_delete'):
            return forbidden_response(
                f'Your roles do not allow removing this. Ask '
                f'{principal.provider_name} to grant it.')

    removed = DoctorNetworkService.remove_connection(conn)
    return success_response(
        data={'removed': [c.to_dict() for c in removed]},
        message='Connection removed',
    )


@doctor_bp.route('/network/generate-invite', methods=['POST'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def generate_network_invite():
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    data = request.get_json() or {}
    try:
        req = DoctorNetworkService.generate_invite(doctor, data)
        return success_response(data={'invite_code': req.invite_code, 'request': req.to_dict()},
                                message='Invite code generated', status_code=201)
    except PlanLimitExceeded as exc:
        return limit_response(exc)
    except ValueError as e:
        return error_response(str(e), status_code=400)


@doctor_bp.route('/network/join/<invite_code>', methods=['POST'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def join_network_by_code(invite_code):
    doctor = _current_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    try:
        conns = DoctorNetworkService.join_by_invite_code(invite_code, doctor)
        return success_response(data={'connections': [c.to_dict() for c in conns]},
                                message='Connected successfully')
    except PlanLimitExceeded as exc:
        return limit_response(exc)
    except ValueError as e:
        return error_response(str(e), status_code=400)
