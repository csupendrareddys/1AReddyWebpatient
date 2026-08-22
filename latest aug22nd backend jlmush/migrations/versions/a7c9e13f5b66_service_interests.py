"""service_interests (doctor expressions of interest in a catalog service/plan)

Revision ID: a7c9e13f5b66
Revises: f6b8d02e4a55
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'a7c9e13f5b66'
down_revision = 'f6b8d02e4a55'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'service_interests',
        sa.Column('interest_id', UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('doctor_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('product_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='new'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctors.doctor_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['product_id'], ['doctor_products.product_id'], ondelete='CASCADE'),
        sa.UniqueConstraint('tenant_id', 'doctor_id', 'product_id', name='uq_service_interest'),
    )


def downgrade():
    op.drop_table('service_interests')
