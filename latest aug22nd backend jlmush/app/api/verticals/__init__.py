"""Tenant-owned verticals — the personas a tenant sells to.

``vertical_plan_types`` has always been tenant-scoped: each tenant owns
its own set, and creating one is an ordinary tenant-admin act. But the
only CRUD for it lived on ``platform_bp`` at
``/api/platform/vertical-plan-types``, which reads as a vendor-controlled
catalogue. It was not one -- every handler already scoped to
``current_tenant_id_strict()`` and already admitted SUPER_ADMIN /
SUB_ADMIN.

This blueprint gives them their honest home. A legal firm creating an
"Advocate" vertical should not be calling an endpoint named after the
platform.

The platform-prefixed paths still work (see
``app.api.platform.membership_routes``), delegating here so there is one
implementation. Those are deprecated aliases for the frontend's benefit,
not a second surface.
"""
from flask import Blueprint

verticals_bp = Blueprint('verticals', __name__)

from app.api.verticals import routes  # noqa: E402,F401
