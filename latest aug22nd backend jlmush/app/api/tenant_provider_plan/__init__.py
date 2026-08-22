"""Tenant-scoped provider-plan API.

Three audiences, three URL surfaces — all backed by this one blueprint:

  * Tenant super-admin CRUD on their own provider plans (gated on the
    relevant ``tenant.can_create_<vertical>_plans`` feature add-on).
    URL prefix: ``/api/tenant-provider-plans``.
  * Anonymous (signup-time) read of a tenant's ACTIVE plans by vertical —
    so the in-tenant doctor/clinic/hospital signup forms can render a
    plan picker. URL prefix: ``/api/tenant-provider-plans/public``.
  * Platform-owner ops author-on-behalf — same CRUD as the tenant
    super-admin but tenant_id is in the URL and the caller is the
    platform owner. URL prefix: ``/api/platform/tenants/<tenant_id>/provider-plans``
    (registered on the ``platform`` blueprint, not this one).

Separate from the apex marketplace (``/api/membership``,
``/api/platform/membership-plans``) on purpose — the data lives in a
different table (``tenant_provider_plans``, RLS-scoped), the audience
is different (the tenant's own subdomain rather than larazen.in), and
the semantics are different (a tenant authors these vs. the platform
owner authoring marketplace tiers).
"""
from flask import Blueprint


tenant_provider_plan_bp = Blueprint('tenant_provider_plan', __name__)

# Round 10 — sibling blueprint for the subscription-management surface
# (``/api/tenant-provider-subscriptions/...``). Sharing the routes file
# with the plan blueprint keeps the helpers + service imports DRY; the
# url_prefix differs so the two URL surfaces don't collide.
tenant_provider_subscription_bp = Blueprint(
    'tenant_provider_subscription', __name__,
)

from app.api.tenant_provider_plan import routes  # noqa: E402,F401
