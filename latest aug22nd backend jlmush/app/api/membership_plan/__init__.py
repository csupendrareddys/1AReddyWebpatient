"""Tenant-scoped marketplace membership-plan API.

The "who pays us" catalog — providers (doctor / clinic / hospital) who
pay to list on a tenant's marketplace. Each tenant authors its own
tiers; the apex/default tenant is just another tenant here (the platform
owner authors on it). Distinct from ``/api/tenant-provider-plans`` (the
"who we pay" catalog) and from the SaaS ``Plan`` line.

Gated per-vertical on ``tenant.can_create_membership_<vertical>_plans``
(the apex/default tenant is auto-entitled via FeatureGate's is_default
bypass). Tenant-scoped: every query filters on the resolved
``current_tenant_id`` on top of Postgres RLS, so it stays correct even
in dev where the app connects as a superuser that bypasses RLS.

URL prefix: ``/api/membership-plans``.
"""
from flask import Blueprint

membership_plan_bp = Blueprint('membership_plan', __name__)

from app.api.membership_plan import routes  # noqa: E402,F401
