"""Platform marketing landing — blueprint.

Admin CRUD + public read for the platform's own marketing site
(``larazen.in``). Schema-separated from the per-tenant landing system
(see :mod:`app.models.platform_landing_page_config`). All admin routes
are PLATFORM_OWNER-only; the public route is open.
"""
from flask import Blueprint

platform_landing_bp = Blueprint('platform_landing', __name__)

from app.api.platform_landing import routes  # noqa: E402,F401
