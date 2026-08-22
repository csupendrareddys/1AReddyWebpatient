"""Add MarketplaceOrder.patient_attachment_link (booking attachment).

The patient can attach one file while booking a service so the doctor can
review it before accepting / rejecting the order. Stores the S3 URL.

Revision ID: ordr8attach9link0
Revises: paymnt7order8link9
Create Date: 2026-07-23
"""
import sqlalchemy as sa
from alembic import op


revision = 'ordr8attach9link0'
down_revision = 'paymnt7order8link9'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('marketplace_orders',
                  sa.Column('patient_attachment_link', sa.String(length=500),
                            nullable=True))


def downgrade():
    op.drop_column('marketplace_orders', 'patient_attachment_link')
