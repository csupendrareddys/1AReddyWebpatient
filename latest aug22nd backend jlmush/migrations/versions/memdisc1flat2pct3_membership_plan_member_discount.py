"""Flat member discount % on a marketplace membership plan

Adds membership_plans.member_discount_pct — the blanket percentage every
holder of the tier gets off the patient-facing price of any offering
(consultation slot or catalog service).

Server-defaulted to 0 so existing rows read as "no member discount"
without a data backfill, and constrained to 0-100 like commission_pct.

Revision ID: memdisc1flat2pct3
Revises: tax1gst2india3
Create Date: 2026-07-27
"""
from alembic import op
import sqlalchemy as sa


revision = 'memdisc1flat2pct3'
down_revision = 'tax1gst2india3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'membership_plans',
        sa.Column(
            'member_discount_pct', sa.Numeric(5, 2),
            nullable=True, server_default='0',
        ),
    )
    op.create_check_constraint(
        'ck_membership_plan_member_discount_pct_range',
        'membership_plans',
        '(member_discount_pct IS NULL) OR '
        '(member_discount_pct >= 0 AND member_discount_pct <= 100)',
    )


def downgrade():
    op.drop_constraint(
        'ck_membership_plan_member_discount_pct_range',
        'membership_plans', type_='check',
    )
    op.drop_column('membership_plans', 'member_discount_pct')
