"""Per-membership-plan voucher / coupon selections on a display pricing rule

``display_pricing_rules.voucher_ids`` / ``coupon_ids`` already hold the flat ₹
rows an admin marked applicable to one doctor × offering. Those apply to
everybody, so they are baked into the displayed price.

These two columns are the same selection scoped to ONE membership plan —
``{membership_plan_id: [discount_id, ...]}`` — and they cannot be baked in for
the same reason ``plan_discounts`` cannot: the price is quoted before we know
who is looking. They come off at purchase, after that plan's percentage, and
only for holders of that plan.

Sparse and additive: a plan absent from the map gets nothing extra, so every
existing row keeps behaving exactly as it did until an admin picks something.

Revision ID: planvouch1coup2
Revises: apprstatuscancel1
Create Date: 2026-07-28
"""
from alembic import op
import sqlalchemy as sa


revision = 'planvouch1coup2'
down_revision = '3f1cefde8fe0'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('display_pricing_rules', schema=None) as batch_op:
        batch_op.add_column(sa.Column('plan_voucher_ids', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('plan_coupon_ids', sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table('display_pricing_rules', schema=None) as batch_op:
        batch_op.drop_column('plan_coupon_ids')
        batch_op.drop_column('plan_voucher_ids')
