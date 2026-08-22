"""Platform-owner author-on-behalf endpoints for tenant-provider plans.

Mirror of the tenant super-admin CRUD (``/api/tenant-provider-plans``)
but with two differences:

  * Auth: PLATFORM_OWNER only. Different decorator, different intent
    (ops escape hatch — "the tenant called support and asked us to
    author their plans for them").
  * Tenant scope is in the URL path (``/api/platform/tenants/<tenant_id>/
    provider-plans``) rather than inferred from JWT — the caller is
    the platform owner working on behalf of any tenant.

These endpoints bypass the ``tenant.can_create_<vertical>_plans``
feature gate via ``bypass_feature_check=True`` on the service. The
platform owner is always entitled regardless of which add-ons the
tenant currently holds — useful if the tenant lost the add-on but
still needs an admin to clean up their plan catalog.

NOTE: the writes go through the same service path as tenant self-
service so the resulting rows are indistinguishable except for the
``authored_by`` column (``platform`` instead of ``tenant``). RLS
enforcement is bypassed implicitly because PLATFORM_OWNER's request
hook sets ``app.current_tenant_id`` to the path tenant_id before the
endpoint runs.
"""
from __future__ import annotations

from flask import g, request
from flask_jwt_extended import jwt_required, current_user

from app.api.platform import platform_bp
from app.api.tenant_provider_plan.routes import (
    _parse_vertical, _translate, _validate_payload,
)
from app.api.tenant_provider_plan.service import (
    TenantProviderPlanError,
    TenantProviderPlanService,
)
from app.common.decorators import role_required
from app.common.responses import (
    created_response, error_response, not_found_response, success_response,
    validation_error_response,
)
from app.models import MembershipPlanStatus, Tenant, UserRole


def _resolve_tenant_or_404(tenant_id):
    """Return the Tenant row or None. PLATFORM_OWNER's session isn't
    scoped to a single tenant_id, so we look it up explicitly rather
    than relying on RLS."""
    return (
        Tenant.query
        .filter_by(tenant_id=tenant_id, is_deleted=False)
        .first()
    )


@platform_bp.route('/tenants/<tenant_id>/provider-plans', methods=['GET'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def platform_list_tenant_provider_plans(tenant_id):
    if _resolve_tenant_or_404(tenant_id) is None:
        return not_found_response('Tenant')
    vertical = _parse_vertical(request.args.get('vertical'))
    # Set the RLS session var so the query reads the right tenant's rows
    # even though the platform owner has no implicit tenant scope.
    g.current_tenant_id = tenant_id
    plans = TenantProviderPlanService.list_for_tenant(
        tenant_id=tenant_id, vertical=vertical,
    )
    return success_response(data=[p.to_dict() for p in plans])


# --------------------------------------------------------------------------- #
# DEPRECATED — cross-tenant write surfaces
# --------------------------------------------------------------------------- #
# The three write routes below (POST / PATCH / DELETE on a SUBSCRIBER
# tenant's provider plans) violate the Round-10 authority boundary:
# PLATFORM_OWNER may NOT write into a subscriber tenant's internal data.
# Subscriber-internal rows — provider plans, provider subscriptions,
# doctor/clinic/hospital roster — belong to that tenant's SUPER_ADMIN
# exclusively.
#
# Rationale: a single SaaS subscription must not be able to spawn
# cross-tenant edits. If PLATFORM_OWNER needs to fix a subscriber's data
# in a support scenario, that's a separate audited-impersonation flow,
# not an everyday API. The GET route stays — read-only visibility into a
# tenant's authored plans is useful for support without crossing the
# write boundary.
#
# The handlers now return 403 with a clear, machine-readable code so
# any client still calling them sees the policy decision rather than a
# silent 404 / 500.
_CROSS_TENANT_WRITE_DENIED = (
    "Platform owner cannot modify a subscriber tenant's provider plans. "
    "Ask that tenant's super admin to make the change. "
    "(Round-10 authority boundary: subscriber-internal data is owned "
    "by the tenant, not the platform owner.)"
)


@platform_bp.route('/tenants/<tenant_id>/provider-plans', methods=['POST'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def platform_create_tenant_provider_plan(tenant_id):
    return error_response(
        _CROSS_TENANT_WRITE_DENIED, status_code=403,
        code='cross_tenant_write_forbidden',
    )


@platform_bp.route(
    '/tenants/<tenant_id>/provider-plans/<plan_id>', methods=['PATCH'],
)
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def platform_update_tenant_provider_plan(tenant_id, plan_id):
    return error_response(
        _CROSS_TENANT_WRITE_DENIED, status_code=403,
        code='cross_tenant_write_forbidden',
    )


@platform_bp.route(
    '/tenants/<tenant_id>/provider-plans/<plan_id>', methods=['DELETE'],
)
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def platform_archive_tenant_provider_plan(tenant_id, plan_id):
    return error_response(
        _CROSS_TENANT_WRITE_DENIED, status_code=403,
        code='cross_tenant_write_forbidden',
    )
