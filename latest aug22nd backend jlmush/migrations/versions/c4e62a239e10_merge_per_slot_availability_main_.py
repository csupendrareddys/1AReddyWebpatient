"""merge per-slot availability + main migration heads

Revision ID: c4e62a239e10
Revises: 002ef9ae392a, mktprod1appr2stat3
Create Date: 2026-07-25 08:44:06.143969

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c4e62a239e10'
down_revision = ('002ef9ae392a', 'mktprod1appr2stat3')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
