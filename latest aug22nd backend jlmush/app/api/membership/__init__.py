"""Marketplace membership API blueprint.

Provider-facing surface — a doctor (clinic / hospital in future rounds)
logged into the apex hits these endpoints to see their own membership
status. Distinct from ``/api/platform/membership-plans`` which is the
PLATFORM_OWNER catalog-authoring surface, and ``/api/public/membership-plans``
which is the anonymous read for the apex pricing grid.
"""
from flask import Blueprint

# Registered on ``api_bp`` with ``url_prefix='/membership'`` in
# ``app/api/__init__.py``; ``api_bp`` itself mounts under ``/api`` from
# ``app/__init__.py``. Final URL prefix: ``/api/membership``.
membership_bp = Blueprint('membership', __name__)

from app.api.membership import routes  # noqa: E402,F401
