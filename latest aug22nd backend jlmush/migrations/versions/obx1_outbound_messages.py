"""Transactional outbox for provider sends (outbound_messages)

Hand-written (house rule). Notification-class SMS/email/push become rows
written transactionally, attempted post-commit, retried by the scheduler
sweep with backoff, dead-lettered after max attempts or expiry. No RLS
policy: the sweep reads cross-tenant by design (same stance as
tenant_dns_configs); writes always set tenant_id explicitly.

Revision ID: obx1_outbound_messages
Revises: rsl2_tenant_dns_configs
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = 'obx1_outbound_messages'
down_revision = 'rsl2_tenant_dns_configs'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'outbound_messages',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('channel', sa.String(10), nullable=False),
        sa.Column('recipient', sa.String(320), nullable=False),
        sa.Column('purpose', sa.String(80), nullable=False),
        sa.Column('payload', postgresql.JSONB(), nullable=False,
                  server_default=sa.text("'{}'::jsonb")),
        sa.Column('status', sa.String(10), nullable=False,
                  server_default='pending', index=True),
        sa.Column('attempts', sa.SmallInteger(), nullable=False,
                  server_default='0'),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text('now()'),
                  index=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.CheckConstraint("channel IN ('sms','email','push')",
                           name='ck_outbound_messages_channel'),
        sa.CheckConstraint(
            "status IN ('pending','sending','sent','failed','dead')",
            name='ck_outbound_messages_status'),
    )
    op.create_index(
        'ix_outbound_messages_due', 'outbound_messages',
        ['next_attempt_at'],
        postgresql_where=sa.text("status IN ('pending','failed','sending')"),
    )


def downgrade():
    op.drop_index('ix_outbound_messages_due', table_name='outbound_messages')
    op.drop_table('outbound_messages')
