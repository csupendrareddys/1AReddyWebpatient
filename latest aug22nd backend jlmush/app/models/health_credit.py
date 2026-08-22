"""Health-credit wallet — a per-period rupee-value wallet a membership plan
grants to its subscriber, spendable at checkout on admin-whitelisted offerings.

  * 1 credit = ₹1 (a money wallet).
  * Granted each billing cycle, NO rollover — a new grant RESETS the balance and
    its expiry to the fresh amount / the new period end.
  * Spending is capped per booking by the plan's per-offering config (a max % of
    the booking's price AND an absolute ₹ ceiling — whichever is lower).

The ``HealthCreditLedger`` records every movement (grant / spend / refund /
expire) for audit and the patient's spending view.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin, utcnow


class HealthCreditWallet(TenantMixin, TimestampMixin, db.Model):
    """One wallet per user — holds their current plan's granted credits and when
    that grant expires (credits do not roll over across periods)."""
    __tablename__ = 'health_credit_wallets'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='wallet_id')
    user_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    balance = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    # When the current grant expires — the subscription's period end. Past this,
    # the balance is treated as 0 (a fresh grant resets it).
    period_end = db.Column(db.DateTime(timezone=True), nullable=True)
    plan_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('membership_plans.id', ondelete='SET NULL'),
        nullable=True,
    )

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'user_id', name='uq_health_credit_wallet_user'),
    )

    def available(self, now=None):
        """Spendable balance right now — 0 once the grant has expired."""
        now = now or utcnow()
        if self.period_end is not None and self.period_end < now:
            return 0.0
        return float(self.balance or 0)

    def to_dict(self, now=None):
        return {
            'id': str(self.id),
            'balance': float(self.balance or 0),
            'available': self.available(now),
            'period_end': self.period_end.isoformat() if self.period_end else None,
            'currency': 'INR',
        }


class HealthCreditLedger(TenantMixin, TimestampMixin, db.Model):
    """Append-only record of every credit movement."""
    __tablename__ = 'health_credit_ledger'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='ledger_id')
    wallet_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('health_credit_wallets.wallet_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    user_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    # Signed: positive for grant / refund, negative for spend / expire.
    amount = db.Column(db.Numeric(10, 2), nullable=False)
    kind = db.Column(db.String(20), nullable=False)  # grant | spend | refund | expire
    # Loose reference to what the credits were spent on / refunded from.
    ref_type = db.Column(db.String(30), nullable=True)   # appointment | order | group_booking
    ref_id = db.Column(UUID(as_uuid=True), nullable=True, index=True)
    note = db.Column(db.String(200), nullable=True)

    def to_dict(self):
        return {
            'id': str(self.id),
            'amount': float(self.amount or 0),
            'kind': self.kind,
            'ref_type': self.ref_type,
            'ref_id': str(self.ref_id) if self.ref_id else None,
            'note': self.note,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
