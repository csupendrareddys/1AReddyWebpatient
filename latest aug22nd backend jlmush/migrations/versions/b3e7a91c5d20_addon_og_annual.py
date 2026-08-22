"""addon og_price_inr_annual

Revision ID: b3e7a91c5d20
Revises: 91c04fd82e55
Create Date: 2026-08-21

Hand-scoped. The legacy scalar price pair on ``addons`` had a
strike-through twin for monthly only — an annual price could never be
shown as discounted. Parity column; the tiered terms carry their own
``og_price_inr`` already.
"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = 'b3e7a91c5d20'
down_revision = '91c04fd82e55'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('addons', sa.Column(
        'og_price_inr_annual', sa.Numeric(10, 2), nullable=True))


def downgrade():
    op.drop_column('addons', 'og_price_inr_annual')
