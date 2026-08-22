"""Payout hold: add on_hold + claimable values to payoutstatus enum

Separate migration (values only) because Postgres cannot ADD VALUE and then
USE that value in the same transaction — the columns/tables that reference
these values live in the next migration.

Revision ID: q3d4e5f6g7h8
Revises: p2c3d4e5f6g7
Create Date: 2026-07-12
"""
from alembic import op


revision = 'q3d4e5f6g7h8'
down_revision = 'p2c3d4e5f6g7'
branch_labels = None
depends_on = None


def upgrade():
    for value in ('on_hold', 'claimable'):
        op.execute(f"ALTER TYPE payoutstatus ADD VALUE IF NOT EXISTS '{value}'")


def downgrade():
    # Postgres has no DROP VALUE for enums — leave them (harmless).
    pass
