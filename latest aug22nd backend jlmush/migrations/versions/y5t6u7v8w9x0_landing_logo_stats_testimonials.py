"""Add brand logo + sub-tagline + section headings + repeating-row JSON arrays
to landing configs.

Follow-up to ``x4s5t6u7v8w9`` which started the "every line editable"
pass with brand_name / support_email / trust_badge_text / cta_band_*.
This migration finishes the job — the remaining hardcoded copy on
the public landing surface (logo image, stats, testimonials, hero
partner-logos band, "Why <brand>?" + "What Our Patients Say" headings)
all become admin-editable.

Adds the same columns to BOTH:
  * ``landing_configs``           (per-tenant landings)
  * ``platform_landing_configs``  (the apex marketing site)

New columns:
  * ``brand_logo_url``                — URL of the logo image rendered
                                         next to the brand name in the
                                         navbar + footer. Text rather
                                         than an asset_id reference so
                                         admins can paste any CDN/S3
                                         link without a custom upload
                                         widget; a follow-up round can
                                         introduce one without a schema
                                         change.
  * ``brand_sub_tagline``             — small one-liner below brand.
  * ``why_section_title`` / ``..._subtitle`` — overrides "Why <brand>?".
  * ``testimonials_section_title`` / ``..._subtitle`` — overrides
                                         "What Our Patients Say" /
                                         "Hear from people who…".
  * ``stats`` (JSON)                  — array of {value, label} objects
                                         rendered as the big-number tiles.
  * ``testimonials`` (JSON)           — array of {quote, name, role}.
  * ``hero_partners`` (JSON)          — array of {name} or {name, logo_url}
                                         for the partner-logos band under
                                         the hero search bar.

All nullable so existing rows survive. Downgrade drops the columns.

Revision ID: y5t6u7v8w9x0
Revises: x4s5t6u7v8w9
Create Date: 2026-05-19
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSON


revision = 'y5t6u7v8w9x0'
down_revision = 'x4s5t6u7v8w9'
branch_labels = None
depends_on = None


_TABLES = ('landing_configs', 'platform_landing_configs')


_SCALAR_COLS = (
    ('brand_logo_url',                sa.String(500)),
    ('brand_sub_tagline',             sa.String(200)),
    ('why_section_title',             sa.String(200)),
    ('why_section_subtitle',          sa.String(500)),
    ('testimonials_section_title',    sa.String(200)),
    ('testimonials_section_subtitle', sa.String(500)),
)

_JSON_COLS = ('stats', 'testimonials', 'hero_partners')


def upgrade():
    for table in _TABLES:
        for name, kind in _SCALAR_COLS:
            op.add_column(table, sa.Column(name, kind, nullable=True))
        for name in _JSON_COLS:
            op.add_column(table, sa.Column(name, JSON, nullable=True))


def downgrade():
    for table in _TABLES:
        # Drop JSON columns first then scalars — order doesn't matter
        # functionally but keeps the inverse-of-upgrade shape.
        for name in reversed(_JSON_COLS):
            op.drop_column(table, name)
        for name, _ in reversed(_SCALAR_COLS):
            op.drop_column(table, name)
