"""Add ``show_in_slider`` to platform landing modules + features.

Mirrors ``slider1feat2mod3`` (tenant tables) for the schema-separated
``platform_landing_*`` tables, so the apex marketing landing's featured
slider works too.

Revision ID: slider4plat5land6
Revises: slider1feat2mod3
Create Date: 2026-07-20
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = 'slider4plat5land6'
down_revision = 'slider1feat2mod3'
branch_labels = None
depends_on = None


def upgrade():
    for table in ('platform_landing_modules', 'platform_landing_features'):
        op.add_column(
            table,
            sa.Column(
                'show_in_slider', sa.Boolean(), nullable=False,
                server_default=sa.text('false'),
            ),
        )


def downgrade():
    for table in ('platform_landing_features', 'platform_landing_modules'):
        op.drop_column(table, 'show_in_slider')
