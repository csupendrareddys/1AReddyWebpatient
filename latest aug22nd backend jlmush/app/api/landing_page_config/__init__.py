"""Landing Configuration API Blueprint (v2 — 3-level hierarchy).

Dynamic top-nav modules + per-module features. Atomic publish at the landing
level. See :mod:`app.models.landing_page_config` for the schema.
"""
from flask import Blueprint

landing_page_config_bp = Blueprint(
    'landing_page_config', __name__,
)

from app.api.landing_page_config import routes  # noqa: E402,F401
