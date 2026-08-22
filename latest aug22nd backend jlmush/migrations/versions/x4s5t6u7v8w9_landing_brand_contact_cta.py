"""Add brand + contact + trust-badge + CTA-band columns to landing configs.

Round of changes after the marketplace rounds (no number — this is a
"make every line editable" pass driven by the user's spec: a tenant
buying a fully white-labelled SaaS shouldn't see ``JLMush`` or our
support email hardcoded on their public landing page).

Adds the same columns to BOTH:
  * ``landing_configs``           (per-tenant landings)
  * ``platform_landing_configs``  (the apex marketing site)

Columns added to each table:
  * ``brand_name``         — replaces the hardcoded "JLMush Hospital" in
                              navbar + footer.
  * ``support_email``      — replaces the hardcoded support email in
                              the utility strip + footer.
  * ``trust_badge_text``   — replaces the hardcoded "Trusted by 10,000+
                              Patients" hero badge.
  * ``cta_band_title``     — replaces the hardcoded "Are you a doctor?"
                              CTA section. Empty title hides the band.
  * ``cta_band_subtitle``
  * ``cta_band_label``     — button label
  * ``cta_band_href``      — link target (default ``/join/doctor`` on
                              apex, anywhere for tenants).

All nullable so existing rows survive. Downgrade drops the columns.

Revision ID: x4s5t6u7v8w9
Revises: w3r4s5t6u7v8
Create Date: 2026-05-18
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = 'x4s5t6u7v8w9'
down_revision = 'w3r4s5t6u7v8'
branch_labels = None
depends_on = None


_TABLES = ('landing_configs', 'platform_landing_configs')


def upgrade():
    for table in _TABLES:
        op.add_column(table, sa.Column('brand_name', sa.String(120), nullable=True))
        op.add_column(table, sa.Column('support_email', sa.String(254), nullable=True))
        op.add_column(table, sa.Column('trust_badge_text', sa.String(200), nullable=True))
        op.add_column(table, sa.Column('cta_band_title', sa.String(200), nullable=True))
        op.add_column(table, sa.Column('cta_band_subtitle', sa.String(500), nullable=True))
        op.add_column(table, sa.Column('cta_band_label', sa.String(120), nullable=True))
        op.add_column(table, sa.Column('cta_band_href', sa.String(500), nullable=True))


def downgrade():
    for table in _TABLES:
        op.drop_column(table, 'cta_band_href')
        op.drop_column(table, 'cta_band_label')
        op.drop_column(table, 'cta_band_subtitle')
        op.drop_column(table, 'cta_band_title')
        op.drop_column(table, 'trust_badge_text')
        op.drop_column(table, 'support_email')
        op.drop_column(table, 'brand_name')
