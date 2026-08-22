"""Group offering: member consent + specialization rules (Item 3D)

Adds member consent (marketplace_service_group_members.status / responded_at) and
specialization rules (marketplace_service_groups.required_specialization_ids).
Additive; existing members default to 'accepted' so live groups keep working.

Revision ID: a3n4o5p6q7r8
Revises: z2m3n4o5p6q7
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa


revision = 'a3n4o5p6q7r8'
down_revision = 'z2m3n4o5p6q7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('marketplace_service_groups', sa.Column('required_specialization_ids', sa.JSON(), nullable=True))
    # New members default 'invited'; existing rows are pre-consent → 'accepted'.
    op.execute(
        "ALTER TABLE marketplace_service_group_members "
        "ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'accepted'"
    )
    op.add_column('marketplace_service_group_members', sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True))
    # Going forward the model default is 'invited'; flip the column default so new
    # inserts that don't specify status are treated as pending consent.
    op.execute("ALTER TABLE marketplace_service_group_members ALTER COLUMN status SET DEFAULT 'invited'")


def downgrade():
    op.drop_column('marketplace_service_group_members', 'responded_at')
    op.execute("ALTER TABLE marketplace_service_group_members DROP COLUMN IF EXISTS status")
    op.drop_column('marketplace_service_groups', 'required_specialization_ids')
