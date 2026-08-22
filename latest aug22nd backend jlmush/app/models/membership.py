"""Marketplace membership models — distinct from the SaaS ``Plan`` line.

The two product lines:
  * SaaS tenant plans (``Plan`` / ``TenantSubscription``) — a clinic
    subscribes to get their own subdomain tenant.
  * Marketplace memberships (this file) — doctors, clinics, and
    hospitals register *on* the apex (``larazen.in``) as participants.
    Patients on the apex discover and book them. Larazen takes a
    platform fee / commission and pays providers out.

A provider can hold both — they're independent.

Round 1 ships the schema and catalog CRUD only. The
``MembershipSubscription`` table sits dormant: Round 2 wires the
signup-to-subscription flow, payouts, and feature gating.
"""
from __future__ import annotations

import uuid

from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin
from app.models._enums import (
    BillingCycle,
    MembershipPlanStatus,
    MembershipSubscriptionStatus,
    MembershipTier,
    MembershipVertical,
)


# --------------------------------------------------------------------------- #
# MembershipPlan — per-tenant marketplace catalog (tenant-scoped, RLS)
# --------------------------------------------------------------------------- #

class MembershipPlan(TenantMixin, db.Model, TimestampMixin, SoftDeleteMixin, AuditMixin):
    """One marketplace membership tier authored by a tenant.

    Tenant-scoped (``TenantMixin`` → ``tenant_id`` + RLS). Each tenant —
    the apex/default tenant included — authors its own membership tiers
    for providers who pay to list on that tenant's marketplace. Gated
    per-vertical by ``tenant.can_create_membership_<vertical>_plans``
    (enforced at the route layer, mirroring ``TenantProviderPlan``).

    The ``features`` column is free-form JSON — it stores the marketing
    bullet copy under each card.
    """
    __tablename__ = 'membership_plans'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Unique per tenant, not globally — see the ``ux_membership_plans_tenant_code``
    # partial-unique index below. Kept ``index=True`` for code lookups.
    code = db.Column(db.String(60), nullable=False, index=True)
    name = db.Column(db.String(150), nullable=False)
    description = db.Column(db.Text, nullable=True)
    tier = db.Column(
        db.Enum(MembershipTier, name='membershiptier'),
        nullable=False,
    )

    # ``Null`` = "Contact us / custom" — pricing page renders an enquiry
    # CTA instead of a button with a number.
    trial_days = db.Column(db.Integer, nullable=False, default=0)
    pricing = db.Column(JSONB, nullable=True)

    # T-day payout hold applied to a subscribed doctor's earnings, same
    # semantics as ``TenantProviderPlan.features['payout_hold_days']``.
    # ``None`` = plan doesn't set a hold (falls through to tenant default
    # in ``resolve_hold_days``); mirrors the nullable-override pattern of
    # ``DoctorBillingProfile.hold_days_override`` rather than defaulting
    # to 0, so "unset" and "explicitly zero" stay distinguishable.
    payout_hold_days = db.Column(db.Integer, nullable=True)

    # Round 1 stores commission_pct + platform_fee_inr but nothing
    # enforces them. Round 2's booking pipeline will read these to
    # split each appointment payment between platform + provider.
    commission_pct = db.Column(db.Numeric(5, 2), nullable=True)
    platform_fee_inr = db.Column(db.Numeric(10, 2), nullable=True)

    # The MAXIMUM % a holder of this membership gets off the patient-facing
    # price of any one offering — a consultation slot or a catalog service.
    # The tier's headline benefit ("up to 20% off everything"), which is why
    # the plan cards can quote it without a lookup per row.
    #
    # A ceiling rather than a rate: it was applied flatly at first, which
    # meant a tier promising 20% took 20% off offerings the platform makes
    # no margin on as readily as off the ones it does.
    # ``DisplayPricingRule.plan_discounts`` now carries a per-offering rate
    # for each plan and this bounds it — an offering with no entry grants
    # the full number here, so the flat behaviour remains the default and
    # lowering this number lowers every offering riding on it.
    #
    # Distinct from ``DisplayPricingRule.overall_discount_pct``, which
    # marks down ONE doctor × offering for everybody. That one is baked
    # into the displayed price (and is what a card's strikethrough
    # advertises); this one is subtracted from it at purchase time,
    # because it depends on who is buying.
    #
    # Nullable-with-0-default rather than plain 0: "this tier grants no
    # member discount" and "nobody has typed a number yet" both read as no
    # discount, so there's nothing to distinguish — but keeping it nullable
    # lets an older row exist without a backfill.
    member_discount_pct = db.Column(
        db.Numeric(5, 2), nullable=True, default=0, server_default='0',
    )

    # The three platform charges that were previously tenant-wide on
    # ``BillingConfig`` (charge1/2/3). They now live per-plan so each
    # membership tier defines its own deductions on a subscribed
    # provider's appointment earnings. Each is a ``percentage`` of the
    # payment or a ``fixed`` ₹ amount. Mirrors the BillingConfig column
    # shape (name/type/value ×3) so the compute helper is identical.
    # A doctor with no active membership plan gets zero charges (see
    # ``compute_platform_charges`` in billing_service) — that's why the
    # value columns default 0 rather than being nullable "unset".
    # Each charge carries an optional tax (fixed ₹ or % OF THE CHARGE). The
    # amount deducted from the payout is the charge INCLUSIVE of its tax; the
    # rest of the GST/TDS breakdown is unchanged. Default 0 → no per-charge tax.
    charge1_name = db.Column(db.String(100), default='Platform Fee', server_default='Platform Fee', nullable=False)
    charge1_type = db.Column(db.String(20), default='percentage', server_default='percentage', nullable=False)
    charge1_value = db.Column(db.Numeric(10, 4), default=0, server_default='0', nullable=False)
    charge1_tax_type = db.Column(db.String(20), default='percentage', server_default='percentage', nullable=False)
    charge1_tax_value = db.Column(db.Numeric(10, 4), default=0, server_default='0', nullable=False)

    charge2_name = db.Column(db.String(100), default='Service Fee', server_default='Service Fee', nullable=False)
    charge2_type = db.Column(db.String(20), default='percentage', server_default='percentage', nullable=False)
    charge2_value = db.Column(db.Numeric(10, 4), default=0, server_default='0', nullable=False)
    charge2_tax_type = db.Column(db.String(20), default='percentage', server_default='percentage', nullable=False)
    charge2_tax_value = db.Column(db.Numeric(10, 4), default=0, server_default='0', nullable=False)

    charge3_name = db.Column(db.String(100), default='Processing Fee', server_default='Processing Fee', nullable=False)
    charge3_type = db.Column(db.String(20), default='percentage', server_default='percentage', nullable=False)
    charge3_value = db.Column(db.Numeric(10, 4), default=0, server_default='0', nullable=False)
    charge3_tax_type = db.Column(db.String(20), default='percentage', server_default='percentage', nullable=False)
    charge3_tax_value = db.Column(db.Numeric(10, 4), default=0, server_default='0', nullable=False)

    # When True, a member on this plan whose trial/subscription lapses is sent
    # to the vendor "holding page" (admin chat) instead of keeping dashboard
    # access. Admin-toggleable per plan.
    holding_enabled = db.Column(
        db.Boolean, nullable=False, default=True, server_default='true',
    )

    status = db.Column(
        db.Enum(MembershipPlanStatus, name='membershipplanstatus'),
        nullable=False, default=MembershipPlanStatus.DRAFT,
    )

    # Surfaced on the public pricing page as a "Most Popular" badge.
    is_featured = db.Column(db.Boolean, nullable=False, default=False)
    is_legacy = db.Column(db.Boolean, nullable=False, default=True)

    # An ACTIVE plan is only offered for self-serve signup on the public landing
    # when this is True. An active-but-unpublished plan exists and works but can
    # only be assigned to a member by an admin.
    publish_on_landing = db.Column(
        db.Boolean, nullable=False, default=False, server_default=db.text('false'),
    )

    # Free-form marketing copy / future feature-flag map. JSONB for
    # cheap GIN indexability if Round 2 needs to query inside it.
    features = db.Column(JSONB, nullable=False, default=dict)
    benefits = db.Column(JSONB, nullable=True, default=list)

    # ── Capacity caps ─────────────────────────────────────────────────────
    # How many support staff a member on this tier may employ, and how many
    # My Link affiliations they may hold. Columns rather than keys inside
    # ``features`` for the same reason ``Plan.max_*`` are: every staff-create
    # and every link-accept runs a count-vs-limit check, and digging into JSONB
    # on that path buys nothing.
    #
    # Sentinel — and it is deliberately NOT the one ``Plan.max_provider_*``
    # uses. There, NULL means "legacy row, deny until backfilled". Here NULL
    # means **unlimited**, because these columns arrive on a table whose rows
    # are already subscribed to: reading an un-backfilled NULL as 0 would take
    # support staff away from every existing member the moment this deploys.
    # 0 stays meaningful ("this tier grants none") and a positive int is a cap.
    # ``-1`` is normalised to NULL on the way in so "unlimited" has exactly one
    # representation to render and compare against.
    #
    # A cap refuses the NEXT one; it never severs what a member already holds.
    # Moving someone to a smaller tier can leave them legitimately over — see
    # ``app.api.membership.limits``.
    max_support_staff = db.Column(db.Integer, nullable=True)
    max_link_connections = db.Column(db.Integer, nullable=True)

    # ── Health-credit constraints ─────────────────────────────────────────
    # The credit GRANT + per-offering redemption caps used to live here
    # (``credit_grant`` / ``credit_config``). They moved to the ``credit_policies``
    # table (``app.models.credit_policy.CreditPolicy``, one per plan) so an admin
    # can retune them live, without re-versioning the plan or waiting for a
    # renewal. Read them via ``app.api.membership.credit_service``.

    # Explicit ordering within a vertical. Defaults seeded 10/20/30 per
    # tier so a human can re-order without touching neighbours.
    sort_order = db.Column(db.Integer, nullable=False, default=0)
    vertical_plan_type_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey("vertical_plan_types.id", ondelete="RESTRICT", name="fk_plans_vetical_plan_type_id"),
        nullable=True,
        index=True,
    )
    vertical_plan_type = db.relationship("VerticalPlanType", back_populates="membership_plans", lazy="joined")

    __table_args__ = (
        # Code is unique WITHIN a tenant (partial on soft-delete so a
        # deleted plan's code can be reused) — mirrors
        # ``ux_tenant_provider_plans_code``. Replaces the old global
        # unique on ``code``.
        db.Index(
            'ux_membership_plans_tenant_code',
            'tenant_id', 'code',
            unique=True,
            postgresql_where=db.text('is_deleted = false'),
        ),
        # Non-unique compound index — keeps the public pricing-page
        # query (filter by vertical, order by sort_order) cheap. The
        # OLD unique variant (one plan per (vertical, tier)) was
        # dropped in migration ``g3b4c5d6e7f8`` so the platform owner
        # can author N plans per (vertical, tier).
        db.Index('ix_membership_plans_status', 'status'),
        db.CheckConstraint('trial_days >= 0', name='ck_membership_plan_trial_nonneg'),
        db.CheckConstraint(
            '(payout_hold_days IS NULL) OR (payout_hold_days >= 0)',
            name='ck_membership_plan_hold_nonneg',
        ),
        db.CheckConstraint(
            '(commission_pct IS NULL) OR '
            '(commission_pct >= 0 AND commission_pct <= 100)',
            name='ck_membership_plan_commission_pct_range',
        ),
        db.CheckConstraint(
            '(member_discount_pct IS NULL) OR '
            '(member_discount_pct >= 0 AND member_discount_pct <= 100)',
            name='ck_membership_plan_member_discount_pct_range',
        ),
        # charge*_type is a free string column (same as BillingConfig) but
        # only two values are meaningful; guard them at the DB so a bad
        # write can't silently make the compute helper fall through to the
        # "fixed" branch.
        db.CheckConstraint(
            "charge1_type IN ('percentage', 'fixed') AND "
            "charge2_type IN ('percentage', 'fixed') AND "
            "charge3_type IN ('percentage', 'fixed')",
            name='ck_membership_plan_charge_type',
        ),
        db.CheckConstraint(
            'charge1_value >= 0 AND charge2_value >= 0 AND charge3_value >= 0',
            name='ck_membership_plan_charge_value_nonneg',
        ),
        # NULL is unlimited, so a negative number has no meaning left to carry.
        # The route normalises ``-1`` to NULL; this stops anything that skips
        # the route from writing a second spelling of "unlimited".
        db.CheckConstraint(
            '(max_support_staff IS NULL OR max_support_staff >= 0) AND '
            '(max_link_connections IS NULL OR max_link_connections >= 0)',
            name='ck_membership_plan_capacity_nonneg',
        ),
    )

    def __repr__(self):
        return f"<MembershipPlan {self.code} ({self.vertical_plan_type.code}/{self.tier.value})>"

    def to_dict(self):
        data = {
            'id': str(self.id),
            'tenant_id': str(self.tenant_id) if self.tenant_id else None,
            'code': self.code,
            'name': self.name,
            'description': self.description,
            'tier': self.tier.value,
            'trial_days': self.trial_days,
            'payout_hold_days': self.payout_hold_days,
            'commission_pct': (
                float(self.commission_pct)
                if self.commission_pct is not None else None
            ),
            'platform_fee_inr': (
                float(self.platform_fee_inr)
                if self.platform_fee_inr is not None else None
            ),
            # Always a number for the client — a null column and an
            # explicit 0 mean the same thing to every reader, and the
            # cards would otherwise have to null-guard before formatting.
            'member_discount_pct': float(self.member_discount_pct or 0),
            'charge1_name': self.charge1_name,
            'charge1_type': self.charge1_type,
            'charge1_value': str(self.charge1_value),
            'charge1_tax_type': self.charge1_tax_type,
            'charge1_tax_value': str(self.charge1_tax_value),
            'charge2_name': self.charge2_name,
            'charge2_type': self.charge2_type,
            'charge2_value': str(self.charge2_value),
            'charge2_tax_type': self.charge2_tax_type,
            'charge2_tax_value': str(self.charge2_tax_value),
            'charge3_name': self.charge3_name,
            'charge3_type': self.charge3_type,
            'charge3_value': str(self.charge3_value),
            'charge3_tax_type': self.charge3_tax_type,
            'charge3_tax_value': str(self.charge3_tax_value),
            'holding_enabled': self.holding_enabled,
            # Nested rather than flat so every reader — the admin form, the
            # plan cards, the provider's own usage meter — takes the same two
            # keys, and adding a third cap later doesn't mean teaching each of
            # them a new top-level field name. ``None`` is unlimited.
            'limits': {
                'support_staff': self.max_support_staff,
                'my_links': self.max_link_connections,
            },
            'status': self.status.value,
            'is_featured': self.is_featured,
            'publish_on_landing': self.publish_on_landing,
            'is_legacy': self.is_legacy,
            'features': self.features or {},
            'sort_order': self.sort_order,
            'benefits': self.benefits or [],
            'vertical_plan_type': self.vertical_plan_type.to_dict() if self.vertical_plan_type else None

        }
        if self.pricing is not None:
            for key, value in self.pricing.items():
                data[key] = float(value)

        return data


## Vertical PLANTYPE TABLE
class VerticalPlanType(TenantMixin, db.Model):
    """The provider/receiver verticals a tenant sells membership tiers for.

    Tenant-scoped (``TenantMixin`` → ``tenant_id`` + RLS) like
    ``MembershipPlan`` itself: each tenant owns its own set of verticals, so
    one tenant renaming "Clinic" or adding a custom vertical can't alter
    another tenant's /join tabs. Every tenant is seeded with the same base
    four (doctor / clinic / hospital / patient) — see migration
    ``vpt1tenant2scope3`` — because these rows drive the public /join persona
    picker, and a tenant with none would render an empty page.

    ``code`` is unique WITHIN a tenant, not globally (see
    ``ux_vertical_plan_types_tenant_code``), so two tenants may each have
    their own ``doctor`` row.
    """
    __tablename__ = "vertical_plan_types"

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = db.Column(db.String(50), nullable=False, index=True)
    name = db.Column(db.String(150), nullable=False)
    description = db.Column(db.String, nullable=True)
    icon_key = db.Column(db.String, nullable=True)
    is_receiver = db.Column(db.Boolean, nullable=True, default=False)
    # Explicit display order for the public pricing page. Lower sorts
    # first; ties fall back to name. Data-driven so a human can re-order
    # without a code change (mirrors MembershipPlan.sort_order).
    sort_order = db.Column(db.Integer, nullable=False, default=0)

    membership_plans = db.relationship("MembershipPlan", back_populates="vertical_plan_type")

    __table_args__ = (
        db.Index(
            'ux_vertical_plan_types_tenant_code',
            'tenant_id', 'code', unique=True,
        ),
    )

    def to_dict(self):
        return {
            "id": str(self.id),
            "tenant_id": str(self.tenant_id) if self.tenant_id else None,
            "code": self.code,
            "name": self.name,
            "icon_key": self.icon_key,
            "description": self.description,
            "is_receiver": self.is_receiver,
            "sort_order": self.sort_order,
        }


# --------------------------------------------------------------------------- #
# MembershipSubscription — provider ↔ plan link
# --------------------------------------------------------------------------- #
# Created in Round 1 so Round 2 doesn't need a second migration. Dormant
# until Round 2 wires the signup flow.
# --------------------------------------------------------------------------- #

class MembershipSubscription(
    TenantMixin, db.Model, TimestampMixin, SoftDeleteMixin, AuditMixin,
):
    """Active marketplace membership for one provider profile.

    Polymorphic via ``provider_type`` + ``provider_id``: validators (not
    DB-level FKs) enforce that ``provider_id`` points at the right table
    for the ``provider_type`` value. The matching ``MembershipPlan.vertical``
    must agree.

    Tenant-scoped (``TenantMixin`` → ``tenant_id`` + RLS): a subscription
    belongs to the tenant whose membership plan it points at, so the same
    provider can hold an active membership in more than one tenant's
    marketplace. The active-uniqueness is therefore per-tenant.
    """
    __tablename__ = 'membership_subscriptions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    provider_type = db.Column(
        db.Enum(MembershipVertical, name='membershipvertical'),
        nullable=False,
    )
    # Polymorphic — no DB-level FK because the target table varies by
    # ``provider_type``. Service-layer validator enforces it.
    provider_id = db.Column(UUID(as_uuid=True), nullable=False)

    membership_plan_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('membership_plans.id', ondelete='RESTRICT'),
        nullable=False, index=True,
    )

    billing_cycle = db.Column(
        db.Enum(BillingCycle, name='billingcycle'),
        nullable=False, default=BillingCycle.MONTHLY,
    )
    # The billing PERIOD the member last paid for — one of the six pricing
    # periods a plan can offer ('monthly'|'quarterly'|'semi_annual'|'annual'|
    # 'biennial'|'triennial'). ``billing_cycle`` only distinguishes monthly vs
    # annual; this carries the exact period so proration (per-day = price/cycle)
    # and the next period window are computed against what was actually bought.
    # Null until a first paid activation (trial members haven't chosen one).
    plan_period = db.Column(db.String(20), nullable=True)
    status = db.Column(
        db.Enum(MembershipSubscriptionStatus, name='membershipsubscriptionstatus'),
        nullable=False, default=MembershipSubscriptionStatus.TRIAL,
    )

    trial_ends_at = db.Column(db.DateTime(timezone=True), nullable=True)
    current_period_start = db.Column(db.DateTime(timezone=True), nullable=True)
    current_period_end = db.Column(db.DateTime(timezone=True), nullable=True)
    cancelled_at = db.Column(db.DateTime(timezone=True), nullable=True)
    # Admin disciplinary hold: when True the member is sent to the holding page
    # (admin chat) regardless of subscription/trial status or the plan toggle.
    on_hold = db.Column(db.Boolean, nullable=False, default=False, server_default='false')

    plan = db.relationship(
        'MembershipPlan', foreign_keys=[membership_plan_id], lazy='joined',
    )

    __table_args__ = (
        db.Index(
            'ix_membership_subscriptions_provider',
            'provider_type', 'provider_id',
        ),
        # One active membership per provider profile PER TENANT — the
        # same provider may be an active member of several tenants'
        # marketplaces, so ``tenant_id`` leads the index. Enum literals
        # are uppercase because SQLAlchemy's ``db.Enum(PyEnum)`` stores
        # the Python member NAME, not ``.value`` — same convention as
        # ``planstatus``/``subscriptionstatus``. Lowercase here is what
        # bit us on first-time ``db.create_all()`` bootstrap (CI failed
        # before migrations ran with: ``invalid input value for enum
        # membershipsubscriptionstatus: "trial"``).
        db.Index(
            'ux_membership_subscriptions_active',
            'tenant_id', 'provider_type', 'provider_id',
            unique=True,
            postgresql_where=db.text(
                "is_deleted = false AND status IN ('TRIAL', 'ACTIVE')"
            ),
        ),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'tenant_id': str(self.tenant_id) if self.tenant_id else None,
            'user_id': str(self.user_id),
            'provider_type': self.provider_type.value,
            'provider_id': str(self.provider_id),
            'membership_plan_id': str(self.membership_plan_id),
            'membership_plan_code': self.plan.code if self.plan else None,
            'billing_cycle': self.billing_cycle.value,
            'plan_period': self.plan_period,
            'status': self.status.value,
            'on_hold': self.on_hold,
            'trial_ends_at': (
                self.trial_ends_at.isoformat() if self.trial_ends_at else None
            ),
            'current_period_start': (
                self.current_period_start.isoformat()
                if self.current_period_start else None
            ),
            'current_period_end': (
                self.current_period_end.isoformat()
                if self.current_period_end else None
            ),
            'cancelled_at': (
                self.cancelled_at.isoformat() if self.cancelled_at else None
            ),
        }
