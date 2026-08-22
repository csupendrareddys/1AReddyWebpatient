"""Tenants: amplify_cert_validation_record column.

Why
---
Amplify returns the ACM-cert-validation DNS record as a top-level
field (``certificateVerificationDNSRecord``) on the domain
association — separate from the per-subDomain routing records.
Persist it so the dialog can render it as its own copy-paste row;
without it, the operator never adds the ACM validation CNAME and the
cert never issues.

Revision ID: m3h4c5d6e7f8
Revises: l2g3b4c5d6e7
Create Date: 2026-05-05
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = 'm3h4c5d6e7f8'
down_revision = 'l2g3b4c5d6e7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'tenants',
        sa.Column('amplify_cert_validation_record', sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column('tenants', 'amplify_cert_validation_record')
