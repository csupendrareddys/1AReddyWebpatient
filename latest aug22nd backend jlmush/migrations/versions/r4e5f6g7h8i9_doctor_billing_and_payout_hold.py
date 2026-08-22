"""Doctor billing profile + payout hold/claim columns + default_hold_days

Adds:
  * doctor_billing_profiles — per-doctor payout config (billing_type default
    'plan', payout_mode default 'autopay', hold_days_override). RLS enabled.
  * doctor_payouts.hold_until / payout_mode / claim_requested_at / claimed_by_id
  * billing_configs.default_hold_days (tenant default T)

New PG enums doctorbillingtype / payoutmode are created here. The payoutstatus
enum values (on_hold, claimable) were added in q3d4e5f6g7h8.

Revision ID: r4e5f6g7h8i9
Revises: q3d4e5f6g7h8
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import UUID


revision = 'r4e5f6g7h8i9'
down_revision = 'q3d4e5f6g7h8'
branch_labels = None
depends_on = None

_billing_type = postgresql.ENUM('plan', 'employee', 'consultant', name='doctorbillingtype', create_type=False)
_payout_mode = postgresql.ENUM('autopay', 'claim', name='payoutmode', create_type=False)


def upgrade():
    _billing_type.create(op.get_bind(), checkfirst=True)
    _payout_mode.create(op.get_bind(), checkfirst=True)

    # 1. billing_configs.default_hold_days -----------------------------------
    op.add_column('billing_configs',
                  sa.Column('default_hold_days', sa.Integer(), nullable=False, server_default='0'))

    # 2. doctor_payouts hold/claim columns -----------------------------------
    op.add_column('doctor_payouts', sa.Column('hold_until', sa.DateTime(timezone=True), nullable=True))
    op.add_column('doctor_payouts', sa.Column('payout_mode', sa.String(20), nullable=True))
    op.add_column('doctor_payouts', sa.Column('claim_requested_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('doctor_payouts', sa.Column('claimed_by_id', UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_doctor_payouts_claimed_by_id', 'doctor_payouts', 'users',
                          ['claimed_by_id'], ['user_id'])
    op.create_index('ix_doctor_payouts_hold_until', 'doctor_payouts', ['hold_until'])

    # 3. doctor_billing_profiles ---------------------------------------------
    op.create_table(
        'doctor_billing_profiles',
        sa.Column('billing_profile_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('doctor_id', UUID(as_uuid=True),
                  sa.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('billing_type', _billing_type, nullable=False, server_default='plan'),
        sa.Column('payout_mode', _payout_mode, nullable=False, server_default='autopay'),
        sa.Column('hold_days_override', sa.Integer(), nullable=True),
        sa.Column('created_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_doctor_billing_profiles_tenant_id', 'doctor_billing_profiles', ['tenant_id'])
    op.create_index('ix_doctor_billing_profiles_doctor_id', 'doctor_billing_profiles', ['doctor_id'])

    from app.models._base import generate_rls_sql
    for stmt in generate_rls_sql('doctor_billing_profiles'):
        op.execute(stmt)


def downgrade():
    table = 'doctor_billing_profiles'
    op.execute(f"DROP POLICY IF EXISTS tenant_insert_{table} ON {table}")
    op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}")
    op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.drop_table(table)

    op.execute('DROP INDEX IF EXISTS ix_doctor_payouts_hold_until')
    op.execute('ALTER TABLE doctor_payouts DROP CONSTRAINT IF EXISTS fk_doctor_payouts_claimed_by_id')
    op.drop_column('doctor_payouts', 'claimed_by_id')
    op.drop_column('doctor_payouts', 'claim_requested_at')
    op.drop_column('doctor_payouts', 'payout_mode')
    op.drop_column('doctor_payouts', 'hold_until')
    op.drop_column('billing_configs', 'default_hold_days')
    # enum types doctorbillingtype/payoutmode left in place (harmless).
