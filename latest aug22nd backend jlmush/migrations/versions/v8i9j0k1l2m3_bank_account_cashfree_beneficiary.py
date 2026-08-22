"""Cashfree payout beneficiary fields on profile_bank_accounts (Phase B)

Adds beneficiary tracking so a doctor's bank account can be registered as a
Cashfree payout beneficiary once (add + penny-drop + doctor confirm), reused for
every payout, and removed on bank change / offboarding. All nullable; the table
already has RLS.

Revision ID: v8i9j0k1l2m3
Revises: u7h8i9j0k1l2
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa


revision = 'v8i9j0k1l2m3'
down_revision = 'u7h8i9j0k1l2'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('profile_bank_accounts', sa.Column('cashfree_beneficiary_id', sa.String(length=100), nullable=True))
    op.add_column('profile_bank_accounts', sa.Column('beneficiary_status', sa.String(length=30), nullable=True, server_default='none'))
    op.add_column('profile_bank_accounts', sa.Column('penny_drop_ref', sa.String(length=100), nullable=True))
    op.add_column('profile_bank_accounts', sa.Column('penny_drop_amount', sa.Numeric(10, 2), nullable=True))
    op.add_column('profile_bank_accounts', sa.Column('verified_name', sa.String(length=200), nullable=True))
    op.add_column('profile_bank_accounts', sa.Column('doctor_confirmed_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_pba_cashfree_beneficiary_id', 'profile_bank_accounts', ['cashfree_beneficiary_id'])


def downgrade():
    op.drop_index('ix_pba_cashfree_beneficiary_id', table_name='profile_bank_accounts')
    op.drop_column('profile_bank_accounts', 'doctor_confirmed_at')
    op.drop_column('profile_bank_accounts', 'verified_name')
    op.drop_column('profile_bank_accounts', 'penny_drop_amount')
    op.drop_column('profile_bank_accounts', 'penny_drop_ref')
    op.drop_column('profile_bank_accounts', 'beneficiary_status')
    op.drop_column('profile_bank_accounts', 'cashfree_beneficiary_id')
