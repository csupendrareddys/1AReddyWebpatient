"""tenant_email_configs — per-tenant sender identity + email template overrides

The email twin of ``tenant_sms_configs``, same shape on purpose so the two
rails stay readable side by side.

Two columns carry the difference from the SMS table, and both are deliberate:

* there is NO encrypted credential. SendClean sends from any verified domain
  on the SAME owner_id/token, and ``from_email``/``from_name`` are already
  per-message parameters — so unlike Combirds there is nothing per-tenant to
  hold in secret.
* ``domain_verified`` exists because the provider REJECTS an unverified From.
  Verification happens in SendClean's portal, so this records an operator
  confirmation rather than something the app can derive. Without it, a
  tenant flipping their sender on would produce mail that silently never
  arrives.

Revision ID: temail1_tenant_email_configs
Revises: obx1_outbound_messages
Create Date: 2026-08-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'temail1_tenant_email_configs'
down_revision = 'obx1_outbound_messages'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'tenant_email_configs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('use_own_email', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('from_email', sa.String(length=255), nullable=True),
        sa.Column('from_name', sa.String(length=120), nullable=True),
        sa.Column('reply_to', sa.String(length=255), nullable=True),
        sa.Column('domain_verified', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('templates', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by_id', sa.UUID(), nullable=True),
        sa.Column('updated_by_id', sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.user_id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by_id'], ['users.user_id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('tenant_email_configs', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_tenant_email_configs_is_deleted'), ['is_deleted'], unique=False)
        batch_op.create_index(
            batch_op.f('ix_tenant_email_configs_tenant_id'), ['tenant_id'], unique=False)
        # One live config per tenant; soft-deleted rows are excluded so a
        # tenant can be re-onboarded without colliding with its own history.
        batch_op.create_index(
            'ux_tenant_email_configs_tenant', ['tenant_id'], unique=True,
            postgresql_where=sa.text('is_deleted = false'))


def downgrade():
    with op.batch_alter_table('tenant_email_configs', schema=None) as batch_op:
        batch_op.drop_index('ux_tenant_email_configs_tenant')
        batch_op.drop_index(batch_op.f('ix_tenant_email_configs_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_tenant_email_configs_is_deleted'))
    op.drop_table('tenant_email_configs')
