"""add payout_hold_days to membership_plans

Revision ID: 8dfd6eb651c9
Revises: slider4plat5land6
Create Date: 2026-07-20 00:07:59.484392

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '8dfd6eb651c9'
down_revision = 'slider4plat5land6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('membership_plans', schema=None) as batch_op:
        batch_op.add_column(sa.Column('payout_hold_days', sa.Integer(), nullable=True))
        batch_op.create_check_constraint(
            'ck_membership_plan_hold_nonneg',
            '(payout_hold_days IS NULL) OR (payout_hold_days >= 0)',
        )


def downgrade():
    with op.batch_alter_table('membership_plans', schema=None) as batch_op:
        batch_op.drop_constraint('ck_membership_plan_hold_nonneg', type_='check')
        batch_op.drop_column('payout_hold_days')
