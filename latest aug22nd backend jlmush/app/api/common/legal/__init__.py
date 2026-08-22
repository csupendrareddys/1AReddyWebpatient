"""
Legal content blueprint initialization
"""
from flask import Blueprint

legal_bp = Blueprint('legal', __name__)

from app.api.common.legal import routes
