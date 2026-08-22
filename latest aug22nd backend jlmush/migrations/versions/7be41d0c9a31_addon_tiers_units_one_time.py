"""addon tiers, purchase units, one_time cycle

Revision ID: 7be41d0c9a31
Revises: 2cbd3a0b4df9
Create Date: 2026-08-21

Hand-scoped. Three changes:
* ``addons.tiers`` — per-buyer-tier commercial terms (main /
  subdomain_child / custom_domain_child), each with units, price,
  min/max purchase bounds and a billing cycle.
* ``tenant_addons`` — ``tier`` + ``units`` snapshot what the buyer
  actually purchased (catalogue edits never change paid grants), and
  ``current_period_end`` becomes nullable: NULL marks a one_time
  purchase that lives and dies with the main plan.
* ``billingcycle`` PG enum gains ``ONE_TIME`` (enum values store
  member NAMES, uppercase — see 2cbd3a0b4df9).
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = '7be41d0c9a31'
down_revision = '2cbd3a0b4df9'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE billingcycle ADD VALUE IF NOT EXISTS 'ONE_TIME'")
    op.add_column('addons', sa.Column('tiers', JSONB(), nullable=True))
    op.add_column('tenant_addons', sa.Column(
        'tier', sa.String(length=24), nullable=False,
        server_default='main'))
    op.add_column('tenant_addons', sa.Column(
        'units', sa.Integer(), nullable=False, server_default='1'))
    op.alter_column('tenant_addons', 'current_period_end',
                    existing_type=sa.DateTime(timezone=True),
                    nullable=True)


def downgrade():
    # Rows with a NULL period end cannot survive the NOT NULL restore;
    # give them their period start so the downgrade is mechanical.
    op.execute("UPDATE tenant_addons SET current_period_end = "
               "current_period_start WHERE current_period_end IS NULL")
    op.alter_column('tenant_addons', 'current_period_end',
                    existing_type=sa.DateTime(timezone=True),
                    nullable=False)
    op.drop_column('tenant_addons', 'units')
    op.drop_column('tenant_addons', 'tier')
    op.drop_column('addons', 'tiers')
    # ONE_TIME stays in the enum — PG cannot drop enum values.
