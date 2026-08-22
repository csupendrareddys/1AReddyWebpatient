"""Specialization gating on doctor_products (Item 3C)

Adds doctor_products.allowed_specialization_ids (JSON list of specialization
category ids allowed to offer the product; NULL/empty = any doctor). Additive,
nullable.

Revision ID: y1l2m3n4o5p6
Revises: x0k1l2m3n4o5
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa


revision = 'y1l2m3n4o5p6'
down_revision = 'x0k1l2m3n4o5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'doctor_products',
        sa.Column('allowed_specialization_ids', sa.JSON(), nullable=True),
    )


def downgrade():
    op.drop_column('doctor_products', 'allowed_specialization_ids')
