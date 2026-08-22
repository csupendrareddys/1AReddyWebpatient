"""Public pricing + self-serve signup routes.

Every handler here runs with NO authentication. Scope is deliberately
narrow — catalog read + one-shot signup. Anything richer should move
behind ``@jwt_required`` into ``/api/pricing/*`` or ``/api/platform/*``.
"""
from __future__ import annotations

from datetime import timedelta
from flask import g, request

from app.api.public import public_bp
from app.api.public.service import (
    PlanNotAvailable, SlugUnavailable, TenantSelfServeService,
)
from app.api.public.validators import TenantSignupValidator
from app.common.responses import (
    created_response, error_response, not_found_response, success_response,
    validation_error_response,
)
from app.extensions import db, limiter


## DIFFERENT THAN INTERNAL /platform/pricing in many ways but also have doesnt expands the pricing dict.
def _public_plan_payload(plan):
    """Trimmed plan dict for anonymous callers. Strips internal knobs that
    tenants don't need to see on the marketing landing page."""
    return {
        'code': plan.code,
        'name': plan.name,
        'description': plan.description,
        'is_default': plan.is_default,
        'pricing': plan.pricing,

        'trial_days': plan.trial_days,
        'user_limits': {
            'total': plan.max_total_users,
            'per_role': {
                'super_admin': plan.max_super_admins,
                'sub_admin': plan.max_sub_admins,
                'provider': plan.max_providers,
            },
        },
        'provider_entity_limits': {
            'doctor': plan.max_provider_doctors,
            'clinic': plan.max_provider_clinics,
            'hospital': plan.max_provider_hospitals,
        },
        'features': plan.features,
        'benefits': plan.benefits or [],
        'card_display': plan.card_display,
        'usage_limits': plan.usage_limits or {},
        'default_addons': plan.default_addons or [],
        'plan_type': {
                    'code': plan.saas_plan_type.code,
                    'name': plan.saas_plan_type.name,
                } if plan.saas_plan_type else None,
    }


def _public_plan_type_payload(pt) -> dict:
    return {
        'id': str(pt.id),
        'code': pt.code,
        'name': pt.name,
        'icon_key': pt.icon_key,
        'description': pt.description,
        'is_receiver': pt.is_receiver,
        'category_code': pt.category.code if pt.category else None,
    }


def _public_addon_payload(addon):
    """Public-safe view of an Addon — same trim philosophy as plans."""
    return {
        'code': addon.code,
        'name': addon.name,
        'description': addon.description,
        'price_inr_monthly': (
            float(addon.price_inr_monthly) if addon.price_inr_monthly is not None else None
        ),
        'og_price_inr_monthly': float(addon.og_price_inr_monthly) if addon.og_price_inr_monthly is not None else None,
        'price_inr_annual': (
            float(addon.price_inr_annual) if addon.price_inr_annual is not None else None
        ),
        'og_price_inr_annual': (
            float(addon.og_price_inr_annual)
            if addon.og_price_inr_annual is not None else None
        ),
        'features': addon.features or {},
        'limits': addon.limits,
        'usage_deltas': addon.usage_deltas,
        'prerequisites': addon.prerequisites or [],
        # The buyer-facing terms for a self-purchase. None when the
        # add-on has tier terms and 'main' is switched off — the shop
        # must then hide it.
        'main_tier': addon.effective_tier('main'),
    }


def _selling_host_tenant():
    """The non-platform tenant whose site this request hit, or None.

    None means the VENDOR surface: the platform host, the default
    fallback, or an unresolvable host. Every public selling endpoint
    (plans, plan-types, selling-status, signup) resolves the host
    through this one helper — the pricing page and the signup POST must
    read the SAME catalog, or the site would advertise plans it cannot
    sell.
    """
    from app.models import Tenant

    host_tenant_id = getattr(g, 'tenant_id', None)
    if not host_tenant_id or getattr(g, 'tenant_source', None) == 'default_fallback':
        return None
    host_tenant = Tenant.query.filter_by(
        id=host_tenant_id, is_deleted=False).first()
    if host_tenant is None or host_tenant.is_platform:
        return None
    return host_tenant


# --------------------------------------------------------------------------- #
# GET /api/public/plans
# --------------------------------------------------------------------------- #

@public_bp.route('/plans', methods=['GET'])
@limiter.limit('60 per minute')
def list_public_plans():
    """ACTIVE plans only. Cached 60s upstream so landing-page load is cheap.

    Serves the HOST OWNER's catalog: on the vendor host (platform row /
    default fallback) that's the vendor catalog (``owner IS NULL``);
    on an apex reseller's host it is THEIR catalog (the P3 selling
    surface). Any other tenant host gets an empty catalog — those sites
    don't sell the SaaS, and the SPA hides pricing there anyway.
    """
    from app.models.plan import Plan, PlanStatus, SAASPlanType

    plan_type = (request.args.get('plan_type') or '').strip().lower()

    host_tenant = _selling_host_tenant()
    owner_id = host_tenant.id if host_tenant is not None else None

    query = Plan.query.filter_by(status=PlanStatus.ACTIVE, is_deleted=False,
                                 owner_tenant_id=owner_id)
    if plan_type:
        # Case-insensitive: the param arrives lowercased, but legacy
        # plan-type rows were created before codes were normalized
        # ('Hospital', 'Cacs') — an exact compare silently empties the
        # whole pricing page for them.
        query = (
            query.join(Plan.saas_plan_type)
            .filter(db.func.lower(SAASPlanType.code) == plan_type)
        )
        plans = query.all()
        return success_response(data=[_public_plan_payload(p) for p in plans])

    return error_response(message="Plan type is required")


@public_bp.route('/saas-categories', methods=['GET'])
@limiter.limit('60 per minute')
def list_public_saas_categories():
    """Active industry segments for the vendor pricing site, in display
    order — each carries its page's hero copy. The pricing page renders
    the ``is_default`` one at /pricing and the rest at /pricing/<code>."""
    from app.models.plan import SaasCategory
    cats = (SaasCategory.query.filter_by(is_active=True)
            .order_by(SaasCategory.display_order.asc(),
                      SaasCategory.created_at.asc())
            .all())
    return success_response(data=[c.to_dict() for c in cats])


@public_bp.route('/plan-types', methods=['GET'])
@limiter.limit('60 per minute')
def list_public_plan_types():
    """Plan types for the pricing page. ``?category=<code>`` scopes to one
    industry segment; rows with no category belong to the default one.

    On a NON-vendor host the list is narrowed to types the host's OWN
    catalog actually sells (>=1 ACTIVE owned plan) — an apex reseller's
    pricing page shouldn't render persona tabs for the vendor's whole
    taxonomy when its catalog covers one vertical.
    """
    from app.models.plan import Plan, PlanStatus, SAASPlanType, SaasCategory
    category = (request.args.get('category') or '').strip().lower()
    query = SAASPlanType.query
    host_tenant = _selling_host_tenant()
    if host_tenant is not None:
        query = (
            query.join(Plan, Plan.saas_plan_type_id == SAASPlanType.id)
            .filter(Plan.owner_tenant_id == host_tenant.id,
                    Plan.status == PlanStatus.ACTIVE,
                    Plan.is_deleted == False)  # noqa: E712
            .distinct()
        )
    if category:
        # Same case-insensitivity rationale as list_public_plans.
        cat = SaasCategory.query.filter(
            db.func.lower(SaasCategory.code) == category).first()
        if cat is None:
            return success_response(data=[])
        if cat.is_default:
            # Legacy NULL-category rows read as the default category.
            query = query.filter(db.or_(
                SAASPlanType.category_id == cat.id,
                SAASPlanType.category_id.is_(None)))
        else:
            query = query.filter(SAASPlanType.category_id == cat.id)
    plan_types = query.all()
    return success_response(data=[_public_plan_type_payload(pt) for pt in plan_types])


@public_bp.route('/selling-status', methods=['GET'])
@limiter.limit('60 per minute')
def public_selling_status():
    """Does THIS host sell SaaS tenancies? Anonymous by design — the
    SPA's route guards and nav need the answer before anyone logs in.

    ``seller`` is 'vendor' on the platform surface, 'reseller' on an
    apex tenant's site, null elsewhere (ordinary tenants and resellers'
    children don't sell). Apex-ness is the same live plan entitlement
    the reseller console checks — a lapsed apex subscription silently
    closes the storefront.
    """
    host_tenant = _selling_host_tenant()
    if host_tenant is None:
        return success_response(data={'sells_tenancies': True,
                                      'seller': 'vendor'})
    from app.api.pricing.service import ResellerPolicy
    if ResellerPolicy.is_apex(str(host_tenant.id)):
        # ``show_pricing_nav`` is a LABEL knob for the apex's own site:
        # off hides the "SaaS Pricing" nav entry, but the storefront
        # routes stay reachable and child tenants are unaffected.
        # Default True so existing apexes keep their nav untouched.
        settings = host_tenant.settings or {}
        return success_response(data={
            'sells_tenancies': True,
            'seller': 'reseller',
            'show_pricing_nav': bool(
                settings.get('storefront_pricing_nav', True)),
        })
    return success_response(data={'sells_tenancies': False, 'seller': None})


@public_bp.route('/tenant-standing', methods=['GET'])
@limiter.limit('60 per minute')
def tenant_standing():
    """Is this host's tenant open for business? Powers the holding page.

    Anonymous by design — the SPA must know before anyone logs in.
    ``ok`` for the vendor surface and healthy tenants; ``suspended``
    (unpaid past the payment grace — sign in and pay) and ``inactive``
    (the seller switched the tenant off — contact them) swap the whole
    site for the holding page. ``seller`` names who to contact: the
    parent apex for a child tenant, the platform vendor otherwise.
    """
    from app.models import Tenant, TenantSubscription
    from app.models._enums import SubscriptionStatus

    tenant_id = getattr(g, 'tenant_id', None)
    if not tenant_id:
        return success_response({'standing': 'ok'})
    tenant = Tenant.query.filter_by(id=tenant_id, is_deleted=False).first()
    if tenant is None or tenant.is_platform:
        return success_response({'standing': 'ok'})

    seller = None
    if tenant.parent_tenant_id:
        seller = Tenant.query.filter_by(id=tenant.parent_tenant_id).first()
    if seller is None:
        seller = Tenant.query.filter_by(is_platform=True).first()
    seller_info = {'name': seller.name if seller else 'your provider'}

    status_val = str(
        tenant.status.value if hasattr(tenant.status, 'value')
        else (tenant.status or 'active')).lower()
    if status_val == 'suspended':
        # Seller-suspended tenant: same pay-to-continue flow as a
        # billing suspension.
        return success_response({
            'standing': 'suspended', 'seller': seller_info,
        })
    if status_val != 'active':
        return success_response({
            'standing': 'inactive', 'seller': seller_info,
        })

    sub = TenantSubscription.query.filter_by(
        tenant_id=tenant.id, is_deleted=False).first()
    if sub is not None and sub.status == SubscriptionStatus.SUSPENDED:
        return success_response({
            'standing': 'suspended',
            'seller': seller_info,
            'data_purge_after': (sub.data_purge_after.isoformat()
                                 if sub.data_purge_after else None),
        })
    return success_response({'standing': 'ok'})


@public_bp.route('/addons', methods=['GET'])
@limiter.limit('60 per minute')
def list_public_addons():
    """Full add-on catalog so the landing page can render plan compositions."""
    from app.models import Addon, AddonStatus
    addons = (
        Addon.query.filter_by(status=AddonStatus.ACTIVE, is_deleted=False)
        .order_by(Addon.created_at.asc())
        .all()
    )
    return success_response(data=[_public_addon_payload(a) for a in addons])


# --------------------------------------------------------------------------- #
# GET /api/public/membership-plans — marketplace (apex) catalog
# --------------------------------------------------------------------------- #
# Distinct from ``/plans`` above: those are SaaS tenant subscriptions
# (clinic buys a subdomain); membership-plans are marketplace tiers
# that doctors / clinics / hospitals subscribe to on the apex itself.
# --------------------------------------------------------------------------- #

def _public_membership_plan_payload(plan):
    """Slim public view of a ``MembershipPlan``. Internal-only fields
    (``commission_pct``, ``platform_fee_inr``) are stripped — those are
    operator knobs, not customer-facing copy."""
    if plan.is_legacy is True:
        return {}
    return {
        'id': str(plan.id),
        'code': plan.code,
        'name': plan.name,
        'description': plan.description,
        'tier': plan.tier.value,
        'pricing': plan.pricing,
        'trial_days': plan.trial_days,
        # Customer-facing, unlike the commission/fee knobs above: it's the
        # headline benefit the card advertises ("20% off every booking").
        'member_discount_pct': float(plan.member_discount_pct or 0),
        'is_featured': plan.is_featured,
        # Customer-facing for the same reason ``member_discount_pct`` is: how
        # many staff and affiliations a tier includes is what somebody is
        # choosing between, not an operator knob. Same nested shape as
        # ``MembershipPlan.to_dict`` so one frontend helper renders both.
        'limits': {
            'support_staff': plan.max_support_staff,
            'my_links': plan.max_link_connections,
        },
        'features': plan.features or {},
        'sort_order': plan.sort_order,
        'vertical_plan_type': {
                    'code': plan.vertical_plan_type.code,
                    'name': plan.vertical_plan_type.name,
        } if plan.vertical_plan_type else None,

        'benefits': plan.benefits or [],
    }


def _public_vertical_plan_type_payload(pt) -> dict:
    return {
        'id': str(pt.id),
        'code': pt.code,
        'name': pt.name,
        'icon_key': pt.icon_key,
        'description': pt.description,
        'is_receiver': pt.is_receiver,
        'sort_order': pt.sort_order,
    }


@public_bp.route('/membership-plans/<code>', methods=['GET'])
@limiter.limit('60 per minute')
def get_public_membership_plan(code):
    """Single-plan fetch — used by the signup-page banner so we can
    show *"You're signing up for **Doctor Starter**"* without
    re-fetching the whole 9-tier catalog.

    Only resolves ACTIVE rows; a stale ``?plan=`` URL pointing at a
    draft/archived plan returns 404, which the signup page handles by
    falling back to "no plan selected".

    MARKETPLACE-ONLY — same scope rule as the list endpoint. Without
    it, a non-marketplace tenant's page that somehow held a marketplace
    plan code could re-resolve its details on that tenant's subdomain,
    rendering marketplace copy inside the wrong tenant. Was keyed on
    ``is_default``; that flag no longer identifies the marketplace
    tenant after the vendor split.
    """
    from app.models import MembershipPlan, MembershipPlanStatus
    from app.api.pricing.service import MarketplacePolicy

    tenant_id = getattr(g, 'tenant_id', None)
    if tenant_id is not None:
        if not MarketplacePolicy.runs_marketplace(tenant_id):
            return not_found_response('MembershipPlan')

    plan = (
        MembershipPlan.query
        .filter_by(
            code=code,
            status=MembershipPlanStatus.ACTIVE,
            is_deleted=False,
        )
        .first()
    )
    if not plan:
        return not_found_response('MembershipPlan')
    return success_response(data=_public_membership_plan_payload(plan))


@public_bp.route('/membership-plans', methods=['GET'])
@limiter.limit('60 per minute')
def list_public_membership_plans():
    """ACTIVE marketplace memberships for the CURRENT tenant, ordered for
    the pricing grid.

    Optional ``?vertical=doctor`` (or ``clinic`` / ``hospital``) filter
    so the frontend can fetch one column at a time if it prefers tab
    switching to one-big-render.

    PER-TENANT. ``membership_plans`` is now tenant-scoped, so this serves
    whichever tenant the request resolved to — the default (apex) tenant's
    catalog on the apex, and a subscriber tenant's own catalog on its
    subdomain. The old apex-only guard is gone: each tenant's ``/join``
    page renders that tenant's own membership tiers, so there's nothing to
    leak. ``tenant_id`` comes from the ``before_request`` host resolver.
    """
    from app.models import MembershipPlan, MembershipPlanStatus
    from app.models.membership import VerticalPlanType

    query = MembershipPlan.query.filter_by(
        status=MembershipPlanStatus.ACTIVE, is_deleted=False,
    )
    # Explicit tenant filter on top of RLS — the app connects as a
    # superuser in dev (RLS bypassed), so without this a subdomain would
    # see every tenant's plans locally.
    tenant_id = getattr(g, 'tenant_id', None)
    if tenant_id is not None:
        query = query.filter(MembershipPlan.tenant_id == tenant_id)

    vertical_param = (request.args.get('vertical') or '').strip().lower()
    if vertical_param:
        query = query.join(VerticalPlanType).filter(VerticalPlanType.code == vertical_param)
    plans = (
        query.order_by(
            MembershipPlan.sort_order.asc(),
            MembershipPlan.tier.asc(),
        )
        .all()
    )
    return success_response(
        data={'plans': [_public_membership_plan_payload(p) for p in plans]},
    )


@public_bp.route('/vertical-plan-types', methods=['GET'])
@limiter.limit('60 per minute')
def list_public_vertical_plan_types():
    """Vertical PLAN TYPES for the CURRENT tenant — drives the /join persona
    tabs and the pricing page.

    PER-TENANT. ``vertical_plan_types`` is tenant-scoped, so each tenant owns
    its own verticals (every tenant is seeded with the same base four). The
    explicit filter sits on top of RLS because the app connects as a Postgres
    superuser in dev, which bypasses RLS — without it a subdomain would see
    every tenant's verticals locally. Same pattern as the membership-plans
    list directly above.
    """
    from app.models.membership import VerticalPlanType
    query = VerticalPlanType.query
    tenant_id = getattr(g, 'tenant_id', None)
    if tenant_id is not None:
        query = query.filter(VerticalPlanType.tenant_id == tenant_id)
    v_plan_types = query.order_by(
        VerticalPlanType.sort_order.asc(), VerticalPlanType.name.asc(),
    ).all()
    return success_response(data=[_public_vertical_plan_type_payload(pt) for pt in v_plan_types])


# --------------------------------------------------------------------------- #
# GET /api/public/platform-landing
# --------------------------------------------------------------------------- #

@public_bp.route('/platform-landing', methods=['GET'])
@limiter.limit('60 per minute')
def get_public_platform_landing():
    """Render the platform marketing landing — feeds the apex (``larazen.in``).

    Reads from the schema-separated ``platform_landing_*`` tables, NOT
    the per-tenant ``landing_*`` ones. Returns the LIVE row only, with
    modules + features inlined so the public page renders in one
    round-trip.
    """
    from app.models import (
        ConfigStatus, PlatformLandingConfig, PlatformLandingScope,
    )
    # Scope-filtered: the apex marketing site is the MARKETING row only.
    # Without this filter, if a DEFAULT_TEMPLATE row is also LIVE (it
    # usually is — it's the seed copied to every new tenant) ``.first()``
    # may return it instead, and the apex would render the new-tenant
    # template rather than the platform_owner's saved marketing config.
    cfg = (
        PlatformLandingConfig.query
        .filter_by(status=ConfigStatus.LIVE, scope=PlatformLandingScope.MARKETING)
        .first()
    )
    if not cfg:
        # Empty render — frontend treats as "site not yet published".
        return success_response(data=None)
    return success_response(
        data=cfg.to_dict(include_modules=True, include_asset_urls=True),
    )


# --------------------------------------------------------------------------- #
# GET /api/public/platform-landing/recognitions
# --------------------------------------------------------------------------- #

@public_bp.route('/platform-landing/recognitions', methods=['GET'])
@limiter.limit('60 per minute')
def get_public_platform_landing_recognitions():
    """Anonymous list of visible platform-marketing recognitions.

    Reads from the LIVE config's recognitions relationship (recognitions
    now live UNDER a config row so they ride the DRAFT → LIVE flow).
    Returns ``[]`` when no LIVE config exists yet for the MARKETING
    scope — same as before, frontend treats it as "site not yet
    published".
    """
    from app.models import (
        ConfigStatus, PlatformLandingConfig, PlatformLandingScope,
    )

    live = (
        PlatformLandingConfig.query
        .filter_by(status=ConfigStatus.LIVE, scope=PlatformLandingScope.MARKETING)
        .first()
    )
    if not live:
        return success_response(data=[])
    visible = [
        r for r in sorted(
            live.recognitions,
            key=lambda x: (x.display_order or 0, x.created_at),
        )
        if r.is_visible
    ]
    return success_response(data=[r.to_dict() for r in visible])


# --------------------------------------------------------------------------- #
# GET /api/public/platform-landing/modules/<slug>
# --------------------------------------------------------------------------- #

@public_bp.route('/platform-landing/modules/<slug>', methods=['GET'])
@limiter.limit('120 per minute')
def get_public_platform_landing_module(slug):
    """Public single-module fetch for the apex marketing landing.

    Mirrors the per-tenant ``/api/landing/public/modules/<slug>``: returns
    the module (with visible features inlined) so ``ModulePage`` on the
    apex can render the same shape it expects from the tenant endpoint.
    """
    from app.models import (
        ConfigStatus, PlatformLandingConfig, PlatformLandingModule,
        PlatformLandingScope,
    )
    cfg = (
        PlatformLandingConfig.query
        .filter_by(status=ConfigStatus.LIVE, scope=PlatformLandingScope.MARKETING)
        .first()
    )
    if not cfg:
        return not_found_response('Module not found or not visible.')
    module = (
        PlatformLandingModule.query
        .filter_by(landing_config_id=cfg.id, slug=slug, is_visible=True)
        .first()
    )
    if not module:
        return not_found_response('Module not found or not visible.')
    data = module.to_dict(include_features=True)
    # Strip non-visible features so anonymous visitors only see published
    # rows — admin endpoint returns everything; public must filter.
    if data.get('features'):
        data['features'] = [f for f in data['features'] if f.get('is_visible', True)]
    return success_response(data=data)


# --------------------------------------------------------------------------- #
# GET /api/public/platform-landing/features/<slug>
# --------------------------------------------------------------------------- #

@public_bp.route('/platform-landing/features/<slug>', methods=['GET'])
@limiter.limit('120 per minute')
def get_public_platform_landing_feature(slug):
    """Public single-feature fetch for the apex marketing landing.

    Slug uniqueness is per-module on the admin side, but the apex feature
    URL (``/service/<slug>``) is bare. Scan visible features under the
    marketing LIVE config and return the first match — matches the tenant
    ``/api/landing/public/features/<slug>`` contract.
    """
    from app.models import (
        ConfigStatus, PlatformLandingConfig, PlatformLandingFeature,
        PlatformLandingModule, PlatformLandingScope,
    )
    cfg = (
        PlatformLandingConfig.query
        .filter_by(status=ConfigStatus.LIVE, scope=PlatformLandingScope.MARKETING)
        .first()
    )
    if not cfg:
        return not_found_response('Feature not found or not visible.')
    row = (
        PlatformLandingFeature.query
        .join(PlatformLandingModule,
              PlatformLandingFeature.module_id == PlatformLandingModule.id)
        .filter(PlatformLandingModule.landing_config_id == cfg.id)
        .filter(PlatformLandingModule.is_visible.is_(True))
        .filter(PlatformLandingFeature.slug == slug)
        .filter(PlatformLandingFeature.is_visible.is_(True))
        .first()
    )
    if not row:
        return not_found_response('Feature not found or not visible.')
    return success_response(data=row.to_dict())


# --------------------------------------------------------------------------- #
# GET /api/public/platform-landing/videos
# --------------------------------------------------------------------------- #

@public_bp.route('/platform-landing/videos', methods=['GET'])
@limiter.limit('60 per minute')
def get_public_platform_landing_videos():
    """Anonymous list of visible platform-marketing videos.

    Reads from the LIVE config's videos relationship so the gallery
    only changes when the platform_owner publishes — same lifecycle as
    modules and recognitions. Optional ``?limit=N`` caps the response.
    """
    from app.models import (
        ConfigStatus, PlatformLandingConfig, PlatformLandingScope,
    )

    limit_raw = request.args.get('limit')
    try:
        limit = int(limit_raw) if limit_raw is not None else None
        if limit is not None and limit < 0:
            limit = None
    except (TypeError, ValueError):
        limit = None

    live = (
        PlatformLandingConfig.query
        .filter_by(status=ConfigStatus.LIVE, scope=PlatformLandingScope.MARKETING)
        .first()
    )
    if not live:
        return success_response(data={'videos': [], 'total_count': 0})
    visible = [
        v for v in sorted(
            live.videos,
            key=lambda x: (x.display_order or 0, x.created_at),
        )
        if v.is_visible
    ]
    total = len(visible)
    items = visible[:limit] if limit is not None else visible
    return success_response(data={
        'videos': [v.to_dict() for v in items],
        'total_count': total,
    })


# --------------------------------------------------------------------------- #
# POST /api/public/signup/tenant
# --------------------------------------------------------------------------- #

@public_bp.route('/signup/tenant', methods=['POST'])
@limiter.limit('5 per hour')
def signup_tenant():
    """Self-serve onboarding.

    Payload::

        {
          "plan_code": "plan1",
          "tenant": { "name": "Demo Clinic", "slug": "demo-clinic" },
          "admin": {
            "first_name": "...", "last_name": "...",
            "phone_number": "9876512345", "email": "...", "password": "..."
          }
        }

    Creates Tenant → TenantSubscription(TRIAL) → SUPER_ADMIN user and
    logs the new admin in via JWT cookies so the frontend can jump
    straight into the freshly-provisioned tenant's dashboard.

    Host-aware (P3): on the vendor surface this sells the vendor
    catalog exactly as before. On an APEX reseller's host it sells the
    reseller's OWN catalog — the new tenant becomes a CHILD of the
    apex (parent + quota + catalog all scoped server-side), and no
    session is minted because the child lives on its own subdomain
    where cookies set here would not travel. Any other tenant host is
    refused: those sites don't sell tenancies.
    """
    import uuid
    from datetime import datetime, timezone
    from flask import jsonify
    from flask_jwt_extended import (
        create_access_token, create_refresh_token,
        set_access_cookies, set_refresh_cookies,
    )
    from app.api.admin.super_admin.service import FieldValidationError
    from app.api.pricing.service import (
        ChildQuotaExceeded, PlanLimitExceeded, ResellerPolicy,
    )

    seller = _selling_host_tenant()
    if seller is not None and not ResellerPolicy.is_apex(str(seller.id)):
        return error_response(
            'This site does not offer workspace signup.',
            code='signup_not_available', status_code=404)

    data = request.get_json() or {}
    errors = TenantSignupValidator.validate(data)
    if errors:
        return validation_error_response(errors)

    # --- Contact-ownership proof (same gate as user signup) ---
    # Self-serve tenancy hands out a whole workspace plus its admin
    # login; accepting the contact details on faith would let anyone
    # squat someone else's phone/email as the owner of a fresh tenant.
    # Mirrors AuthService.signup exactly: phone OTP is mandatory,
    # email OTP is mandatory iff an email was supplied. The frontend
    # obtains the tokens from the existing /auth/pre-signup endpoints.
    from app.auth.service import AuthService

    admin_payload = data.get('admin') or {}
    if not data.get('phone_verification_token'):
        return error_response(
            'Phone verification is required. Verify the mobile number '
            'first.', status_code=400, code='phone_verification_required')
    if admin_payload.get('email') \
            and not data.get('email_verification_token'):
        return error_response(
            'Email verification is required. Verify the email first.',
            status_code=400, code='email_verification_required')
    try:
        phone_proof = AuthService._verify_pre_signup_token(
            data['phone_verification_token'], 'pre_signup_phone')
        if phone_proof.get('identifier') != admin_payload.get('phone_number'):
            raise ValueError(
                'Phone verification does not match the phone number.')
        if admin_payload.get('email'):
            email_proof = AuthService._verify_pre_signup_token(
                data['email_verification_token'], 'pre_signup_email')
            if email_proof.get('identifier') != AuthService._normalize_email(
                    admin_payload['email']):
                raise ValueError(
                    'Email verification does not match the email.')
    except ValueError as e:
        return error_response(str(e), status_code=400,
                              code='verification_invalid')

    try:
        result = TenantSelfServeService.provision(
            plan_code=data['plan_code'],
            tenant_payload=data['tenant'],
            admin_payload=data['admin'],
            seller_tenant=seller,
            billing_cycle=data.get('billing_cycle'),
        )
    except PlanNotAvailable as e:
        return error_response(str(e), code='plan_unavailable', status_code=404)
    except SlugUnavailable as e:
        return error_response(
            str(e), code='slug_unavailable', status_code=409,
            data={'field': 'tenant.slug'},
        )
    except ChildQuotaExceeded as e:
        # The reseller's plan has no free child slots. 402 like every
        # other quota refusal so the SPA can show a "sold out" state.
        return error_response(
            'No workspaces are available on this site right now.',
            status_code=402, code='child_quota_exceeded',
            data={'limit': e.limit, 'used': e.used, 'allowed': e.allowed},
        )
    except FieldValidationError as e:
        # Dup phone/email. provision() already abandoned the
        # half-created tenant so the visitor can retry the same slug.
        return validation_error_response(
            {f'admin.{e.field}': [e.message]},
        )
    except PlanLimitExceeded:
        # A plan sold with zero admin seats — a catalog authoring bug,
        # but answer with an envelope instead of a 500.
        return error_response(
            'This plan cannot seat an administrator. Contact support.',
            status_code=409, code='plan_limit_exceeded')
    except ValueError as e:
        return error_response(str(e), status_code=409)

    # Both contacts arrived with ownership proof, so the new admin
    # starts verified — no post-login "verify your email" nag for
    # details we just OTP-checked.
    result.user.phone_verified = True
    if admin_payload.get('email'):
        result.user.email_verified = True

    # Signup-time "additional team members": granted for the TRIAL
    # window only (they collapse at trial end unless bought for real).
    addons_attached, addons_skipped = [], []
    if data.get('addons'):
        from app.api.pricing.subscription_billing import (
            attach_signup_addons,
        )
        from app.models import TenantSubscription
        new_sub = TenantSubscription.query.filter_by(
            tenant_id=result.tenant.id, is_deleted=False).first()
        if new_sub is not None:
            addons_attached, addons_skipped = attach_signup_addons(
                new_sub, data['addons'], actor_user_id=result.user.id)
    db.session.commit()

    if seller is not None:
        # ── Reseller funnel completion ──
        # Tell the new admin where their workspace lives (email + SMS,
        # best-effort) and the apex's admins that a slot was consumed.
        from app.api.platform.service import PlatformTenantService
        from app.common.notify import push_to_super_admins

        PlatformTenantService.notify_tenant_ready(result.tenant, result.user)
        push_to_super_admins(
            tenant_id=str(seller.id),
            type='child_tenant_signup',
            title='New tenant signed up',
            body=(f'{result.tenant.name} ({result.tenant.slug}) signed up '
                  f'on plan "{data["plan_code"]}".'),
            data={'kind': 'reseller',
                  'url': '/dashboard/admin/reseller/tenants'},
        )
        from app.services.cloudflare_dns import public_host_for
        return created_response({
            'addons_attached': addons_attached,
            'addons_skipped': addons_skipped,
            'tenant': result.tenant.to_dict(),
            'subscription': result.subscription.to_dict(),
            'user': {'id': str(result.user.id), 'email': result.user.email},
            'seller': 'reseller',
            # Where the new workspace actually lives — the apex's own
            # zone when its DNS config is connected (P4), else the
            # platform zone. The SPA appends its own port for local dev.
            'login_host': public_host_for(result.tenant),
        }, message=f'Workspace "{result.tenant.slug}" created')

    # --- Issue JWT cookies so the SPA can redirect straight in ---
    # Same machinery as :meth:`AuthService.signin` — a REGISTERED session
    # (DB row + Redis cache + refresh jti), not just a minted uuid claim.
    # The ``user_lookup_loader`` validates ``session_id`` against the
    # session store on every request, so an unregistered id produced
    # cookies that 401'd on their very first use and dumped the freshly
    # signed-up admin on the login page instead of the dashboard.
    from flask import current_app
    from werkzeug.security import generate_password_hash
    from app.auth.service import AuthService
    from app.auth.session_store import SessionStore

    session = AuthService._create_session(result.user, None)
    refresh_jti = str(uuid.uuid4())
    tenant_claim = str(result.user.tenant_id) if result.user.tenant_id else None
    access_token = create_access_token(
        identity=result.user,
        additional_claims={
            'session_id': str(session.id),
            'refresh_jti': refresh_jti,
            'tenant_id': tenant_claim,
            'role': result.user.role.value,
        },
    )
    refresh_token = create_refresh_token(
        identity=result.user,
        additional_claims={
            'session_id': str(session.id),
            'jti': refresh_jti,
            'tenant_id': tenant_claim,
        },
    )
    now_ts = datetime.now(timezone.utc)
    refresh_lifetime = current_app.config.get(
        'JWT_REFRESH_TOKEN_EXPIRES', timedelta(days=15))
    refresh_ttl = (int(refresh_lifetime.total_seconds())
                   if isinstance(refresh_lifetime, timedelta)
                   else 15 * 24 * 60 * 60)
    ttl_seconds = min(
        refresh_ttl, int((session.absolute_expiry - now_ts).total_seconds()))
    if not SessionStore.store_refresh_token(
            refresh_jti, str(session.id), ttl_seconds):
        db.session.rollback()
        return error_response(
            'Authentication service temporarily unavailable. Please sign in '
            'with your new credentials.', status_code=503)
    session.refresh_token_hash = generate_password_hash(refresh_jti)
    db.session.commit()
    SessionStore.cache_session(
        session_id=str(session.id),
        user_id=str(result.user.id),
        expires_at=session.expires_at,
        created_at=session.created_at,
        device_info=session.device_fingerprint,
    )
    session_id = str(session.id)
    response = jsonify({
        'success': True,
        'message': 'Tenant created. Welcome aboard.',
        'data': {
            'addons_attached': addons_attached,
            'addons_skipped': addons_skipped,
            'tenant': result.tenant.to_dict(),
            'subscription': result.subscription.to_dict(),
            'user': result.user.to_dict(),
            'session_id': session_id,
            # Frontend computes the full FQDN from ``tenant.fqdn`` for
            # prod, or strips to ``/dashboard/admin`` for local dev.
            'redirect_url': '/dashboard/admin',
        },
    })
    set_access_cookies(response, access_token)
    set_refresh_cookies(response, refresh_token)
    return response, 201


# (The old ``_rollback_tenant_row`` helper is gone: it was only ever
# called with ``None`` — a dead no-op — and hard-deleting a Tenant row
# risks FK surprises. ``TenantSelfServeService._abandon_tenant`` now
# soft-deletes + renames inside the service, where the tenant id is
# actually in scope.)
