"""tenant gateway/sms configs + subscription payments + billing state

Revision ID: 87f0b6217cba
Revises: c2s3u4p5p6o7
Create Date: 2026-08-18 16:16:31.860959

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '87f0b6217cba'
down_revision = 'c2s3u4p5p6o7'
branch_labels = None
depends_on = None


def upgrade():
    # Autogen also detected pre-existing LOCAL drift (link_relationship_policies,
    # group_offerings.product_category, membership_plans.max_*). Those belong
    # to their own features' migrations — re-adding them here would fail on
    # environments that already have them. Pruned to THIS feature's objects.
    op.create_table('tenant_payment_configs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('razorpay_key_id', sa.String(length=100), nullable=True),
    sa.Column('_razorpay_key_secret_encrypted', sa.Text(), nullable=True),
    sa.Column('_razorpay_webhook_secret_encrypted', sa.Text(), nullable=True),
    sa.Column('cashfree_env', sa.String(length=20), server_default='sandbox', nullable=False),
    sa.Column('cashfree_client_id', sa.String(length=100), nullable=True),
    sa.Column('_cashfree_client_secret_encrypted', sa.Text(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('collection_verified_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('payout_verified_at', sa.DateTime(timezone=True), nullable=True),
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
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('tenant_payment_configs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_tenant_payment_configs_is_deleted'), ['is_deleted'], unique=False)
        batch_op.create_index(batch_op.f('ix_tenant_payment_configs_tenant_id'), ['tenant_id'], unique=False)
        batch_op.create_index('ux_tenant_payment_configs_tenant', ['tenant_id'], unique=True, postgresql_where=sa.text('is_deleted = false'))

    op.create_table('tenant_sms_configs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('use_own_dlt', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('sender_id', sa.String(length=20), nullable=True),
    sa.Column('_combirds_api_key_encrypted', sa.Text(), nullable=True),
    sa.Column('combirds_sms_url', sa.String(length=300), nullable=True),
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
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('tenant_sms_configs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_tenant_sms_configs_is_deleted'), ['is_deleted'], unique=False)
        batch_op.create_index(batch_op.f('ix_tenant_sms_configs_tenant_id'), ['tenant_id'], unique=False)
        batch_op.create_index('ux_tenant_sms_configs_tenant', ['tenant_id'], unique=True, postgresql_where=sa.text('is_deleted = false'))

    with op.batch_alter_table('payments', schema=None) as batch_op:
        batch_op.add_column(sa.Column('tenant_subscription_id', sa.UUID(), nullable=True))
        batch_op.create_index(batch_op.f('ix_payments_tenant_subscription_id'), ['tenant_subscription_id'], unique=False)
        batch_op.create_foreign_key(
            'fk_payments_tenant_subscription_id', 'tenant_subscriptions',
            ['tenant_subscription_id'], ['id'], ondelete='SET NULL')

    with op.batch_alter_table('tenant_subscriptions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('billing_state', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade():
    with op.batch_alter_table('tenant_subscriptions', schema=None) as batch_op:
        batch_op.drop_column('billing_state')

    with op.batch_alter_table('payments', schema=None) as batch_op:
        batch_op.drop_constraint('fk_payments_tenant_subscription_id',
                                 type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_payments_tenant_subscription_id'))
        batch_op.drop_column('tenant_subscription_id')

    with op.batch_alter_table('tenant_sms_configs', schema=None) as batch_op:
        batch_op.drop_index('ux_tenant_sms_configs_tenant', postgresql_where=sa.text('is_deleted = false'))
        batch_op.drop_index(batch_op.f('ix_tenant_sms_configs_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_tenant_sms_configs_is_deleted'))

    op.drop_table('tenant_sms_configs')
    with op.batch_alter_table('tenant_payment_configs', schema=None) as batch_op:
        batch_op.drop_index('ux_tenant_payment_configs_tenant', postgresql_where=sa.text('is_deleted = false'))
        batch_op.drop_index(batch_op.f('ix_tenant_payment_configs_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_tenant_payment_configs_is_deleted'))

    op.drop_table('tenant_payment_configs')
