"""Add product_id link to platform_landing_features

Apex twin of ``landing_features.product_id`` (landfeatprod1): lets a platform
landing feature link to a marketplace product so the feature editor's care-team
picker can scope to that product's providers.

Revision ID: platfeatprod1
Revises: 5e9521044896
Create Date: 2026-07-28

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision = 'platfeatprod1'
down_revision = '5e9521044896'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'platform_landing_features',
        sa.Column('product_id', UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'platform_landing_features_product_id_fkey',
        'platform_landing_features', 'doctor_products',
        ['product_id'], ['product_id'],
        ondelete='SET NULL',
    )


def downgrade():
    op.drop_constraint(
        'platform_landing_features_product_id_fkey',
        'platform_landing_features', type_='foreignkey',
    )
    op.drop_column('platform_landing_features', 'product_id')
