"""Charge policy — the platform CHARGES (commission fees c1/c2/c3, each with its
own per-charge tax) billed to a doctor on every payout, kept in its own table
separate from the membership plan's commercial terms.

Why a separate table (mirrors :class:`app.models.credit_policy.CreditPolicy`):
the three charges and their taxes must be tunable WITHOUT re-versioning the plan
and WITHOUT waiting for a renewal — an admin edit here takes effect on the very
next payout, because :mod:`app.api.common.payment.billing_service` reads the live
policy by the doctor's active ``plan_id`` at payout time. Existing payouts are
unaffected (their charge amounts are snapshotted on the payout row).

One policy per plan (``uq(tenant_id, plan_id)``). Each charge carries:
    * ``name``       — invoice label (e.g. "Platform Fee")
    * ``type``       — ``percentage`` (of the payout base) | ``fixed`` (flat ₹)
    * ``value``      — the percentage or the flat amount
    * ``tax_type``   — ``percentage`` (of the charge) | ``fixed``
    * ``tax_value``  — the per-charge tax percentage or flat amount
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin


class ChargePolicy(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = 'charge_policies'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='policy_id')
    plan_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('membership_plans.id', ondelete='CASCADE', name='fk_charge_policies_plan_id'),
        nullable=False, index=True,
    )

    charge1_name = db.Column(db.String(100), nullable=False, default='Platform Fee')
    charge1_type = db.Column(db.String(20), nullable=False, default='percentage')
    charge1_value = db.Column(db.Numeric(10, 4), nullable=False, default=0)
    charge1_tax_type = db.Column(db.String(20), nullable=False, default='percentage')
    charge1_tax_value = db.Column(db.Numeric(10, 4), nullable=False, default=0)

    charge2_name = db.Column(db.String(100), nullable=False, default='Service Fee')
    charge2_type = db.Column(db.String(20), nullable=False, default='percentage')
    charge2_value = db.Column(db.Numeric(10, 4), nullable=False, default=0)
    charge2_tax_type = db.Column(db.String(20), nullable=False, default='percentage')
    charge2_tax_value = db.Column(db.Numeric(10, 4), nullable=False, default=0)

    charge3_name = db.Column(db.String(100), nullable=False, default='Processing Fee')
    charge3_type = db.Column(db.String(20), nullable=False, default='percentage')
    charge3_value = db.Column(db.Numeric(10, 4), nullable=False, default=0)
    charge3_tax_type = db.Column(db.String(20), nullable=False, default='percentage')
    charge3_tax_value = db.Column(db.Numeric(10, 4), nullable=False, default=0)

    # Kill-switch: when false, the plan levies NO platform charges (all three
    # resolve to zero) without wiping the configured values.
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'plan_id', name='uq_charge_policy_plan'),
    )

    def charge_specs(self):
        """The three ``(type, value, tax_type, tax_value)`` tuples, or all-zero
        when the policy is inactive."""
        if not self.is_active:
            z = ('percentage', 0, 'percentage', 0)
            return [z, z, z]
        return [
            (self.charge1_type, self.charge1_value, self.charge1_tax_type, self.charge1_tax_value),
            (self.charge2_type, self.charge2_value, self.charge2_tax_type, self.charge2_tax_value),
            (self.charge3_type, self.charge3_value, self.charge3_tax_type, self.charge3_tax_value),
        ]

    def charge_names(self):
        return [self.charge1_name or 'Charge 1', self.charge2_name or 'Charge 2',
                self.charge3_name or 'Charge 3']

    def to_dict(self):
        return {
            'id': str(self.id),
            'plan_id': str(self.plan_id),
            'is_active': self.is_active,
            'charge1_name': self.charge1_name, 'charge1_type': self.charge1_type,
            'charge1_value': float(self.charge1_value or 0),
            'charge1_tax_type': self.charge1_tax_type, 'charge1_tax_value': float(self.charge1_tax_value or 0),
            'charge2_name': self.charge2_name, 'charge2_type': self.charge2_type,
            'charge2_value': float(self.charge2_value or 0),
            'charge2_tax_type': self.charge2_tax_type, 'charge2_tax_value': float(self.charge2_tax_value or 0),
            'charge3_name': self.charge3_name, 'charge3_type': self.charge3_type,
            'charge3_value': float(self.charge3_value or 0),
            'charge3_tax_type': self.charge3_tax_type, 'charge3_tax_value': float(self.charge3_tax_value or 0),
        }
