"""Device push tokens for mobile background notification delivery.

See app/models/device_push_token.py. Provider-agnostic (Expo first).

Revision ID: devpush1_device_push_tokens
Revises: notif1_notifications_table
Create Date: 2026-08-19
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'devpush1_device_push_tokens'
down_revision = 'notif1_notifications_table'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'device_push_tokens',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('token', sa.String(length=512), nullable=False),
        sa.Column('platform', sa.String(length=20), nullable=False),
        sa.Column('provider', sa.String(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.user_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token', name='uq_device_push_tokens_token'),
    )
    op.create_index('ix_device_push_tokens_tenant_id', 'device_push_tokens', ['tenant_id'])
    op.create_index('ix_device_push_tokens_user_id', 'device_push_tokens', ['user_id'])


def downgrade():
    op.drop_index('ix_device_push_tokens_user_id', table_name='device_push_tokens')
    op.drop_index('ix_device_push_tokens_tenant_id', table_name='device_push_tokens')
    op.drop_table('device_push_tokens')
