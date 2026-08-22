"""Facility self-profile API blueprint — a clinic/hospital admin (the facility
HEAD) views/edits their facility record + their own head-user personal details.

Registered on ``api_bp`` with ``url_prefix='/facility'``; final prefix
``/api/facility``. This is what the clinic/hospital "Settings" page uses —
a facility admin has no ``Doctor`` row, so the doctor profile endpoint 404s.
Legal-entity details (logos, statutory docs) stay on ``/api/entity-profile``.
"""
from flask import Blueprint

facility_profile_bp = Blueprint('facility_profile', __name__)

from app.api.facility_profile import routes  # noqa: E402,F401
