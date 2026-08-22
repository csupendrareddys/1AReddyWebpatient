"""per-plan add-on terms

Revision ID: 91c04fd82e55
Revises: 7be41d0c9a31
Create Date: 2026-08-21

Hand-scoped. ``plans.addon_terms`` — per-plan overrides of the add-on
commercial terms ({addon_code: {active, units, price_inr, og_price_inr,
min_qty, max_qty, billing_cycle} | null}): different plans sell the
same add-on at different prices and capacities. On an apex-authored
child plan these are the apex's RESALE terms.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = '91c04fd82e55'
down_revision = '7be41d0c9a31'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('plans', sa.Column('addon_terms', JSONB(), nullable=True))


def downgrade():
    op.drop_column('plans', 'addon_terms')
