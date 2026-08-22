"""add product_categories table

Revision ID: a1c7f3e9b2d4
Revises: 228f5deb99bd
Create Date: 2026-08-17 00:00:00.000000

Catalog-level reference data: a product falls under one main product category.
Managed from the admin Product Catalog toolbar (create / edit / activate).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'a1c7f3e9b2d4'
down_revision = '228f5deb99bd'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'product_categories',
        sa.Column('category_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('tag_line', sa.String(length=200), nullable=True),
        sa.Column('icon', sa.String(length=500), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('features', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('category_id'),
        sa.UniqueConstraint('tenant_id', 'name', name='product_category_tenant_name'),
    )
    with op.batch_alter_table('product_categories', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_product_categories_name'), ['name'], unique=False)
        batch_op.create_index(batch_op.f('ix_product_categories_is_active'), ['is_active'], unique=False)
        batch_op.create_index(batch_op.f('ix_product_categories_tenant_id'), ['tenant_id'], unique=False)
        batch_op.create_index('ix_category_tenant_active', ['tenant_id', 'is_active'], unique=False)

    op.create_table(
        'product_subcategories',
        sa.Column('subcategory_id', sa.UUID(), nullable=False),
        sa.Column('category_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['category_id'], ['product_categories.category_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('subcategory_id'),
        sa.UniqueConstraint('category_id', 'name', name='product_subcategory_category_name'),
    )
    with op.batch_alter_table('product_subcategories', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_product_subcategories_category_id'), ['category_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_product_subcategories_tenant_id'), ['tenant_id'], unique=False)


def downgrade():
    with op.batch_alter_table('product_subcategories', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_product_subcategories_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_product_subcategories_category_id'))
    op.drop_table('product_subcategories')

    with op.batch_alter_table('product_categories', schema=None) as batch_op:
        batch_op.drop_index('ix_category_tenant_active')
        batch_op.drop_index(batch_op.f('ix_product_categories_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_product_categories_is_active'))
        batch_op.drop_index(batch_op.f('ix_product_categories_name'))

    op.drop_table('product_categories')
