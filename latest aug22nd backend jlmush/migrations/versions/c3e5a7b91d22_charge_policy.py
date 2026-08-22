"""charge policy table (platform charges off the plan)

Revision ID: c3e5a7b91d22
Revises: b2d4f6a80c11
Create Date: 2026-08-06

Moves the three platform charges (c1/c2/c3 + per-charge tax) off
``membership_plans`` into their own ``charge_policies`` table so an admin can
tune them without re-versioning the plan, effective on the next payout. The
plan columns stay in place (read as a fallback) and are backfilled into a
policy row per plan so behaviour is unchanged on upgrade.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'c3e5a7b91d22'
down_revision = 'b2d4f6a80c11'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'charge_policies',
        sa.Column('policy_id', UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('plan_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('charge1_name', sa.String(100), nullable=False, server_default='Platform Fee'),
        sa.Column('charge1_type', sa.String(20), nullable=False, server_default='percentage'),
        sa.Column('charge1_value', sa.Numeric(10, 4), nullable=False, server_default='0'),
        sa.Column('charge1_tax_type', sa.String(20), nullable=False, server_default='percentage'),
        sa.Column('charge1_tax_value', sa.Numeric(10, 4), nullable=False, server_default='0'),
        sa.Column('charge2_name', sa.String(100), nullable=False, server_default='Service Fee'),
        sa.Column('charge2_type', sa.String(20), nullable=False, server_default='percentage'),
        sa.Column('charge2_value', sa.Numeric(10, 4), nullable=False, server_default='0'),
        sa.Column('charge2_tax_type', sa.String(20), nullable=False, server_default='percentage'),
        sa.Column('charge2_tax_value', sa.Numeric(10, 4), nullable=False, server_default='0'),
        sa.Column('charge3_name', sa.String(100), nullable=False, server_default='Processing Fee'),
        sa.Column('charge3_type', sa.String(20), nullable=False, server_default='percentage'),
        sa.Column('charge3_value', sa.Numeric(10, 4), nullable=False, server_default='0'),
        sa.Column('charge3_tax_type', sa.String(20), nullable=False, server_default='percentage'),
        sa.Column('charge3_tax_value', sa.Numeric(10, 4), nullable=False, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['plan_id'], ['membership_plans.id'],
                                name='fk_charge_policies_plan_id', ondelete='CASCADE'),
        sa.UniqueConstraint('tenant_id', 'plan_id', name='uq_charge_policy_plan'),
    )
    # (tenant_id / plan_id indexes are created by index=True on the columns.)

    # Backfill one policy per plan from the plan's existing charge columns so the
    # payout math is unchanged until an admin edits it.
    op.execute("""
        INSERT INTO charge_policies (
            policy_id, tenant_id, plan_id, is_active,
            charge1_name, charge1_type, charge1_value, charge1_tax_type, charge1_tax_value,
            charge2_name, charge2_type, charge2_value, charge2_tax_type, charge2_tax_value,
            charge3_name, charge3_type, charge3_value, charge3_tax_type, charge3_tax_value,
            created_at, updated_at
        )
        SELECT
            gen_random_uuid(), mp.tenant_id, mp.id, true,
            mp.charge1_name, mp.charge1_type, mp.charge1_value, mp.charge1_tax_type, mp.charge1_tax_value,
            mp.charge2_name, mp.charge2_type, mp.charge2_value, mp.charge2_tax_type, mp.charge2_tax_value,
            mp.charge3_name, mp.charge3_type, mp.charge3_value, mp.charge3_tax_type, mp.charge3_tax_value,
            now(), now()
        FROM membership_plans mp
        WHERE mp.is_deleted = false
        ON CONFLICT (tenant_id, plan_id) DO NOTHING
    """)


def downgrade():
    op.drop_table('charge_policies')
