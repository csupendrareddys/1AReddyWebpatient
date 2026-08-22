"""merge migration heads

Revision ID: d91abcfce1e2
Revises: ec27c29b74c5, featdoc1care2team
Create Date: 2026-07-20 20:50:41.360985

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd91abcfce1e2'
down_revision = ('ec27c29b74c5', 'featdoc1care2team')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
