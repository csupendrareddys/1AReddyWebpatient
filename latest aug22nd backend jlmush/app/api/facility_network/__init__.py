"""Facility (clinic/hospital) care-network inbox.

The doctor-side care-network routes are DOCTOR-only. When a doctor connects to a
clinic/hospital it now creates a PENDING request addressed to the facility's
owner account (``admin_user_id``). This blueprint gives that owner (CLINIC /
HOSPITAL role) the inbox to accept/reject those requests — accepting is what
actually creates the doctor→facility connection.

Mounted at ``/api/facility/network``.

A facility's own support staff reach this inbox too, when their roles grant
``doctors_network.network_requests`` — a front desk fielding connection requests
is the ordinary case, not an exception. They act as the facility's owner
account, so ``accept``/``reject`` still resolve against the request's
``target_user_id`` exactly as before. See ``app.common.provider_access``.

Accepting is also the only moment the FACILITY's own My Link cap can be
reached — every path that creates one of these rows is on the doctor's
blueprint, so a facility never adds a link, it only ever agrees to one.
"""
from flask import Blueprint

from app.api.membership.limits import PlanLimitExceeded, limit_response
from app.common.provider_access import acting_user, provider_access
from app.common.responses import success_response, error_response
from app.models import StaffProviderType, UserRole
from app.api.service_provider.doctor.network_service import DoctorNetworkService

facility_network_bp = Blueprint('facility_network', __name__)

_FACILITIES = [StaffProviderType.CLINIC, StaffProviderType.HOSPITAL]

# SUPER_ADMIN stays admitted for facilities whose owner account happens to be an
# admin — they have no practice row to resolve, so they pass through and act as
# themselves. Acceptance is still gated to the request's target_user_id, so no
# one can accept a request not addressed to them.
_PASSTHROUGH = [UserRole.SUPER_ADMIN]

_MODULE = 'doctors_network.network_requests'


@facility_network_bp.route('/requests', methods=['GET'])
@provider_access(module=_MODULE, action='can_view', verticals=_FACILITIES,
                 passthrough_roles=_PASSTHROUGH)
def list_facility_requests():
    """Pending care-network requests addressed to this facility's owner."""
    reqs = DoctorNetworkService.get_received_requests(acting_user().id)
    reqs = [r for r in reqs if r.target_clinic_id or r.target_hospital_id]
    return success_response(data={'received_requests': [r.to_dict() for r in reqs]})


@facility_network_bp.route('/requests/<request_id>/accept', methods=['POST'])
@provider_access(module=_MODULE, action='can_edit', verticals=_FACILITIES,
                 passthrough_roles=_PASSTHROUGH)
def accept_facility_request(request_id):
    try:
        req = DoctorNetworkService.accept_request(request_id, acting_user().id)
        return success_response(data=req.to_dict(), message='Connection accepted')
    except PlanLimitExceeded as exc:
        return limit_response(exc)
    except ValueError as e:
        return error_response(str(e), status_code=400)


@facility_network_bp.route('/requests/<request_id>/reject', methods=['POST'])
@provider_access(module=_MODULE, action='can_edit', verticals=_FACILITIES,
                 passthrough_roles=_PASSTHROUGH)
def reject_facility_request(request_id):
    try:
        req = DoctorNetworkService.reject_request(request_id, acting_user().id)
        return success_response(data=req.to_dict(), message='Request rejected')
    except ValueError as e:
        return error_response(str(e), status_code=400)
