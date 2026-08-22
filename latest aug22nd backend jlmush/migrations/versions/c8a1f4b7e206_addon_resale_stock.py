"""tenant_addons.is_stock — reseller inventory

Revision ID: c8a1f4b7e206
Revises: d47f20a9e813
Create Date: 2026-08-21

Hand-scoped. Marks a TenantAddon row as RESALE STOCK: units an apex
bought from the vendor to sell on, held on the apex but granting it
nothing. Children draw from the pool when they buy.
"""
import sqlalchemy as sa
from alembic import op

revision = 'c8a1f4b7e206'
down_revision = 'd47f20a9e813'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('tenant_addons', sa.Column(
        'is_stock', sa.Boolean(), nullable=False, server_default='false'))
    # An apex holds at most ONE stock row per add-on; the unique index on
    # (tenant_id, addon_id) already covers entitlement rows, so stock
    # needs its own partial index to coexist with a self-purchase.
    op.drop_index('ux_tenant_addons_unique', table_name='tenant_addons')
    op.create_index(
        'ux_tenant_addons_unique', 'tenant_addons',
        ['tenant_id', 'addon_id', 'is_stock'], unique=True,
        postgresql_where=sa.text('is_deleted = false'))


def downgrade():
    op.drop_index('ux_tenant_addons_unique', table_name='tenant_addons')
    op.create_index(
        'ux_tenant_addons_unique', 'tenant_addons',
        ['tenant_id', 'addon_id'], unique=True,
        postgresql_where=sa.text('is_deleted = false'))
    op.drop_column('tenant_addons', 'is_stock')
