"""Per-doctor salary/retainer override on billing profile (Item 2B)

Adds doctor_billing_profiles.salary_override / retainer_override — per-doctor
amounts layered on top of the plan's default_monthly_salary / default_base_retainer.
Both nullable; NULL = use the plan default.

Revision ID: z2m3n4o5p6q7
Revises: y1l2m3n4o5p6
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa


revision = 'z2m3n4o5p6q7'
down_revision = 'y1l2m3n4o5p6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('doctor_billing_profiles', sa.Column('salary_override', sa.Numeric(10, 2), nullable=True))
    op.add_column('doctor_billing_profiles', sa.Column('retainer_override', sa.Numeric(10, 2), nullable=True))


def downgrade():
    op.drop_column('doctor_billing_profiles', 'retainer_override')
    op.drop_column('doctor_billing_profiles', 'salary_override')
