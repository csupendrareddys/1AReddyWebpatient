"""Tenants: auto_subdomain column.

Why
---
Lets a tenant opt out of the platform's ``<slug>.<base_domain>`` CNAME
when they only want to be reachable via their own custom domain. Default
True so every existing tenant keeps its current subdomain.

Revision ID: k1f2a3b4c5d6
Revises: j0e1f2a3b4c5
Create Date: 2026-05-04
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = 'k1f2a3b4c5d6'
down_revision = 'j0e1f2a3b4c5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'tenants',
        sa.Column(
            'auto_subdomain',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('true'),
        ),
    )


def downgrade():
    op.drop_column('tenants', 'auto_subdomain')
