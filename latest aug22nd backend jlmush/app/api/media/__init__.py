from flask import Blueprint

media_assets_bp = Blueprint('media_assets', __name__)

from . import routes  # noqa: E402,F401
