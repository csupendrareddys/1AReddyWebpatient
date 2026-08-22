"""Patient Profile Configuration API Blueprint."""
from flask import Blueprint

patient_profile_config_bp = Blueprint('patient_profile_config', __name__, url_prefix='/api/v1/patient-profile-config')

from app.api.patient_profile_config import routes
