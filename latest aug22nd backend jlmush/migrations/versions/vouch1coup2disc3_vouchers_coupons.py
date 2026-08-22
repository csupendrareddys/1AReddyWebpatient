"""Vouchers + coupons, and their selection on a display pricing rule

Two separate tenant-scoped tables (``vouchers``, ``coupons``), each a flat ₹
reduction with a per-tenant unique code. ``display_pricing_rules`` gains
``voucher_ids`` / ``coupon_ids`` JSON id lists recording which of them an admin
marked applicable to that doctor × offering; each selected row's amount is
subtracted straight off the display price.

Revision ID: vouch1coup2disc3
Revises: dp1a2b3c4d5e
Create Date: 2026-07-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'vouch1coup2disc3'
down_revision = 'dp1a2b3c4d5e'
branch_labels = None
depends_on = None


def _discount_table(name, pk_name):
    """Both tables are structurally identical — build them from one spec."""
    op.create_table(
        name,
        sa.Column(pk_name, postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('code', sa.String(length=40), nullable=False),
        sa.Column('label', sa.String(length=160), nullable=True),
        sa.Column('amount', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False,
                  server_default=sa.text('true')),
        sa.Column('is_deleted', sa.Boolean(), nullable=False,
                  server_default=sa.text('false')),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('updated_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'],
                                name=f'fk_{name}_tenant', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.user_id'],
                                name=f'fk_{name}_created_by', ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['updated_by_id'], ['users.user_id'],
                                name=f'fk_{name}_updated_by', ondelete='SET NULL'),
        sa.PrimaryKeyConstraint(pk_name, name=f'pk_{name}'),
        sa.UniqueConstraint('tenant_id', 'code',
                            name=f'uq_{name[:-1]}_tenant_code'),
    )
    op.create_index(f'ix_{name}_tenant_id', name, ['tenant_id'])
    op.create_index(f'ix_{name}_is_active', name, ['is_active'])
    op.create_index(f'ix_{name}_is_deleted', name, ['is_deleted'])

    from app.models._base import generate_rls_sql
    for stmt in generate_rls_sql(name):
        op.execute(stmt)


def upgrade():
    _discount_table('vouchers', 'voucher_id')
    _discount_table('coupons', 'coupon_id')

    with op.batch_alter_table('display_pricing_rules', schema=None) as batch_op:
        batch_op.add_column(sa.Column('voucher_ids', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('coupon_ids', sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table('display_pricing_rules', schema=None) as batch_op:
        batch_op.drop_column('coupon_ids')
        batch_op.drop_column('voucher_ids')

    for name in ('coupons', 'vouchers'):
        op.execute(f'DROP POLICY IF EXISTS tenant_insert_{name} ON {name}')
        op.execute(f'DROP POLICY IF EXISTS tenant_isolation_{name} ON {name}')
        op.drop_index(f'ix_{name}_is_deleted', table_name=name)
        op.drop_index(f'ix_{name}_is_active', table_name=name)
        op.drop_index(f'ix_{name}_tenant_id', table_name=name)
        op.drop_table(name)
