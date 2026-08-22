"""Add ``show_in_slider`` to landing modules + features.

Backs the public landing "featured slider" (the third sliding bar) — admins
toggle which modules / services appear in it from the landing config; each
slide links to that module's / feature's own page. NOT NULL with a
``server_default`` of false, so it's safe to add on populated tables.

Revision ID: slider1feat2mod3
Revises: workqual1multi2
Create Date: 2026-07-20
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = 'slider1feat2mod3'
down_revision = 'workqual1multi2'
branch_labels = None
depends_on = None


def upgrade():
    for table in ('landing_modules', 'landing_features'):
        op.add_column(
            table,
            sa.Column(
                'show_in_slider', sa.Boolean(), nullable=False,
                server_default=sa.text('false'),
            ),
        )


def downgrade():
    for table in ('landing_features', 'landing_modules'):
        op.drop_column(table, 'show_in_slider')
