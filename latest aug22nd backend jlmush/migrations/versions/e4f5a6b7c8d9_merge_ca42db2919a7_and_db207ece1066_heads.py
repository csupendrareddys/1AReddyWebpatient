"""merge ca42db2919a7 and db207ece1066 heads

Revision ID: e4f5a6b7c8d9
Revises: ca42db2919a7, db207ece1066
Create Date: 2026-08-11 19:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e4f5a6b7c8d9'
down_revision = ('ca42db2919a7', 'db207ece1066')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
