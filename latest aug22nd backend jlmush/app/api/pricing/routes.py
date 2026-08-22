"""Tenant-facing pricing routes.

Mounted under ``/api/pricing``:
    * ``GET /me`` — the resolved plan for the caller's tenant.
    * ``GET /plans`` — public catalog (ACTIVE plans only).
    * ``GET /addons`` — public add-on catalog (ACTIVE only).

Platform-owner CRUD for ``plans``, ``addons`` and tenant-level subscription /
add-on attachment lives in :mod:`app.api.platform.routes` so it sits alongside
the other PLATFORM_OWNER surfaces.
"""
from __future__ import annotations

from flask import request
from flask_jwt_extended import jwt_required

from app.api.pricing import pricing_bp
from app.api.pricing.service import (
    NoActiveSubscription, PlanService,
)
from app.common.responses import error_response, success_response
from app.common.tenant_context import current_tenant_id_strict


@pricing_bp.route('/me', methods=['GET'])
@jwt_required()
def get_my_plan():
    """Resolved plan + live counts for the current tenant."""
    tenant_id = current_tenant_id_strict()
    try:
        resolved = PlanService.resolve(tenant_id)
    except NoActiveSubscription:
        return error_response(
            'Tenant has no active subscription',
            code='no_active_subscription',
            status_code=404,
        )

    counts = PlanService.current_counts(tenant_id)

    # ``?debug=1`` returns feature_sources / limit_sources for support triage.
    include_debug = request.args.get('debug') in ('1', 'true', 'yes')
    data = resolved.to_dict(include_debug=include_debug)
    data['counts'] = counts
    # Marketplace-entity census (doctor/clinic/hospital used-vs-cap) —
    # a separate axis from team seats, resolved by the quota rail.
    from app.api.tenant_provider_plan.service import entity_usage
    data['entities'] = entity_usage(tenant_id)
    return success_response(data=data)


@pricing_bp.route('/my-addons', methods=['GET'])
@jwt_required()
def get_my_addons():
    """The add-ons THIS tenant can buy, priced by the full resolution
    chain (plan terms snapshot-first -> add-on tier -> legacy). The
    shop renders from this instead of the public catalogue so
    "different plans, different add-on price and capacity" holds."""
    from app.api.pricing import subscription_billing as sbill
    from app.models import Addon, AddonStatus, TenantSubscription

    tenant_id = current_tenant_id_strict()
    sub = TenantSubscription.query.filter_by(
        tenant_id=tenant_id, is_deleted=False).first()
    # A reseller's child shops ONLY its apex's resale offers — the
    # vendor's main-tier catalogue is not its store.
    child_of_apex = bool(sub is not None and sub.plan is not None
                         and sub.plan.owner_tenant_id)
    out = []
    for a in (Addon.query
              .filter_by(is_deleted=False, status=AddonStatus.ACTIVE)
              .order_by(Addon.code).all()):
        plan_terms = sbill._plan_addon_terms(sub, a.code)
        if child_of_apex and not isinstance(plan_terms, dict):
            continue
        tier = a.effective_tier('main')
        # Legacy pick-your-period add-on: neither the plan nor a tier
        # fixes the cycle, so the buyer chooses monthly/annual and the
        # scalars price it.
        pick_period = plan_terms is None and (
            tier is None or tier['billing_cycle'] is None)
        try:
            terms = sbill.resolve_addon_terms(a, 'monthly', 'main', sub=sub)
        except sbill.SubscriptionBillingError:
            continue                      # not offered to this buyer
        entry = {
            'code': a.code, 'name': a.name, 'description': a.description,
            'limits': a.limits, 'usage_deltas': a.usage_deltas,
            'prerequisites': a.prerequisites or [],
            'terms': terms,
            'pick_period': pick_period,
        }
        if pick_period:
            entry['price_inr_monthly'] = (
                float(a.price_inr_monthly)
                if a.price_inr_monthly is not None else None)
            entry['price_inr_annual'] = (
                float(a.price_inr_annual)
                if a.price_inr_annual is not None else None)
        out.append(entry)
    return success_response(data=out)


@pricing_bp.route('/plans', methods=['GET'])
@jwt_required()
def list_public_plans():
    """ACTIVE plans only — feeds the upgrade UI."""
    from app.models import Plan, PlanStatus
    plans = (
        Plan.query
        .filter_by(status=PlanStatus.ACTIVE, is_deleted=False)
        .order_by(Plan.created_at.asc())
        .all()
    )
    return success_response(data=[p.to_dict() for p in plans])


@pricing_bp.route('/addons', methods=['GET'])
@jwt_required()
def list_public_addons():
    from app.models import Addon, AddonStatus
    addons = (
        Addon.query
        .filter_by(status=AddonStatus.ACTIVE, is_deleted=False)
        .order_by(Addon.created_at.asc())
        .all()
    )
    return success_response(data=[a.to_dict() for a in addons])
