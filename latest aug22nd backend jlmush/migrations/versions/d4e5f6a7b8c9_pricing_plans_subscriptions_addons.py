"""Pricing / Plans module — tables, RLS, Plan1 seed, existing-tenant backfill.

Creates four tables:
    * ``plans`` — platform-wide catalog (no tenant_id).
    * ``tenant_subscriptions`` — tenant ↔ plan link, RLS-enabled.
    * ``addons`` — platform-wide add-on catalog (no tenant_id).
    * ``tenant_addons`` — tenant ↔ add-on link, RLS-enabled.

Also enum-types for PlanStatus / SubscriptionStatus / BillingCycle /
OverLimitAction / AddonStatus / AddonSubscriptionStatus.

Seeds ``Plan1`` with the Plan1 defaults confirmed with the user:
    total=20, super_admin=1, sub_admin=3, provider=16,
    BLOCK_NEW over-limit action, platform-managed comms + Razorpay,
    subdomain configurable, custom domain disabled.

Backfills a ``tenant_subscriptions`` row pointing at Plan1 for every
existing tenant whose ``settings['plan']`` is null / 'free' / 'starter' —
so no tenant is left without an active subscription after upgrade.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-04-21
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSON, UUID


# revision identifiers, used by Alembic.
revision = 'd4e5f6a7b8c9'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None


PLAN1_FEATURES = {
    'patient': {
        'basic_info': True,
        'vitals': False,
        'documents': False,
        'family': False,
    },
    'doctor': {
        'profile': True,
        'calendar': True,
        'pricing': True,
        'prescriptions': True,
    },
    'admin': {
        'manage_users': True,
        'page_configuration': False,
    },
    'communication': {
        'sms': {'enabled': True, 'control': 'platform'},
        'email': {'enabled': True, 'control': 'platform'},
    },
    'payments': {
        'razorpay': {'enabled': True, 'control': 'platform'},
    },
    'domain': {
        'subdomain': {'enabled': True, 'configurable': True},
        'custom_domain': {'enabled': False, 'configurable': False},
    },
}


def upgrade():
    # ── Enum types ──────────────────────────────────────────────────
    # Raw CREATE TYPE (with IF NOT EXISTS guard) — lets subsequent
    # ``create_table`` calls reference the types via ``postgresql.ENUM(..., create_type=False)``
    # without the SQLAlchemy-enum-auto-create path clashing with our
    # explicit creation in the same transaction.
    # SQLAlchemy's ``db.Enum(PyEnum)`` stores the Python member NAME
    # (e.g. ``ACTIVE``), not ``.value``. The DB-side enum values must
    # match the uppercase member names — convention used by every other
    # enum in this schema (configstatus, userstatus, …).
    enum_ddl = [
        ("planstatus", "'DRAFT','ACTIVE','ARCHIVED'"),
        ("subscriptionstatus",
         "'TRIAL','ACTIVE','PAST_DUE','CANCELLED','SUSPENDED','OVER_LIMIT'"),
        ("billingcycle", "'MONTHLY','ANNUAL'"),
        ("overlimitaction",
         "'BLOCK_NEW','GRACE_THEN_SUSPEND','SUSPEND_IMMEDIATELY'"),
        ("addonstatus", "'DRAFT','ACTIVE','ARCHIVED'"),
        ("addonsubstatus", "'ACTIVE','CANCELLED','SUSPENDED'"),
    ]
    for name, values in enum_ddl:
        op.execute(
            f"DO $$ BEGIN "
            f"IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '{name}') THEN "
            f"CREATE TYPE {name} AS ENUM ({values}); "
            f"END IF; END $$;"
        )

    # Column-level references — do NOT re-create the types.
    plan_status_col = postgresql.ENUM(
        'DRAFT', 'ACTIVE', 'ARCHIVED', name='planstatus', create_type=False,
    )
    subscription_status_col = postgresql.ENUM(
        'TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'SUSPENDED', 'OVER_LIMIT',
        name='subscriptionstatus', create_type=False,
    )
    billing_cycle_col = postgresql.ENUM(
        'MONTHLY', 'ANNUAL', name='billingcycle', create_type=False,
    )
    over_limit_action_col = postgresql.ENUM(
        'BLOCK_NEW', 'GRACE_THEN_SUSPEND', 'SUSPEND_IMMEDIATELY',
        name='overlimitaction', create_type=False,
    )
    addon_status_col = postgresql.ENUM(
        'DRAFT', 'ACTIVE', 'ARCHIVED', name='addonstatus', create_type=False,
    )
    addon_sub_status_col = postgresql.ENUM(
        'ACTIVE', 'CANCELLED', 'SUSPENDED', name='addonsubstatus', create_type=False,
    )

    # ── plans (platform catalog, no tenant_id) ──────────────────────
    op.create_table(
        'plans',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('code', sa.String(50), unique=True, nullable=False, index=True),
        sa.Column('name', sa.String(150), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', plan_status_col, nullable=False, server_default='DRAFT'),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('price_inr_monthly', sa.Numeric(10, 2), nullable=True),
        sa.Column('price_inr_annual', sa.Numeric(10, 2), nullable=True),
        sa.Column('trial_days', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('max_total_users', sa.Integer(), nullable=False),
        sa.Column('max_super_admins', sa.Integer(), nullable=False),
        sa.Column('max_sub_admins', sa.Integer(), nullable=False),
        sa.Column('max_providers', sa.Integer(), nullable=False),
        sa.Column('over_limit_action', over_limit_action_col, nullable=False, server_default='BLOCK_NEW'),
        sa.Column('grace_period_days', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('razorpay_supported', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('tenant_keys_allowed', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('features', JSON, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.false(), index=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.CheckConstraint(
            'max_total_users >= max_super_admins + max_sub_admins + max_providers',
            name='ck_plan_limits_sum',
        ),
        sa.CheckConstraint('grace_period_days >= 0', name='ck_plan_grace_nonneg'),
    )

    # ── tenant_subscriptions (tenant-scoped) ────────────────────────
    op.create_table(
        'tenant_subscriptions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('plan_id', UUID(as_uuid=True),
                  sa.ForeignKey('plans.id', ondelete='RESTRICT'),
                  nullable=False, index=True),
        sa.Column('status', subscription_status_col, nullable=False, server_default='TRIAL'),
        sa.Column('billing_cycle', billing_cycle_col, nullable=False, server_default='MONTHLY'),
        sa.Column('trial_ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('current_period_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=False),
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('over_limit_since', sa.DateTime(timezone=True), nullable=True),
        sa.Column('suspend_after', sa.DateTime(timezone=True), nullable=True),
        sa.Column('overrides', JSON, nullable=True),
        sa.Column('activated_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.false(), index=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
    )
    op.create_index(
        'ux_tenant_subscriptions_active',
        'tenant_subscriptions', ['tenant_id'], unique=True,
        postgresql_where=sa.text('is_deleted = false'),
    )

    # ── addons (platform catalog, no tenant_id) ─────────────────────
    op.create_table(
        'addons',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('code', sa.String(50), unique=True, nullable=False, index=True),
        sa.Column('name', sa.String(150), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', addon_status_col, nullable=False, server_default='DRAFT'),
        sa.Column('price_inr_monthly', sa.Numeric(10, 2), nullable=True),
        sa.Column('price_inr_annual', sa.Numeric(10, 2), nullable=True),
        sa.Column('features', JSON, nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column('limits', JSON, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.false(), index=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
    )

    # ── tenant_addons (tenant-scoped) ───────────────────────────────
    op.create_table(
        'tenant_addons',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('addon_id', UUID(as_uuid=True),
                  sa.ForeignKey('addons.id', ondelete='RESTRICT'),
                  nullable=False, index=True),
        sa.Column('status', addon_sub_status_col, nullable=False, server_default='ACTIVE'),
        sa.Column('billing_cycle', billing_cycle_col, nullable=False, server_default='MONTHLY'),
        sa.Column('activated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('current_period_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=False),
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('activated_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.false(), index=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('updated_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
    )
    op.create_index(
        'ux_tenant_addons_unique',
        'tenant_addons', ['tenant_id', 'addon_id'], unique=True,
        postgresql_where=sa.text('is_deleted = false'),
    )

    # ── RLS on the two tenant-scoped tables ─────────────────────────
    from app.models._base import generate_rls_sql
    for table in ('tenant_subscriptions', 'tenant_addons'):
        for stmt in generate_rls_sql(table):
            op.execute(stmt)

    # ── Seed Plan1 ──────────────────────────────────────────────────
    plan1_id = str(uuid.uuid4())
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            INSERT INTO plans (
                id, code, name, description, status, is_default,
                price_inr_monthly, price_inr_annual, trial_days,
                max_total_users, max_super_admins, max_sub_admins, max_providers,
                over_limit_action, grace_period_days,
                razorpay_supported, tenant_keys_allowed,
                features, created_at, updated_at
            ) VALUES (
                :id, :code, :name, :description, :status, :is_default,
                :price_inr_monthly, :price_inr_annual, :trial_days,
                :max_total_users, :max_super_admins, :max_sub_admins, :max_providers,
                :over_limit_action, :grace_period_days,
                :razorpay_supported, :tenant_keys_allowed,
                CAST(:features AS JSON),
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            """
        ),
        {
            'id': plan1_id,
            'code': 'plan1',
            'name': 'Plan 1',
            'description': (
                'Starter plan: basic patient profile, full doctor workflow, '
                'platform-managed communications and payments.'
            ),
            'status': 'ACTIVE',
            'is_default': True,
            'price_inr_monthly': None,
            'price_inr_annual': None,
            'trial_days': 14,
            'max_total_users': 20,
            'max_super_admins': 1,
            'max_sub_admins': 3,
            'max_providers': 16,
            'over_limit_action': 'BLOCK_NEW',
            'grace_period_days': 0,
            'razorpay_supported': True,
            'tenant_keys_allowed': False,
            'features': json.dumps(PLAN1_FEATURES),
        },
    )

    # ── Backfill tenant_subscriptions for pre-existing tenants ──────
    # Every non-deleted tenant whose settings['plan'] is null / free /
    # starter gets a Plan1 TRIAL subscription. Tenants already on a
    # higher tier in the legacy JSON are left alone — the platform
    # owner can migrate them via the new API when a Plan2+ exists.
    now = datetime.now(timezone.utc)
    period_end = now + timedelta(days=30)
    tenants = conn.execute(sa.text(
        """
        SELECT id, COALESCE(settings->>'plan', 'starter') AS legacy_plan
        FROM tenants
        WHERE is_deleted = false
        """
    )).fetchall()
    for tenant_id, legacy_plan in tenants:
        if legacy_plan in ('free', 'starter', None):
            conn.execute(
                sa.text(
                    """
                    INSERT INTO tenant_subscriptions (
                        id, tenant_id, plan_id, status, billing_cycle,
                        trial_ends_at, current_period_start, current_period_end,
                        created_at, updated_at
                    ) VALUES (
                        :id, :tenant_id, :plan_id, :status, 'MONTHLY',
                        :trial_ends_at, :now, :period_end,
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    )
                    ON CONFLICT DO NOTHING
                    """
                ),
                {
                    'id': str(uuid.uuid4()),
                    'tenant_id': str(tenant_id),
                    'plan_id': plan1_id,
                    'status': 'TRIAL',
                    'trial_ends_at': now + timedelta(days=14),
                    'now': now,
                    'period_end': period_end,
                },
            )


def downgrade():
    # Reverse order.
    for table in ('tenant_addons', 'tenant_subscriptions'):
        op.execute(f"DROP POLICY IF EXISTS tenant_insert_{table} ON {table}")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_index('ux_tenant_addons_unique', table_name='tenant_addons')
    op.drop_table('tenant_addons')
    op.drop_table('addons')
    op.drop_index('ux_tenant_subscriptions_active', table_name='tenant_subscriptions')
    op.drop_table('tenant_subscriptions')
    op.drop_table('plans')

    for enum_name in ('addonsubstatus', 'addonstatus', 'overlimitaction',
                      'billingcycle', 'subscriptionstatus', 'planstatus'):
        op.execute(f'DROP TYPE IF EXISTS {enum_name}')
