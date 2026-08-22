"""merge second-opinion pct + provider-staff heads

Revision ID: a1288160ece1
Revises: 038699102e33, a1702cea653c
Create Date: 2026-08-07 18:58:40.536024

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a1288160ece1'
down_revision = ('038699102e33', 'a1702cea653c')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
