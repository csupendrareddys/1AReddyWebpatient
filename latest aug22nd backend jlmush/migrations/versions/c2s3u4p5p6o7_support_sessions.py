"""support_sessions — time-boxed vendor access grants

Revision ID: c2s3u4p5p6o7
Revises: b1p2l3a4t5f6
Create Date: 2026-08-18 00:00:00.000000

Backs the replacement for PLATFORM_OWNER's unconditional bypass of every
authorization decorator. Deliberately NOT RLS/tenant-scoped: a grant
describes the vendor<->tenant relationship, and scoping it into one
tenant's context would hide it from the other side.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'c2s3u4p5p6o7'
down_revision = 'b1p2l3a4t5f6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'support_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('platform_user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('target_tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('granted_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('use_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['platform_user_id'], ['users.user_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['target_tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_support_sessions_platform_user_id', 'support_sessions', ['platform_user_id'])
    op.create_index('ix_support_sessions_target_tenant_id', 'support_sessions', ['target_tenant_id'])
    op.create_index('ix_support_sessions_granted_at', 'support_sessions', ['granted_at'])
    op.create_index('ix_support_sessions_expires_at', 'support_sessions', ['expires_at'])
    op.create_index(
        'ix_support_sessions_lookup', 'support_sessions',
        ['platform_user_id', 'target_tenant_id', 'expires_at'],
    )


def downgrade():
    op.drop_index('ix_support_sessions_lookup', table_name='support_sessions')
    op.drop_index('ix_support_sessions_expires_at', table_name='support_sessions')
    op.drop_index('ix_support_sessions_granted_at', table_name='support_sessions')
    op.drop_index('ix_support_sessions_target_tenant_id', table_name='support_sessions')
    op.drop_index('ix_support_sessions_platform_user_id', table_name='support_sessions')
    op.drop_table('support_sessions')
