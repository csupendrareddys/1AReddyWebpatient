"""Tenant-scoped provider-plan catalog — the "in-tenant marketplace."

This is a third product axis, distinct from both:
  * ``Plan`` / ``TenantSubscription``  — platform-owner-authored SaaS
    plans that a tenant subscribes to to get their own subdomain.
  * ``MembershipPlan`` / ``MembershipSubscription`` — platform-owner-
    authored apex marketplace tiers for doctors / clinics / hospitals
    who list on ``larazen.in`` itself.

This file's two tables let a SAAS TENANT author *their own*
plans for *their own* in-tenant providers:

  ``TenantProviderPlan``           — plan rows authored by the tenant
                                      (or by the platform owner on
                                      behalf of the tenant as a one-off
                                      ops operation). One vertical per
                                      row (``doctor`` / ``clinic`` /
                                      ``hospital``). NOT visible on the
                                      apex marketplace, ever.
  ``TenantProviderSubscription``   — binds a provider profile inside
                                      the tenant (Doctor / Clinic /
                                      Hospital row created via the
                                      tenant's signup flow) to one of
                                      the tenant's authored plans.

Gating rules — enforced in the service layer, not in the schema:

  * Tenant may only CREATE / EDIT plans for verticals their SaaS
    subscription unlocks (feature paths
    ``tenant.can_create_doctor_plans`` etc.). Removing the add-on
    soft-archives existing rows but doesn't delete subscriptions.
  * Tenant may not exceed the per-vertical provider-entity quota
    (``Plan.max_provider_doctors`` and siblings). Enforcement happens
    at provider-signup time, not on plan create — a plan with no
    subscribers is fine even if the quota is 0.
  * Cross-vertical mismatch is rejected: subscribing a Clinic profile
    to a doctor-vertical plan errors.

Tenant-scoped (TenantMixin) — RLS policies in the accompanying Alembic
migration ensure tenants only see their own rows. Platform-owner ops
endpoint bypasses RLS via the existing service-role connection.
"""
from __future__ import annotations

import uuid

from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.extensions import db
from app.models._base import (
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin,
)
from app.models._enums import (
    BillingCycle,
    MembershipPlanStatus,
    MembershipSubscriptionStatus,
    MembershipVertical,
)


# --------------------------------------------------------------------------- #
# TenantProviderPlan — tenant-authored provider-plan template
# --------------------------------------------------------------------------- #

class TenantProviderPlan(
    TenantMixin, db.Model, TimestampMixin, SoftDeleteMixin, AuditMixin,
):
    """One in-tenant provider plan tier, authored by the tenant.

    The tenant's super-admin uses this to publish a small catalog of
    plans (e.g. "Doctor — Starter", "Doctor — Pro", "Clinic — Basic")
    that providers signing up *inside that tenant's subdomain* must
    pick from. Verticals are independent — a tenant might only have
    doctor plans, or doctor + clinic, never hospital, etc.

    Reuses the marketplace enums (``MembershipVertical``,
    ``MembershipPlanStatus``) so the UI surfaces share components
    with the apex marketplace catalog — they're semantically the
    same shape, just scoped to a different audience.
    """
    __tablename__ = 'tenant_provider_plans'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Stable per-tenant identifier. NOT globally unique — different
    # tenants may both author a plan with code ``doctor_starter``
    # without conflict. Uniqueness is enforced (tenant_id, code) below.
    code = db.Column(db.String(60), nullable=False, index=True)
    name = db.Column(db.String(150), nullable=False)
    description = db.Column(db.Text, nullable=True)

    # No standalone ``index=True`` here on purpose — every real query
    # against this table comes through RLS-scoped sessions, which
    # already filter on ``tenant_id``. The composite index
    # ``ix_tenant_provider_plans_vertical`` below is keyed on
    # ``(tenant_id, vertical, status)`` and covers every lookup we
    # care about. Adding a single-column index would collide with
    # the composite's name (SQLAlchemy uses the same default name
    # ``ix_<table>_<column>`` for both) — that's what crashed CI on
    # first-time ``db.create_all()`` bootstrap.
    vertical = db.Column(
        db.Enum(MembershipVertical, name='membershipvertical',
                create_type=False),
        nullable=False,
    )

    # Pricing — NULL means "Contact us" / custom enquiry.
    price_inr_monthly = db.Column(db.Numeric(10, 2), nullable=True)
    og_price_inr_monthly= db.Column(db.Numeric(10, 2), nullable=True)
    price_inr_annual = db.Column(db.Numeric(10, 2), nullable=True)
    trial_days = db.Column(db.Integer, nullable=False, default=0)

    # Status — DRAFT plans are invisible to provider signup; ACTIVE plans
    # gate signup (provider MUST pick one if the tenant has the add-on
    # and ≥1 active plan in that vertical exists). ARCHIVED soft-hides
    # but keeps existing subscriptions intact.
    status = db.Column(
        db.Enum(MembershipPlanStatus, name='membershipplanstatus',
                create_type=False),
        nullable=False, default=MembershipPlanStatus.DRAFT,
    )

    # Free-form bullets / marketing copy / future feature flags.
    features = db.Column(JSONB, nullable=False, default=dict)

    # Order within a vertical on the signup picker. Defaults 10/20/30
    # by convention so a human can insert without renumbering.
    sort_order = db.Column(db.Integer, nullable=False, default=0)

    # Audit trail — who authored this plan. ``authored_by`` distinguishes
    # tenant self-service from a platform-owner ops author-on-behalf:
    #   * ``tenant`` — tenant super-admin via the in-tenant editor.
    #   * ``platform`` — platform owner via the ops endpoint.
    authored_by = db.Column(
        db.String(20), nullable=False, default='tenant',
    )

    __table_args__ = (
        db.Index(
            'ux_tenant_provider_plans_code',
            'tenant_id', 'code',
            unique=True,
            postgresql_where=db.text('is_deleted = false'),
        ),
        db.Index(
            'ix_tenant_provider_plans_vertical',
            'tenant_id', 'vertical', 'status',
        ),
        db.CheckConstraint(
            'trial_days >= 0', name='ck_tenant_provider_plan_trial_nonneg',
        ),
        db.CheckConstraint(
            "authored_by IN ('tenant', 'platform')",
            name='ck_tenant_provider_plan_authored_by',
        ),
    )

    def __repr__(self):
        return (
            f"<TenantProviderPlan tenant={self.tenant_id} "
            f"code={self.code} vertical={self.vertical.value}>"
        )

    def to_dict(self):
        return {
            'id': str(self.id),
            'tenant_id': str(self.tenant_id),
            'code': self.code,
            'name': self.name,
            'description': self.description,
            'vertical': self.vertical.value,
            'price_inr_monthly': (
                float(self.price_inr_monthly)
                if self.price_inr_monthly is not None else None
            ),
            'og_price_inr_monthly': float(self.og_price_inr_monthly) if self.og_price_inr_monthly is not None else None,
            'price_inr_annual': (
                float(self.price_inr_annual)
                if self.price_inr_annual is not None else None
            ),
            'trial_days': self.trial_days,
            'status': self.status.value,
            'features': self.features or {},
            'billing_terms': self.billing_terms(),
            'sort_order': self.sort_order,
            'authored_by': self.authored_by,
        }

    def billing_terms(self):
        """Normalized plan-driven billing config, read from the ``features`` JSONB
        (Phase A — kept in JSONB for consistency with ``payout_hold_days``; no
        migration). All keys optional; absent → no effect / fall back to the
        tenant BillingConfig.

        Shape::

            features['payout_hold_days']: int      # T-day payout hold
            features['per_patient_fee']:            # platform fee per per-patient
                {'mode': 'percentage'|'flat'|'none', 'value': number}
                # applies to Plan + Consultant (above-minimum) payouts
            features['salary_deduction']:           # deduction on salary/retainer
                {'mode': 'percentage'|'flat'|'none', 'value': number}
                # applies when the agreement's platform_fee_mode == 'plan'
                # (Employee + Consultant)
        """
        f = self.features or {}

        def _fee(key):
            d = f.get(key) or {}
            mode = d.get('mode') or 'none'
            val = d.get('value')
            if mode not in ('percentage', 'flat') or val in (None, ''):
                return {'mode': 'none', 'value': None}
            try:
                return {'mode': mode, 'value': float(val)}
            except (TypeError, ValueError):
                return {'mode': 'none', 'value': None}

        hd = f.get('payout_hold_days')
        try:
            hd = int(hd) if hd not in (None, '') else None
        except (TypeError, ValueError):
            hd = None

        def _num(v):
            if v in (None, ''):
                return None
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        # Employment/consultancy terms (Item 2A) — the shared terms a plan
        # carries for employee/consultant doctors. Per-doctor salary/retainer is
        # an override on the subscription (Item 2B); these are the plan defaults.
        emp = f.get('employment') or {}
        employment = {
            'min_hours_per_day': _num(emp.get('min_hours_per_day')),
            'min_hours_per_week': _num(emp.get('min_hours_per_week')),
            'min_hours_per_month': _num(emp.get('min_hours_per_month')),
            'day_window_start': emp.get('day_window_start') or None,   # 'HH:MM'
            'day_window_end': emp.get('day_window_end') or None,
            'per_type_minimums': emp.get('per_type_minimums') or {},   # {chat:2,...}
            'default_monthly_salary': _num(emp.get('default_monthly_salary')),
            'payment_cadence': emp.get('payment_cadence') or 'monthly',
            'default_base_retainer': _num(emp.get('default_base_retainer')),
            'retainer_cadence': emp.get('retainer_cadence') or 'monthly',
            # zero | plan | custom — how salary/retainer platform fee is taken.
            'platform_fee_mode': emp.get('platform_fee_mode') or 'zero',
        }

        oct_ = f.get('offered_consultation_types')
        if oct_ is not None and not isinstance(oct_, list):
            oct_ = None

        return {
            'payout_hold_days': hd,
            'per_patient_fee': _fee('per_patient_fee'),
            'salary_deduction': _fee('salary_deduction'),
            'employment': employment,
            # Ceiling of consultation types a doctor on this plan may offer
            # (Item 2E). None = no ceiling.
            'offered_consultation_types': oct_,
        }


# --------------------------------------------------------------------------- #
# TenantProviderSubscription — in-tenant provider ↔ tenant-plan link
# --------------------------------------------------------------------------- #

class TenantProviderSubscription(
    TenantMixin, db.Model, TimestampMixin, SoftDeleteMixin, AuditMixin,
):
    """Binds a provider profile inside a tenant to one of that tenant's
    authored plans.

    Polymorphic via ``provider_type`` + ``provider_id`` (mirrors
    ``MembershipSubscription``). The ``provider_id`` points at the
    matching profile row (``doctors`` / ``clinics`` / ``hospitals``).
    Validators (not DB FKs) enforce that the row exists in the same
    tenant_id — cross-tenant linkage is rejected.

    Lifecycle states mirror ``MembershipSubscriptionStatus`` —
    PENDING (created at signup, awaiting tenant-admin approval) →
    TRIAL → ACTIVE → CANCELLED. Trial clock anchors are set when the
    tenant admin approves (parallel to the marketplace flow).

    Partial uniqueness: at most one *active-ish* (PENDING/TRIAL/ACTIVE)
    subscription per provider profile per tenant.
    """
    __tablename__ = 'tenant_provider_subscriptions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    provider_type = db.Column(
        db.Enum(MembershipVertical, name='membershipvertical',
                create_type=False),
        nullable=False,
    )
    # Polymorphic — no DB-level FK because the target table varies by
    # ``provider_type``. Service-layer validator enforces it.
    provider_id = db.Column(UUID(as_uuid=True), nullable=False)

    tenant_provider_plan_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('tenant_provider_plans.id', ondelete='RESTRICT'),
        nullable=False, index=True,
    )

    billing_cycle = db.Column(
        db.Enum(BillingCycle, name='billingcycle', create_type=False),
        nullable=False, default=BillingCycle.MONTHLY,
    )
    status = db.Column(
        db.Enum(MembershipSubscriptionStatus,
                name='membershipsubscriptionstatus', create_type=False),
        nullable=False, default=MembershipSubscriptionStatus.PENDING,
    )

    trial_ends_at = db.Column(db.DateTime(timezone=True), nullable=True)
    current_period_start = db.Column(db.DateTime(timezone=True), nullable=True)
    current_period_end = db.Column(db.DateTime(timezone=True), nullable=True)
    cancelled_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Doctor-requested plan change (Phase A5). The provider requests a switch;
    # the active plan stays put until an admin approves — approval applies the
    # requested plan and clears both columns. NULL = no pending request.
    requested_plan_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('tenant_provider_plans.id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    requested_at = db.Column(db.DateTime(timezone=True), nullable=True)

    plan = db.relationship(
        'TenantProviderPlan',
        foreign_keys=[tenant_provider_plan_id], lazy='joined',
    )
    requested_plan = db.relationship(
        'TenantProviderPlan',
        foreign_keys=[requested_plan_id], lazy='joined',
    )

    __table_args__ = (
        db.Index(
            'ix_tenant_provider_subs_provider',
            'tenant_id', 'provider_type', 'provider_id',
        ),
        # One active-ish subscription per provider profile. Uppercase
        # enum labels match SQLAlchemy's ``db.Enum(PyEnum)`` storage
        # convention (Python member NAME, not ``.value``) — same
        # gotcha that bit ``ux_membership_subscriptions_active``.
        db.Index(
            'ux_tenant_provider_subs_active',
            'tenant_id', 'provider_type', 'provider_id',
            unique=True,
            postgresql_where=db.text(
                "is_deleted = false AND "
                "status IN ('PENDING', 'TRIAL', 'ACTIVE')"
            ),
        ),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'tenant_id': str(self.tenant_id),
            'user_id': str(self.user_id),
            'provider_type': self.provider_type.value,
            'provider_id': str(self.provider_id),
            'tenant_provider_plan_id': str(self.tenant_provider_plan_id),
            'plan_code': self.plan.code if self.plan else None,
            'plan_name': self.plan.name if self.plan else None,
            'billing_cycle': self.billing_cycle.value,
            'status': self.status.value,
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
            'requested_plan_id': (
                str(self.requested_plan_id) if self.requested_plan_id else None
            ),
            'requested_plan_name': (
                self.requested_plan.name if self.requested_plan else None
            ),
            'requested_at': (
                self.requested_at.isoformat() if self.requested_at else None
            ),
        }
