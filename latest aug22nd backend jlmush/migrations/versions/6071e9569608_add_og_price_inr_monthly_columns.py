"""add og_price_inr_monthly columns

Backfills the migration for the ``og_price_inr_monthly`` (strike-through /
"original price") column that was added to four plan models without a migration.
CI never caught it because bootstrap uses ``create_all()`` (which builds columns
straight from the models); but an EXISTING production DB upgraded via migrations
was missing the columns, so any code reading ``og_price_inr_monthly`` would 500.
All nullable, additive, idempotent (IF NOT EXISTS) — safe on any existing DB.

Revision ID: 6071e9569608
Revises: w9j0k1l2m3n4
Create Date: 2026-07-13 16:13:37.515980

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '6071e9569608'
down_revision = 'w9j0k1l2m3n4'
branch_labels = None
depends_on = None

# Tables whose model gained og_price_inr_monthly (membership.py, plan.py x2,
# tenant_provider_plan.py).
_TABLES = ('membership_plans', 'plans', 'addons', 'tenant_provider_plans')


def upgrade():
    # IF NOT EXISTS keeps this a no-op on DBs (e.g. freshly create_all'd) that
    # already have the column from the model, so it can't collide.
    for t in _TABLES:
        op.execute(
            f'ALTER TABLE {t} ADD COLUMN IF NOT EXISTS '
            f'og_price_inr_monthly NUMERIC(10, 2)'
        )


def downgrade():
    for t in _TABLES:
        op.execute(f'ALTER TABLE {t} DROP COLUMN IF EXISTS og_price_inr_monthly')
