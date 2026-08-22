"""add patient section_provenance

Revision ID: fb4c479f719b
Revises: 7e5d83faef5d
Create Date: 2026-08-11 02:58:35.385820

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'fb4c479f719b'
down_revision = '7e5d83faef5d'
branch_labels = None
depends_on = None


def upgrade():
    # Per-section profile provenance: {section_key: {by_id, by_role, at}}.
    op.add_column('patients', sa.Column('section_provenance', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('patients', 'section_provenance')
