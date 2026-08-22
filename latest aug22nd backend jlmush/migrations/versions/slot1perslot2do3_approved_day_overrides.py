"""Per-slot approval: add doctors.approved_day_overrides

Adds the admin-approved snapshot of ``availability_config['day_overrides']``.
With per-slot approval, only slots present here (approval_status='approved')
are materialised into bookable TimeSlot rows / shown to patients; the live
``availability_config`` holds the doctor's draft (pending/rejected) edits.
Nullable JSON; NULL = no approved dated slots yet.

Revision ID: slot1perslot2do3
Revises: pat1ent2plan3vert
Create Date: 2026-07-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'slot1perslot2do3'
down_revision = 'pat1ent2plan3vert'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'doctors',
        sa.Column('approved_day_overrides', postgresql.JSON(astext_type=sa.Text()), nullable=True),
    )


def downgrade():
    op.drop_column('doctors', 'approved_day_overrides')
