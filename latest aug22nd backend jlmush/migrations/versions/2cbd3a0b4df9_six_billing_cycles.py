"""six billing cycles

Revision ID: 2cbd3a0b4df9
Revises: c42ef07eb3ee
Create Date: 2026-08-21

Hand-written: Alembic never autogenerates enum ADD VALUE. The
``billingcycle`` PG enum stores Python member NAMES (uppercase), as
``SELECT enum_range(NULL::billingcycle)`` shows ('MONTHLY', 'ANNUAL').

Closes the priceable-but-unbuyable gap: plans could always be PRICED
on six periods (``PRICING_PERIODS``) but only monthly/annual could be
bought, so a quarterly price rendered a card no one could purchase.
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = '2cbd3a0b4df9'
down_revision = 'c42ef07eb3ee'
branch_labels = None
depends_on = None

_NEW = ('QUARTERLY', 'SEMI_ANNUAL', 'BIENNIAL', 'TRIENNIAL')


def upgrade():
    # PG >= 12 allows ADD VALUE inside a transaction as long as the new
    # value is not USED in the same transaction. Nothing here writes a
    # row with the new values, so this is safe.
    for value in _NEW:
        op.execute(
            "ALTER TYPE billingcycle ADD VALUE IF NOT EXISTS '%s'" % value)


def downgrade():
    # PostgreSQL cannot drop enum values. Leaving them in place is
    # harmless: older code simply never emits them, and no row can hold
    # one unless it was written by the newer code.
    pass
