"""Doctor Profile Configuration API Blueprint."""
from flask import Blueprint

doctor_profile_config_bp = Blueprint('doctor_profile_config', __name__, url_prefix='/api/v1/doctor-profile-config')

from app.api.doctor_profile_config import routes
