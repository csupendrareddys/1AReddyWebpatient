"""merge chargetax1 + landing nav heads

Revision ID: 90d6f95d0e03
Revises: 5f8b7367c9e6, chargetax1
Create Date: 2026-07-29 07:51:15.138261

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '90d6f95d0e03'
down_revision = ('5f8b7367c9e6', 'chargetax1')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
