"""Add CANCELLED to approvalrequeststatus enum

The schedule/pricing update flow cancels a still-pending approval request when
the doctor re-submits a change that matches the already-approved state. It set
status=CANCELLED, but that label didn't exist on the enum, so the second
schedule submission 500'd. Add the label.

Revision ID: apprstatuscancel1
Revises: svcparity1inst2
Create Date: 2026-07-28
"""
from alembic import op


revision = 'apprstatuscancel1'
down_revision = 'svcparity1inst2'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE approvalrequeststatus ADD VALUE IF NOT EXISTS 'CANCELLED'")


def downgrade():
    # Postgres cannot drop a single enum value; leaving the label in place is
    # harmless (nothing references it once rows are re-stamped).
    pass
