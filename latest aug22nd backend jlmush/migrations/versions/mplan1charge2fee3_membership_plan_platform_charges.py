"""add platform charges (charge1/2/3) to membership_plans

Moves the three platform charges (name/type/value each) off the tenant-wide
``billing_configs`` table onto each ``membership_plans`` row, so a membership
tier defines its own deductions on a subscribed provider's earnings.
BillingConfig keeps its own charge columns (untouched here) — the app just
stops editing/reading them for payout math.

Revision ID: mplan1charge2fee3
Revises: pat1ent2plan3vert
Create Date: 2026-07-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'mplan1charge2fee3'
down_revision = 'pat1ent2plan3vert'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('membership_plans', schema=None) as batch_op:
        batch_op.add_column(sa.Column(
            'charge1_name', sa.String(length=100),
            nullable=False, server_default='Platform Fee'))
        batch_op.add_column(sa.Column(
            'charge1_type', sa.String(length=20),
            nullable=False, server_default='percentage'))
        batch_op.add_column(sa.Column(
            'charge1_value', sa.Numeric(10, 4),
            nullable=False, server_default='0'))

        batch_op.add_column(sa.Column(
            'charge2_name', sa.String(length=100),
            nullable=False, server_default='Service Fee'))
        batch_op.add_column(sa.Column(
            'charge2_type', sa.String(length=20),
            nullable=False, server_default='percentage'))
        batch_op.add_column(sa.Column(
            'charge2_value', sa.Numeric(10, 4),
            nullable=False, server_default='0'))

        batch_op.add_column(sa.Column(
            'charge3_name', sa.String(length=100),
            nullable=False, server_default='Processing Fee'))
        batch_op.add_column(sa.Column(
            'charge3_type', sa.String(length=20),
            nullable=False, server_default='percentage'))
        batch_op.add_column(sa.Column(
            'charge3_value', sa.Numeric(10, 4),
            nullable=False, server_default='0'))

        batch_op.create_check_constraint(
            'ck_membership_plan_charge_type',
            "charge1_type IN ('percentage', 'fixed') AND "
            "charge2_type IN ('percentage', 'fixed') AND "
            "charge3_type IN ('percentage', 'fixed')",
        )
        batch_op.create_check_constraint(
            'ck_membership_plan_charge_value_nonneg',
            'charge1_value >= 0 AND charge2_value >= 0 AND charge3_value >= 0',
        )


def downgrade():
    with op.batch_alter_table('membership_plans', schema=None) as batch_op:
        batch_op.drop_constraint('ck_membership_plan_charge_value_nonneg', type_='check')
        batch_op.drop_constraint('ck_membership_plan_charge_type', type_='check')
        batch_op.drop_column('charge3_value')
        batch_op.drop_column('charge3_type')
        batch_op.drop_column('charge3_name')
        batch_op.drop_column('charge2_value')
        batch_op.drop_column('charge2_type')
        batch_op.drop_column('charge2_name')
        batch_op.drop_column('charge1_value')
        batch_op.drop_column('charge1_type')
        batch_op.drop_column('charge1_name')
