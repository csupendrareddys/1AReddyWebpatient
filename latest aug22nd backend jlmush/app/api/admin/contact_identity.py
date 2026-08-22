"""Admin self-service contact change — /api/v1/admin/contact-change/*.

Admins at every level (the vendor's PLATFORM_OWNER and staff, tenant
and child-tenant SUPER/SUB_ADMINs) change their own sign-in phone or
email here, proving ownership of the NEW value with an OTP first —
the same ``ContactChangeService`` rail patients and doctors already
use, applied immediately on verification like the patient flow (an
admin needs no second admin's approval for their own account).

Tenant scoping is inherent: uniqueness checks and the user row both
live in the caller's tenant, so the same two endpoints serve level
0, 1 and 2 without any per-level branching.
"""
import logging

from flask import Blueprint, request
from flask_jwt_extended import current_user, jwt_required

from app.common.decorators import role_required, validate_json
from app.common.responses import error_response, success_response
from app.extensions import db, limiter
from app.models import UserRole
from app.services.contact_change_service import ContactChangeService

logger = logging.getLogger(__name__)

contact_identity_bp = Blueprint('admin_contact_identity', __name__)

_ADMIN_ROLES = [UserRole.PLATFORM_OWNER, UserRole.SUPER_ADMIN,
                UserRole.SUB_ADMIN]


@contact_identity_bp.route('/send-otp', methods=['POST'])
@jwt_required()
@role_required(_ADMIN_ROLES)
@limiter.limit('5 per minute')
@validate_json(['channel', 'value'])
def send_contact_change_otp():
    data = request.get_json() or {}
    try:
        ContactChangeService.send_otp(
            current_user, data.get('channel'), data.get('value'))
    except ValueError as e:
        return error_response(str(e), status_code=400)
    return success_response(message='Verification code sent.')


@contact_identity_bp.route('/confirm', methods=['POST'])
@jwt_required()
@role_required(_ADMIN_ROLES)
@limiter.limit('10 per minute')
@validate_json(['channel', 'value', 'otp'])
def confirm_contact_change():
    data = request.get_json() or {}
    channel = (data.get('channel') or '').strip().lower()
    value = ContactChangeService.normalize(channel, data.get('value'))

    if not ContactChangeService.verify_otp(channel, value, data.get('otp')):
        return error_response(
            'Wrong or expired code — request a new one.',
            status_code=400, code='otp_invalid')
    # Re-check uniqueness at apply time: someone else may have claimed
    # the value in the OTP window. verify_otp consumed the code, so a
    # clash here means starting over — the honest outcome.
    try:
        ContactChangeService.assert_unique(current_user, channel, value)
    except ValueError as e:
        return error_response(str(e), status_code=409)

    if channel == 'phone':
        current_user.phone_number = value
        current_user.phone_verified = True
    else:
        current_user.email = value
        current_user.email_verified = True
    db.session.commit()
    logger.info('[CONTACT_CHANGE] admin %s changed %s',
                current_user.id, channel)
    return success_response(
        {'phone_number': current_user.phone_number,
         'email': current_user.email},
        message=('Phone number updated.' if channel == 'phone'
                 else 'Email updated.'),
    )
