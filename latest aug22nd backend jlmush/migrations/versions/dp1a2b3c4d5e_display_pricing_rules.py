"""Display pricing rules — admin markup/discount over a provider's quoted fee

Creates ``display_pricing_rules``: one sparse row per
(tenant, doctor, scope_type, scope_key) holding the SUPER_ADMIN-entered
increment (flat ₹ + %) and the overall discount (%). A missing row means "no
overlay" so the patient-facing price equals the provider's own price.

``scope_type`` is a ConsultationType value (then ``scope_key`` is a duration
slot like '10-20') or the literal 'service' (then ``scope_key`` is a
``DoctorProduct`` id) — hence ``scope_key`` is wide enough for a UUID.

Revision ID: dp1a2b3c4d5e
Revises: ee6c47624661
Create Date: 2026-07-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'dp1a2b3c4d5e'
down_revision = 'ee6c47624661'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'display_pricing_rules',
        sa.Column('display_pricing_rule_id', postgresql.UUID(as_uuid=True),
                  nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('doctor_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('scope_type', sa.String(length=32), nullable=False),
        sa.Column('scope_key', sa.String(length=64), nullable=False),
        sa.Column('increment_fixed', sa.Numeric(10, 2), nullable=False,
                  server_default='0'),
        sa.Column('increment_pct', sa.Numeric(5, 2), nullable=False,
                  server_default='0'),
        sa.Column('overall_discount_pct', sa.Numeric(5, 2), nullable=False,
                  server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('updated_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'],
                                name='fk_display_pricing_rules_tenant',
                                ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctors.doctor_id'],
                                name='fk_display_pricing_rules_doctor',
                                ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.user_id'],
                                name='fk_display_pricing_rules_created_by',
                                ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['updated_by_id'], ['users.user_id'],
                                name='fk_display_pricing_rules_updated_by',
                                ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('display_pricing_rule_id',
                                name='pk_display_pricing_rules'),
        sa.UniqueConstraint('tenant_id', 'doctor_id', 'scope_type',
                            'scope_key', name='uq_display_pricing_scope'),
    )
    op.create_index('ix_display_pricing_rules_tenant_id',
                    'display_pricing_rules', ['tenant_id'])
    op.create_index('ix_display_pricing_rules_doctor_id',
                    'display_pricing_rules', ['doctor_id'])
    # The hot read path is "every rule for this scope in this tenant" (the
    # admin table) and "every rule for these doctors" (booking reads).
    op.create_index('ix_display_pricing_lookup', 'display_pricing_rules',
                    ['tenant_id', 'scope_type', 'scope_key'])

    from app.models._base import generate_rls_sql
    for stmt in generate_rls_sql('display_pricing_rules'):
        op.execute(stmt)


def downgrade():
    op.execute("DROP POLICY IF EXISTS tenant_insert_display_pricing_rules "
               "ON display_pricing_rules")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_display_pricing_rules "
               "ON display_pricing_rules")
    op.drop_index('ix_display_pricing_lookup', table_name='display_pricing_rules')
    op.drop_index('ix_display_pricing_rules_doctor_id',
                  table_name='display_pricing_rules')
    op.drop_index('ix_display_pricing_rules_tenant_id',
                  table_name='display_pricing_rules')
    op.drop_table('display_pricing_rules')
