"""Public (unauthenticated) API blueprint.

Everything under ``/api/public/*`` is reachable without a JWT. Today it hosts:

* ``GET /plans``          — pricing catalog for the platform landing page.
* ``POST /signup/tenant`` — self-serve onboarding: creates a tenant, a
  TRIAL ``TenantSubscription`` linked to the chosen plan, and the
  initial SUPER_ADMIN user. Rate-limited per IP.

Kept intentionally small so the authenticated surface under ``/api/*``
stays the default. Any new public endpoint goes here so reviewers can
audit what anonymous traffic can hit.
"""
from flask import Blueprint

public_bp = Blueprint('public', __name__)

from app.api.public import routes  # noqa: E402,F401
# Booking routes register additional public endpoints under /booking/* on the
# same blueprint. Imported at module load so url_map sees them on app start.
from app.api.public import booking_routes  # noqa: E402,F401
