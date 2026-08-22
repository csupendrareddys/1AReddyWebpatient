"""Doctor-requested plan change on tenant provider subscriptions (Phase A5)

Adds two nullable columns to ``tenant_provider_subscriptions``:
  * ``requested_plan_id`` — FK → tenant_provider_plans (ON DELETE SET NULL)
  * ``requested_at``

A provider requests a plan switch; the active plan stays put until an admin
approves — approval applies the requested plan and clears both columns. Both
columns are nullable, so no backfill; the table already has RLS.

Revision ID: t6g7h8i9j0k1
Revises: s5f6g7h8i9j0
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 't6g7h8i9j0k1'
down_revision = 's5f6g7h8i9j0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'tenant_provider_subscriptions',
        sa.Column('requested_plan_id', UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        'tenant_provider_subscriptions',
        sa.Column('requested_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_tps_requested_plan',
        'tenant_provider_subscriptions', 'tenant_provider_plans',
        ['requested_plan_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index(
        'ix_tps_requested_plan_id',
        'tenant_provider_subscriptions', ['requested_plan_id'],
    )


def downgrade():
    op.drop_index('ix_tps_requested_plan_id', table_name='tenant_provider_subscriptions')
    op.drop_constraint('fk_tps_requested_plan', 'tenant_provider_subscriptions', type_='foreignkey')
    op.drop_column('tenant_provider_subscriptions', 'requested_at')
    op.drop_column('tenant_provider_subscriptions', 'requested_plan_id')
