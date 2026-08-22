"""Pricing / Plans blueprint.

Tenant-facing endpoints live under ``/api/pricing``. Platform-owner CRUD for
plans, add-ons and tenant subscriptions lives under ``/api/platform/plans``,
``/api/platform/addons`` and ``/api/platform/tenants/<id>/subscription`` —
registered in :mod:`app.api.platform.routes` for consistency with other
PLATFORM_OWNER-only surfaces.
"""
from flask import Blueprint

pricing_bp = Blueprint('pricing', __name__)

from app.api.pricing import routes  # noqa: E402,F401
