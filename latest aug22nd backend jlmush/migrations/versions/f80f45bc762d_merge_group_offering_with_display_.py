"""merge group offering with display pricing

Revision ID: f80f45bc762d
Revises: f629c0374d80, dp1a2b3c4d5e
Create Date: 2026-07-26 13:23:53.518728

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f80f45bc762d'
down_revision = ('f629c0374d80', 'dp1a2b3c4d5e')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
