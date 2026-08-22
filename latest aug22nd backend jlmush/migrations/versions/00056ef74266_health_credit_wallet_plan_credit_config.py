"""health credit wallet + plan credit config

Revision ID: 00056ef74266
Revises: 84ac07d71afc
Create Date: 2026-07-31 13:39:33.601255

Adds the health-credit wallet (a per-period rupee wallet a membership plan
grants its subscriber) + its ledger, and the plan-side config: ``credit_grant``
(₹ granted per period) and ``credit_config`` (per-offering redemption caps).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '00056ef74266'
down_revision = '84ac07d71afc'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'health_credit_wallets',
        sa.Column('wallet_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('balance', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('period_end', sa.DateTime(timezone=True), nullable=True),
        sa.Column('plan_id', sa.UUID(), nullable=True),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['plan_id'], ['membership_plans.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.user_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('wallet_id'),
        sa.UniqueConstraint('tenant_id', 'user_id', name='uq_health_credit_wallet_user'),
    )
    op.create_index('ix_health_credit_wallets_tenant_id', 'health_credit_wallets', ['tenant_id'])
    op.create_index('ix_health_credit_wallets_user_id', 'health_credit_wallets', ['user_id'])

    op.create_table(
        'health_credit_ledger',
        sa.Column('ledger_id', sa.UUID(), nullable=False),
        sa.Column('wallet_id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('amount', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('ref_type', sa.String(length=30), nullable=True),
        sa.Column('ref_id', sa.UUID(), nullable=True),
        sa.Column('note', sa.String(length=200), nullable=True),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.user_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['wallet_id'], ['health_credit_wallets.wallet_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('ledger_id'),
    )
    op.create_index('ix_health_credit_ledger_ref_id', 'health_credit_ledger', ['ref_id'])
    op.create_index('ix_health_credit_ledger_tenant_id', 'health_credit_ledger', ['tenant_id'])
    op.create_index('ix_health_credit_ledger_user_id', 'health_credit_ledger', ['user_id'])
    op.create_index('ix_health_credit_ledger_wallet_id', 'health_credit_ledger', ['wallet_id'])

    # NOT NULL on an existing table needs a server default so current rows fill.
    with op.batch_alter_table('membership_plans', schema=None) as batch_op:
        batch_op.add_column(sa.Column(
            'credit_grant', sa.Numeric(precision=10, scale=2),
            nullable=False, server_default='0'))
        batch_op.add_column(sa.Column(
            'credit_config', postgresql.JSONB(astext_type=sa.Text()),
            nullable=False, server_default=sa.text("'{}'::jsonb")))


def downgrade():
    with op.batch_alter_table('membership_plans', schema=None) as batch_op:
        batch_op.drop_column('credit_config')
        batch_op.drop_column('credit_grant')
    # drop_table cascades the tables' own indexes + FK constraints.
    op.drop_table('health_credit_ledger')
    op.drop_table('health_credit_wallets')
