"""Tenant-wide platform discount % on billing config

Adds billing_configs.platform_discount_pct — one percentage off every
patient-facing price for the whole tenant (a site-wide sale), as opposed to
DisplayPricingRule's per doctor × offering markdown or a membership tier's
buyer-dependent discount.

Server-defaulted to 0 ("no sale on") so existing tenants price exactly as they
did, and bounded 0-100 because a discount past 100% would mean paying the
patient to book.

Revision ID: platdisc1wide2pct3
Revises: memdisc1flat2pct3
Create Date: 2026-07-27
"""
from alembic import op
import sqlalchemy as sa


revision = 'platdisc1wide2pct3'
down_revision = 'memdisc1flat2pct3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'billing_configs',
        sa.Column(
            'platform_discount_pct', sa.Numeric(5, 2),
            nullable=False, server_default='0',
        ),
    )
    op.create_check_constraint(
        'ck_billing_config_platform_discount_pct_range',
        'billing_configs',
        'platform_discount_pct >= 0 AND platform_discount_pct <= 100',
    )


def downgrade():
    op.drop_constraint(
        'ck_billing_config_platform_discount_pct_range',
        'billing_configs', type_='check',
    )
    op.drop_column('billing_configs', 'platform_discount_pct')
