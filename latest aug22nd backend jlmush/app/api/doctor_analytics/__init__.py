"""
Doctor Analytics Module
Provides analytics metrics, appointment settings, and live status management.

A doctor's staff reach this with ``profile.analytics``. Admins are unaffected:
the gate only inspects PROVIDER_STAFF callers and every route keeps the admin
branch it already had.
"""
from flask import Blueprint

from app.common.provider_access import staff_prefix_gate
from app.models import StaffProviderType

doctor_analytics_bp = Blueprint('doctor_analytics', __name__)

from . import routes  # noqa

doctor_analytics_bp.before_request(staff_prefix_gate(
    base='/api/v1/doctor-analytics',
    rules={
        '<doctor_id>/metrics': 'profile.analytics',
        # Settings decide what the analytics screen measures. Reading them is
        # part of reading analytics; changing them needs an edit grant.
        '<doctor_id>/settings': 'profile.analytics',
    },
    vertical=StaffProviderType.DOCTOR,
    # ``/me`` returns only the caller's doctor id, and every profile tab needs
    # it to address the by-id reads. Gating it on analytics would mean an
    # assistant granted Working Hours couldn't load Working Hours. It discloses
    # the id of the doctor they already know they work for.
    public=('me',),
))
