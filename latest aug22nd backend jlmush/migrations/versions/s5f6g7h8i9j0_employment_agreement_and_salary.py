"""Doctor employment agreement + salary payouts (Phase 2)

Adds:
  * doctor_employment_agreements — versioned employee/consultant terms
    (min-slot rules, salary, cadence, platform-fee mode, retainer for P3).
  * salary_payouts — one row per pay period (reuses payoutstatus for settle).
  * doctor_billing_profiles.active_agreement_id → the in-force agreement.

New PG enums salarycadence / platformfeemode created here. Both new tables get RLS.

Revision ID: s5f6g7h8i9j0
Revises: r4e5f6g7h8i9
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import UUID, JSON


revision = 's5f6g7h8i9j0'
down_revision = 'r4e5f6g7h8i9'
branch_labels = None
depends_on = None

_salary_cadence = postgresql.ENUM('monthly', 'fortnightly', name='salarycadence', create_type=False)
_platform_fee_mode = postgresql.ENUM('zero', 'plan', 'custom', name='platformfeemode', create_type=False)
_billing_type = postgresql.ENUM('plan', 'employee', 'consultant', name='doctorbillingtype', create_type=False)
_payout_status = postgresql.ENUM(
    'on_hold', 'claimable', 'pending', 'processing', 'completed', 'failed', 'reversed',
    name='payoutstatus', create_type=False,
)

_NEW_TABLES = ['doctor_employment_agreements', 'salary_payouts']


def upgrade():
    _salary_cadence.create(op.get_bind(), checkfirst=True)
    _platform_fee_mode.create(op.get_bind(), checkfirst=True)

    # 1. doctor_employment_agreements ----------------------------------------
    op.create_table(
        'doctor_employment_agreements',
        sa.Column('agreement_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('doctor_id', UUID(as_uuid=True), sa.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False),
        sa.Column('billing_type', _billing_type, nullable=False, server_default='employee'),
        sa.Column('effective_from', sa.Date(), nullable=True),
        sa.Column('effective_to', sa.Date(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('min_hours_per_day', sa.Numeric(5, 2), nullable=True),
        sa.Column('min_hours_per_week', sa.Numeric(6, 2), nullable=True),
        sa.Column('min_hours_per_month', sa.Numeric(7, 2), nullable=True),
        sa.Column('day_window_start', sa.Time(), nullable=True),
        sa.Column('day_window_end', sa.Time(), nullable=True),
        sa.Column('per_type_minimums', JSON, nullable=True),
        sa.Column('monthly_salary', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('payment_cadence', _salary_cadence, nullable=False, server_default='monthly'),
        sa.Column('platform_fee_mode', _platform_fee_mode, nullable=False, server_default='zero'),
        sa.Column('platform_fee_value', sa.Numeric(10, 4), nullable=True),
        sa.Column('base_retainer_amount', sa.Numeric(10, 2), nullable=True),
        sa.Column('retainer_cadence', _salary_cadence, nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by_id', UUID(as_uuid=True), sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_by_id', UUID(as_uuid=True), sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_doctor_employment_agreements_tenant_id', 'doctor_employment_agreements', ['tenant_id'])
    op.create_index('ix_doctor_employment_agreements_doctor_id', 'doctor_employment_agreements', ['doctor_id'])
    op.create_index('ix_doctor_employment_agreements_is_active', 'doctor_employment_agreements', ['is_active'])

    # 2. salary_payouts ------------------------------------------------------
    op.create_table(
        'salary_payouts',
        sa.Column('salary_payout_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('doctor_id', UUID(as_uuid=True), sa.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False),
        sa.Column('agreement_id', UUID(as_uuid=True), sa.ForeignKey('doctor_employment_agreements.agreement_id', ondelete='SET NULL'), nullable=True),
        sa.Column('period_start', sa.Date(), nullable=False),
        sa.Column('period_end', sa.Date(), nullable=False),
        sa.Column('kind', sa.String(20), nullable=False, server_default='salary'),
        sa.Column('gross_salary', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('deductions', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('net_amount', sa.Numeric(10, 2), nullable=False, server_default='0'),
        sa.Column('compliance_withheld', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('status', _payout_status, nullable=False, server_default='pending'),
        sa.Column('status_reason', sa.Text(), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by_id', UUID(as_uuid=True), sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_by_id', UUID(as_uuid=True), sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('tenant_id', 'doctor_id', 'period_start', 'period_end', 'kind',
                            name='uq_salary_payout_period'),
    )
    op.create_index('ix_salary_payouts_tenant_id', 'salary_payouts', ['tenant_id'])
    op.create_index('ix_salary_payouts_doctor_id', 'salary_payouts', ['doctor_id'])
    op.create_index('ix_salary_payouts_status', 'salary_payouts', ['status'])

    # 3. doctor_billing_profiles.active_agreement_id -------------------------
    op.add_column('doctor_billing_profiles', sa.Column('active_agreement_id', UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_billing_profile_active_agreement', 'doctor_billing_profiles',
                          'doctor_employment_agreements', ['active_agreement_id'], ['agreement_id'],
                          ondelete='SET NULL')

    # 4. RLS -----------------------------------------------------------------
    from app.models._base import generate_rls_sql
    for table in _NEW_TABLES:
        for stmt in generate_rls_sql(table):
            op.execute(stmt)


def downgrade():
    for table in reversed(_NEW_TABLES):
        op.execute(f"DROP POLICY IF EXISTS tenant_insert_{table} ON {table}")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.execute('ALTER TABLE doctor_billing_profiles DROP CONSTRAINT IF EXISTS fk_billing_profile_active_agreement')
    op.drop_column('doctor_billing_profiles', 'active_agreement_id')
    op.drop_table('salary_payouts')
    op.drop_table('doctor_employment_agreements')
    # enum types salarycadence/platformfeemode left in place (harmless).
