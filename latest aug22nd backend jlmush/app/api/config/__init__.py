"""
Config Module
Handles dynamic configuration for frontend components (login page, etc.)
"""
from flask import Blueprint

config_bp = Blueprint('config', __name__, url_prefix='/config')

from . import routes
