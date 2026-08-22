"""
Doctor Attendance Routes
Endpoints for attendance metrics, appointment tracking, metric overrides, and config.
"""
from flask import request
from flask_jwt_extended import jwt_required, current_user
from datetime import datetime

from . import doctor_attendance_bp
from .service import DoctorAttendanceService
from app.common.responses import success_response, error_response
from app.models import UserRole, Doctor


def _is_admin():
    # PLATFORM_OWNER is included for the same reason it is in
    # doctor_analytics: it is a super-tenant admin and reaches these metrics
    # through the Operations doctor screen, which mounts the doctor's own
    # Attendance & Activity tab. Without it that tab 403s for the one role
    # that is allowed everywhere else.
    return current_user.role in (
        UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN, UserRole.PLATFORM_OWNER,
    )


def _get_doctor_for_user():
    # Employer's row for a doctor's staff, so _check_doctor_access below
    # admits an assistant for the doctor they work for and nobody else.
    from app.common.provider_access import acting_doctor
    return acting_doctor()


def _check_doctor_access(doctor_id):
    """Return True if current user can access this doctor's data."""
    if _is_admin():
        return True
    doctor = _get_doctor_for_user()
    return doctor and str(doctor.id) == doctor_id


# ================================================================== #
# Acceptance Metrics
# ================================================================== #
@doctor_attendance_bp.route('/<doctor_id>/acceptance-metrics', methods=['GET'])
@jwt_required()
def get_acceptance_metrics(doctor_id):
    """
    Get acceptance stage metrics for a doctor.

    Query params:
        period: day | week | month (default: day)
        date: YYYY-MM-DD (default: today)
        consultation_type: video | audio | chat | complete (default: all)
    """
    if not _check_doctor_access(doctor_id):
        return error_response('Access denied', status_code=403)

    period = request.args.get('period', 'day').strip().lower()
    if period not in ('day', 'week', 'month'):
        return error_response('Invalid period', status_code=400)

    date_str = request.args.get('date', '').strip()
    reference_date = None
    if date_str:
        try:
            reference_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return error_response('Invalid date format. Use YYYY-MM-DD.', status_code=400)

    consultation_type = request.args.get('consultation_type', '').strip().lower() or None

    metrics = DoctorAttendanceService.get_acceptance_metrics(
        doctor_id, period, reference_date, consultation_type
    )
    return success_response(data=metrics)


# ================================================================== #
# Doctor Actions (tracking flags)
# ================================================================== #
@doctor_attendance_bp.route('/appointments/<appointment_id>/verify', methods=['POST'])
@jwt_required()
def verify_appointment(appointment_id):
    """Mark appointment as verified by doctor."""
    appt, err = DoctorAttendanceService.verify_appointment(appointment_id, current_user.id)
    if err:
        code = 404 if 'not found' in err.lower() else 403
        return error_response(err, code)
    return success_response(data=appt.to_dict(), message='Appointment verified')


@doctor_attendance_bp.route('/appointments/<appointment_id>/doctor-accept', methods=['POST'])
@jwt_required()
def doctor_accept_appointment(appointment_id):
    """Doctor confirms they can treat this patient."""
    appt, err = DoctorAttendanceService.doctor_accept_appointment(appointment_id, current_user.id)
    if err:
        code = 404 if 'not found' in err.lower() else 400
        return error_response(err, code)
    return success_response(data=appt.to_dict(), message='Appointment accepted by doctor')


@doctor_attendance_bp.route('/appointments/<appointment_id>/doctor-reject', methods=['POST'])
@jwt_required()
def doctor_reject_appointment(appointment_id):
    """Doctor flags wrong specialization."""
    data = request.get_json(silent=True) or {}
    reason = data.get('reason', '')
    appt, err = DoctorAttendanceService.doctor_reject_appointment(appointment_id, current_user.id, reason)
    if err:
        code = 404 if 'not found' in err.lower() else 400
        return error_response(err, code)
    return success_response(data=appt.to_dict(), message='Appointment rejected by doctor')


@doctor_attendance_bp.route('/appointments/<appointment_id>/doctor-cancel', methods=['POST'])
@jwt_required()
def doctor_cancel_appointment(appointment_id):
    """Doctor cancels due to unavailability."""
    data = request.get_json(silent=True) or {}
    reason = data.get('reason', '')
    appt, err = DoctorAttendanceService.doctor_cancel_appointment(appointment_id, current_user.id, reason)
    if err:
        code = 404 if 'not found' in err.lower() else 400
        return error_response(err, code)
    return success_response(data=appt.to_dict(), message='Appointment cancelled by doctor')


# ================================================================== #
# Execution Stage Metrics
# ================================================================== #
@doctor_attendance_bp.route('/<doctor_id>/execution-metrics', methods=['GET'])
@jwt_required()
def get_execution_metrics(doctor_id):
    """Get execution stage metrics for a doctor."""
    if not _check_doctor_access(doctor_id):
        return error_response('Access denied', status_code=403)

    period = request.args.get('period', 'day').strip().lower()
    if period not in ('day', 'week', 'month'):
        return error_response('Invalid period', status_code=400)

    date_str = request.args.get('date', '').strip()
    reference_date = None
    if date_str:
        try:
            reference_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return error_response('Invalid date format. Use YYYY-MM-DD.', status_code=400)

    consultation_type = request.args.get('consultation_type', '').strip().lower() or None
    metrics = DoctorAttendanceService.get_execution_metrics(
        doctor_id, period, reference_date, consultation_type
    )
    return success_response(data=metrics)


# ================================================================== #
# Live / Call Stage Metrics
# ================================================================== #
@doctor_attendance_bp.route('/<doctor_id>/livecall-metrics', methods=['GET'])
@jwt_required()
def get_livecall_metrics(doctor_id):
    """Get live/call stage metrics for a doctor."""
    if not _check_doctor_access(doctor_id):
        return error_response('Access denied', status_code=403)

    period = request.args.get('period', 'day').strip().lower()
    if period not in ('day', 'week', 'month'):
        return error_response('Invalid period', status_code=400)

    date_str = request.args.get('date', '').strip()
    reference_date = None
    if date_str:
        try:
            reference_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return error_response('Invalid date format. Use YYYY-MM-DD.', status_code=400)

    consultation_type = request.args.get('consultation_type', '').strip().lower() or None
    metrics = DoctorAttendanceService.get_livecall_metrics(
        doctor_id, period, reference_date, consultation_type
    )
    return success_response(data=metrics)


# ================================================================== #
# Execution Stage Actions
# ================================================================== #
@doctor_attendance_bp.route('/appointments/<appointment_id>/doctor-joined', methods=['POST'])
@jwt_required()
def mark_doctor_joined(appointment_id):
    """Mark doctor as joined/present for appointment."""
    appt, err = DoctorAttendanceService.mark_doctor_joined(appointment_id, current_user.id)
    if err:
        code = 404 if 'not found' in err.lower() else 403
        return error_response(err, code)
    return success_response(data=appt.to_dict(), message='Doctor marked as joined')


@doctor_attendance_bp.route('/appointments/<appointment_id>/patient-joined', methods=['POST'])
@jwt_required()
def mark_patient_joined(appointment_id):
    """Mark patient as joined/present for appointment."""
    appt, err = DoctorAttendanceService.mark_patient_joined(appointment_id, current_user.id)
    if err:
        code = 404 if 'not found' in err.lower() else 403
        return error_response(err, code)
    return success_response(data=appt.to_dict(), message='Patient marked as joined')


@doctor_attendance_bp.route('/appointments/<appointment_id>/mark-missed', methods=['POST'])
@jwt_required()
def mark_missed(appointment_id):
    """Mark appointment as missed by doctor/patient/technical."""
    data = request.get_json(silent=True) or {}
    missed_by = data.get('missed_by', '')
    if missed_by not in ('doctor', 'patient', 'technical'):
        return error_response('missed_by must be "doctor", "patient", or "technical"', status_code=400)

    appt, err = DoctorAttendanceService.mark_missed(appointment_id, missed_by, current_user.id)
    if err:
        code = 404 if 'not found' in err.lower() else 400
        return error_response(err, code)
    return success_response(data=appt.to_dict(), message=f'Appointment marked as missed by {missed_by}')


# ================================================================== #
# Live/Call Stage Actions
# ================================================================== #
@doctor_attendance_bp.route('/appointments/<appointment_id>/track-media', methods=['POST'])
@jwt_required()
def track_media_usage(appointment_id):
    """Track doctor media usage during call (video/audio/chat)."""
    data = request.get_json(silent=True) or {}
    media_type = data.get('media_type', '')
    if media_type not in ('video', 'audio', 'chat'):
        return error_response('media_type must be "video", "audio", or "chat"', status_code=400)

    appt, err = DoctorAttendanceService.track_media_usage(appointment_id, current_user.id, media_type)
    if err:
        code = 404 if 'not found' in err.lower() else 400
        return error_response(err, code)
    return success_response(data=appt.to_dict(), message=f'Doctor {media_type} usage tracked')


# ================================================================== #
# Metric Overrides
# ================================================================== #
@doctor_attendance_bp.route('/<doctor_id>/metric-overrides', methods=['POST'])
@jwt_required()
def create_metric_override(doctor_id):
    """Submit a metric correction suggestion."""
    if not _check_doctor_access(doctor_id):
        return error_response('Access denied', status_code=403)

    data = request.get_json(silent=True) or {}
    required_fields = ['metric_type', 'period_start', 'period_end', 'original_value', 'suggested_value', 'reason']
    for field in required_fields:
        if field not in data:
            return error_response(f'Missing required field: {field}', status_code=400)

    override, err = DoctorAttendanceService.create_override(doctor_id, data)
    if err:
        return error_response(err, status_code=400)
    return success_response(data=override.to_dict(), message='Override submitted for review')


@doctor_attendance_bp.route('/<doctor_id>/metric-overrides', methods=['GET'])
@jwt_required()
def get_metric_overrides(doctor_id):
    """List metric overrides for a doctor."""
    if not _check_doctor_access(doctor_id):
        return error_response('Access denied', status_code=403)

    status = request.args.get('status', '').strip().lower() or None
    overrides = DoctorAttendanceService.get_overrides(doctor_id, status)
    return success_response(data=overrides)


@doctor_attendance_bp.route('/metric-overrides/<override_id>/review', methods=['PUT'])
@jwt_required()
def review_metric_override(override_id):
    """Admin approve or reject a metric override."""
    if not _is_admin():
        return error_response('Admin access required', status_code=403)

    data = request.get_json(silent=True) or {}
    status = data.get('status', '')
    if status not in ('approved', 'rejected'):
        return error_response('Status must be "approved" or "rejected"', status_code=400)

    override, err = DoctorAttendanceService.review_override(
        override_id, status, data.get('comment', ''), current_user.id
    )
    if err:
        return error_response(err, status_code=400)
    return success_response(data=override.to_dict(), message=f'Override {status}')


# ================================================================== #
# Attendance Page Config
# ================================================================== #
@doctor_attendance_bp.route('/config', methods=['GET'])
@jwt_required()
def get_attendance_config():
    """Get attendance page configuration."""
    doctor_id = request.args.get('doctor_id', '').strip() or None

    # Non-admin can only get their own config
    if not _is_admin() and doctor_id:
        doctor = _get_doctor_for_user()
        if not doctor or str(doctor.id) != doctor_id:
            return error_response('Access denied', status_code=403)

    configs = DoctorAttendanceService.get_config(doctor_id)
    return success_response(data=configs)


@doctor_attendance_bp.route('/config', methods=['PUT'])
@jwt_required()
def update_attendance_config():
    """Update attendance page configuration (admin only)."""
    if not _is_admin():
        return error_response('Admin access required', status_code=403)

    data = request.get_json(silent=True) or {}
    section_key = data.get('section_key')
    config = data.get('config')

    if not section_key or not config:
        return error_response('section_key and config are required', status_code=400)

    doctor_id = data.get('doctor_id')  # null for global default

    result, err = DoctorAttendanceService.update_config(
        section_key, config, doctor_id, current_user.id
    )
    if err:
        return error_response(err, status_code=400)
    return success_response(data=result.to_dict(), message='Config updated')


# ================================================================== #
# No-Response Metrics
# ================================================================== #
@doctor_attendance_bp.route('/<doctor_id>/no-response-metrics', methods=['GET'])
@jwt_required()
def get_no_response_metrics(doctor_id):
    """
    Get no-response counts per attendance stage for a doctor.

    Query params:
        period: day | week | month (default: day)
        date: YYYY-MM-DD (default: today)
        consultation_type: video | audio | chat | in_person | home_visit | camp (default: all)
    """
    if not _check_doctor_access(doctor_id):
        return error_response('Access denied', status_code=403)

    period = request.args.get('period', 'day').strip().lower()
    if period not in ('day', 'week', 'month'):
        return error_response('Invalid period', status_code=400)

    date_str = request.args.get('date', '').strip()
    reference_date = None
    if date_str:
        try:
            reference_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return error_response('Invalid date format. Use YYYY-MM-DD.', status_code=400)

    consultation_type = request.args.get('consultation_type', '').strip().lower() or None

    metrics = DoctorAttendanceService.get_no_response_metrics(
        doctor_id, period, reference_date, consultation_type
    )
    return success_response(data=metrics)


# ================================================================== #
# Asset Library Usage
# ================================================================== #
@doctor_attendance_bp.route('/appointments/<appointment_id>/asset-library-usage', methods=['POST'])
@jwt_required()
def log_asset_library_usage(appointment_id):
    """Log an asset library usage event during a consultation."""
    data = request.get_json(silent=True) or {}
    asset_type = data.get('asset_type', '').strip()
    asset_url = data.get('asset_url', '').strip()
    asset_name = data.get('asset_name', '').strip() or None

    if not asset_type:
        return error_response('asset_type is required', status_code=400)
    if not asset_url:
        return error_response('asset_url is required', status_code=400)

    usage, err = DoctorAttendanceService.log_asset_library_usage(
        appointment_id, current_user.id, asset_type, asset_url, asset_name
    )
    if err:
        code = 404 if 'not found' in err.lower() else 403
        return error_response(err, code)
    return success_response(data={
        'id': str(usage.id),
        'appointment_id': str(usage.appointment_id),
        'asset_type': usage.asset_type,
        'asset_name': usage.asset_name,
        'asset_url': usage.asset_url,
        'consultation_type': usage.consultation_type,
        'used_at': usage.used_at.isoformat() if usage.used_at else None,
    }, message='Asset library usage logged')


@doctor_attendance_bp.route('/<doctor_id>/asset-library-usage', methods=['GET'])
@jwt_required()
def get_asset_library_usage(doctor_id):
    """
    Get asset library usage metrics for a doctor.

    Query params:
        period: day | week | month (default: day)
        date: YYYY-MM-DD (default: today)
        consultation_type: filter by consultation type (default: all)
    """
    if not _check_doctor_access(doctor_id):
        return error_response('Access denied', status_code=403)

    period = request.args.get('period', 'day').strip().lower()
    if period not in ('day', 'week', 'month'):
        return error_response('Invalid period', status_code=400)

    date_str = request.args.get('date', '').strip()
    reference_date = None
    if date_str:
        try:
            reference_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return error_response('Invalid date format. Use YYYY-MM-DD.', status_code=400)

    consultation_type = request.args.get('consultation_type', '').strip().lower() or None

    metrics = DoctorAttendanceService.get_asset_library_usage_metrics(
        doctor_id, period, reference_date, consultation_type
    )
    return success_response(data=metrics)
