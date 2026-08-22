"""merge migration heads

Revision ID: 3dcfcac922f5
Revises: 955c06d5e5eb, svccomm2guard3
Create Date: 2026-07-21 01:06:26.808351

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '3dcfcac922f5'
down_revision = ('955c06d5e5eb', 'svccomm2guard3')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
