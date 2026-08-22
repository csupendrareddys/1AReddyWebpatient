"""Doctor appointment master switch + offered consultation types (Item 3B)

Adds doctors.appointments_enabled (master on/off the doctor controls) and
doctors.offered_consultation_types (JSON subset of schedulable types; NULL = all).
Both additive; appointments_enabled defaults TRUE so existing doctors are
unchanged.

Revision ID: x0k1l2m3n4o5
Revises: 6071e9569608
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'x0k1l2m3n4o5'
down_revision = '6071e9569608'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE doctors ADD COLUMN IF NOT EXISTS appointments_enabled "
        "BOOLEAN NOT NULL DEFAULT TRUE"
    )
    op.add_column(
        'doctors',
        sa.Column('offered_consultation_types', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade():
    op.drop_column('doctors', 'offered_consultation_types')
    op.execute("ALTER TABLE doctors DROP COLUMN IF EXISTS appointments_enabled")
