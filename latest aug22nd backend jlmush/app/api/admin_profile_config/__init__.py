"""Admin Profile Configuration API Blueprint."""
from flask import Blueprint

admin_profile_config_bp = Blueprint('admin_profile_config', __name__, url_prefix='/api/v1/admin-profile-config')

from app.api.admin_profile_config import routes
