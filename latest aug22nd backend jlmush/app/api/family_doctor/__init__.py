"""Family Doctor / Empanelment API.

Bidirectional patient<->doctor link. Mounted at ``/api/family-doctor``.
Role-gated per route (PATIENT vs DOCTOR); the accept/reject/cancel routes are
shared and gated to the request's ``target_user_id`` / requester.
"""
from flask import Blueprint

family_doctor_bp = Blueprint('family_doctor', __name__)

from app.api.family_doctor import routes  # noqa: E402,F401
