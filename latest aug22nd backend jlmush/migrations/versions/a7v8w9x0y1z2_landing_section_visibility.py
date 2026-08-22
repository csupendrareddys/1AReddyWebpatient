"""Add ``section_visibility`` JSON column to landing configs.

Lets the admin toggle individual sections of the public landing page
on/off without having to delete the section's content. Single column
keyed by stable section slug → bool; missing keys default to "visible"
so the table stays tiny on un-configured tenants.

Adds to BOTH ``landing_configs`` and ``platform_landing_configs``.

Revision ID: a7v8w9x0y1z2
Revises: z6u7v8w9x0y1
Create Date: 2026-05-19
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSON


revision = 'a7v8w9x0y1z2'
down_revision = 'z6u7v8w9x0y1'
branch_labels = None
depends_on = None


_TABLES = ('landing_configs', 'platform_landing_configs')


def upgrade():
    for table in _TABLES:
        op.add_column(table, sa.Column('section_visibility', JSON, nullable=True))


def downgrade():
    for table in _TABLES:
        op.drop_column(table, 'section_visibility')
