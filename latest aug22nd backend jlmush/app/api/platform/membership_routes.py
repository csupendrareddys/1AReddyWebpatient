"""Platform-owner CRUD for marketplace ``MembershipPlan`` catalog.

Round 1 surface — admin only. The companion public read endpoint at
``/api/public/membership-plans`` (in ``app.api.public.routes``) feeds
the apex pricing page.

All endpoints require ``PLATFORM_OWNER``. They live under ``/api/platform``
alongside the SaaS Plans + Tenants admin routes.
"""
from __future__ import annotations

from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.platform import platform_bp
from app.api.platform.membership_validators import MembershipPlanValidator
from app.common.decorators import role_required
from app.common.tenant_context import current_tenant_id_strict
from app.common.responses import (
    created_response, error_response, no_content_response,
    not_found_response, success_response, validation_error_response,
)
from app.extensions import db
from app.models._base import utcnow
from app.models._enums import (
    MembershipPlanStatus, MembershipTier, MembershipVertical, UserRole,
)


# --------------------------------------------------------------------------- #
# MembershipPlan catalog
# --------------------------------------------------------------------------- #

@platform_bp.route('/membership-plans', methods=['GET'])
@jwt_required()
@role_required([UserRole.PLATFORM_OWNER, UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def list_membership_plans():
    """Return every non-deleted plan, any status. Admin view — Draft /
    Active / Archived all show up so the platform owner can curate the
    9-cell grid before flipping rows to ``active``."""
    from app.models import MembershipPlan
    plans = (
        MembershipPlan.query.filter_by(is_deleted=False)
        .order_by(
            MembershipPlan.sort_order.asc(),
            MembershipPlan.tier.asc(),
            MembershipPlan.created_at.asc(),
        )
        .all()
    )
    return success_response([p.to_dict() for p in plans])


@platform_bp.route('/membership-plans/<code>', methods=['GET'])
@jwt_required()
@role_required([UserRole.PLATFORM_OWNER, UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_membership_plan(code):
    from app.models import MembershipPlan
    plan = MembershipPlan.query.filter_by(code=code, is_deleted=False).first()
    if not plan:
        return not_found_response('MembershipPlan')
    return success_response(plan.to_dict())


@platform_bp.route('/membership-plans', methods=['POST'])
@jwt_required()
@role_required([UserRole.PLATFORM_OWNER, UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def create_membership_plan():
    from app.models import MembershipPlan
    data = request.get_json() or {}
    errors = MembershipPlanValidator.validate_create(data)
    if errors:
        return validation_error_response(errors)

    # 409 on duplicate code (table has UNIQUE; trap pre-flight to give
    # a nice error message instead of a raw IntegrityError).
    if MembershipPlan.query.filter_by(
        code=data['code'], is_deleted=False,
    ).first():
        return error_response(
            f'Membership plan with code "{data["code"]}" already exists',
            status_code=409,
        )

    tier = MembershipTier(data['tier'])

    # Round 8.5 — the partial-unique index on (vertical, tier) was
    # dropped in migration ``g3b4c5d6e7f8`` so the platform owner can
    # author N plans per (vertical, tier). Uniqueness now lives only
    # on the ``code`` column (checked above). Listing endpoints rely
    # on ``sort_order`` to surface the right plan at the right slot.

    plan = MembershipPlan(
        code=data["code"],
        name=data["name"],
        description=data.get("description"),
        vertical_plan_type_id=data["vertical_plan_type_id"],
        tier=tier,
        pricing=_create_pricing_dict(data),
        trial_days=data.get("trial_days", 0),
        payout_hold_days=data.get("payout_hold_days"),
        commission_pct=data.get("commission_pct"),
        platform_fee_inr=data.get("platform_fee_inr"),
        member_discount_pct=data.get("member_discount_pct") or 0,
        status=MembershipPlanStatus(data.get("status", "draft")),
        is_featured=bool(data.get("is_featured", False)),
        is_legacy=bool(data.get("is_legacy", False)),
        features=data.get("features") or {},
        sort_order=data.get("sort_order", 0),
        benefits=data.get("benefits") or [],
        created_by_id=current_user.id,
    )
    db.session.add(plan)
    db.session.commit()
    return created_response(plan.to_dict(), message='Membership plan created')


@platform_bp.route('/membership-plans/<code>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.PLATFORM_OWNER, UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def update_membership_plan(code):
    from app.models import MembershipPlan
    plan = MembershipPlan.query.filter_by(code=code, is_deleted=False).first()
    if not plan:
        return not_found_response('MembershipPlan')

    data = request.get_json() or {}
    errors = MembershipPlanValidator.validate_update(data)
    if errors:
        return validation_error_response(errors)

    # Scalar / nullable fields — straight assign.
    for field_name in (
        "name",
        "description",
        "trial_days",
        "payout_hold_days",
        "commission_pct",
        "platform_fee_inr",
        "member_discount_pct",
        "is_featured",
        "is_legacy",
        "features",
        "benefits",
        "sort_order",
        "vertical_plan_type_id",
    ):
        if field_name in data:
            setattr(plan, field_name, data[field_name])
    # Setting up pricing. Guarded the same way as the tenant-scoped route: a
    # wholesale rebuild from a payload that never mentions a price deletes every
    # price on the plan. See ``_mentions_pricing`` in
    # ``app/api/membership_plan/routes.py`` for what that cost.
    if any(
        f'{prefix}{period}' in data
        for period in ('monthly', 'quarterly', 'semi_annual', 'annual', 'biennial', 'triennial')
        for prefix in ('price_inr_', 'og_price_inr_')
    ):
        plan.pricing = _create_pricing_dict(data)

    # Enum coercions.
    if 'tier' in data:
        plan.tier = MembershipTier(data['tier'])
    if 'status' in data:
        plan.status = MembershipPlanStatus(data['status'])

    plan.updated_by_id = current_user.id
    db.session.commit()
    return success_response(plan.to_dict(), message='Membership plan updated')


@platform_bp.route('/membership-plans/<code>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.PLATFORM_OWNER, UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def archive_membership_plan(code):
    """Soft-archive. Round 1 has no active subscriptions yet so there
    are no orphans to worry about; the parallel check for SaaS Plan
    archives (``Cannot archive a plan with active subscriptions``) gets
    added in Round 2 when ``MembershipSubscription`` writes turn on.
    """
    from app.models import MembershipPlan
    plan = MembershipPlan.query.filter_by(code=code, is_deleted=False).first()
    if not plan:
        return not_found_response('MembershipPlan')

    plan.is_deleted = True
    plan.deleted_at = utcnow()
    plan.status = MembershipPlanStatus.ARCHIVED
    plan.updated_by_id = current_user.id
    db.session.commit()
    return no_content_response()


### VERTICAL PLAN TYPES CRUD
#
# DEPRECATED PATHS. ``vertical_plan_types`` is tenant-owned data and every
# handler below already scopes to ``current_tenant_id_strict()`` — the
# ``/api/platform`` prefix only ever made a tenant-admin act look like a
# vendor-controlled catalogue. The honest surface is ``/api/verticals``
# (app/api/verticals). These stay as aliases so existing clients keep
# working; prefer the new paths and retire these once the frontend has
# moved.
#
# Note PLATFORM_OWNER still appears in the role lists here. That no longer
# grants blanket reach: on a customer tenant the owner needs an active
# support session (app.common.support_access) like anywhere else.

@platform_bp.route("/vertical-plan-types", methods=["GET"])
@jwt_required()
@role_required([UserRole.PLATFORM_OWNER, UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def list_vertical_plan_types():
    from app.models.membership import VerticalPlanType

    # Tenant-scoped: each tenant owns its own verticals. Explicit filter on
    # top of RLS because the app connects as a superuser in dev (RLS bypassed).
    vertical_plan_types = VerticalPlanType.query.filter_by(
        tenant_id=current_tenant_id_strict(),
    ).order_by(
        VerticalPlanType.sort_order.asc(), VerticalPlanType.name.asc()
    ).all()

    return success_response([pt.to_dict() for pt in vertical_plan_types])


@platform_bp.route("/vertical-plan-types", methods=["POST"])
@jwt_required()
@role_required([UserRole.PLATFORM_OWNER, UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def create_vertical_plan_type():
    from app.models.membership import VerticalPlanType

    data = request.get_json() or {}

    code = (data.get("code") or "").strip()
    name = (data.get("name") or "").strip()
    icon_key = (data.get("icon_key") or "").strip()
    description = (data.get("description") or "").strip()
    is_receiver = data.get("is_receiver") or False
    sort_order = data.get("sort_order") or 0

    if not code or not name:
        return validation_error_response({"missing": ["code", "name"]})

    # ``code`` is unique WITHIN a tenant now, so the conflict check and the
    # new row are both scoped to the caller's tenant.
    tenant_id = current_tenant_id_strict()
    if VerticalPlanType.query.filter_by(tenant_id=tenant_id, code=code).first():
        return error_response(
            f'Vertical Plan type "{code}" already exists.',
            status_code=409,
        )

    vertical_plan_type = VerticalPlanType(
        tenant_id=tenant_id,
        code=code, name=name, icon_key=icon_key, description=description,
        is_receiver=is_receiver, sort_order=sort_order,
    )

    db.session.add(vertical_plan_type)
    db.session.commit()

    return created_response(vertical_plan_type.to_dict(), message="Vertical Plan type created")


@platform_bp.route("/vertical-plan-types/<uuid:vertical_plan_type_id>", methods=["PUT"])
@jwt_required()
@role_required([UserRole.PLATFORM_OWNER, UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def update_vertical_plan_type(vertical_plan_type_id):
    from app.models.membership import VerticalPlanType

    tenant_id = current_tenant_id_strict()
    vertical_plan_type = VerticalPlanType.query.filter_by(
        id=vertical_plan_type_id, tenant_id=tenant_id,
    ).first()
    if not vertical_plan_type:
        return not_found_response("Plan type")

    data = request.get_json() or {}

    if "code" in data:
        existing = VerticalPlanType.query.filter(
            VerticalPlanType.tenant_id == tenant_id,
            VerticalPlanType.code == data["code"],
            VerticalPlanType.id != vertical_plan_type.id,
        ).first()

        if existing:
            return error_response(
                f'Plan type "{data["code"]}" already exists.',
                status_code=409,
            )

        vertical_plan_type.code = data["code"]

    if "name" in data:
        vertical_plan_type.name = data["name"]

    if "icon_key" in data:
        vertical_plan_type.icon_key = data["icon_key"]

    if "description" in data:
        vertical_plan_type.description = data["description"]

    if "is_receiver" in data:
        vertical_plan_type.is_receiver = data["is_receiver"]

    if "sort_order" in data:
        vertical_plan_type.sort_order = data["sort_order"]

    db.session.commit()

    return success_response(vertical_plan_type.to_dict(), message="Vertical Plan type updated")


@platform_bp.route("/vertical-plan-types/<uuid:plan_type_id>", methods=["DELETE"])
@jwt_required()
@role_required([UserRole.PLATFORM_OWNER, UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def delete_vertical_plan_type(plan_type_id):
    from app.models.membership import VerticalPlanType, MembershipPlan

    vertical_plan_type = VerticalPlanType.query.filter_by(
        id=plan_type_id, tenant_id=current_tenant_id_strict(),
    ).first()
    if not vertical_plan_type:
        return not_found_response("Vertical Plan type")

    # Never remove a vertical that any plan still references — INCLUDING
    # archived plans, since grandfathered members may still be on them. The FK
    # is ondelete=RESTRICT so the DB would block it anyway; this returns a clean
    # 409 (with the member count) instead of an IntegrityError, and matches the
    # rule that a vertical/plan in use can only be closed to new signups, never
    # removed out from under existing members.
    referencing_plans = MembershipPlan.query.filter_by(
        vertical_plan_type_id=vertical_plan_type.id,
    ).all()
    if referencing_plans:
        from app.models.membership import MembershipSubscription
        from app.models._enums import MembershipSubscriptionStatus
        plan_ids = [p.id for p in referencing_plans]
        live_members = MembershipSubscription.query.filter(
            MembershipSubscription.tenant_id == current_tenant_id_strict(),
            MembershipSubscription.membership_plan_id.in_(plan_ids),
            MembershipSubscription.is_deleted.is_(False),
            MembershipSubscription.status.in_([
                MembershipSubscriptionStatus.PENDING,
                MembershipSubscriptionStatus.TRIAL,
                MembershipSubscriptionStatus.ACTIVE,
                MembershipSubscriptionStatus.PAST_DUE,
            ]),
        ).count()
        detail = (f' {live_members} member(s) are still on its plans.'
                  if live_members else '')
        return error_response(
            "Cannot remove a vertical that still has plans (including archived "
            "ones)." + detail + " Remove its plans first, or just leave it "
            "archived — it won't be offered to new subscribers.",
            status_code=409,
        )

    db.session.delete(vertical_plan_type)
    db.session.commit()

    return no_content_response()


def _create_pricing_dict(data: dict) -> dict:
    """Create a pricing dict.

    Only None/blank is dropped ("period not offered"). ``0`` is kept: it's a
    price the admin typed, and the plan card renders it as "Free". ``-1`` is
    kept too — the "Custom / Contact sales" sentinel.
    """
    PRICING_PERIOD = ["monthly", "quarterly", "semi_annual", "annual","biennial", "triennial"]
    pricing={}
    if data is not None:
        for period in PRICING_PERIOD:
            str1 = f'price_inr_{period}'
            str2 = f'og_price_inr_{period}'
            if data.get(str1) not in (None, ''):
                pricing[str1] = float(data.get(str1))
            if data.get(str2) not in (None, ''):
                pricing[str2] = float(data.get(str2))

    return pricing