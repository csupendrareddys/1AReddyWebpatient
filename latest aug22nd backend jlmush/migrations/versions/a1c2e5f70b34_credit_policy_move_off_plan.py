"""credit policy table — move credit constraints off the plan

Revision ID: a1c2e5f70b34
Revises: 00056ef74266
Create Date: 2026-08-01 09:30:00.000000

Splits the health-credit constraints out of ``membership_plans`` into their own
``credit_policies`` table (one per plan), so an admin can retune the grant + the
per-offering redemption caps WITHOUT re-versioning the plan or waiting for a
renewal. Backfills the new table from the existing plan columns, then drops
``credit_grant`` / ``credit_config`` from ``membership_plans``.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'a1c2e5f70b34'
down_revision = '00056ef74266'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'credit_policies',
        sa.Column('policy_id', sa.UUID(), nullable=False),
        sa.Column('plan_id', sa.UUID(), nullable=False),
        sa.Column('grant_amount', sa.Numeric(precision=10, scale=2), nullable=False, server_default='0'),
        sa.Column('scopes', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['plan_id'], ['membership_plans.id'], ondelete='CASCADE',
                                name='fk_credit_policies_plan_id'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('policy_id'),
        sa.UniqueConstraint('tenant_id', 'plan_id', name='uq_credit_policy_plan'),
    )
    op.create_index('ix_credit_policies_plan_id', 'credit_policies', ['plan_id'])
    op.create_index('ix_credit_policies_tenant_id', 'credit_policies', ['tenant_id'])

    # Backfill one policy per plan that actually has credit config today.
    op.execute(sa.text("""
        INSERT INTO credit_policies
            (policy_id, plan_id, tenant_id, grant_amount, scopes, is_active,
             created_at, updated_at)
        SELECT gen_random_uuid(), p.id, p.tenant_id,
               COALESCE(p.credit_grant, 0),
               COALESCE(p.credit_config, '{}'::jsonb),
               true, now(), now()
        FROM membership_plans p
        WHERE COALESCE(p.credit_grant, 0) > 0
           OR COALESCE(p.credit_config, '{}'::jsonb) <> '{}'::jsonb
    """))

    with op.batch_alter_table('membership_plans', schema=None) as batch_op:
        batch_op.drop_column('credit_config')
        batch_op.drop_column('credit_grant')


def downgrade():
    with op.batch_alter_table('membership_plans', schema=None) as batch_op:
        batch_op.add_column(sa.Column(
            'credit_grant', sa.Numeric(precision=10, scale=2),
            nullable=False, server_default='0'))
        batch_op.add_column(sa.Column(
            'credit_config', postgresql.JSONB(astext_type=sa.Text()),
            nullable=False, server_default=sa.text("'{}'::jsonb")))

    # Copy the constraints back onto the plan before dropping the table.
    op.execute(sa.text("""
        UPDATE membership_plans p
        SET credit_grant = cp.grant_amount,
            credit_config = cp.scopes
        FROM credit_policies cp
        WHERE cp.plan_id = p.id
    """))

    op.drop_table('credit_policies')
