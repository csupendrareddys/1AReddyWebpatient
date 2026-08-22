"""plan card_display flags

Revision ID: d47f20a9e813
Revises: b3e7a91c5d20
Create Date: 2026-08-21

Hand-scoped. Display-only flags controlling which add-on blocks the
public plan card renders per audience (main / subdomain child /
custom-domain child). Never entitlement.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = 'd47f20a9e813'
down_revision = 'b3e7a91c5d20'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('plans', sa.Column('card_display', JSONB(), nullable=True))


def downgrade():
    op.drop_column('plans', 'card_display')
