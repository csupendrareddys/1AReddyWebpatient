"""Per-membership-plan discount on a display pricing rule

``MembershipPlan.member_discount_pct`` used to be applied flatly to every
offering a member bought. It becomes a CEILING instead, and
``display_pricing_rules.plan_discounts`` (``{membership_plan_id: pct}``) is
where an admin dials one doctor × offering below that ceiling.

Sparse by design: a plan absent from the map gets its own ceiling, so this is
a pure add-column with no backfill — every existing row keeps behaving exactly
as it did (full member discount everywhere) until an admin overrides something.

Revision ID: plandisc1cap2pct3
Revises: 34b3274d7b0c
Create Date: 2026-07-27
"""
from alembic import op
import sqlalchemy as sa


revision = 'plandisc1cap2pct3'
down_revision = '34b3274d7b0c'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('display_pricing_rules', schema=None) as batch_op:
        batch_op.add_column(sa.Column('plan_discounts', sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table('display_pricing_rules', schema=None) as batch_op:
        batch_op.drop_column('plan_discounts')
