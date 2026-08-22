"""
Affiliation routes — apex-marketplace doctor↔hospital roster management.

Endpoint groups
---------------
Doctor (UserRole.DOCTOR, and their staff via practice.affiliations):
    GET    /affiliation/invite                    Get my current invite code.
    POST   /affiliation/invite/regenerate         (Re)generate it.
    DELETE /affiliation/invite                    Revoke it.
    GET    /affiliation/requests                  List hospital requests + history.
    POST   /affiliation/requests/<id>/approve     Accept.
    POST   /affiliation/requests/<id>/reject      Decline (optional reason).

Facility admin (UserRole.HOSPITAL / CLINIC, and their staff):
    GET    /affiliation/facility/doctors          Roster + pending list.
    POST   /affiliation/facility/request-by-code  Submit a doctor's code.
    POST   /affiliation/facility/doctors/direct-create
                                                  Create new doctor + APPROVED affiliation.
    POST   /affiliation/facility/requests/<id>/cancel
                                                  Withdraw a PENDING request.

Both halves are reachable by the practice's own support staff as well as by its
owner, so every route here carries ``@provider_access`` instead of
``@role_required`` and passes ``acting_user()`` rather than ``current_user``.
For an owner the two are the same object; for a receptionist the first is her
practice, which is the whole point — the service layer below is unchanged and
does not need to know which of them called it. See ``app.common.provider_access``.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime

from flask import current_app, jsonify, request
from flask_jwt_extended import current_user, jwt_required
from werkzeug.utils import secure_filename

from app.common.decorators import role_required
from app.common.provider_access import acting_user, provider_access
from app.common.responses import (
    success_response, error_response, not_found_response,
)
from app.models import StaffProviderType, UserRole

# Manage Doctors is a facility screen; a doctor's own assistant has no roster.
FACILITIES = [StaffProviderType.CLINIC, StaffProviderType.HOSPITAL]
DOCTORS = [StaffProviderType.DOCTOR]

# Catalog leaves the facility routes below are gated on. Named once so a path
# typo shows up as an import error rather than as a route nobody can reach.
M_ROSTER = 'doctors_network.manage_doctors.roster'
M_INVITATIONS = 'doctors_network.manage_doctors.invitations'
# The doctor's own side: their invite code and the roster requests
# facilities send them.
M_AFFILIATIONS = 'practice.affiliations'

from . import affiliation_bp
from .service import (
    AffiliationError, AffiliationForbidden, AffiliationNotFound,
    AffiliationService,
)

logger = logging.getLogger(__name__)


def _err(exc: Exception):
    """Map a service-layer exception to the right HTTP response."""
    if isinstance(exc, AffiliationNotFound):
        return not_found_response(str(exc))
    if isinstance(exc, AffiliationForbidden):
        return error_response(str(exc), status_code=403)
    return error_response(str(exc), status_code=400)


# ── Doctor: invite code ──────────────────────────────────────────────────

@affiliation_bp.route('/invite', methods=['GET'])
@provider_access(module=M_AFFILIATIONS, action='can_view', verticals=DOCTORS)
def get_invite():
    try:
        return success_response(
            AffiliationService.get_doctor_invite(acting_user())
        )
    except (AffiliationError, AffiliationForbidden, AffiliationNotFound) as e:
        return _err(e)


@affiliation_bp.route('/invite/regenerate', methods=['POST'])
@provider_access(module=M_AFFILIATIONS, action='can_edit', verticals=DOCTORS)
def regenerate_invite():
    try:
        return success_response(
            AffiliationService.generate_doctor_invite(acting_user()),
            message='Invite code generated.',
        )
    except (AffiliationError, AffiliationForbidden, AffiliationNotFound) as e:
        return _err(e)


@affiliation_bp.route('/invite', methods=['DELETE'])
@provider_access(module=M_AFFILIATIONS, action='can_delete', verticals=DOCTORS)
def revoke_invite():
    try:
        AffiliationService.revoke_doctor_invite(acting_user())
        return success_response({}, message='Invite code revoked.')
    except (AffiliationError, AffiliationForbidden, AffiliationNotFound) as e:
        return _err(e)


# ── Doctor: incoming requests ────────────────────────────────────────────

@affiliation_bp.route('/requests', methods=['GET'])
@provider_access(module=M_AFFILIATIONS, action='can_view', verticals=DOCTORS)
def list_doctor_requests():
    try:
        return success_response(
            {'requests': AffiliationService.list_doctor_requests(acting_user())}
        )
    except (AffiliationError, AffiliationForbidden, AffiliationNotFound) as e:
        return _err(e)


@affiliation_bp.route('/requests/<request_id>/approve', methods=['POST'])
@provider_access(module=M_AFFILIATIONS, action='can_edit', verticals=DOCTORS)
def approve_request(request_id):
    try:
        return success_response(
            AffiliationService.respond_to_request(
                acting_user(), request_id, approve=True,
            ),
            message='Affiliation approved.',
        )
    except (AffiliationError, AffiliationForbidden, AffiliationNotFound) as e:
        return _err(e)


@affiliation_bp.route('/requests/<request_id>/reject', methods=['POST'])
@provider_access(module=M_AFFILIATIONS, action='can_edit', verticals=DOCTORS)
def reject_request(request_id):
    body = request.get_json(silent=True) or {}
    reason = (body.get('reason') or '').strip()
    try:
        return success_response(
            AffiliationService.respond_to_request(
                acting_user(), request_id, approve=False,
                rejection_reason=reason or None,
            ),
            message='Affiliation rejected.',
        )
    except (AffiliationError, AffiliationForbidden, AffiliationNotFound) as e:
        return _err(e)


# ── Facility admin: roster + requests ───────────────────────────────────

@affiliation_bp.route('/facility/doctors', methods=['GET'])
@provider_access(module=M_ROSTER, action='can_view', verticals=FACILITIES)
def list_facility_doctors():
    status = request.args.get('status')
    try:
        return success_response(
            {'affiliations':
             AffiliationService.list_facility_doctors(
                 acting_user(), status=status,
             )}
        )
    except (AffiliationError, AffiliationForbidden, AffiliationNotFound) as e:
        return _err(e)


@affiliation_bp.route('/facility/request-by-code', methods=['POST'])
@provider_access(module=M_INVITATIONS, action='can_create', verticals=FACILITIES)
def request_by_code():
    body = request.get_json(silent=True) or {}
    code = body.get('code')
    employment_type = body.get('employment_type') or 'full_time'
    try:
        return success_response(
            AffiliationService.request_by_code(
                acting_user(), code=code, employment_type=employment_type,
            ),
            message='Request sent to doctor for approval.',
        )
    except (AffiliationError, AffiliationForbidden, AffiliationNotFound) as e:
        return _err(e)


@affiliation_bp.route('/facility/requests/<request_id>/cancel', methods=['POST'])
@provider_access(module=M_INVITATIONS, action='can_delete', verticals=FACILITIES)
def facility_cancel_request(request_id):
    try:
        return success_response(
            AffiliationService.cancel_request(acting_user(), request_id),
            message='Request cancelled.',
        )
    except (AffiliationError, AffiliationForbidden, AffiliationNotFound) as e:
        return _err(e)


# ── Facility admin: direct-create ───────────────────────────────────────
# Multipart upload like /auth/signup/doctor: the form carries fields +
# three file inputs. We reuse the same field shape so the frontend
# can lift code from the existing doctor-signup wizard with minimal
# adaptation.

ALLOWED_UPLOAD_EXTS = {'.pdf', '.png', '.jpg', '.jpeg'}


def _save_upload(file_storage, *, prefix: str) -> str | None:
    if not file_storage or not file_storage.filename:
        return None
    fn = secure_filename(file_storage.filename)
    ext = os.path.splitext(fn)[1].lower()
    if ext not in ALLOWED_UPLOAD_EXTS:
        raise AffiliationError(
            f'Unsupported file type {ext}. Allowed: '
            + ', '.join(sorted(ALLOWED_UPLOAD_EXTS))
        )
    upload_dir = current_app.config.get('UPLOAD_FOLDER', '/tmp/uploads')
    os.makedirs(upload_dir, exist_ok=True)
    stamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
    target_name = f'{prefix}_{stamp}_{uuid.uuid4().hex[:8]}{ext}'
    target = os.path.join(upload_dir, target_name)
    file_storage.save(target)
    return target


@affiliation_bp.route('/facility/doctors/invite', methods=['POST'])
@provider_access(module=M_INVITATIONS, action='can_create', verticals=FACILITIES)
def facility_invite_doctor():
    """
    Facility admin invites a doctor without setting a password.
    The doctor receives an activation link (email + SMS) and must
    set their own password + verify both contacts before they can
    sign in. Hospital and clinic admins use the same endpoint.
    """
    try:
        form = request.form
        if not form:
            raise AffiliationError(
                'Multipart form data required to invite a doctor.'
            )

        import json
        qualifications = form.get('qualifications', '[]')
        try:
            qualifications = json.loads(qualifications)
        except json.JSONDecodeError:
            raise AffiliationError('qualifications must be valid JSON.')

        data = {
            'first_name': form.get('first_name'),
            'last_name': form.get('last_name'),
            'email': form.get('email'),
            'phone_number': form.get('phone_number'),
            'state': form.get('state'),
            'registration_number': form.get('registration_number'),
            'aadhar_number': form.get('aadhar_number'),
            'qualifications': qualifications,
        }

        files = request.files
        reg_cert = _save_upload(
            files.get('registration_certificate'), prefix='regcert',
        )
        aadhar = _save_upload(
            files.get('aadhar_attachment'), prefix='aadhar',
        )
        if not reg_cert:
            raise AffiliationError('registration_certificate file is required.')
        if not aadhar:
            raise AffiliationError('aadhar_attachment file is required.')

        qual_paths: list[str] = []
        i = 0
        while True:
            f = files.get(f'qualification_certificate_{i}')
            if f is None:
                break
            qual_paths.append(_save_upload(f, prefix=f'ugcert_{i}') or '')
            i += 1

        file_paths = {
            'registration_certificate': reg_cert,
            'aadhar_attachment': aadhar,
            'qualification_certificates': qual_paths,
        }

        employment_type = form.get('employment_type') or 'full_time'

        return success_response(
            AffiliationService.invite_doctor(
                acting_user(), data, file_paths,
                employment_type=employment_type,
            ),
            message='Doctor invited. Activation link sent via email + SMS.',
            status_code=201,
        )
    except (AffiliationError, AffiliationForbidden, AffiliationNotFound) as e:
        return _err(e)


# ── Activation flow (doctor-driven, no JWT required) ─────────────────────

@affiliation_bp.route('/activate/lookup', methods=['POST'])
def activation_lookup():
    body = request.get_json(silent=True) or {}
    token = (body.get('token') or '').strip()
    if not token:
        return error_response('Activation token is required.', status_code=400)
    try:
        return success_response(AffiliationService.activation_lookup(token))
    except AffiliationError as e:
        return _err(e)


@affiliation_bp.route('/activate/set-password', methods=['POST'])
def activation_set_password():
    body = request.get_json(silent=True) or {}
    token = (body.get('token') or '').strip()
    new_password = body.get('password') or ''
    if not token:
        return error_response('Activation token is required.', status_code=400)
    try:
        return success_response(
            AffiliationService.activation_set_password(token, new_password),
            message='Password set.',
        )
    except AffiliationError as e:
        return _err(e)


@affiliation_bp.route('/activate/send-email-otp', methods=['POST'])
def activation_send_email_otp():
    body = request.get_json(silent=True) or {}
    token = (body.get('token') or '').strip()
    if not token:
        return error_response('Activation token is required.', status_code=400)
    try:
        return success_response(
            AffiliationService.activation_send_email_otp(token),
            message='OTP sent to your email.',
        )
    except AffiliationError as e:
        return _err(e)


@affiliation_bp.route('/activate/verify-email-otp', methods=['POST'])
def activation_verify_email_otp():
    body = request.get_json(silent=True) or {}
    token = (body.get('token') or '').strip()
    otp = (body.get('otp') or '').strip()
    if not token or not otp:
        return error_response('Token + OTP required.', status_code=400)
    try:
        return success_response(
            AffiliationService.activation_verify_email_otp(token, otp),
            message='Email verified.',
        )
    except AffiliationError as e:
        return _err(e)


@affiliation_bp.route('/activate/send-phone-otp', methods=['POST'])
def activation_send_phone_otp():
    body = request.get_json(silent=True) or {}
    token = (body.get('token') or '').strip()
    if not token:
        return error_response('Activation token is required.', status_code=400)
    try:
        return success_response(
            AffiliationService.activation_send_phone_otp(token),
            message='OTP sent to your phone.',
        )
    except AffiliationError as e:
        return _err(e)


@affiliation_bp.route('/activate/verify-phone-otp', methods=['POST'])
def activation_verify_phone_otp():
    body = request.get_json(silent=True) or {}
    token = (body.get('token') or '').strip()
    otp = (body.get('otp') or '').strip()
    if not token or not otp:
        return error_response('Token + OTP required.', status_code=400)
    try:
        return success_response(
            AffiliationService.activation_verify_phone_otp(token, otp),
            message='Phone verified.',
        )
    except AffiliationError as e:
        return _err(e)
