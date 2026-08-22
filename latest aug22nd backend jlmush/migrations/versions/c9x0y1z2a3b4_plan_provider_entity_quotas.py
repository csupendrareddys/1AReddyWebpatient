"""Add per-vertical provider-entity quotas to ``plans``.

Round 5 follow-up — the SaaS-tenant "in-tenant marketplace" needs the
platform owner to control HOW MANY provider entities (independent
doctors, clinic orgs, hospital orgs) a tenant may register inside
their subdomain.

The existing ``max_providers`` column governs **staff seats** —
internal team users with role ``provider``. That's not the same axis:
a clinic-org-entity may itself host multiple doctor seats. These new
columns are per-vertical caps on the PROVIDER ENTITY count:

* ``max_provider_doctors``   — independent doctor practices.
* ``max_provider_clinics``   — clinic organisations.
* ``max_provider_hospitals`` — hospital organisations.

Sentinel convention (matches the rest of the pricing surface):
``-1`` = unlimited, ``0`` = vertical disabled, positive int = hard
cap. ``NULL`` is allowed because existing rows pre-date the column —
enforcement treats NULL as 0 (deny) so the platform owner has to
explicitly set non-zero values when authoring new plans. Backfill is
intentionally not automated; platform owner picks per-plan via the
PlanForm editor.

Revision ID: c9x0y1z2a3b4
Revises: b8w9x0y1z2a3
Create Date: 2026-05-19
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = 'c9x0y1z2a3b4'
down_revision = 'b8w9x0y1z2a3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'plans',
        sa.Column('max_provider_doctors', sa.Integer(), nullable=True),
    )
    op.add_column(
        'plans',
        sa.Column('max_provider_clinics', sa.Integer(), nullable=True),
    )
    op.add_column(
        'plans',
        sa.Column('max_provider_hospitals', sa.Integer(), nullable=True),
    )


def downgrade():
    op.drop_column('plans', 'max_provider_hospitals')
    op.drop_column('plans', 'max_provider_clinics')
    op.drop_column('plans', 'max_provider_doctors')
