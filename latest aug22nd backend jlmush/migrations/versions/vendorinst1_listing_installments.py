"""Vendor listing: per-vendor payout installment override

Revision ID: vendorinst1
Revises: svcwh1
Create Date: 2026-07-28
"""
from alembic import op
import sqlalchemy as sa


revision = 'vendorinst1'
down_revision = 'svcwh1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('doctor_marketplace_products',
                  sa.Column('payout_installments', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('doctor_marketplace_products', 'payout_installments')
