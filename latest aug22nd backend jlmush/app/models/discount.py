"""Vouchers and coupons — flat ₹ reductions off a patient-facing price.

Two deliberately separate tables rather than one table with a ``kind`` column.
They are administered separately (an admin manages a voucher book and a coupon
book as distinct things), they are selected separately per pricing row, and they
are reported on separately. Collapsing them would mean every read filters on
``kind`` and every UI re-splits them again.

The two models are otherwise identical, so the shared columns live in
:class:`_DiscountMixin` and each concrete table just names itself. Amounts are
a flat rupee value: the admin picks which vouchers/coupons apply to a given
doctor × offering, and each selected one subtracts its ``amount`` straight off
the display price.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin, AuditMixin, SoftDeleteMixin


class _DiscountMixin(TenantMixin, TimestampMixin, AuditMixin, SoftDeleteMixin):
    """Columns shared by vouchers and coupons.

    Soft-deleted rather than hard-deleted: a pricing rule may still reference
    the id, and a price that silently changed because a row vanished is worse
    than one that keeps applying until an admin clears the selection.
    """

    #: Short admin-facing handle ('WELCOME50'). Unique per tenant so two
    #: vouchers can't share a code within one clinic.
    code = db.Column(db.String(40), nullable=False)

    #: Human label shown next to the code in the picker.
    label = db.Column(db.String(160), nullable=True)

    #: Flat ₹ taken off the display price. Percentage discounts are already
    #: covered by the rule's ``overall_discount_pct``; keeping these flat is
    #: what makes "subtract directly" unambiguous.
    amount = db.Column(db.Numeric(10, 2), nullable=False, default=0,
                       server_default='0')

    #: Inactive rows stay selectable-but-ignored: they keep their history and
    #: stop affecting prices without an admin having to unpick every row.
    is_active = db.Column(db.Boolean, nullable=False, default=True,
                          server_default=db.text('true'), index=True)

    def to_dict(self):
        return {
            'id': str(self.id),
            'code': self.code,
            'label': self.label or '',
            'amount': float(self.amount or 0),
            'is_active': bool(self.is_active),
        }


class Voucher(_DiscountMixin, db.Model):
    __tablename__ = 'vouchers'
    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'code', name='uq_voucher_tenant_code'),
    )

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                   name='voucher_id')

    def __repr__(self):
        return f'<Voucher {self.code} ₹{self.amount}>'


class Coupon(_DiscountMixin, db.Model):
    __tablename__ = 'coupons'
    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'code', name='uq_coupon_tenant_code'),
    )

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                   name='coupon_id')

    def __repr__(self):
        return f'<Coupon {self.code} ₹{self.amount}>'
