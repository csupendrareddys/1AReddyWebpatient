"""Link payments to marketplace orders (service / group-service payments).

Payments were appointment-only. To charge for a service or group-service
purchase through the same Razorpay create-order/verify/webhook path, a payment
must be able to point at a ``MarketplaceOrder`` instead of an appointment.

Adds a nullable ``payments.order_id`` FK (``ON DELETE SET NULL`` so deleting an
order never destroys its payment audit trail). Exactly one of
``appointment_id`` / ``order_id`` is set per payment; both stay nullable and the
service layer enforces the choice.

Revision ID: paymnt7order8link9
Revises: grpsvc4chan5comm6
Create Date: 2026-07-23
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = 'paymnt7order8link9'
down_revision = 'grpsvc4chan5comm6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('payments', sa.Column(
        'order_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index('ix_payments_order_id', 'payments', ['order_id'])
    op.create_foreign_key(
        'fk_payments_order_id', 'payments', 'marketplace_orders',
        ['order_id'], ['order_id'], ondelete='SET NULL')


def downgrade():
    op.drop_index('ix_payments_order_id', table_name='payments')
    # Drop the column WITHOUT naming its FK first: dropping the column cascades
    # the constraint, and its name differs between a migration-built DB
    # (fk_payments_order_id) and a db.create_all()-bootstrapped one
    # (payments_order_id_fkey, which the CI roundtrip uses) — so a named
    # drop_constraint would raise UndefinedObject on the latter.
    op.drop_column('payments', 'order_id')
