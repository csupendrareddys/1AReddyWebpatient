"""Plan-catalog CRUD shared by the two authoring surfaces.

Extracted from the inline handlers in ``app/api/platform/pricing_routes.py``
so the vendor console and the apex reseller console
(``app/api/admin/reseller``) run ONE implementation with an owner scope:

  * vendor surface  → ``owner_tenant_id=None``, ``kind`` from the payload
    (the only surface that may author 'apex' plans);
  * reseller surface → ``owner_tenant_id=<apex id>``, ``kind`` FORCED
    'normal', ``is_default`` forced False.

Validation stays with ``PlanValidator`` at the routes; this module owns
construction/update/archive mechanics and the per-owner code-uniqueness
checks. All lookups here are owner-scoped — with per-owner code
namespaces, an unscoped ``filter_by(code=...)`` can resolve a FOREIGN
catalog's row (see invariant notes on the Plan model).
"""
from app.extensions import db
from app.models._base import utcnow
from app.models._enums import OverLimitAction, PlanStatus

PRICING_PERIODS = ("monthly", "quarterly", "semi_annual", "annual",
                   "biennial", "triennial")


class PlanCodeExists(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(f'Plan code already exists: {code}')


class InvalidPlanType(Exception):
    pass


class PlanHasActiveSubscriptions(Exception):
    pass


def build_pricing_dict(data: dict) -> dict:
    """Create a pricing dict.

    Only None/blank is dropped ("period not offered"). ``0`` is kept: it's a
    price the operator typed, and the plan card renders it as "Free".
    ``-1`` is kept too — the "Custom / Contact sales" sentinel.
    """
    pricing = {}
    for period in PRICING_PERIODS:
        for key in (f'price_inr_{period}', f'og_price_inr_{period}'):
            if data.get(key) not in (None, ''):
                pricing[key] = float(data.get(key))
    return pricing


def build_plan_snapshot(plan) -> dict:
    """Freeze a plan's terms for storage on a subscription.

    This is the GRANDFATHERING contract: what a tenant gets is what the
    plan said at subscription time. Everything entitlement resolution and
    quota enforcement read from the plan lives here; editing the catalog
    afterwards changes NEW subscriptions only. Pricing rides along so
    billing can honour subscription-time rates once wired.
    """
    import copy as _copy
    return {
        'features': _copy.deepcopy(plan.features or {}),
        'limits': {
            'total': plan.max_total_users,
            'super_admin': plan.max_super_admins,
            'sub_admin': plan.max_sub_admins,
            'provider': plan.max_providers,
        },
        'provider_entity_limits': {
            'doctor': plan.max_provider_doctors,
            'clinic': plan.max_provider_clinics,
            'hospital': plan.max_provider_hospitals,
        },
        'usage_limits': _copy.deepcopy(plan.usage_limits or {}),
        'over_limit_action': plan.over_limit_action.value
        if plan.over_limit_action else None,
        'grace_period_days': plan.grace_period_days,
        'data_retention_days': plan.data_retention_days,
        'child_plan_caps': plan.child_plan_caps,
        'addon_terms': plan.addon_terms,
        'payment': {
            'razorpay_supported': plan.razorpay_supported,
            'tenant_keys_allowed': plan.tenant_keys_allowed,
        },
        'pricing': _copy.deepcopy(plan.pricing or {}),
        'child_limits': {
            'subdomains': plan.max_child_subdomains,
            'custom_domains': plan.max_child_custom_domains,
        },
        'kind': plan.kind,
        'snapshot_of_updated_at': plan.updated_at.isoformat()
        if plan.updated_at else None,
    }


class PlanCatalogService:

    @staticmethod
    def list_plans(*, owner_tenant_id):
        from app.models import Plan
        return (
            Plan.query
            .filter_by(is_deleted=False, owner_tenant_id=owner_tenant_id)
            .order_by(Plan.created_at.asc())
            .all()
        )

    @staticmethod
    def get_plan(code, *, owner_tenant_id):
        from app.models import Plan
        return Plan.query.filter_by(
            code=code, is_deleted=False, owner_tenant_id=owner_tenant_id,
        ).first()

    @staticmethod
    def create_plan(data, *, owner_tenant_id, kind, created_by_id,
                    is_default=None):
        """Construct + persist a plan in the given owner's namespace.

        Raises :class:`PlanCodeExists` / :class:`InvalidPlanType`; the
        caller has already run ``PlanValidator.validate_create``.
        """
        from app.models.plan import Plan, SAASPlanType

        if PlanCatalogService.get_plan(data['code'],
                                       owner_tenant_id=owner_tenant_id):
            raise PlanCodeExists(data['code'])

        plan_type = SAASPlanType.query.filter_by(
            id=data['saas_plan_type_id']).first()
        if not plan_type:
            raise InvalidPlanType()

        plan = Plan(
            code=data["code"],
            name=data["name"],
            description=data.get("description"),
            status=PlanStatus(data.get("status", "draft")),
            is_default=(bool(data.get("is_default", False))
                        if is_default is None else is_default),
            price_inr_monthly=data.get("price_inr_monthly"),
            og_price_inr_monthly=data.get("og_price_inr_monthly"),
            price_inr_annual=data.get("price_inr_annual"),
            # The per-period map the plan cards actually read. Create used
            # to skip it, so a brand-new plan priced its six periods and
            # rendered none of them until someone re-saved it.
            pricing=build_pricing_dict(data),
            trial_days=data.get("trial_days", 0),
            max_total_users=data["max_total_users"],
            max_super_admins=data["max_super_admins"],
            max_sub_admins=data["max_sub_admins"],
            max_providers=data["max_providers"],
            # Per-vertical provider-entity quotas. NULL is allowed (legacy)
            # but enforcement treats NULL/missing as 0.
            max_provider_doctors=data.get("max_provider_doctors"),
            max_provider_clinics=data.get("max_provider_clinics"),
            max_provider_hospitals=data.get("max_provider_hospitals"),
            over_limit_action=OverLimitAction(
                data.get("over_limit_action", "block_new")),
            grace_period_days=data.get("grace_period_days", 0),
            benefits=data.get("benefits") or [],
            child_plan_caps=data.get("child_plan_caps") or None,
            data_retention_days=data.get("data_retention_days", 180),
            razorpay_supported=data.get("razorpay_supported", True),
            tenant_keys_allowed=data.get("tenant_keys_allowed", False),
            features=data["features"],
            usage_limits=data.get("usage_limits"),
            default_addons=data.get("default_addons"),
            kind=kind,
            owner_tenant_id=owner_tenant_id,
            max_child_subdomains=data.get("max_child_subdomains"),
            max_child_custom_domains=data.get("max_child_custom_domains"),
            addon_terms=data.get('addon_terms'),
            card_display=data.get('card_display'),
            created_by_id=created_by_id,
            saas_plan_type_id=data["saas_plan_type_id"],
        )
        db.session.add(plan)
        db.session.commit()
        return plan

    # Fields a partial update may touch. ``kind`` / owner / child quotas
    # are NOT here — the vendor route whitelists them separately and the
    # reseller route never may.
    _UPDATE_FIELDS = (
        'name', 'description', 'is_default',
        'trial_days', 'max_total_users', 'max_super_admins',
        'max_sub_admins', 'max_providers',
        'max_provider_doctors', 'max_provider_clinics',
        'max_provider_hospitals',
        'grace_period_days', 'data_retention_days', 'benefits',
        'razorpay_supported', 'tenant_keys_allowed',
        'features', 'usage_limits', 'default_addons',
        'addon_terms', 'card_display',
    )
    _VENDOR_ONLY_UPDATE_FIELDS = (
        'child_plan_caps',
        'kind', 'max_child_subdomains', 'max_child_custom_domains',
    )

    @staticmethod
    def update_plan(plan, data, *, updated_by_id, allow_vendor_fields=False):
        """Apply a validated partial update. Never touches code/owner."""
        from app.models.plan import SAASPlanType

        fields = PlanCatalogService._UPDATE_FIELDS
        if allow_vendor_fields:
            fields = fields + PlanCatalogService._VENDOR_ONLY_UPDATE_FIELDS
        for field_name in fields:
            if field_name in data:
                setattr(plan, field_name, data[field_name])

        # Rebuild pricing ONLY when the payload actually mentions a price.
        # An unconditional rebuild here meant any partial update — the
        # status-toggle chip sends just ``{"status": ...}`` — reset
        # ``plan.pricing`` to ``{}`` and silently deleted every price on
        # the plan (and a plan with no priced period drops off the public
        # pricing page). The membership surface was bitten by the same
        # thing and carries the same guard; see ``_mentions_pricing`` in
        # ``app/api/membership_plan/routes.py``.
        price_keys = [
            key
            for period in PRICING_PERIODS
            for key in (f'price_inr_{period}', f'og_price_inr_{period}')
        ]
        if any(key in data for key in price_keys):
            # Merge over the EXISTING pricing rather than rebuilding from
            # the payload alone — a partial update naming one price must
            # not silently un-offer every other period. Sending an
            # explicit null/blank for a key still removes that period.
            merged = dict(plan.pricing or {})
            merged.update({k: data[k] for k in price_keys if k in data})
            plan.pricing = build_pricing_dict(merged)

        if "saas_plan_type_id" in data:
            # Null/blank = "no type" — legal (internal ops plans). The
            # UI always echoes the field back, so treating null as a
            # failed lookup made typeless plans uneditable.
            if data["saas_plan_type_id"] in (None, ''):
                plan.saas_plan_type_id = None
            else:
                plan_type = SAASPlanType.query.filter_by(
                    id=data["saas_plan_type_id"]).first()
                if not plan_type:
                    raise InvalidPlanType()
                plan.saas_plan_type_id = data["saas_plan_type_id"]

        if 'status' in data:
            plan.status = PlanStatus(data['status'])
        if 'over_limit_action' in data:
            plan.over_limit_action = OverLimitAction(data['over_limit_action'])
        plan.updated_by_id = updated_by_id
        db.session.commit()
        return plan

    @staticmethod
    def archive_plan(plan, *, updated_by_id):
        """Soft-archive; refuses while any live subscription points at it
        (avoid orphaning tenants)."""
        from app.models import TenantSubscription

        active = TenantSubscription.query.filter_by(
            plan_id=plan.id, is_deleted=False,
        ).first()
        if active:
            raise PlanHasActiveSubscriptions()
        plan.is_deleted = True
        plan.deleted_at = utcnow()
        plan.status = PlanStatus.ARCHIVED
        plan.updated_by_id = updated_by_id
        db.session.commit()
