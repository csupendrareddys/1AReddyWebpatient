"""Link a landing feature to a bookable product

Adds landing_features.product_id (FK -> doctor_products) so a marketed landing
feature can point at the service/product its "Book Now" redirects to. Nullable
— a feature can stay purely informational.

Revision ID: landfeatprod1
Revises: apprstatuscancel1
Create Date: 2026-07-28
"""
from alembic import op
import sqlalchemy as sa


revision = 'landfeatprod1'
down_revision = 'apprstatuscancel1'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('landing_features', schema=None) as batch_op:
        batch_op.add_column(sa.Column('product_id', sa.UUID(), nullable=True))
        batch_op.create_index(batch_op.f('ix_landing_features_product_id'), ['product_id'], unique=False)
        batch_op.create_foreign_key(
            'landing_features_product_id_fkey', 'doctor_products',
            ['product_id'], ['product_id'], ondelete='SET NULL',
        )


def downgrade():
    with op.batch_alter_table('landing_features', schema=None) as batch_op:
        batch_op.drop_constraint('landing_features_product_id_fkey', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_landing_features_product_id'))
        batch_op.drop_column('product_id')
