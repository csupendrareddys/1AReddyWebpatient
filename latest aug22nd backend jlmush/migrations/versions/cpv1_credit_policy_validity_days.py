"""add validity_days to credit_policies

Admin-configurable credit expiration: how many days a grant stays valid,
measured from the grant. NULL preserves the original behaviour (expire at
the subscription's billing-period end). Setting it takes effect immediately
for all current wallets on the plan.

Revision ID: cpv1_credit_policy_validity
Revises: f3e5a28c97b5
Create Date: 2026-08-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'cpv1_credit_policy_validity'
down_revision = 'f3e5a28c97b5'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('credit_policies', schema=None) as batch_op:
        batch_op.add_column(sa.Column('validity_days', sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table('credit_policies', schema=None) as batch_op:
        batch_op.drop_column('validity_days')
