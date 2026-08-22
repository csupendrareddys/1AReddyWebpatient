"""Facility-side My Link — see :mod:`app.api.provider_link.routes`."""
from flask import Blueprint

provider_link_bp = Blueprint('provider_link', __name__)

from app.api.provider_link import routes  # noqa: E402,F401  (registers routes)
