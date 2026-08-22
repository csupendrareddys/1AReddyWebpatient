"""
Doctor Analytics Routes
Endpoints for doctor metrics, appointment settings, and live status.
"""
from flask import request
from flask_jwt_extended import jwt_required, current_user
from datetime import datetime

from . import doctor_analytics_bp
from .service import DoctorAnalyticsService
from app.common.decorators import role_required
from app.common.provider_access import acting_doctor
from app.common.responses import success_response, error_response
from app.models import UserRole, Doctor


@doctor_analytics_bp.route('/me', methods=['GET'])
@jwt_required()
def get_my_doctor_id():
    """Return the current doctor's profile ID (for frontend convenience)."""
    doctor = acting_doctor()
    if not doctor:
        return error_response('Doctor profile not found', status_code=404)
    return success_response(data={'doctor_id': str(doctor.id)})


@doctor_analytics_bp.route('/<doctor_id>/metrics', methods=['GET'])
@jwt_required()
def get_metrics(doctor_id):
    """
    Get analytics metrics for a doctor.

    Query params:
        period: day | week | month  (default: day)
        date: YYYY-MM-DD reference date (default: today)
    """
    # Permission: admin can view any doctor, doctor can view only self
    is_admin = current_user.role in (UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN, UserRole.PLATFORM_OWNER)
    if not is_admin:
        doctor = acting_doctor()
        if not doctor or str(doctor.id) != doctor_id:
            return error_response('Access denied', status_code=403)

    period = request.args.get('period', 'day').strip().lower()
    if period not in ('day', 'week', 'month'):
        return error_response('Invalid period. Use day, week, or month.', status_code=400)

    date_str = request.args.get('date', '').strip()
    reference_date = None
    if date_str:
        try:
            reference_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return error_response('Invalid date format. Use YYYY-MM-DD.', status_code=400)

    metrics = DoctorAnalyticsService.get_metrics(doctor_id, period, reference_date)
    return success_response(data=metrics)


@doctor_analytics_bp.route('/<doctor_id>/settings', methods=['GET'])
@jwt_required()
def get_settings(doctor_id):
    """Get doctor's analytics-related settings (is_live, appointment modes)."""
    is_admin = current_user.role in (UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN, UserRole.PLATFORM_OWNER)
    if not is_admin:
        doctor = acting_doctor()
        if not doctor or str(doctor.id) != doctor_id:
            return error_response('Access denied', status_code=403)

    settings = DoctorAnalyticsService.get_settings(doctor_id)
    if settings is None:
        return error_response('Doctor not found', status_code=404)
    return success_response(data=settings)


@doctor_analytics_bp.route('/<doctor_id>/settings', methods=['PUT'])
@jwt_required()
def update_settings(doctor_id):
    """
    Update doctor settings.

    Admin can update: is_live, admin_allowed_appointment_modes, accepting_appointments
    Doctor can update: accepting_appointments (only within admin-allowed modes)
    """
    is_admin = current_user.role in (UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN, UserRole.PLATFORM_OWNER)
    if not is_admin:
        doctor = acting_doctor()
        if not doctor or str(doctor.id) != doctor_id:
            return error_response('Access denied', status_code=403)

    data = request.get_json(silent=True) or {}
    if not data:
        return error_response('Request body required', status_code=400)

    result, err = DoctorAnalyticsService.update_settings(doctor_id, data, current_user)
    if err:
        return error_response(err, status_code=400)
    return success_response(data=result, message='Settings updated successfully')
