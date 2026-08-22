"""
Doctor Attendance & Activity Module
Provides attendance metrics, appointment tracking flags, metric overrides, and admin config.

A doctor's staff reach the metrics with ``profile.attendance`` and the
appointment-lifecycle flags with a grant on consultations — marking a doctor
joined or an appointment missed is running the appointment, not reading a
statistic. Admin-only routes (config writes, override review) are absent from
the table and so refused to staff outright, whatever they hold.
"""
from flask import Blueprint

from app.common.provider_access import staff_prefix_gate
from app.models import StaffProviderType

doctor_attendance_bp = Blueprint('doctor_attendance', __name__)

from . import routes  # noqa

_ATTENDANCE = 'profile.attendance'
_CONSULTATIONS = 'appointments.my_appointments.consultations'

doctor_attendance_bp.before_request(staff_prefix_gate(
    base='/api/v1/doctor-attendance',
    rules={
        '<doctor_id>/acceptance-metrics': _ATTENDANCE,
        '<doctor_id>/execution-metrics': _ATTENDANCE,
        '<doctor_id>/livecall-metrics': _ATTENDANCE,
        '<doctor_id>/no-response-metrics': _ATTENDANCE,
        '<doctor_id>/asset-library-usage': _ATTENDANCE,
        # Raising an override is a request for correction against one's own
        # record, not the creation of a new thing to manage.
        '<doctor_id>/metric-overrides': (_ATTENDANCE, {'POST': 'can_edit'}),
        # Running the appointment. Every one of these is a POST that records
        # something that happened, so none of them is a "create".
        'appointments/<appointment_id>': (_CONSULTATIONS, {'POST': 'can_edit'}),
        'config': _ATTENDANCE,
    },
    vertical=StaffProviderType.DOCTOR,
))
