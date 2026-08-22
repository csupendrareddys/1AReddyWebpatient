"""Drop (vertical, tier) uniqueness on membership_plans.

Round 8.5 follow-up. Round 1's seed migration enforced "exactly one
plan per (vertical, tier)" via a partial unique index. The product
direction has since changed: the platform owner needs to author N
plans per (vertical, tier) — e.g. multiple doctor/basic tiers with
different pricing, trial lengths, or commission splits.

This migration:

  * Drops ``ux_membership_plans_vertical_tier``.
  * Replaces it with a NON-unique index on the same columns to keep
    listing queries cheap (the public pricing page filters by
    vertical + orders by sort_order).

The route-layer 409 pre-flight that printed "Archive the existing
row before creating a replacement" is removed in app/api/platform/
membership_routes.py in the same commit; this migration only owns
the schema change.

Revision ID: g3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-05-21
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


# revision identifiers
revision = 'g3b4c5d6e7f8'
down_revision = 'f2a3b4c5d6e7'
branch_labels = None
depends_on = None


def upgrade():
    # ``IF EXISTS`` guard so the CI bootstrap path (db.create_all then
    # stamp head) — which might not have the index under the same
    # name — also downgrades cleanly in a roundtrip.
    op.execute(
        'DROP INDEX IF EXISTS ux_membership_plans_vertical_tier'
    )
    op.create_index(
        'ix_membership_plans_vertical_tier',
        'membership_plans',
        ['vertical', 'tier'],
        unique=False,
        postgresql_where=sa.text('is_deleted = false'),
    )


def downgrade():
    op.execute(
        'DROP INDEX IF EXISTS ix_membership_plans_vertical_tier'
    )
    # Restoring the unique index requires no current duplicates. If
    # production has accumulated duplicates while running with this
    # change deployed, downgrade will fail — which is the desired
    # safety: the operator must reconcile dupes manually before
    # rolling back to a release that depends on uniqueness.
    op.create_index(
        'ux_membership_plans_vertical_tier',
        'membership_plans',
        ['vertical', 'tier'],
        unique=True,
        postgresql_where=sa.text('is_deleted = false'),
    )
