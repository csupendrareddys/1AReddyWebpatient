"""merge profile_owner and main pricing heads

Revision ID: 06cc45ffb9bf
Revises: be1adf4e1a11, 9f9ee8ce7e5d
Create Date: 2026-07-16 16:02:55.252872

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '06cc45ffb9bf'
down_revision = ('be1adf4e1a11', '9f9ee8ce7e5d')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
