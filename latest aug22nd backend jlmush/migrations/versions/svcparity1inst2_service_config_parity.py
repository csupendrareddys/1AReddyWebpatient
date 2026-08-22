"""Service-config parity: per-mode consultation counts + admin payout installments

Adds audio/video per-mode consultation counts to doctor_products and a
doctor_product_installments table holding the admin-set payout schedule for a
service (fixed ₹ or % of the doctor's fee, released after N days) — mirroring
the group-offering member installment schedule.

Revision ID: svcparity1inst2
Revises: plandisc1cap2pct3
Create Date: 2026-07-28
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'svcparity1inst2'
down_revision = 'plandisc1cap2pct3'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('doctor_products', schema=None) as batch_op:
        batch_op.add_column(sa.Column('audio_min_consultations', sa.Integer(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('audio_max_consultations', sa.Integer(), nullable=False, server_default='1'))
        batch_op.add_column(sa.Column('video_min_consultations', sa.Integer(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('video_max_consultations', sa.Integer(), nullable=False, server_default='1'))

    op.create_table(
        'doctor_product_installments',
        sa.Column('installment_id', sa.UUID(), nullable=False),
        sa.Column('product_id', sa.UUID(), nullable=False),
        sa.Column('installment_no', sa.Integer(), nullable=False),
        sa.Column('payment_type', sa.String(length=20), nullable=False),
        sa.Column('amount', sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column('percentage', sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column('period_label', sa.String(length=60), nullable=True),
        sa.Column('due_after_days', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(
            ['product_id'], ['doctor_products.product_id'],
            name='doctor_product_installments_product_id_fkey', ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['tenant_id'], ['tenants.id'],
            name='doctor_product_installments_tenant_id_fkey', ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('installment_id'),
    )
    with op.batch_alter_table('doctor_product_installments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_doctor_product_installments_product_id'), ['product_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_doctor_product_installments_tenant_id'), ['tenant_id'], unique=False)


def downgrade():
    with op.batch_alter_table('doctor_product_installments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_doctor_product_installments_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_doctor_product_installments_product_id'))
    op.drop_table('doctor_product_installments')

    with op.batch_alter_table('doctor_products', schema=None) as batch_op:
        batch_op.drop_column('video_max_consultations')
        batch_op.drop_column('video_min_consultations')
        batch_op.drop_column('audio_max_consultations')
        batch_op.drop_column('audio_min_consultations')
