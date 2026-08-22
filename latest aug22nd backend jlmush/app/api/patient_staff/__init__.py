"""Patient Support Staff API — the patient manages caregivers; a caregiver acts."""
from flask import Blueprint

patient_staff_bp = Blueprint('patient_staff', __name__)

from app.api.patient_staff import routes  # noqa: E402,F401
