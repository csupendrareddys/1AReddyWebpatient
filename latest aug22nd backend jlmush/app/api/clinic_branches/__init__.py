"""Clinic Branches API — a main clinic manages its login-less branch clinics."""
from flask import Blueprint

clinic_branches_bp = Blueprint('clinic_branches', __name__)

from app.api.clinic_branches import routes  # noqa: E402,F401
