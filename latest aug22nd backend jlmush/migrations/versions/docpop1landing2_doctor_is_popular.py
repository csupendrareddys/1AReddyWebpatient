"""Add ``doctors.is_popular`` — admin-curated landing-widget flag.

The public landing booking widget shows only *popular* doctors (a curated
subset); the full published directory is bookable after login. NOT NULL
with a ``server_default`` of false, so existing rows fill in without a
backfill step and the column is safe to add on a populated table.

Revision ID: docpop1landing2
Revises: mts1membscope2
Create Date: 2026-07-20
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = 'docpop1landing2'
down_revision = 'mts1membscope2'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'doctors',
        sa.Column(
            'is_popular', sa.Boolean(), nullable=False,
            server_default=sa.text('false'),
        ),
    )
    op.create_index('ix_doctors_is_popular', 'doctors', ['is_popular'])


def downgrade():
    op.drop_index('ix_doctors_is_popular', table_name='doctors')
    op.drop_column('doctors', 'is_popular')
