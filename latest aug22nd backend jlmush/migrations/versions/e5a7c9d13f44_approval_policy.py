"""approval policy table + per-doctor approval-mode overrides

Revision ID: e5a7c9d13f44
Revises: d4f6b8c02e33
Create Date: 2026-08-06

Adds the tenant-wide approval-mode defaults (approval_policies) and the
per-doctor override JSON columns. Non-breaking: with no rows / null overrides,
the resolver falls back to a hardcoded 'manual' default, i.e. today's behaviour
(every change needs admin approval) is preserved until an admin flips a section
to 'auto'.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON, JSONB, UUID


revision = 'e5a7c9d13f44'
down_revision = 'd4f6b8c02e33'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'approval_policies',
        sa.Column('policy_id', UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('permission_modes', JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('action_modes', JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('tenant_id', name='uq_approval_policy_tenant'),
    )
    op.add_column('doctors', sa.Column('approval_permission_modes', JSON(), nullable=True))
    op.add_column('doctors', sa.Column('approval_action_modes', JSON(), nullable=True))


def downgrade():
    op.drop_column('doctors', 'approval_action_modes')
    op.drop_column('doctors', 'approval_permission_modes')
    op.drop_table('approval_policies')
