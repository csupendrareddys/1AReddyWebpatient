"""
Pricing / Plans module models.

Four tables. Two are platform-catalog entities with no tenant_id (``plans`` and
``addons``); two are tenant-scoped links (``tenant_subscriptions`` and
``tenant_addons``) that inherit ``TenantMixin`` and get PostgreSQL RLS policies
in the accompanying Alembic migration.

See the plan file for the full design. The short version:
  * ``Plan`` is a platform-wide tier definition (Plan1, Plan2, …).
  * ``TenantSubscription`` pins one tenant to one plan with lifecycle state.
  * ``Addon`` is an optional feature/capacity pack attached à la carte.
  * ``TenantAddon`` attaches an add-on to a tenant.

Resolution order in :class:`PlanService.resolve`: ``Plan < Add-ons < Overrides``.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.extensions import db
from app.models._base import (
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin,
)
from app.models._enums import (
    PlanStatus, SubscriptionStatus, BillingCycle, OverLimitAction,
    AddonStatus, AddonSubscriptionStatus, MembershipVertical
)


# --------------------------------------------------------------------------- #
# Plan — platform catalog (NO tenant_id)
# --------------------------------------------------------------------------- #

class Plan(db.Model, TimestampMixin, SoftDeleteMixin, AuditMixin):
    """A SaaS subscription tier.

    Two catalogs share this table, split by ``owner_tenant_id``:
    NULL = the VENDOR's catalog (what jlmush sells); set = a plan authored
    by that APEX tenant for its own sub-tenants (reseller catalog).

    ``kind``: 'normal' (an ordinary tenant subscription) or 'apex' (a
    reseller entitlement carrying child quotas). Invariants, enforced by
    guards + DB CHECKs:
      I1: a subscription's plan owner always equals the tenant's parent
          (both NULL for vendor catalog on top-level tenants).
      I2: apex-kind plans are vendor-authored only, and only parentless
          non-vendor tenants may subscribe to them.
    """
    __tablename__ = 'plans'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # NOT column-unique: uniqueness is scoped per catalog owner via two
    # partial indexes in __table_args__ — the vendor catalog keeps global
    # code uniqueness, while every apex reseller gets its own namespace
    # (two apexes may both sell a 'starter').
    code = db.Column(db.String(50), nullable=False, index=True)
    name = db.Column(db.String(150), nullable=False)
    description = db.Column(db.Text, nullable=True)
    status = db.Column(
        db.Enum(PlanStatus, name='planstatus'),
        nullable=False,
        default=PlanStatus.DRAFT,
    )
    is_default = db.Column(db.Boolean, nullable=False, default=False)

    price_inr_monthly = db.Column(db.Numeric(10, 2), nullable=True)
    og_price_inr_monthly = db.Column(db.Numeric(10,2), nullable=True)
    price_inr_annual = db.Column(db.Numeric(10, 2), nullable=True)
    trial_days = db.Column(db.Integer, nullable=False, default=0)
    pricing = db.Column(JSONB, nullable=True)
    saas_plan_type_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("saas_plan_types.id", ondelete="RESTRICT", name="fk_plans_saas_plan_type_id"),
        nullable=True,
        index=True,
    )
    saas_plan_type = db.relationship("SAASPlanType", back_populates="plans", lazy="joined")

    # User-limit scalars. Hot path (every staff-create runs a count-vs-limit
    # check), so these are columns not JSONB.
    max_total_users = db.Column(db.Integer, nullable=False)
    max_super_admins = db.Column(db.Integer, nullable=False)
    max_sub_admins = db.Column(db.Integer, nullable=False)
    max_providers = db.Column(db.Integer, nullable=False)

    # ── Per-vertical PROVIDER-ENTITY quotas (in-tenant marketplace) ───
    # Separate from the user/seat limits above. These cap how many
    # **provider entities** a tenant may register *inside their own
    # subdomain*:
    #   * ``max_provider_doctors``   — independent doctor practitioners
    #     who run their own practice inside the tenant.
    #   * ``max_provider_clinics``   — clinic organisations inside the
    #     tenant (each clinic can in turn hold doctors).
    #   * ``max_provider_hospitals`` — hospital organisations inside
    #     the tenant.
    # Sentinel: -1 = unlimited, 0 = vertical not allowed at all, positive
    # int = hard cap. Provider signup-inside-tenant checks the relevant
    # quota and rejects with PlanLimitExceeded when over. Independent of
    # the ``tenant.can_create_<vertical>_plans`` feature add-ons —
    # a tenant can have a doctor quota of 50 with no doctor-plan add-on
    # (direct registration, no tiers) or with the add-on (plan-gated).
    # NULL on existing rows treated as 0 (deny) during the post-deploy
    # window; platform owner backfills via PlanForm.
    max_provider_doctors = db.Column(db.Integer, nullable=True)
    max_provider_clinics = db.Column(db.Integer, nullable=True)
    max_provider_hospitals = db.Column(db.Integer, nullable=True)

    # Downgrade lifecycle policy.
    over_limit_action = db.Column(
        db.Enum(OverLimitAction, name='overlimitaction'),
        nullable=False,
        default=OverLimitAction.BLOCK_NEW,
    )
    grace_period_days = db.Column(db.Integer, nullable=False, default=0)
    # Per-PLAN add-on terms: {addon_code: {active, units, price_inr,
    # og_price_inr, min_qty, max_qty, billing_cycle} | null}. Overrides
    # the add-on's own tier terms for buyers ON THIS PLAN — "different
    # plans, different add-on price and capacity". A code absent here
    # falls through to the add-on's global tier; an entry with
    # active=false (or null) means this plan does not offer the add-on
    # at all. On an APEX-AUTHORED child plan these are the apex's
    # RESALE terms: what its children pay it.
    addon_terms = db.Column(JSONB, nullable=True)

    # Display-only card flags: which add-on blocks the PUBLIC plan card
    # shows, per audience ({show_addons_main,
    # show_addons_subdomain_child, show_addons_custom_domain_child}:
    # bool, default true). Never entitlement — the catalogue keeps every
    # add-on either way.
    card_display = db.Column(JSONB, nullable=True)

    # Free-text marketing bullets typed by the seller — rendered on the
    # public pricing card (the membership-plan 'benefits' pattern).
    # Copy only: entitlement stays in the structured feature tree.
    benefits = db.Column(JSONB, nullable=True)
    # APEX plans only: per-child-tenant ceilings — the maximum any plan
    # the apex authors for a child may grant, per seat type
    # ({total, super_admin, sub_admin, provider}). None = uncapped.
    child_plan_caps = db.Column(JSONB, nullable=True)
    # How long a SUSPENDED tenant's data stays in the database before it
    # is archived to S3 and purged (subdomain + slug freed). Distinct
    # from ``grace_period_days`` (payment grace before suspension) —
    # the two windows run back to back. 180 = the 6-month default.
    data_retention_days = db.Column(
        db.Integer, nullable=False, default=180, server_default='180')

    # Payment seam. Future tenant-key branch reads ``tenant_keys_allowed``.
    razorpay_supported = db.Column(db.Boolean, nullable=False, default=True)
    tenant_keys_allowed = db.Column(db.Boolean, nullable=False, default=False)

    # Unified feature tree. See Deliverable 2 in the plan.
    features = db.Column(JSONB, nullable=False)

    # Per-plan default usage caps. Shape:
    #   { "<metric>": { "monthly": int, "daily": int?,
    #                   "rolling_days": int?, "rolling_limit": int? } }
    # Sentinel: -1 = unlimited, 0 = disabled, positive int = cap.
    # Editable by platform owner via plan PUT.
    usage_limits = db.Column(JSONB, nullable=True)

    # List of addon codes that auto-attach when a tenant subscribes to
    # this plan. Platform owner curates this in the admin UI.
    default_addons = db.Column(JSONB, nullable=True)

    # ── Reseller hierarchy ──────────────────────────────────────────────
    # 'normal' | 'apex' — varchar + CHECK (dns_status precedent), Python
    # constants in app.models._enums.PlanKind.
    kind = db.Column(db.String(10), nullable=False,
                     server_default='normal', default='normal')
    # NULL = vendor catalog; set = authored by that apex tenant.
    owner_tenant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('tenants.id', ondelete='RESTRICT',
                      name='fk_plans_owner_tenant_id'),
        nullable=True, index=True,
    )
    # Child quotas — meaningful only on apex-kind plans (CHECK below).
    # NULL/0 = none allowed (no -1 sentinels, house rule).
    max_child_subdomains = db.Column(db.Integer, nullable=True)
    max_child_custom_domains = db.Column(db.Integer, nullable=True)

    __table_args__ = (
        db.CheckConstraint(
            'max_total_users >= max_super_admins + max_sub_admins + max_providers',
            name='ck_plan_limits_sum',
        ),
        db.CheckConstraint('grace_period_days >= 0', name='ck_plan_grace_nonneg'),
        db.CheckConstraint("kind IN ('normal','apex')", name='ck_plans_kind'),
        # I2 (DB half): apex plans are vendor-authored only.
        db.CheckConstraint("owner_tenant_id IS NULL OR kind = 'normal'",
                           name='ck_plans_apex_vendor_only'),
        db.CheckConstraint(
            "kind = 'apex' OR (max_child_subdomains IS NULL "
            "AND max_child_custom_domains IS NULL)",
            name='ck_plans_child_quotas_apex_only',
        ),
        # Per-owner code namespaces (NULLs are distinct in PG unique
        # indexes, hence TWO partial indexes rather than one composite).
        db.Index('ux_plans_vendor_code', 'code', unique=True,
                 postgresql_where=db.text('owner_tenant_id IS NULL')),
        db.Index('ux_plans_owner_code', 'owner_tenant_id', 'code', unique=True,
                 postgresql_where=db.text('owner_tenant_id IS NOT NULL')),
    )

    def __repr__(self):
        return f"<Plan {self.code}>"

    def to_dict(self):
        data = {
            'id': str(self.id),
            'code': self.code,
            'name': self.name,
            'description': self.description,
            'status': self.status.value,
            'is_default': self.is_default,
            'kind': self.kind,
            'owner_tenant_id': (str(self.owner_tenant_id)
                                if self.owner_tenant_id else None),
            'child_limits': {
                'subdomains': self.max_child_subdomains,
                'custom_domains': self.max_child_custom_domains,
            },
            'trial_days': self.trial_days,
            'user_limits': {
                'total': self.max_total_users,
                'per_role': {
                    'super_admin': self.max_super_admins,
                    'sub_admin': self.max_sub_admins,
                    'provider': self.max_providers,
                },
            },
            'provider_entity_limits': {
                # Per-vertical caps for in-tenant marketplace participants.
                # -1 = unlimited, 0 = vertical disabled, None = legacy row
                # (pre-quota deploy) treated as 0 by enforcement.
                'doctor': self.max_provider_doctors,
                'clinic': self.max_provider_clinics,
                'hospital': self.max_provider_hospitals,
            },
            'over_limit_action': self.over_limit_action.value,
            'grace_period_days': self.grace_period_days,
            'benefits': self.benefits or [],
            'addon_terms': self.addon_terms,
            'card_display': self.card_display,
            'child_plan_caps': self.child_plan_caps,
            'data_retention_days': self.data_retention_days,
            'razorpay_supported': self.razorpay_supported,
            'tenant_keys_allowed': self.tenant_keys_allowed,
            'features': self.features,
            'usage_limits': self.usage_limits,
            'default_addons': self.default_addons or [],
            'plan_type': (
                    self.saas_plan_type.to_dict()
                    if self.saas_plan_type
                    else None
                ),
        }
        if self.pricing is not None:
            for key, value in self.pricing.items():
                data[key] = float(value)
        
        return data


## SAAS CATEGORY TABLE — the vendor site's top-level market segment
class SaasCategory(db.Model, TimestampMixin):
    """An INDUSTRY the SaaS is sold to (healthcare, legal, ...), each with
    its own vendor-site pricing page: hero copy lives here, and plan types
    (and through them, plans) hang off a category. Dynamic like plan
    types — the platform owner authors categories in the console instead
    of the pricing page hardcoding one industry's copy.

    ``is_default`` marks the category ``/pricing`` renders with no segment
    in the URL, and the one legacy NULL-category plan types belong to.
    Vendor-owned: no tenant_id.
    """
    __tablename__ = "saas_categories"

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = db.Column(db.String(50), unique=True, nullable=False, index=True)
    name = db.Column(db.String(150), nullable=False)
    # Hero copy for the category's pricing page.
    tagline = db.Column(db.String(200), nullable=True)      # chip, e.g. "For healthcare organizations"
    headline = db.Column(db.String(300), nullable=True)
    subheadline = db.Column(db.Text, nullable=True)
    display_order = db.Column(db.Integer, nullable=False, default=0)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    is_default = db.Column(db.Boolean, nullable=False, default=False)

    plan_types = db.relationship("SAASPlanType", back_populates="category")

    def to_dict(self):
        return {
            "id": str(self.id),
            "code": self.code,
            "name": self.name,
            "tagline": self.tagline,
            "headline": self.headline,
            "subheadline": self.subheadline,
            "display_order": self.display_order,
            "is_active": self.is_active,
            "is_default": self.is_default,
        }


## SAAS PLANTYPE TABLE
class SAASPlanType(db.Model):
    __tablename__ = "saas_plan_types"

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = db.Column(db.String(50), unique=True, nullable=False, index=True)
    name = db.Column(db.String(150), nullable=False)
    description = db.Column(db.String, nullable=True)
    icon_key = db.Column(db.String, nullable=True)
    is_receiver = db.Column(db.Boolean, nullable=True, default=False)
    # NULL reads as the DEFAULT category (pre-category rows).
    category_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("saas_categories.id", ondelete="RESTRICT",
                      name="fk_saas_plan_types_category_id"),
        nullable=True, index=True,
    )

    category = db.relationship("SaasCategory", back_populates="plan_types")
    plans = db.relationship("Plan", back_populates="saas_plan_type")

    def to_dict(self):
        return {
            "id": str(self.id),
            "code": self.code,
            "name": self.name,
            "icon_key": self.icon_key,
            "description": self.description,
            "is_receiver": self.is_receiver,
            "category_id": str(self.category_id) if self.category_id else None,
            "category_code": self.category.code if self.category else None,
        }


# --------------------------------------------------------------------------- #
# TenantSubscription — tenant ↔ plan (tenant-scoped, RLS)
# --------------------------------------------------------------------------- #

class TenantSubscription(TenantMixin, db.Model, TimestampMixin, SoftDeleteMixin, AuditMixin):
    __tablename__ = 'tenant_subscriptions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('plans.id', ondelete='RESTRICT'),
        nullable=False,
        index=True,
    )
    status = db.Column(
        db.Enum(SubscriptionStatus, name='subscriptionstatus'),
        nullable=False,
        default=SubscriptionStatus.TRIAL,
    )
    billing_cycle = db.Column(
        db.Enum(BillingCycle, name='billingcycle'),
        nullable=False,
        default=BillingCycle.MONTHLY,
    )
    trial_ends_at = db.Column(db.DateTime(timezone=True), nullable=True)
    current_period_start = db.Column(db.DateTime(timezone=True), nullable=False)
    current_period_end = db.Column(db.DateTime(timezone=True), nullable=False)
    cancelled_at = db.Column(db.DateTime(timezone=True), nullable=True)

    over_limit_since = db.Column(db.DateTime(timezone=True), nullable=True)
    suspend_after = db.Column(db.DateTime(timezone=True), nullable=True)
    # Armed when the sweep suspends: suspension time + the plan's
    # data_retention_days. Past it, the retention sweep archives the
    # tenant to S3 and hard-deletes it (freeing subdomain + slug).
    data_purge_after = db.Column(db.DateTime(timezone=True), nullable=True)

    overrides = db.Column(JSONB, nullable=True)

    # GRANDFATHERING: the plan's terms captured at subscription time
    # (features / limits / usage caps / entity quotas / payment flags /
    # pricing — see ``build_plan_snapshot``). Resolution reads THIS, not
    # the live plan row, so editing the catalog never silently rewrites
    # what an existing subscriber bought. Refreshed only by an explicit
    # (re)assignment or the vendor's "push current terms" resync. NULL on
    # legacy rows = fall back to the live plan (pre-snapshot behaviour)
    # until the backfill script runs.
    plan_snapshot = db.Column(JSONB, nullable=True)

    # Billing/dunning bookkeeping (NOT entitlement data — resolution never
    # reads this). Shape: {"notices": {"<key>": "<iso timestamp>"}} where key
    # is e.g. "trial_ending_3d" — the sweep uses it to send each reminder
    # exactly once per period.
    billing_state = db.Column(JSONB, nullable=True)

    activated_by_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )

    plan = db.relationship('Plan', foreign_keys=[plan_id], lazy='joined')

    __table_args__ = (
        db.Index('ix_tenant_subscriptions_tenant', 'tenant_id'),
        db.Index(
            'ux_tenant_subscriptions_active',
            'tenant_id',
            unique=True,
            postgresql_where=db.text('is_deleted = false'),
        ),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'tenant_id': str(self.tenant_id),
            'plan_id': str(self.plan_id),
            'plan_code': self.plan.code if self.plan else None,
            'status': self.status.value,
            'billing_cycle': self.billing_cycle.value,
            'trial_ends_at': self.trial_ends_at.isoformat() if self.trial_ends_at else None,
            'current_period_start': (
                self.current_period_start.isoformat() if self.current_period_start else None
            ),
            'current_period_end': (
                self.current_period_end.isoformat() if self.current_period_end else None
            ),
            'cancelled_at': self.cancelled_at.isoformat() if self.cancelled_at else None,
            'over_limit_since': (
                self.over_limit_since.isoformat() if self.over_limit_since else None
            ),
            'suspend_after': self.suspend_after.isoformat() if self.suspend_after else None,
            'overrides': self.overrides,
            'data_purge_after': (self.data_purge_after.isoformat()
                                 if self.data_purge_after else None),
            'plan_snapshot': self.plan_snapshot,
        }


# --------------------------------------------------------------------------- #
# Addon — platform catalog (NO tenant_id)
# --------------------------------------------------------------------------- #

class Addon(db.Model, TimestampMixin, SoftDeleteMixin, AuditMixin):
    __tablename__ = 'addons'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = db.Column(db.String(50), unique=True, nullable=False, index=True)
    name = db.Column(db.String(150), nullable=False)
    description = db.Column(db.Text, nullable=True)
    status = db.Column(
        db.Enum(AddonStatus, name='addonstatus'),
        nullable=False,
        default=AddonStatus.DRAFT,
    )
    price_inr_monthly = db.Column(db.Numeric(10, 2), nullable=True)
    og_price_inr_monthly = db.Column(db.Numeric(10, 2), nullable=True)
    price_inr_annual = db.Column(db.Numeric(10, 2), nullable=True)
    og_price_inr_annual = db.Column(db.Numeric(10, 2), nullable=True)

    # Feature leaves the add-on toggles. Empty dict is legal for pure-capacity add-ons.
    features = db.Column(JSONB, nullable=False, default=dict)
    # Signed-integer seat deltas per role. Null for pure-feature add-ons.
    limits = db.Column(JSONB, nullable=True)
    # Additive usage-cap deltas per metric/window, same merge logic as limits.
    # Shape: { "<metric>": { "monthly": +int, "daily": +int, … } }
    usage_deltas = db.Column(JSONB, nullable=True)
    # List of addon codes that must already be active on the tenant before
    # this one can be attached. Validated topologically on attach.
    prerequisites = db.Column(JSONB, nullable=True)

    # Per-buyer-tier commercial terms. Keys: 'main' (a tenant buying for
    # itself), 'subdomain_child' / 'custom_domain_child' (an apex buying
    # for a child of that hosting type). Each value:
    #   {active, units, price_inr, og_price_inr, min_qty, max_qty,
    #    billing_cycle}
    # units = how many of this add-on's limit/usage deltas ONE purchase
    # grants (grant = limits x units x quantity). min/max are purchase
    # bounds enforced cumulatively; max_qty null = uncapped.
    # billing_cycle is one of PERIOD_DAYS or 'one_time' (charged once,
    # kept while the main plan stays active). A missing/None tier is not
    # offered to that buyer. Null tiers entirely = legacy add-on: the
    # 'main' tier is synthesized from the scalar price columns at
    # purchase time (see effective_tier).
    tiers = db.Column(JSONB, nullable=True)

    def effective_tier(self, tier_key='main'):
        """The commercial terms for one buyer tier, or None when the
        add-on is not offered at that tier. Falls back to the legacy
        scalar prices for 'main' so pre-tier add-ons keep selling."""
        tiers = self.tiers if isinstance(self.tiers, dict) else None
        if tiers is not None:
            t = tiers.get(tier_key)
            if not isinstance(t, dict) or not t.get('active', True):
                return None
            return {
                'units': int(t.get('units') or 1),
                'price_inr': t.get('price_inr'),
                'og_price_inr': t.get('og_price_inr'),
                'min_qty': int(t.get('min_qty') or 1),
                'max_qty': (int(t['max_qty'])
                            if t.get('max_qty') not in (None, '') else None),
                'billing_cycle': t.get('billing_cycle') or 'monthly',
            }
        if tier_key != 'main':
            return None
        # Legacy shape: price picked by the buyer's period at purchase.
        return {
            'units': 1, 'price_inr': None, 'og_price_inr': None,
            'min_qty': 1, 'max_qty': None, 'billing_cycle': None,
        }

    def to_dict(self):
        return {
            'id': str(self.id),
            'code': self.code,
            'name': self.name,
            'description': self.description,
            'status': self.status.value,
            'price_inr_monthly': (
                float(self.price_inr_monthly) if self.price_inr_monthly is not None else None
            ),
            'og_price_inr_monthly': (
                float(self.og_price_inr_monthly) if self.og_price_inr_monthly is not None else None
            ),
            'price_inr_annual': (
                float(self.price_inr_annual) if self.price_inr_annual is not None else None
            ),
            'og_price_inr_annual': (
                float(self.og_price_inr_annual)
                if self.og_price_inr_annual is not None else None
            ),
            'features': self.features,
            'limits': self.limits,
            'usage_deltas': self.usage_deltas,
            'prerequisites': self.prerequisites or [],
            'tiers': self.tiers,
        }


# --------------------------------------------------------------------------- #
# TenantAddon — tenant ↔ addon link (tenant-scoped, RLS)
# --------------------------------------------------------------------------- #

class TenantAddon(TenantMixin, db.Model, TimestampMixin, SoftDeleteMixin, AuditMixin):
    __tablename__ = 'tenant_addons'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    addon_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('addons.id', ondelete='RESTRICT'),
        nullable=False,
        index=True,
    )
    status = db.Column(
        db.Enum(AddonSubscriptionStatus, name='addonsubstatus'),
        nullable=False,
        default=AddonSubscriptionStatus.ACTIVE,
    )
    billing_cycle = db.Column(
        db.Enum(BillingCycle, name='billingcycle'),
        nullable=False,
        default=BillingCycle.MONTHLY,
    )
    activated_at = db.Column(db.DateTime(timezone=True), nullable=False)
    current_period_start = db.Column(db.DateTime(timezone=True), nullable=False)
    # Null = a one_time purchase: no expiry of its own, lives and dies
    # with the main plan (held on suspension, revived on payment,
    # collapsed with the subscription).
    current_period_end = db.Column(db.DateTime(timezone=True), nullable=True)
    cancelled_at = db.Column(db.DateTime(timezone=True), nullable=True)
    activated_by_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )

    # Purchasable capacity multiplier: seat add-ons ("extra provider
    # seat") are bought N at a time; limit/usage deltas scale by it.
    quantity = db.Column(db.Integer, nullable=False, default=1,
                         server_default='1')

    # Which commercial tier this row was bought at, and the per-purchase
    # units multiplier SNAPSHOTTED from that tier at purchase time (so a
    # later catalogue edit never silently changes what a tenant already
    # paid for). Grant = addon.limits x units x quantity.
    tier = db.Column(db.String(24), nullable=False, default='main',
                     server_default='main')

    # RESALE STOCK, not an entitlement. An apex buys units from the
    # vendor at a child-tier price and holds them; its children then draw
    # from that pool when they buy. A stock row therefore sits on the
    # APEX but must never grant the apex anything — every resolver skips
    # it. Ordinary rows (is_stock=False) apply to the tenant they sit on,
    # exactly as before.
    is_stock = db.Column(db.Boolean, nullable=False, default=False,
                         server_default='false')
    units = db.Column(db.Integer, nullable=False, default=1,
                      server_default='1')

    addon = db.relationship('Addon', foreign_keys=[addon_id], lazy='joined')

    __table_args__ = (
        db.Index('ix_tenant_addons_tenant', 'tenant_id'),
        db.Index(
            'ux_tenant_addons_unique',
            'tenant_id', 'addon_id', 'is_stock',
            unique=True,
            postgresql_where=db.text('is_deleted = false'),
        ),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'tenant_id': str(self.tenant_id),
            'addon_id': str(self.addon_id),
            'addon_code': self.addon.code if self.addon else None,
            'status': self.status.value,
            'billing_cycle': self.billing_cycle.value,
            'quantity': self.quantity,
            'tier': self.tier,
            'is_stock': bool(self.is_stock),
            'units': self.units,
            'activated_at': self.activated_at.isoformat() if self.activated_at else None,
            'current_period_start': (
                self.current_period_start.isoformat() if self.current_period_start else None
            ),
            'current_period_end': (
                self.current_period_end.isoformat() if self.current_period_end else None
            ),
            'cancelled_at': self.cancelled_at.isoformat() if self.cancelled_at else None,
        }


# --------------------------------------------------------------------------- #
# TenantUsageCounter — atomic counters for monthly / daily / rolling windows
# --------------------------------------------------------------------------- #

class TenantUsageCounter(TenantMixin, db.Model):
    """One row per (tenant, metric, window, period_start).

    Hot path is ``UsageGate.check_and_increment`` which does a single
    upsert with ``count = count + :delta``. The composite uniqueness on
    ``(tenant_id, metric, window, period_start)`` keeps the upsert
    idempotent across concurrent requests.

    Window taxonomy:
      * ``monthly``  — calendar month or subscription period
      * ``daily``    — UTC day boundary
      * ``rolling``  — N-day window anchored to subscription start
    """
    __tablename__ = 'tenant_usage_counters'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    metric = db.Column(db.String(50), nullable=False)
    window = db.Column(db.String(20), nullable=False)
    period_start = db.Column(db.DateTime(timezone=True), nullable=False)
    period_end = db.Column(db.DateTime(timezone=True), nullable=False)
    count = db.Column(db.BigInteger, nullable=False, default=0)
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: __import__('datetime').datetime.now(__import__('datetime').timezone.utc),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: __import__('datetime').datetime.now(__import__('datetime').timezone.utc),
        onupdate=lambda: __import__('datetime').datetime.now(__import__('datetime').timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        db.UniqueConstraint(
            'tenant_id', 'metric', 'window', 'period_start',
            name='uq_tenant_usage_counter',
        ),
        db.Index(
            'ix_tenant_usage_counter_lookup',
            'tenant_id', 'metric', 'window', 'period_start',
        ),
    )

    def to_dict(self):
        return {
            'metric': self.metric,
            'window': self.window,
            'period_start': self.period_start.isoformat() if self.period_start else None,
            'period_end': self.period_end.isoformat() if self.period_end else None,
            'count': int(self.count),
        }
