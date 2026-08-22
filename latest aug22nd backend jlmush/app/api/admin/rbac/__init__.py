"""
RBAC Admin Module - Blueprint Registration
"""
from flask import Blueprint

rbac_bp = Blueprint('rbac', __name__)

from app.api.admin.rbac import routes  # noqa
