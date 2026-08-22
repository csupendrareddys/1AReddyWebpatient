"""Platform API Blueprint (PLATFORM_OWNER only).

Owns cross-tenant operations: tenant CRUD and per-tenant permission
allocation that decides which landing-page modules each tenant's
SUPER_ADMIN can configure.
"""
from flask import Blueprint

platform_bp = Blueprint('platform', __name__, url_prefix='/api/v1/platform')

from app.api.platform import routes  # noqa: E402,F401
from app.api.platform import pricing_routes  # noqa: E402,F401
from app.api.platform import membership_routes  # noqa: E402,F401
# Platform-owner author-on-behalf endpoints for the tenant-provider-plan
# catalog (see app/api/tenant_provider_plan/__init__.py for the tenant-
# self-service surface).
# Vendor -> tenant support access grants. Control-plane routes that
# gate the vendor's reach into customer data (app.common.support_access).
from app.api.platform import support_routes  # noqa: E402,F401
from app.api.platform import tenant_provider_plan_routes  # noqa: E402,F401
# Seller<->tenant support chat inbox (SupportMessage threads).
from app.api.platform import support_inbox_routes  # noqa: E402,F401
