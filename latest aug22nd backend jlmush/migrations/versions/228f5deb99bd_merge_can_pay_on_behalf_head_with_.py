"""merge can_pay_on_behalf head with clinic-branch head

Revision ID: 228f5deb99bd
Revises: 7848890d0a34, e4f5a6b7c8d9
Create Date: 2026-08-11 17:26:00.335231

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '228f5deb99bd'
down_revision = ('7848890d0a34', 'e4f5a6b7c8d9')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
