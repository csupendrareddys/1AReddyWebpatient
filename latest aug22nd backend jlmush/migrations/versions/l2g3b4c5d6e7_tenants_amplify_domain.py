"""Tenants: AWS Amplify domain-association tracking.

Why
---
Adds bookkeeping columns the backend uses when it auto-registers a
tenant's verified custom domain with AWS Amplify (via
``AmplifyDomainService.create_or_update``). Without this Amplify call,
even a correct DNS CNAME 403s at CloudFront because Amplify won't
accept the unrecognised Host header. The columns persist Amplify's
status + the per-subDomain ACM validation records so the UI can show
the "publish this CNAME" instructions without re-querying AWS each
render.

All columns nullable — Amplify integration is opt-in via
``AMPLIFY_APP_ID``; tenants on non-Amplify ingresses (or platforms
where the env var is unset) keep ``amplify_domain_status = NULL``.

Revision ID: l2g3b4c5d6e7
Revises: k1f2a3b4c5d6
Create Date: 2026-05-05
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSON


revision = 'l2g3b4c5d6e7'
down_revision = 'k1f2a3b4c5d6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'tenants',
        sa.Column('amplify_domain_status', sa.String(length=40), nullable=True),
    )
    op.create_index(
        'ix_tenants_amplify_domain_status',
        'tenants', ['amplify_domain_status'],
    )
    op.add_column(
        'tenants',
        sa.Column('amplify_domain_error', sa.Text(), nullable=True),
    )
    op.add_column(
        'tenants',
        sa.Column(
            'amplify_synced_at',
            sa.DateTime(timezone=True), nullable=True,
        ),
    )
    op.add_column(
        'tenants',
        sa.Column('amplify_subdomains', JSON(), nullable=True),
    )


def downgrade():
    op.drop_column('tenants', 'amplify_subdomains')
    op.drop_column('tenants', 'amplify_synced_at')
    op.drop_column('tenants', 'amplify_domain_error')
    op.drop_index('ix_tenants_amplify_domain_status', table_name='tenants')
    op.drop_column('tenants', 'amplify_domain_status')
