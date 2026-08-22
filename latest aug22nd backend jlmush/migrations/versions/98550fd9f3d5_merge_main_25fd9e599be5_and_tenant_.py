"""merge main (25fd9e599be5) and tenant-addition (v8i9j0k1l2m3) heads

Revision ID: 98550fd9f3d5
Revises: 25fd9e599be5, v8i9j0k1l2m3
Create Date: 2026-07-13 16:02:56.753068

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '98550fd9f3d5'
down_revision = ('25fd9e599be5', 'v8i9j0k1l2m3')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
