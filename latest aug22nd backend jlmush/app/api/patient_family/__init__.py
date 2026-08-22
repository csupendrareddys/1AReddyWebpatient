"""Patient Family API — roles + reciprocal adult links (Phase 2)."""
from flask import Blueprint

patient_family_bp = Blueprint('patient_family', __name__)

from app.api.patient_family import routes  # noqa: E402,F401
