"""Platform-owner pricing routes.

Plan / add-on catalog CRUD and tenant-level subscription + add-on attachment.
All endpoints require PLATFORM_OWNER. Lives under ``/api/platform`` alongside
tenant / DNS / permission-allocation routes.
"""
from __future__ import annotations

from datetime import timedelta

from flask import request
from flask_jwt_extended import jwt_required, current_user

from app.api.platform import platform_bp
from app.api.pricing.service import (
    ALLOWED_FEATURE_PATHS,
    AddonPrerequisiteMissing, NoActiveSubscription, PlanService,
    ResellerPolicy, assert_prerequisites_active,
)
from app.api.pricing.plan_catalog_service import (
    build_plan_snapshot,
    InvalidPlanType, PlanCatalogService, PlanCodeExists,
    PlanHasActiveSubscriptions, build_pricing_dict,
)
from app.api.pricing.validators import (
    AddonValidator, PlanOverrideValidator, PlanValidator,
    SubscriptionValidator,
)
from app.api.platform.access import platform_access
from app.common.decorators import role_required
from app.common.responses import (
    created_response, error_response, no_content_response,
    not_found_response, success_response, validation_error_response,
)
from app.common.tenant_context import with_tenant_context
from app.extensions import db
from app.models._base import utcnow
from app.models._enums import (
    AddonStatus, AddonSubscriptionStatus, BillingCycle, OverLimitAction,
    PermissionAction, PermissionModule, PlanStatus, SubscriptionStatus,
    UserRole,
)


# --------------------------------------------------------------------------- #
# Feature-path whitelist (for the structured feature-tree editor in the UI)
# --------------------------------------------------------------------------- #

@platform_bp.route('/feature-paths', methods=['GET'])
@jwt_required()
@platform_access(PermissionModule.PLAN_CATALOG, PermissionAction.VIEW)
def list_feature_paths():
    """Return the whitelist of dotted feature paths the structured
    feature-tree editor (Frontend ``FeatureTreeEditor.jsx``) renders
    as toggles. Single source of truth lives in the backend at
    ``ALLOWED_FEATURE_PATHS`` — exposing it here means a new path
    added in code shows up in the dialog without a frontend change.

    Sorted for stable rendering. Caller groups by the leading segment
    (``patient``, ``doctor``, ``admin``, …) for the accordion layout.
    """
    return success_response(sorted(ALLOWED_FEATURE_PATHS))


# --------------------------------------------------------------------------- #
# Plan catalog
# --------------------------------------------------------------------------- #

def _plan_audit_state(plan) -> dict:
    """The fields a vendor can change, flattened for before/after diffs."""
    state = build_plan_snapshot(plan)
    state.pop('snapshot_of_updated_at', None)
    state.update({
        'name': plan.name,
        'description': plan.description,
        'status': plan.status.value if plan.status else None,
        'is_default': plan.is_default,
        'trial_days': plan.trial_days,
        'default_addons': list(plan.default_addons or []),
        'saas_plan_type_id': str(plan.saas_plan_type_id)
        if plan.saas_plan_type_id else None,
    })
    return state


def _walk_leaves(tree, prefix=''):
    for k, v in (tree or {}).items():
        path = f'{prefix}.{k}' if prefix else k
        if isinstance(v, bool):
            yield path, v
        elif isinstance(v, dict) and 'enabled' in v:
            yield path, bool(v.get('enabled'))
        elif isinstance(v, dict):
            yield from _walk_leaves(v, path)


def _diff_plan_states(before: dict, after: dict) -> dict:
    changes = {}
    for key in sorted(set(before) | set(after)):
        b, a = before.get(key), after.get(key)
        if b == a:
            continue
        if key == 'features':
            b_leaves = dict(_walk_leaves(b))
            a_leaves = dict(_walk_leaves(a))
            flips = sorted(
                p for p in set(b_leaves) | set(a_leaves)
                if b_leaves.get(p, False) != a_leaves.get(p, False)
            )
            changes[key] = {'changed_paths': flips}
        else:
            changes[key] = {'from': b, 'to': a}
    return changes


@platform_bp.route('/plans', methods=['GET'])
@jwt_required()
@platform_access(PermissionModule.PLAN_CATALOG, PermissionAction.VIEW)
def list_plans():
    # Vendor catalog only — apex-owned reseller plans are managed on the
    # /admin/reseller surface and must never surface (or be editable) here.
    from app.models import TenantSubscription
    plans = PlanCatalogService.list_plans(owner_tenant_id=None)
    counts = dict(
        db.session.query(
            TenantSubscription.plan_id, db.func.count(TenantSubscription.id))
        .filter(TenantSubscription.is_deleted.is_(False))
        .group_by(TenantSubscription.plan_id).all()
    )
    out = []
    for p in plans:
        row = p.to_dict()
        row['subscriber_count'] = int(counts.get(p.id, 0))
        out.append(row)
    return success_response(out)


@platform_bp.route('/plans/<code>', methods=['GET'])
@jwt_required()
@platform_access(PermissionModule.PLAN_CATALOG, PermissionAction.VIEW)
def get_plan(code):
    plan = PlanCatalogService.get_plan(code, owner_tenant_id=None)
    if not plan:
        return not_found_response('Plan')
    return success_response(plan.to_dict())


@platform_bp.route('/plans', methods=['POST'])
@jwt_required()
@platform_access(PermissionModule.PLAN_CATALOG, PermissionAction.CREATE)
def create_plan():
    data = request.get_json() or {}
    errors = PlanValidator.validate_create(data)
    if errors:
        return validation_error_response(errors)
    try:
        # This is the ONLY surface that may author kind='apex'.
        plan = PlanCatalogService.create_plan(
            data, owner_tenant_id=None, kind=data.get('kind', 'normal'),
            created_by_id=current_user.id,
        )
    except PlanCodeExists:
        return error_response(
            f'Plan with code "{data["code"]}" already exists',
            status_code=409,
        )
    except InvalidPlanType:
        return error_response("Invalid plan type", status_code=400)
    from app.models import record_plan_action
    record_plan_action(current_user.id, plan, 'create',
                       {'summary': {'name': plan.name,
                                    'status': plan.status.value,
                                    'kind': plan.kind}})
    db.session.commit()
    return created_response(plan.to_dict(), message='Plan created')


@platform_bp.route('/plans/<code>', methods=['PUT'])
@jwt_required()
@platform_access(PermissionModule.PLAN_CATALOG, PermissionAction.EDIT)
def update_plan(code):
    plan = PlanCatalogService.get_plan(code, owner_tenant_id=None)
    if not plan:
        return not_found_response('Plan')
    data = request.get_json() or {}
    errors = PlanValidator.validate_update(data)
    if errors:
        return validation_error_response(errors)
    before = _plan_audit_state(plan)
    try:
        PlanCatalogService.update_plan(
            plan, data, updated_by_id=current_user.id,
            allow_vendor_fields=True,  # kind + child quotas: vendor-only
        )
    except InvalidPlanType:
        return error_response("Invalid plan type", status_code=400)
    changes = _diff_plan_states(before, _plan_audit_state(plan))
    if changes:
        from app.models import record_plan_action
        record_plan_action(current_user.id, plan, 'update', changes)
        db.session.commit()
    return success_response(plan.to_dict(), message='Plan updated')


@platform_bp.route('/plans/<code>', methods=['DELETE'])
@jwt_required()
@platform_access(PermissionModule.PLAN_CATALOG, PermissionAction.DELETE)
def archive_plan(code):
    plan = PlanCatalogService.get_plan(code, owner_tenant_id=None)
    if not plan:
        return not_found_response('Plan')
    try:
        PlanCatalogService.archive_plan(plan, updated_by_id=current_user.id)
    except PlanHasActiveSubscriptions:
        return error_response(
            'Cannot archive a plan with active subscriptions. '
            'Move tenants to another plan first.',
            status_code=409,
        )
    from app.models import record_plan_action
    record_plan_action(current_user.id, plan, 'archive', None)
    db.session.commit()
    return no_content_response()


@platform_bp.route('/plans/<code>/resync-subscribers', methods=['POST'])
@jwt_required()
@platform_access(PermissionModule.PLAN_SUBSCRIPTION, PermissionAction.EDIT)
def resync_plan_subscribers(code):
    """Push the plan's CURRENT terms to every existing subscriber.

    Grandfathering means catalog edits touch new subscriptions only; this
    is the vendor's deliberate opt-in to migrate everyone already on the
    plan — each subscription's snapshot is rebuilt from the live row and
    over-limit is recomputed (a shrink can push tenants into grace).
    """
    from app.models import TenantSubscription, record_plan_action
    plan = PlanCatalogService.get_plan(code, owner_tenant_id=None)
    if not plan:
        return not_found_response('Plan')
    subs = (TenantSubscription.query
            .filter_by(plan_id=plan.id, is_deleted=False).all())
    for sub in subs:
        sub.plan_snapshot = build_plan_snapshot(plan)
        PlanService.recompute_over_limit(sub)
    record_plan_action(current_user.id, plan, 'resync_subscribers',
                       {'subscribers': len(subs)})
    db.session.commit()
    # Post-commit seller -> tenant bell for every migrated subscriber.
    from app.common.notify import notify_tenant_admins
    for sub in subs:
        notify_tenant_admins(
            str(sub.tenant_id), type='subscription_terms_updated',
            title='Plan terms updated',
            body='Your "%s" plan now follows its current features and limits.'
                 % plan.name,
            data={'kind': 'subscription',
                  'url': '/dashboard/admin/subscription/my'},
        )
    return success_response({'resynced': len(subs)},
                            message=f'{len(subs)} subscription(s) updated')



# --------------------------------------------------------------------------- #
# SAAS Plan Types
# --------------------------------------------------------------------------- #


# ── SaaS categories (industry segments: healthcare, legal, ...) ────────────
# The vendor-site dimension ABOVE plan types: each category gets its own
# pricing page (hero copy lives on the row) and owns a set of plan types.

@platform_bp.route("/saas-categories", methods=["GET"])
@jwt_required()
@platform_access(PermissionModule.PLAN_CATALOG, PermissionAction.VIEW)
def list_saas_categories():
    from app.models.plan import SaasCategory
    cats = (SaasCategory.query
            .order_by(SaasCategory.display_order.asc(),
                      SaasCategory.created_at.asc()).all())
    return success_response([c.to_dict() for c in cats])


@platform_bp.route("/saas-categories", methods=["POST"])
@jwt_required()
@platform_access(PermissionModule.PLAN_CATALOG, PermissionAction.CREATE)
def create_saas_category():
    from app.models.plan import SaasCategory

    data = request.get_json() or {}
    code = (data.get("code") or "").strip().lower()
    name = (data.get("name") or "").strip()
    if not code or not name:
        return validation_error_response({"missing": ["code", "name"]})
    if SaasCategory.query.filter_by(code=code).first():
        return error_response(f'Category "{code}" already exists.',
                              status_code=409)

    cat = SaasCategory(
        code=code, name=name,
        tagline=(data.get("tagline") or "").strip() or None,
        headline=(data.get("headline") or "").strip() or None,
        subheadline=(data.get("subheadline") or "").strip() or None,
        display_order=int(data.get("display_order") or 0),
        is_active=bool(data.get("is_active", True)),
    )
    db.session.add(cat)
    db.session.commit()
    return created_response(cat.to_dict(), message="Category created")


@platform_bp.route("/saas-categories/<uuid:category_id>", methods=["PUT"])
@jwt_required()
@platform_access(PermissionModule.PLAN_CATALOG, PermissionAction.EDIT)
def update_saas_category(category_id):
    from app.models.plan import SaasCategory

    cat = SaasCategory.query.get(category_id)
    if not cat:
        return not_found_response("Category")
    data = request.get_json() or {}

    if "code" in data:
        # Permanent once created: the code IS the pricing-page URL
        # (/pricing/<code>) that links, bookmarks, and campaigns point
        # at. Rename = every existing link 404s, so refuse instead.
        code = (data["code"] or "").strip().lower()
        if code and code != cat.code:
            return error_response(
                "The category code is permanent — it is the page URL "
                "(/pricing/%s). Create a new category instead." % cat.code,
                status_code=409, code='code_immutable')
    for field in ("name", "tagline", "headline", "subheadline"):
        if field in data:
            setattr(cat, field, (data[field] or "").strip() or None)
    if "display_order" in data:
        cat.display_order = int(data["display_order"] or 0)
    if "is_active" in data:
        if not data["is_active"] and cat.is_default:
            return error_response("The default category cannot be "
                                  "deactivated. Make another category the "
                                  "default first.", status_code=409)
        cat.is_active = bool(data["is_active"])
    if data.get("is_default"):
        # Single-default invariant (also DB-enforced by a partial unique
        # index): demote the current default in the same transaction.
        from app.models.plan import SaasCategory as _C
        _C.query.filter(_C.is_default.is_(True), _C.id != cat.id) \
            .update({"is_default": False})
        cat.is_default = True
        cat.is_active = True

    db.session.commit()
    return success_response(cat.to_dict(), message="Category updated")


@platform_bp.route("/saas-categories/<uuid:category_id>", methods=["DELETE"])
@jwt_required()
@platform_access(PermissionModule.PLAN_CATALOG, PermissionAction.DELETE)
def delete_saas_category(category_id):
    from app.models.plan import SaasCategory, SAASPlanType

    cat = SaasCategory.query.get(category_id)
    if not cat:
        return not_found_response("Category")
    if cat.is_default:
        return error_response("The default category cannot be deleted.",
                              status_code=409)
    attached = SAASPlanType.query.filter_by(category_id=cat.id).count()
    if attached:
        return error_response(
            f"{attached} plan type(s) still belong to this category. "
            "Reassign them first.", status_code=409)
    db.session.delete(cat)
    db.session.commit()
    return success_response(message="Category deleted")


@platform_bp.route("/plan-types", methods=["GET"])
@jwt_required()
@platform_access(PermissionModule.PLAN_CATALOG, PermissionAction.VIEW)
def list_plan_types():
    from app.models.plan import SAASPlanType

    plan_types = SAASPlanType.query.order_by(SAASPlanType.name.asc()).all()

    return success_response([pt.to_dict() for pt in plan_types])


@platform_bp.route("/plan-types", methods=["POST"])
@jwt_required()
@platform_access(PermissionModule.PLAN_CATALOG, PermissionAction.CREATE)
def create_plan_type():
    from app.models.plan import SAASPlanType

    data = request.get_json() or {}

    # Lowercased at birth: the public plans filter compares codes
    # case-insensitively, but normalized storage keeps new rows from
    # ever depending on that ('Cacs' vs 'cacs' cost a live pricing
    # page). Uniqueness is checked the same way for the legacy
    # uppercase rows that predate this.
    code = (data.get("code") or "").strip().lower()
    name = (data.get("name") or "").strip()
    icon_key = (data.get("icon_key") or "").strip()
    description = (data.get("description") or "").strip()
    is_receiver = data.get("is_receiver") or False

    if not code or not name:
        return validation_error_response({"missing": ["code", "name"]})

    if SAASPlanType.query.filter(
            db.func.lower(SAASPlanType.code) == code).first():
        return error_response(
            f'Plan type "{code}" already exists.',
            status_code=409,
        )

    plan_type = SAASPlanType(
        code=code, name=name, icon_key=icon_key, description=description, is_receiver=is_receiver
    )
    if data.get("category_id"):
        from app.models.plan import SaasCategory
        if not SaasCategory.query.get(data["category_id"]):
            return not_found_response("Category")
        plan_type.category_id = data["category_id"]

    db.session.add(plan_type)
    db.session.commit()

    return created_response(plan_type.to_dict(), message="Plan type created")


@platform_bp.route("/plan-types/<uuid:plan_type_id>", methods=["PUT"])
@jwt_required()
@platform_access(PermissionModule.PLAN_CATALOG, PermissionAction.EDIT)
def update_plan_type(plan_type_id):
    from app.models.plan import SAASPlanType

    plan_type = SAASPlanType.query.get(plan_type_id)
    if not plan_type:
        return not_found_response("Plan type")

    data = request.get_json() or {}

    if "code" in data:
        # Permanent once created — the pricing page selects plans by
        # this code, so a rename detaches every published plan from
        # the storefront. A case-only change is allowed (it cannot
        # break the case-insensitive lookups) so legacy uppercase
        # rows like 'Cacs' can still be tidied to 'cacs'.
        code = (data["code"] or "").strip()
        if code and code.lower() != (plan_type.code or '').lower():
            return error_response(
                "The plan type code is permanent. Create a new plan "
                "type instead.", status_code=409, code='code_immutable')
        if code:
            plan_type.code = code.lower()

    if "name" in data:
        plan_type.name = data["name"]

    if "icon_key" in data:
        plan_type.icon_key = data["icon_key"]

    if "description" in data:
        plan_type.description = data["description"]

    if "is_receiver" in data:
        plan_type.is_receiver = data["is_receiver"]

    if "category_id" in data:
        from app.models.plan import SaasCategory
        if data["category_id"] and not SaasCategory.query.get(data["category_id"]):
            return not_found_response("Category")
        plan_type.category_id = data["category_id"] or None

    db.session.commit()

    return success_response(plan_type.to_dict(), message="Plan type updated")


@platform_bp.route("/plan-types/<uuid:plan_type_id>", methods=["DELETE"])
@jwt_required()
@platform_access(PermissionModule.PLAN_CATALOG, PermissionAction.DELETE)
def delete_plan_type(plan_type_id):
    from app.models.plan import SAASPlanType, Plan

    plan_type = SAASPlanType.query.get(plan_type_id)
    if not plan_type:
        return not_found_response("Plan type")

    in_use = Plan.query.filter_by(
        saas_plan_type_id=plan_type.id,
        is_deleted=False,
    ).first()

    if in_use:
        return error_response(
            "Cannot delete a plan type that is assigned to one or more plans.",
            status_code=409,
        )

    db.session.delete(plan_type)
    db.session.commit()

    return no_content_response()


# --------------------------------------------------------------------------- #
# Addon catalog
# --------------------------------------------------------------------------- #

@platform_bp.route('/addons', methods=['GET'])
@jwt_required()
@platform_access(PermissionModule.ADDON_CATALOG, PermissionAction.VIEW)
def list_addons():
    from app.models import Addon
    addons = Addon.query.filter_by(is_deleted=False).order_by(Addon.created_at.asc()).all()
    return success_response([a.to_dict() for a in addons])


@platform_bp.route('/addons', methods=['POST'])
@jwt_required()
@platform_access(PermissionModule.ADDON_CATALOG, PermissionAction.CREATE)
def create_addon():
    from app.models import Addon
    data = request.get_json() or {}
    errors = AddonValidator.validate_create(data)
    if errors:
        return validation_error_response(errors)
    if Addon.query.filter_by(code=data['code'], is_deleted=False).first():
        return error_response(
            f'Addon with code "{data["code"]}" already exists',
            status_code=409,
        )
    addon = Addon(
        code=data['code'],
        name=data['name'],
        description=data.get('description'),
        status=AddonStatus(data.get('status', 'draft')),
        price_inr_monthly=data.get('price_inr_monthly'),
        og_price_inr_monthly=data.get('og_price_inr_monthly'),
        price_inr_annual=data.get('price_inr_annual'),
        og_price_inr_annual=data.get('og_price_inr_annual'),
        features=data.get('features') or {},
        limits=data.get('limits'),
        usage_deltas=data.get('usage_deltas'),
        prerequisites=data.get('prerequisites') or [],
        tiers=data.get('tiers'),
        created_by_id=current_user.id,
    )
    db.session.add(addon)
    db.session.commit()
    return created_response(addon.to_dict(), message='Add-on created')


@platform_bp.route('/addons/<code>', methods=['PUT'])
@jwt_required()
@platform_access(PermissionModule.ADDON_CATALOG, PermissionAction.EDIT)
def update_addon(code):
    from app.models import Addon
    addon = Addon.query.filter_by(code=code, is_deleted=False).first()
    if not addon:
        return not_found_response('Addon')
    data = request.get_json() or {}
    errors = AddonValidator.validate_update(data)
    if errors:
        return validation_error_response(errors)
    # NB: the missing comma after 'og_price_inr_monthly' used to concatenate
    # it with 'features' into one bogus field name — updates to either field
    # were silently dropped.
    for f in ('name', 'description', 'price_inr_monthly', 'price_inr_annual',
              'og_price_inr_monthly', 'og_price_inr_annual',
              'features', 'limits', 'usage_deltas', 'prerequisites', 'tiers'):
        if f in data:
            setattr(addon, f, data[f])
    if 'status' in data:
        addon.status = AddonStatus(data['status'])
    addon.updated_by_id = current_user.id
    db.session.commit()
    return success_response(addon.to_dict(), message='Add-on updated')


@platform_bp.route('/addons/<code>', methods=['DELETE'])
@jwt_required()
@platform_access(PermissionModule.ADDON_CATALOG, PermissionAction.DELETE)
def archive_addon(code):
    from app.models import Addon, TenantAddon
    addon = Addon.query.filter_by(code=code, is_deleted=False).first()
    if not addon:
        return not_found_response('Addon')
    active = TenantAddon.query.filter_by(
        addon_id=addon.id, is_deleted=False,
        status=AddonSubscriptionStatus.ACTIVE,
    ).first()
    if active:
        return error_response(
            'Cannot archive an add-on with active tenant attachments. '
            'Detach it from tenants first.',
            status_code=409,
        )
    addon.is_deleted = True
    addon.deleted_at = utcnow()
    addon.status = AddonStatus.ARCHIVED
    addon.updated_by_id = current_user.id
    db.session.commit()
    return no_content_response()


# --------------------------------------------------------------------------- #
# Per-tenant subscription
# --------------------------------------------------------------------------- #

def _period_end(start, cycle: BillingCycle):
    if cycle == BillingCycle.ANNUAL:
        return start + timedelta(days=365)
    return start + timedelta(days=30)


@platform_bp.route('/tenants/<tenant_id>/subscription', methods=['GET'])
@jwt_required()
@platform_access(PermissionModule.PLAN_SUBSCRIPTION, PermissionAction.VIEW)
def get_tenant_subscription(tenant_id):
    from app.models import TenantSubscription
    with with_tenant_context(tenant_id):
        sub = TenantSubscription.query.filter_by(
            tenant_id=tenant_id, is_deleted=False,
        ).first()
    if not sub:
        return not_found_response('Subscription')
    return success_response(sub.to_dict())


@platform_bp.route('/tenants/<tenant_id>/entitlements', methods=['GET'])
@jwt_required()
@platform_access(PermissionModule.PLAN_SUBSCRIPTION, PermissionAction.VIEW)
def get_tenant_entitlements(tenant_id):
    """What the tenant ACTUALLY resolves to right now — the seller-side
    twin of the tenant's own ``/pricing/me?debug=1``.

    Grandfathering makes the live plan row an unreliable answer to
    "what did they buy": resolution reads the subscription snapshot,
    then add-ons, then manual overrides, so this is the vendor's only
    truthful per-tenant view. ``is_apex`` rides along because apex-ness
    is itself a plan entitlement, not a tenant flag.
    """
    import uuid as _uuid

    from app.models import Tenant

    try:
        _uuid.UUID(str(tenant_id))
    except (ValueError, AttributeError):
        return not_found_response('Tenant')
    tenant = Tenant.query.filter_by(id=tenant_id, is_deleted=False).first()
    if tenant is None or tenant.is_platform:
        return not_found_response('Tenant')
    try:
        resolved = PlanService.resolve(str(tenant_id))
    except NoActiveSubscription:
        return error_response(
            'Tenant has no active subscription',
            code='no_active_subscription', status_code=404,
        )
    data = resolved.to_dict(include_debug=True)
    data['counts'] = PlanService.current_counts(str(tenant_id))
    data['is_apex'] = ResellerPolicy.is_apex(str(tenant_id))
    return success_response(data)


@platform_bp.route('/tenants/<tenant_id>/subscription', methods=['POST'])
@jwt_required()
@platform_access(PermissionModule.PLAN_SUBSCRIPTION, PermissionAction.EDIT)
def assign_tenant_subscription(tenant_id):
    """Assign (or replace) a tenant's plan."""
    from app.models import Plan, Tenant, TenantSubscription
    from app.models._enums import PlanKind
    data = request.get_json() or {}
    errors = SubscriptionValidator.validate_assign(data)
    if errors:
        return validation_error_response(errors)

    tenant = Tenant.query.filter_by(id=tenant_id, is_deleted=False).first()
    if not tenant:
        return not_found_response('Tenant')

    # I1: a subscription's plan owner always equals the tenant's parent —
    # vendor plans (owner NULL) for top-level tenants, the apex's own
    # plans for its children. The scoped lookup makes any I1 violation a
    # plain 404 (a vendor plan simply doesn't exist in a child's catalog).
    plan = Plan.query.filter_by(
        code=data['plan_code'], is_deleted=False,
        owner_tenant_id=tenant.parent_tenant_id,
    ).first()
    if not plan:
        return not_found_response('Plan')

    # I2 backstop (unreachable via the scoped lookup — apex plans have
    # owner NULL which never matches a parented tenant — but cheap and
    # explicit): a sub-tenant can never hold an apex subscription.
    if plan.kind == PlanKind.APEX and tenant.parent_tenant_id is not None:
        return error_response(
            'Apex plans cannot be assigned to a sub-tenant.',
            status_code=409, code='apex_plan_not_for_subtenant',
        )

    cycle = BillingCycle(data.get('billing_cycle', 'monthly'))

    with with_tenant_context(tenant_id):
        existing = TenantSubscription.query.filter_by(
            tenant_id=tenant_id, is_deleted=False,
        ).first()
        now = utcnow()
        if existing:
            existing.plan_id = plan.id
            # Explicit (re)assignment is the ONE moment the snapshot
            # refreshes — this doubles as the vendor's migrate-to-current-
            # terms action for a tenant.
            existing.plan_snapshot = build_plan_snapshot(plan)
            existing.billing_cycle = cycle
            existing.overrides = data.get('overrides')
            existing.current_period_start = now
            existing.current_period_end = _period_end(now, cycle)
            existing.status = SubscriptionStatus.ACTIVE
            existing.over_limit_since = None
            existing.suspend_after = None
            existing.data_purge_after = None
            existing.cancelled_at = None
            existing.updated_by_id = current_user.id
            subscription = existing
        else:
            subscription = TenantSubscription(
                tenant_id=tenant_id,
                plan_id=plan.id,
                plan_snapshot=build_plan_snapshot(plan),
                status=SubscriptionStatus.TRIAL if plan.trial_days > 0 else SubscriptionStatus.ACTIVE,
                billing_cycle=cycle,
                trial_ends_at=(now + timedelta(days=plan.trial_days)) if plan.trial_days > 0 else None,
                current_period_start=now,
                current_period_end=_period_end(now, cycle),
                overrides=data.get('overrides'),
                activated_by_id=current_user.id,
                created_by_id=current_user.id,
            )
            db.session.add(subscription)
        db.session.flush()
        # Recompute over-limit against new plan (downgrade drill).
        PlanService.recompute_over_limit(subscription)
        db.session.commit()

        # ── Auto-attach the plan's default add-ons (Plan B / Plan C bundles).
        # Topologically order by prerequisite chain so each attach passes
        # the prereq check.
        default_codes = list(plan.default_addons or [])
        if default_codes:
            _auto_attach_default_addons(tenant_id, default_codes, cycle, now)

    # Seller -> tenant bell: the tenant's admins learn their plan changed
    # without needing email. Post-commit, best-effort.
    from app.common.notify import notify_tenant_admins
    notify_tenant_admins(
        str(tenant_id), type='subscription_changed',
        title='Your subscription plan changed',
        body='Your workspace is now on the "%s" plan.' % plan.name,
        data={'kind': 'subscription', 'url': '/dashboard/admin/subscription/my'},
    )
    return success_response(subscription.to_dict(), message='Subscription assigned')


def _auto_attach_default_addons(tenant_id, addon_codes, cycle, now):
    """Attach a list of add-ons in dependency order. Already-attached ones
    are skipped silently. Failures on a single add-on are logged but don't
    abort the whole assign — operator can manually retry.
    """
    from app.models import Addon, TenantAddon
    import logging
    log = logging.getLogger(__name__)

    addons_by_code = {
        a.code: a for a in
        Addon.query.filter(
            Addon.code.in_(addon_codes), Addon.is_deleted == False,  # noqa: E712
            Addon.status == AddonStatus.ACTIVE,
        ).all()
    }

    # Topological sort by prerequisites — prereqs first.
    ordered = []
    seen = set()

    def visit(code, stack):
        if code in seen or code not in addons_by_code:
            return
        if code in stack:
            log.warning('default_addons cycle detected at %s — skipping', code)
            return
        stack.add(code)
        for pre in (addons_by_code[code].prerequisites or []):
            visit(pre, stack)
        stack.discard(code)
        seen.add(code)
        ordered.append(code)

    for code in addon_codes:
        visit(code, set())

    for code in ordered:
        addon = addons_by_code.get(code)
        if not addon:
            continue
        existing = TenantAddon.query.filter_by(
            tenant_id=tenant_id, addon_id=addon.id, is_deleted=False,
        ).first()
        if existing and existing.status == AddonSubscriptionStatus.ACTIVE:
            continue
        try:
            assert_prerequisites_active(tenant_id, addon)
        except AddonPrerequisiteMissing as e:
            log.warning(
                'default_addons skip %s on %s — prereqs missing: %s',
                code, tenant_id, e.missing,
            )
            continue
        if existing:
            existing.status = AddonSubscriptionStatus.ACTIVE
            existing.billing_cycle = cycle
            existing.activated_at = now
            existing.current_period_start = now
            existing.current_period_end = _period_end(now, cycle)
            existing.cancelled_at = None
            existing.updated_by_id = current_user.id if current_user else None
        else:
            db.session.add(TenantAddon(
                tenant_id=tenant_id,
                addon_id=addon.id,
                status=AddonSubscriptionStatus.ACTIVE,
                billing_cycle=cycle,
                activated_at=now,
                current_period_start=now,
                current_period_end=_period_end(now, cycle),
                activated_by_id=current_user.id if current_user else None,
                created_by_id=current_user.id if current_user else None,
            ))
    db.session.commit()


@platform_bp.route('/tenants/<tenant_id>/subscription', methods=['PUT'])
@jwt_required()
@platform_access(PermissionModule.PLAN_SUBSCRIPTION, PermissionAction.EDIT)
def update_tenant_subscription(tenant_id):
    """Update billing cycle / overrides on an existing subscription."""
    from app.models import TenantSubscription
    data = request.get_json() or {}
    if 'overrides' in data:
        override_errors = PlanOverrideValidator.validate(data.get('overrides'))
        if override_errors:
            return validation_error_response({'overrides': override_errors})
    from app.api.pricing.subscription_billing import PERIOD_DAYS
    if 'billing_cycle' in data and data['billing_cycle'] not in PERIOD_DAYS:
        return validation_error_response({'billing_cycle': 'Must be monthly or annual.'})

    with with_tenant_context(tenant_id):
        subscription = TenantSubscription.query.filter_by(
            tenant_id=tenant_id, is_deleted=False,
        ).first()
        if not subscription:
            return not_found_response('Subscription')
        if 'billing_cycle' in data:
            subscription.billing_cycle = BillingCycle(data['billing_cycle'])
        if 'overrides' in data:
            subscription.overrides = data['overrides']
        subscription.updated_by_id = current_user.id
        db.session.flush()
        PlanService.recompute_over_limit(subscription)
        db.session.commit()
    return success_response(subscription.to_dict(), message='Subscription updated')


# --------------------------------------------------------------------------- #
# Subscription lifecycle — the vendor's manual controls
# --------------------------------------------------------------------------- #
# The dunning sweep drives the AUTOMATIC path (trial -> past due ->
# suspended -> archive). These are the operator's deliberate overrides,
# mirroring what the membership console already offers its admins.
#
# One safety rule runs through all of them: a MANUAL suspension never
# arms the data-purge clock. Only a dunning suspension (recorded via the
# 'suspended' billing notice) marches a tenant toward deletion, so an
# operator clicking Suspend can never start a countdown to erasing a
# customer's data.
# --------------------------------------------------------------------------- #

def _sub_for(tenant_id):
    from app.models import TenantSubscription
    return TenantSubscription.query.filter_by(
        tenant_id=tenant_id, is_deleted=False).first()


@platform_bp.route('/tenants/<tenant_id>/subscription/extend-trial',
                   methods=['POST'])
@jwt_required()
@platform_access(PermissionModule.PLAN_SUBSCRIPTION, PermissionAction.EDIT)
def extend_tenant_trial(tenant_id):
    """Extend (or restart) the tenant's free trial by ``days``, putting
    the subscription back on TRIAL and lifting any holding page."""
    from datetime import timedelta
    from app.models._base import utcnow
    from app.models._enums import SubscriptionStatus

    body = request.get_json(silent=True) or {}
    try:
        days = int(body.get('days', 0))
    except (TypeError, ValueError):
        days = 0
    if days <= 0 or days > 365:
        return error_response('days must be between 1 and 365.',
                              status_code=400)

    with with_tenant_context(tenant_id):
        sub = _sub_for(tenant_id)
        if not sub:
            return not_found_response('Subscription')
        now = utcnow()
        base = sub.trial_ends_at if (
            sub.trial_ends_at and sub.trial_ends_at > now) else now
        sub.trial_ends_at = base + timedelta(days=days)
        sub.status = SubscriptionStatus.TRIAL
        # Coming back from a lapse: clear both countdowns.
        sub.suspend_after = None
        sub.data_purge_after = None
        sub.updated_by_id = current_user.id
        db.session.commit()
        payload = sub.to_dict()
    return success_response(payload,
                            message=f'Trial extended by {days} day(s).')


@platform_bp.route('/tenants/<tenant_id>/subscription/activate',
                   methods=['POST'])
@jwt_required()
@platform_access(PermissionModule.PLAN_SUBSCRIPTION, PermissionAction.EDIT)
def activate_tenant_subscription(tenant_id):
    """Mark the subscription PAID for one period without a gateway
    round-trip — the vendor granting access (offline payment, comped
    account, converting a trial early). Body: ``{period}`` (defaults to
    the subscription's own billing cycle)."""
    from app.api.pricing import subscription_billing as sbill

    body = request.get_json(silent=True) or {}
    with with_tenant_context(tenant_id):
        sub = _sub_for(tenant_id)
        if not sub:
            return not_found_response('Subscription')
        period = body.get('period') or (
            sub.billing_cycle.value if sub.billing_cycle else 'monthly')
        if period not in sbill.PERIOD_DAYS:
            return error_response(
                'period must be one of %s' % sorted(sbill.PERIOD_DAYS),
                status_code=400)
        try:
            sbill.apply_paid_period(sub, period, actor_user_id=current_user.id)
        except sbill.SubscriptionBillingError as e:
            return error_response(str(e), status_code=400)
        db.session.commit()
        payload = sub.to_dict()
    return success_response(
        payload, message=f'Marked paid for one {period} period.')


@platform_bp.route('/tenants/<tenant_id>/subscription/suspend',
                   methods=['POST'])
@jwt_required()
@platform_access(PermissionModule.PLAN_SUBSCRIPTION, PermissionAction.EDIT)
def suspend_tenant_subscription(tenant_id):
    """Suspend billing by hand: the tenant sees the sign-in-and-pay
    holding page and add-ons go on hold. Deliberately does NOT arm the
    data-purge clock — see the note above."""
    from app.api.pricing.subscription_billing import _hold_addons
    from app.models._enums import SubscriptionStatus

    with with_tenant_context(tenant_id):
        sub = _sub_for(tenant_id)
        if not sub:
            return not_found_response('Subscription')
        sub.status = SubscriptionStatus.SUSPENDED
        sub.suspend_after = None
        sub.data_purge_after = None      # manual != scheduled deletion
        _hold_addons(tenant_id)
        sub.updated_by_id = current_user.id
        db.session.commit()
        payload = sub.to_dict()
    return success_response(
        payload, message='Subscription suspended. Data is untouched.')


@platform_bp.route('/tenants/<tenant_id>/subscription/restore',
                   methods=['POST'])
@jwt_required()
@platform_access(PermissionModule.PLAN_SUBSCRIPTION, PermissionAction.EDIT)
def restore_tenant_subscription(tenant_id):
    """Lift a suspension without taking payment: back to TRIAL when the
    trial still runs, else ACTIVE. Add-ons whose own paid window still
    runs come back; lapsed ones stay collapsed."""
    from app.api.pricing.subscription_billing import revive_or_collapse_addons
    from app.models._base import utcnow
    from app.models._enums import SubscriptionStatus

    with with_tenant_context(tenant_id):
        sub = _sub_for(tenant_id)
        if not sub:
            return not_found_response('Subscription')
        now = utcnow()
        trial_end = sub.trial_ends_at
        if trial_end is not None and trial_end.tzinfo is None:
            from datetime import timezone as _tz
            trial_end = trial_end.replace(tzinfo=_tz.utc)
        sub.status = (SubscriptionStatus.TRIAL
                      if trial_end and trial_end > now
                      else SubscriptionStatus.ACTIVE)
        sub.suspend_after = None
        sub.data_purge_after = None
        revived, collapsed = revive_or_collapse_addons(tenant_id, now=now)
        sub.updated_by_id = current_user.id
        db.session.commit()
        payload = sub.to_dict()
    return success_response(
        payload,
        message=('Subscription restored (%d add-on(s) revived, %d collapsed).'
                 % (revived, collapsed)))


# --------------------------------------------------------------------------- #
# Cross-tenant subscription roster
# --------------------------------------------------------------------------- #
# The per-tenant routes above answer "what is tenant X on?". This one
# answers the inverse — "who is on plan type Y?" — so the platform owner
# can work a whole plan type at once instead of drilling into each tenant
# from the Tenants list. Read-only: the change-plan action on the roster
# page reuses ``assign_tenant_subscription`` above, so there is exactly one
# code path that moves a tenant between plans (and one place that knows to
# re-attach default add-ons + recompute over-limit).
# --------------------------------------------------------------------------- #

@platform_bp.route('/subscriptions', methods=['GET'])
@jwt_required()
@platform_access(PermissionModule.PLAN_SUBSCRIPTION, PermissionAction.VIEW)
def list_all_tenant_subscriptions():
    """Every tenant's SaaS subscription, optionally filtered by plan type.

    Query params:
      * ``plan_type`` — a ``saas_plan_types`` id OR code. Omit for all.
      * ``status``    — ``trial|active|past_due|cancelled|suspended|over_limit``.

    ``tenant_subscriptions`` is RLS-scoped, so there is no single query
    that spans tenants — we flip the session tenant per row via
    ``with_tenant_context``. That's O(tenants) round-trips, which is fine
    at the current scale (tens of tenants) and mirrors the same trade-off
    already accepted in ``_provider_display_name``. If the tenant count
    ever reaches the hundreds this should move to a single query issued
    as the RLS-bypassing owner role instead.
    """
    from app.api.platform.service import PlatformTenantService
    from app.models import TenantSubscription

    plan_type_raw = (request.args.get('plan_type') or '').strip()
    status_raw = (request.args.get('status') or '').strip().lower()

    status = None
    if status_raw:
        try:
            status = SubscriptionStatus(status_raw)
        except ValueError:
            return error_response(
                f'Unknown status "{status_raw}".', status_code=400,
            )

    rows = []
    for tenant in PlatformTenantService.list_tenants():
        with with_tenant_context(tenant.id):
            sub = TenantSubscription.query.filter_by(
                tenant_id=tenant.id, is_deleted=False,
            ).first()
        if sub is None:
            continue
        if status is not None and sub.status != status:
            continue

        plan = sub.plan
        plan_type = plan.saas_plan_type if plan else None
        # Match on either the id or the human code so the caller can pass
        # whichever it happens to hold (the UI tabs carry the id).
        if plan_type_raw:
            if plan_type is None:
                continue
            if plan_type_raw not in (str(plan_type.id), plan_type.code):
                continue

        rows.append({
            **sub.to_dict(),
            'tenant_name': tenant.name,
            'tenant_slug': tenant.slug,
            'tenant_is_default': tenant.is_default,
            'plan_name': plan.name if plan else None,
            'plan_type': plan_type.to_dict() if plan_type else None,
        })

    return success_response(data={'subscriptions': rows})


# --------------------------------------------------------------------------- #
# Per-tenant add-ons
# --------------------------------------------------------------------------- #

@platform_bp.route('/tenants/<tenant_id>/addons', methods=['GET'])
@jwt_required()
@platform_access(PermissionModule.PLAN_SUBSCRIPTION, PermissionAction.VIEW)
def list_tenant_addons(tenant_id):
    from app.models import TenantAddon
    with with_tenant_context(tenant_id):
        rows = (
            TenantAddon.query.filter_by(tenant_id=tenant_id, is_deleted=False)
            .order_by(TenantAddon.activated_at.asc())
            .all()
        )
    return success_response([r.to_dict() for r in rows])


@platform_bp.route('/tenants/<tenant_id>/addons', methods=['POST'])
@jwt_required()
@platform_access(PermissionModule.PLAN_SUBSCRIPTION, PermissionAction.EDIT)
def attach_tenant_addon(tenant_id):
    from app.models import Addon, TenantAddon, TenantSubscription
    data = request.get_json() or {}
    code = data.get('addon_code')
    if not code:
        return validation_error_response({'missing': ['addon_code']})
    addon = Addon.query.filter_by(code=code, is_deleted=False).first()
    if not addon:
        return not_found_response('Addon')
    cycle_raw = data.get('billing_cycle', 'monthly')
    from app.api.pricing.subscription_billing import PERIOD_DAYS
    if cycle_raw not in PERIOD_DAYS:
        return validation_error_response(
            {'billing_cycle': 'Must be one of %s.' % sorted(PERIOD_DAYS)})
    cycle = BillingCycle(cycle_raw)
    try:
        quantity = max(int(data.get('quantity', 1)), 1)
    except (TypeError, ValueError):
        return validation_error_response({'quantity': 'Must be a number.'})
    now = utcnow()

    with with_tenant_context(tenant_id):
        # Must have an active subscription first — add-ons layer on top.
        sub = TenantSubscription.query.filter_by(
            tenant_id=tenant_id, is_deleted=False,
        ).first()
        if not sub:
            return error_response(
                'Tenant has no active subscription to attach an add-on to',
                code='no_active_subscription',
                status_code=409,
            )
        # Topological prereq check — every code in addon.prerequisites
        # must already be ACTIVE on this tenant.
        try:
            assert_prerequisites_active(tenant_id, addon)
        except AddonPrerequisiteMissing as e:
            return error_response(
                str(e), code='prerequisite_missing', status_code=409,
                data={'missing': e.missing},
            )
        existing = TenantAddon.query.filter_by(
            tenant_id=tenant_id, addon_id=addon.id, is_deleted=False,
        ).first()
        if existing and existing.status == AddonSubscriptionStatus.ACTIVE:
            return error_response(
                f'Add-on "{code}" already attached', status_code=409,
            )
        if existing:
            existing.status = AddonSubscriptionStatus.ACTIVE
            existing.billing_cycle = cycle
            existing.quantity = quantity
            existing.activated_at = now
            existing.current_period_start = now
            existing.current_period_end = _period_end(now, cycle)
            existing.cancelled_at = None
            existing.updated_by_id = current_user.id
            row = existing
        else:
            row = TenantAddon(
                tenant_id=tenant_id,
                addon_id=addon.id,
                quantity=quantity,
                status=AddonSubscriptionStatus.ACTIVE,
                billing_cycle=cycle,
                activated_at=now,
                current_period_start=now,
                current_period_end=_period_end(now, cycle),
                activated_by_id=current_user.id,
                created_by_id=current_user.id,
            )
            db.session.add(row)
        db.session.commit()
    return created_response(row.to_dict(), message='Add-on attached')


@platform_bp.route('/tenants/<tenant_id>/addons/<code>', methods=['DELETE'])
@jwt_required()
@platform_access(PermissionModule.PLAN_SUBSCRIPTION, PermissionAction.EDIT)
def detach_tenant_addon(tenant_id, code):
    from app.models import Addon, TenantAddon
    addon = Addon.query.filter_by(code=code, is_deleted=False).first()
    if not addon:
        return not_found_response('Addon')
    with with_tenant_context(tenant_id):
        row = TenantAddon.query.filter_by(
            tenant_id=tenant_id, addon_id=addon.id, is_deleted=False,
        ).first()
        if not row:
            return not_found_response('TenantAddon')
        row.status = AddonSubscriptionStatus.CANCELLED
        row.cancelled_at = utcnow()
        row.is_deleted = True
        row.deleted_at = utcnow()
        row.updated_by_id = current_user.id
        db.session.commit()
    return no_content_response()
