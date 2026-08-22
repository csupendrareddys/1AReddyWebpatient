"""Page Configuration API Blueprint."""
from flask import Blueprint

page_config_bp = Blueprint('page_config', __name__, url_prefix='/api/v1/page-config')

from app.api.page_config import routes
