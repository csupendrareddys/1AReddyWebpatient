"""Add ``hero_body_text`` + ``hero_search_placeholder`` to landing configs.

Two more "make every line editable" follow-ups:

* ``hero_body_text``           — the marketing one-liner under the hero
                                  subtitle ("Book appointments, consult
                                  doctors online…"). Currently hardcoded.
* ``hero_search_placeholder``  — the search-bar placeholder text
                                  ("Search 'Video Consultation' or 'Lab
                                  Tests'…"). Currently hardcoded.

Adds the columns to BOTH ``landing_configs`` and
``platform_landing_configs``. Nullable; frontend falls back to the
historical copy when null.

Revision ID: b8w9x0y1z2a3
Revises: a7v8w9x0y1z2
Create Date: 2026-05-19
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = 'b8w9x0y1z2a3'
down_revision = 'a7v8w9x0y1z2'
branch_labels = None
depends_on = None


_TABLES = ('landing_configs', 'platform_landing_configs')


def upgrade():
    for table in _TABLES:
        op.add_column(table, sa.Column('hero_body_text', sa.Text(), nullable=True))
        op.add_column(
            table,
            sa.Column('hero_search_placeholder', sa.String(200), nullable=True),
        )


def downgrade():
    for table in _TABLES:
        op.drop_column(table, 'hero_search_placeholder')
        op.drop_column(table, 'hero_body_text')
