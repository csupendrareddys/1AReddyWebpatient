"""merge Anish-Work and main migration heads

Revision ID: db207ece1066
Revises: 6db470d176b4, b64b68869562
Create Date: 2026-08-11 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'db207ece1066'
down_revision = ('6db470d176b4', 'b64b68869562')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
