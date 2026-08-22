"""
TimeSlot Routes
API endpoints for managing doctor time slots (admin / internal use).
Doctor-facing slot generation is handled via the schedule update flow.
"""
from flask import request
from flask_jwt_extended import jwt_required, current_user
from datetime import datetime

from . import timeslot_bp
from .service import TimeSlotService
from app.common.decorators import role_required
from app.common.responses import success_response, error_response
from app.models import UserRole, Doctor


@timeslot_bp.route('/doctor/<doctor_id>/timeslots', methods=['GET'])
@jwt_required()
def get_timeslots(doctor_id):
    """
    Get time slots for a doctor on a date.

    Query params:
        date (required): YYYY-MM-DD
        consultation_type (optional): video|audio|chat|complete
        include_booked (optional): true — include booked slots (default false)
    """
    date_str = request.args.get('date', '').strip()
    if not date_str:
        return error_response('date query parameter is required (YYYY-MM-DD)', status_code=400)

    try:
        date_val = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return error_response('Invalid date format. Use YYYY-MM-DD', status_code=400)

    ct = request.args.get('consultation_type', '').strip() or None
    include_booked = request.args.get('include_booked', '').lower() == 'true'

    if include_booked:
        slots = TimeSlotService.get_all_slots_for_date(doctor_id, date_val)
    else:
        slots = TimeSlotService.get_available_slots(doctor_id, date_val, ct)

    return success_response(data={'slots': slots})


@timeslot_bp.route('/doctor/<doctor_id>/timeslots/summary', methods=['GET'])
@jwt_required()
def get_timeslot_summary(doctor_id):
    """
    Get slot counts per day for a month (DB-backed).

    Query params:
        month (required): YYYY-MM
    """
    month_str = request.args.get('month', '').strip()
    if not month_str:
        return error_response('month query parameter is required (YYYY-MM)', status_code=400)

    try:
        year, month = [int(x) for x in month_str.split('-')]
    except (ValueError, AttributeError):
        return error_response('Invalid month format. Use YYYY-MM', status_code=400)

    summary = TimeSlotService.get_slot_summary(doctor_id, year, month)
    return success_response(data={'dates': summary})


@timeslot_bp.route('/doctor/<doctor_id>/timeslots/<slot_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.DOCTOR)
def delete_timeslot(doctor_id, slot_id):
    """Delete a single unbooked time slot."""
    try:
        TimeSlotService.delete_slot(slot_id)
        return success_response(message='Slot deleted')
    except ValueError as e:
        return error_response(str(e), status_code=400)
