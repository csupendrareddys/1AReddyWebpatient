"""merge helduser1 + planvouch1coup2 heads

Revision ID: 5e9521044896
Revises: helduser1, planvouch1coup2
Create Date: 2026-07-28 12:47:02.632221

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '5e9521044896'
down_revision = ('helduser1', 'planvouch1coup2')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
