"""Doctor Signup Configuration API Blueprint."""
from flask import Blueprint

doctor_signup_config_bp = Blueprint(
    'doctor_signup_config', __name__,
    url_prefix='/api/v1/doctor-signup-config',
)

from app.api.doctor_signup_config import routes  # noqa: E402, F401
