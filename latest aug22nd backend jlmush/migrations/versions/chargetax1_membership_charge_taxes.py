"""Per-charge tax on membership-plan charges

Each of the three platform charges gains an optional tax (fixed ₹ or % of the
charge). The amount deducted from a payout becomes the charge inclusive of its
tax; the rest of the GST/TDS breakdown is unchanged. Default 0 = no tax, so
existing plans keep their current deduction.

Revision ID: chargetax1
Revises: careteamteam1
Create Date: 2026-07-29

"""
from alembic import op
import sqlalchemy as sa


revision = 'chargetax1'
down_revision = 'careteamteam1'
branch_labels = None
depends_on = None


def upgrade():
    for n in (1, 2, 3):
        op.add_column('membership_plans', sa.Column(
            f'charge{n}_tax_type', sa.String(length=20),
            server_default='percentage', nullable=False))
        op.add_column('membership_plans', sa.Column(
            f'charge{n}_tax_value', sa.Numeric(10, 4),
            server_default='0', nullable=False))


def downgrade():
    for n in (1, 2, 3):
        op.drop_column('membership_plans', f'charge{n}_tax_value')
        op.drop_column('membership_plans', f'charge{n}_tax_type')
