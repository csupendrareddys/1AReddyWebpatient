"""Credit policy — the redemption RULES for a membership plan's health credits,
kept in its own table (separate from the plan's commercial terms).

Why a separate table: the constraints (how many credits a plan grants per period,
and the per-offering caps a subscriber may redeem) must be tunable WITHOUT
touching / re-versioning the plan and WITHOUT waiting for a renewal — an admin
edit here reflects immediately on the subscriber side, because
:mod:`app.api.membership.credit_service` reads the live policy at grant/quote
time by ``plan_id``.

One policy per plan (``uq(tenant_id, plan_id)``). ``scopes`` is keyed by an
offering scope — a consultation-type value (``video``/``audio``/``chat``/…),
``service`` (marketplace), ``group`` (health plan), or ``membership`` (redeem
toward a membership renewal):

    { "video": {"allowed": true, "max_pct": 50, "max_amount": 100}, ... }

``max_pct`` caps credits at a % of the payable amount; ``max_amount`` an absolute
₹ ceiling — the lower of the two (and the wallet balance) applies.
"""
import uuid

from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin


class CreditPolicy(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = 'credit_policies'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='policy_id')
    plan_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('membership_plans.id', ondelete='CASCADE', name='fk_credit_policies_plan_id'),
        nullable=False, index=True,
    )
    # Credits (₹, 1 credit = ₹1) granted to the subscriber each billing period —
    # reset (not accumulated) each cycle. 0 = plan grants no credits.
    grant_amount = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    # Per-offering redemption rules (see module docstring).
    scopes = db.Column(JSONB, nullable=False, default=dict)
    # A kill-switch: when false the plan's credits can't be redeemed anywhere
    # (grants still happen; nothing is spendable). Lets an admin freeze
    # redemption without wiping the per-scope config.
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    # How many days a grant stays valid, measured from the grant. ``None`` =
    # use the subscription's billing-period end (the original behaviour). When
    # an admin sets this, it takes effect immediately for all current wallets
    # on the plan (their expiry is recomputed to now + validity_days).
    validity_days = db.Column(db.Integer, nullable=True)

    # ── Family-doctor "second opinion" commission ────────────────────────
    # Credits granted to an empanelled patient's family doctor for each
    # completed consultation/service the patient books (from any doctor), and
    # the minimum credits a doctor must hold before redeeming to cash. Both
    # plan-based (per this plan); the grant is overridable per-doctor on
    # DoctorBillingProfile. 0 = feature off for the plan.
    second_opinion_grant = db.Column(db.Numeric(10, 2), nullable=False, default=0,
                                     server_default='0')
    second_opinion_redeem_threshold = db.Column(db.Numeric(10, 2), nullable=False,
                                                 default=0, server_default='0')
    # Per-booking-type grant overrides {consultation, service, group}. A type
    # present here wins over the flat ``second_opinion_grant`` for that type;
    # absent falls back to the flat rate. Lets the admin pay differently for a
    # consultation vs a service vs a group plan.
    second_opinion_grants = db.Column(JSONB, nullable=False, default=dict,
                                      server_default='{}')
    # Percentage-of-booking-price variant (1 credit = ₹1, so credits =
    # price * pct / 100). Flat default + per-type. When BOTH a flat and a
    # percentage apply to a booking, the doctor earns the MIN of the two.
    second_opinion_pct = db.Column(db.Numeric(5, 2), nullable=False, default=0,
                                   server_default='0')
    second_opinion_pcts = db.Column(JSONB, nullable=False, default=dict,
                                    server_default='{}')

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'plan_id', name='uq_credit_policy_plan'),
    )

    def scope(self, offering_scope):
        """The rule dict for one offering scope (``{}`` when unset)."""
        if not self.is_active:
            return {}
        return (self.scopes or {}).get(offering_scope) or {}

    def to_dict(self):
        return {
            'id': str(self.id),
            'plan_id': str(self.plan_id),
            'grant_amount': float(self.grant_amount or 0),
            'scopes': self.scopes or {},
            'is_active': self.is_active,
            'validity_days': self.validity_days,
            'second_opinion_grant': float(self.second_opinion_grant or 0),
            'second_opinion_redeem_threshold': float(self.second_opinion_redeem_threshold or 0),
            'second_opinion_grants': self.second_opinion_grants or {},
            'second_opinion_pct': float(self.second_opinion_pct or 0),
            'second_opinion_pcts': self.second_opinion_pcts or {},
        }
