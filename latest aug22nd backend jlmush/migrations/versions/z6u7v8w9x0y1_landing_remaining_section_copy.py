"""Make every remaining hardcoded landing-page line editable.

Completes the "every line editable" pass started in ``x4s5t6u7v8w9``
(brand identity + CTA band) and continued in ``y5t6u7v8w9x0`` (logo
URL + stats / testimonials / hero partners + section titles).

After this migration the public landing surface has no hardcoded
customer-facing copy left except for the FAQ items themselves —
those now come from ``faqs`` JSON. The historical ``hospitalServices.js``
constants stay as graceful fallbacks for un-configured tenants.

Adds to BOTH ``landing_configs`` and ``platform_landing_configs``:

Scalars (all VARCHAR, nullable):
  * ``services_section_title`` / ``services_section_subtitle`` —
    overrides "Popular Services" / "Everything you need to manage…".
  * ``categories_section_title`` / ``categories_section_subtitle`` —
    overrides "Browse by Category" / "Select a service category…".
  * ``ready_cta_title`` / ``ready_cta_subtitle`` /
    ``ready_cta_label`` / ``ready_cta_href`` — the small inline CTA
    inside the Why-us stats panel ("Ready to start? / Talk to a
    healthcare expert today.").
  * ``faq_section_title`` / ``faq_section_subtitle`` — overrides
    "Frequently Asked Questions" / "Got questions? We have answers."

JSON arrays:
  * ``why_features`` — [{title, description}] — the 4-bullet Why-us
    panel beside the stats card.
  * ``faqs``         — [{question, answer}] — the accordion items.

Nullable → existing rows survive. Downgrade drops the columns in
reverse order.

Revision ID: z6u7v8w9x0y1
Revises: y5t6u7v8w9x0
Create Date: 2026-05-19
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSON


revision = 'z6u7v8w9x0y1'
down_revision = 'y5t6u7v8w9x0'
branch_labels = None
depends_on = None


_TABLES = ('landing_configs', 'platform_landing_configs')


_SCALAR_COLS = (
    ('services_section_title',      sa.String(200)),
    ('services_section_subtitle',   sa.String(500)),
    ('categories_section_title',    sa.String(200)),
    ('categories_section_subtitle', sa.String(500)),
    ('ready_cta_title',             sa.String(200)),
    ('ready_cta_subtitle',          sa.String(500)),
    ('ready_cta_label',             sa.String(120)),
    ('ready_cta_href',              sa.String(500)),
    ('faq_section_title',           sa.String(200)),
    ('faq_section_subtitle',        sa.String(500)),
)

_JSON_COLS = ('why_features', 'faqs')


def upgrade():
    for table in _TABLES:
        for name, kind in _SCALAR_COLS:
            op.add_column(table, sa.Column(name, kind, nullable=True))
        for name in _JSON_COLS:
            op.add_column(table, sa.Column(name, JSON, nullable=True))


def downgrade():
    for table in _TABLES:
        for name in reversed(_JSON_COLS):
            op.drop_column(table, name)
        for name, _ in reversed(_SCALAR_COLS):
            op.drop_column(table, name)
