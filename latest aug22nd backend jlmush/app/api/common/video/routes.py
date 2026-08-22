"""
Video Meeting Routes
API endpoints for Twilio Video room creation and token generation
"""
import logging
from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.common.video import video_bp

logger = logging.getLogger(__name__)
from app.api.common.video.service import VideoService
from app.common.responses import success_response, error_response
from app.common.decorators import role_required, validate_json
from app.models import UserRole


@video_bp.route('/create-room', methods=['POST'])
@jwt_required()
@role_required(UserRole.DOCTOR)
@validate_json(['room_name'])
def create_room():
    """
    Create a new Twilio Video room (doctor only).

    Plan-gated by ``consultation.video`` and metered against
    ``video_calls`` (count) + ``video_minutes`` (estimate-on-create,
    refined by the room-end webhook). UsageGate runs BEFORE the Twilio
    call so we don't get charged for blocked-quota tenants.

    Request Body:
        { "room_name": "dr-smith-1234567890" }
    """
    from app.api.pricing.service import (
        FeatureDisabled, FeatureGate, NoActiveSubscription,
        UsageGate, UsageLimitExceeded,
    )
    from app.common.tenant_context import current_tenant_id_strict
    from flask import jsonify

    tenant_id = current_tenant_id_strict()
    try:
        FeatureGate.require_feature(tenant_id, 'consultation.video')
    except FeatureDisabled as e:
        return jsonify({
            'success': False, 'error': 'feature_disabled',
            'feature': e.feature_path,
        }), 403
    except NoActiveSubscription:
        # Same code the appointment surface uses for this condition.
        return error_response('Tenant has no active subscription',
                              status_code=402, code='no_active_subscription')

    # Bump the call-count counter. Minutes are added at room-end.
    try:
        UsageGate.check_and_increment(tenant_id, 'video_calls', delta=1)
    except UsageLimitExceeded as e:
        return jsonify({
            'success': False, 'error': 'usage_limit_exceeded',
            'metric': e.metric, 'window': e.window,
            'current': e.current, 'max': e.max_allowed,
            'period_end': e.period_end.isoformat() if e.period_end else None,
        }), 402

    data = request.get_json()
    room_name = data.get('room_name', '').strip()

    if not room_name:
        return error_response('Room name is required', status_code=400)

    try:
        room_info = VideoService.create_room(room_name)
        return success_response(data=room_info, message='Room created', status_code=201)
    except ValueError as e:
        logger.error(f"Failed to create room: {e}")
        return error_response('An internal error occurred', status_code=500)
    except Exception as e:
        logger.error(f"Failed to create room: {e}")
        return error_response('An internal error occurred', status_code=500)


@video_bp.route('/join', methods=['POST'])
@jwt_required()
@validate_json(['appointment_id'])
def join_appointment():
    """
    Validate appointment access and time window, create Twilio room if needed,
    and return an access token. Used by both doctor and patient.

    Request Body:
        { "appointment_id": "<uuid>" }

    Returns:
        200: { token, identity, room_name }
        400: Outside time window, wrong appointment type/status, missing fields
        403: User is not the doctor or patient for this appointment
        500: Twilio API error
    """
    data = request.get_json()
    appointment_id = data.get('appointment_id', '').strip()

    if not appointment_id:
        return error_response('appointment_id is required', status_code=400)

    try:
        result = VideoService.join_appointment(appointment_id, current_user)
        return success_response(data=result)
    except PermissionError as e:
        return error_response(str(e), status_code=403)
    except ValueError as e:
        return error_response(str(e), status_code=400)
    except Exception as e:
        logger.error(f"Failed to join meeting: {e}")
        return error_response('An internal error occurred', status_code=500)


@video_bp.route('/token', methods=['POST'])
@jwt_required()
@validate_json(['room_name'])
def get_token():
    """
    Generate a Twilio access token for a video room.
    Available to both doctors and patients.

    Request Body:
        { "room_name": "dr-smith-1234567890" }

    Returns:
        200: { token: "...", identity: "...", room_name: "..." }
        400: Missing parameters
        500: Token generation error
    """
    data = request.get_json()
    room_name = data.get('room_name', '').strip()

    if not room_name:
        return error_response('Room name is required', status_code=400)

    # Build identity from current user
    role = current_user.role.value if current_user.role else 'user'
    first_name = current_user.first_name or 'User'
    last_name = current_user.last_name or ''

    if role == 'doctor':
        identity = f"Dr. {first_name} {last_name}".strip()
    else:
        identity = f"{first_name} {last_name}".strip()

    try:
        token = VideoService.generate_token(identity, room_name)
        return success_response(data={
            'token': token,
            'identity': identity,
            'room_name': room_name
        })
    except ValueError as e:
        logger.error(f"Failed to generate token: {e}")
        return error_response('An internal error occurred', status_code=500)
    except Exception as e:
        logger.error(f"Failed to generate token: {e}")
        return error_response('An internal error occurred', status_code=500)
