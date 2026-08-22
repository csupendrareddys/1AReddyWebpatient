"""Retention-purge stamps on the deletion register.

``purged_at`` / ``purge_note`` record when the retention-expiry sweep
(scripts/purge_expired_records.py) completed the erasure of a deleted
account's clinical set — DPDP s.8(7) storage limitation, once the
statutory retention window (NMC/Companies Act/CGST) has lapsed. NULL
means the records are still inside their retention period.

Revision ID: purge1_register_purge_columns
Revises: delreg1_deletion_register
Create Date: 2026-08-19
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'purge1_register_purge_columns'
down_revision = 'delreg1_deletion_register'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'account_deletion_records',
        sa.Column('purged_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'account_deletion_records',
        sa.Column('purge_note', sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column('account_deletion_records', 'purge_note')
    op.drop_column('account_deletion_records', 'purged_at')
