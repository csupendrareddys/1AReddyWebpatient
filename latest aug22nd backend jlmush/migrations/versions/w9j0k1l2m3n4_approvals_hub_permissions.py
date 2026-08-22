"""Approvals-hub per-module permission modules

Adds the 8 `approve_*` PermissionModule enum values so each Approvals-hub module
can be an assignable RBAC scope for sub-admins. Enum-values-only; no table
changes. PG16 allows ADD VALUE in a transaction as long as the value isn't USED
in the same transaction (we don't), and IF NOT EXISTS keeps the create_all path
(which already has them) safe.

Revision ID: w9j0k1l2m3n4
Revises: 98550fd9f3d5
Create Date: 2026-07-13
"""
from alembic import op


revision = 'w9j0k1l2m3n4'
down_revision = '98550fd9f3d5'
branch_labels = None
depends_on = None


def upgrade():
    for value in ('approve_registration', 'approve_appointment', 'approve_profile',
                  'approve_working_days', 'approve_education', 'approve_bank',
                  'approve_bank_account', 'approve_payout'):
        op.execute(f"ALTER TYPE permissionmodule ADD VALUE IF NOT EXISTS '{value}'")


def downgrade():
    # Postgres can't drop enum values — leave them (harmless).
    pass
