"""add category_types to product_categories

A category classification multi-select — "Consultant type" / "Plan based
type" (a category may be both). Same JSONB-array shape as ``features``.

Revision ID: pccat1_product_category_types
Revises: 87f0b6217cba
Create Date: 2026-08-08 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'pccat1_product_category_types'
down_revision = '87f0b6217cba'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('product_categories', schema=None) as batch_op:
        batch_op.add_column(sa.Column(
            'category_types', postgresql.JSONB(astext_type=sa.Text()),
            nullable=False, server_default='[]',
        ))


def downgrade():
    with op.batch_alter_table('product_categories', schema=None) as batch_op:
        batch_op.drop_column('category_types')
