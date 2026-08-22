from flask import Blueprint

reseller_bp = Blueprint('reseller_admin', __name__)

from . import routes  # noqa: E402,F401
