"""Entity-profile API blueprint — view/edit a corporate registrant's entity
details (type, names, statutory numbers) from the profile. Registered on
``api_bp`` with ``url_prefix='/entity-profile'``; final prefix
``/api/entity-profile``.
"""
from flask import Blueprint

entity_profile_bp = Blueprint('entity_profile', __name__)

from app.api.entity_profile import routes  # noqa: E402,F401
