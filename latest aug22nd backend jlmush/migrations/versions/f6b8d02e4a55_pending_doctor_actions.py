"""pending_doctor_actions (held doctor actions awaiting admin approval)

Revision ID: f6b8d02e4a55
Revises: e5a7c9d13f44
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = 'f6b8d02e4a55'
down_revision = 'e5a7c9d13f44'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'pending_doctor_actions',
        sa.Column('action_id', UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('doctor_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('kind', sa.String(40), nullable=False, index=True),
        sa.Column('ref_type', sa.String(30), nullable=True),
        sa.Column('ref_id', UUID(as_uuid=True), nullable=True, index=True),
        sa.Column('payload', JSONB(), nullable=True),
        sa.Column('label', sa.String(200), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending', index=True),
        sa.Column('requested_by_id', UUID(as_uuid=True), nullable=True),
        sa.Column('review_comment', sa.Text(), nullable=True),
        sa.Column('reviewed_by_id', UUID(as_uuid=True), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctors.doctor_id'], ondelete='CASCADE'),
    )


def downgrade():
    op.drop_table('pending_doctor_actions')
