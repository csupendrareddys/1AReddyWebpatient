"""add per-doctor tds_rate_override to doctor_billing_profiles

Per-doctor TDS rate (%) override. NULL → falls back to the tenant-wide flat
BillingConfig.tds_rate. Mirrors hold_days_override (a one-per-doctor knob).

Revision ID: tds1perdoc2override
Revises: gst1bytype2cons3
Create Date: 2026-07-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'tds1perdoc2override'
down_revision = 'gst1bytype2cons3'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('doctor_billing_profiles', schema=None) as batch_op:
        batch_op.add_column(sa.Column('tds_rate_override', sa.Numeric(5, 2), nullable=True))


def downgrade():
    with op.batch_alter_table('doctor_billing_profiles', schema=None) as batch_op:
        batch_op.drop_column('tds_rate_override')
