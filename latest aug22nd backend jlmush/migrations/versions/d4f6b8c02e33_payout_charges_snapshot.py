"""doctor_payouts.charges_snapshot (per-charge tax breakdown)

Revision ID: d4f6b8c02e33
Revises: c3e5a7b91d22
Create Date: 2026-08-06

Snapshots each payout's per-charge breakdown ({name, base_charge, tax, total})
so the charge TAX is visible on the payout row even after the plan's
ChargePolicy is later retuned. Nullable — historical payouts simply have no
snapshot and fall back to the stored charge amounts.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = 'd4f6b8c02e33'
down_revision = 'c3e5a7b91d22'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('doctor_payouts', sa.Column('charges_snapshot', JSONB(), nullable=True))


def downgrade():
    op.drop_column('doctor_payouts', 'charges_snapshot')
