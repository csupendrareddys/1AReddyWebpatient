"""Add admin-approval gate to individual marketplace products.

Adds ``approval_status`` (pending → approved | rejected) and
``rejection_reason`` to ``doctor_marketplace_products``, mirroring the
existing group-offering approval on ``marketplace_service_groups``.

Existing rows were already live (a product used to go on sale the moment a
doctor added it), so they are backfilled to 'approved' — the new pending
gate applies only to products submitted from here on.

Revision ID: mktprod1appr2stat3
Revises: slot1perslot2do3
"""
from alembic import op
import sqlalchemy as sa


revision = 'mktprod1appr2stat3'
down_revision = 'slot1perslot2do3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'doctor_marketplace_products',
        sa.Column('approval_status', sa.String(length=20), nullable=True),
    )
    op.add_column(
        'doctor_marketplace_products',
        sa.Column('rejection_reason', sa.Text(), nullable=True),
    )

    # Existing products were already visible/bookable — keep them so.
    op.execute(
        "UPDATE doctor_marketplace_products "
        "SET approval_status = 'approved' WHERE approval_status IS NULL"
    )

    # Lock down: NOT NULL + a DB-level default of 'pending' for future inserts.
    op.alter_column(
        'doctor_marketplace_products', 'approval_status',
        existing_type=sa.String(length=20),
        nullable=False, server_default='pending',
    )
    op.create_index(
        'ix_doctor_marketplace_products_approval_status',
        'doctor_marketplace_products', ['approval_status'],
    )


def downgrade():
    op.drop_index('ix_doctor_marketplace_products_approval_status',
                  table_name='doctor_marketplace_products')
    op.drop_column('doctor_marketplace_products', 'rejection_reason')
    op.drop_column('doctor_marketplace_products', 'approval_status')
