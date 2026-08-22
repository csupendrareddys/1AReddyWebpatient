"""Group Offering payment schedule + tax (Phase 2).

Adds per-plan tax config (tax_mode + CGST/SGST/IGST rates) to
``group_offerings`` and a ``group_offering_installments`` payment-schedule
table (booking amount = installment #1).

Revision ID: gopay1sched2tax3
Revises: e8af12636f4f
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'gopay1sched2tax3'
down_revision = 'e8af12636f4f'
branch_labels = None
depends_on = None


def upgrade():
    # ── Tax config on the plan ──────────────────────────────────────────
    op.add_column('group_offerings', sa.Column(
        'tax_mode', sa.String(length=20), nullable=False, server_default='none'))
    op.add_column('group_offerings', sa.Column('cgst_rate', sa.Numeric(5, 2), nullable=True))
    op.add_column('group_offerings', sa.Column('sgst_rate', sa.Numeric(5, 2), nullable=True))
    op.add_column('group_offerings', sa.Column('igst_rate', sa.Numeric(5, 2), nullable=True))

    # ── Payment schedule ────────────────────────────────────────────────
    op.create_table(
        'group_offering_installments',
        sa.Column('installment_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('offering_id', UUID(as_uuid=True),
                  sa.ForeignKey('group_offerings.group_offering_id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('installment_no', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('payment_type', sa.String(length=20), nullable=False, server_default='fixed'),
        sa.Column('amount', sa.Numeric(10, 2), nullable=True),
        sa.Column('percentage', sa.Numeric(5, 2), nullable=True),
        sa.Column('due_after_days', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('due_label', sa.String(length=50), nullable=True),
        sa.Column('is_booking', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    # tenant_id / offering_id indexes are created by the index=True flags on
    # their columns above — no explicit create_index needed.


def downgrade():
    op.drop_table('group_offering_installments')
    op.drop_column('group_offerings', 'igst_rate')
    op.drop_column('group_offerings', 'sgst_rate')
    op.drop_column('group_offerings', 'cgst_rate')
    op.drop_column('group_offerings', 'tax_mode')
