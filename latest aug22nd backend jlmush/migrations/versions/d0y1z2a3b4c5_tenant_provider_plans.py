"""Tenant-scoped provider-plan catalog (in-tenant marketplace).

Adds two tenant-scoped tables — the "third axis" alongside the SaaS
``plans`` and apex ``membership_plans`` catalogs:

  * ``tenant_provider_plans``         — plans authored by a SaaS tenant
                                        (or by the platform owner on
                                        behalf of the tenant) to offer
                                        their own in-tenant providers.
  * ``tenant_provider_subscriptions`` — binds a provider profile inside
                                        the tenant to one of the
                                        tenant's authored plans.

Both tables carry ``tenant_id`` and get full RLS policies. They reuse
the existing marketplace enums (``membershipvertical``,
``membershipplanstatus``, ``membershipsubscriptionstatus``,
``billingcycle``) — those are already in the schema from
``u1p2k3l4m5n6_membership_plans_and_subscriptions``.

Revision ID: d0y1z2a3b4c5
Revises: c9x0y1z2a3b4
Create Date: 2026-05-19
"""
from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models._base import generate_rls_sql


# revision identifiers
revision = 'd0y1z2a3b4c5'
down_revision = 'c9x0y1z2a3b4'
branch_labels = None
depends_on = None


def upgrade():
    # Reuse existing enums — DO NOT re-create them. ``create_type=False``
    # matters because ``op.create_table`` will otherwise try to CREATE TYPE
    # again and fail with DuplicateObject on the second migration run.
    vertical_col = postgresql.ENUM(
        'DOCTOR', 'CLINIC', 'HOSPITAL',
        name='membershipvertical', create_type=False,
    )
    plan_status_col = postgresql.ENUM(
        'DRAFT', 'ACTIVE', 'ARCHIVED',
        name='membershipplanstatus', create_type=False,
    )
    sub_status_col = postgresql.ENUM(
        'PENDING', 'TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'SUSPENDED',
        name='membershipsubscriptionstatus', create_type=False,
    )
    billing_cycle_col = postgresql.ENUM(
        'MONTHLY', 'ANNUAL',
        name='billingcycle', create_type=False,
    )

    # ── tenant_provider_plans ───────────────────────────────────────
    op.create_table(
        'tenant_provider_plans',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        # TenantMixin
        sa.Column(
            'tenant_id', UUID(as_uuid=True),
            # Tenant's primary key column is literally named ``id`` —
            # the python attribute happens to be ``id`` too. TenantMixin
            # uses ``tenants.id`` everywhere else; mirror that here so
            # the downgrade→upgrade roundtrip lines up.
            sa.ForeignKey('tenants.id', ondelete='CASCADE'),
            nullable=False, index=True,
        ),
        sa.Column('code', sa.String(60), nullable=False, index=True),
        sa.Column('name', sa.String(150), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        # NB: no ``index=True`` on ``vertical`` — the composite
        # ``ix_tenant_provider_plans_vertical`` below covers the
        # tenant-scoped query pattern and would collide on name
        # with the auto-generated standalone index otherwise.
        sa.Column('vertical', vertical_col, nullable=False),
        sa.Column('price_inr_monthly', sa.Numeric(10, 2), nullable=True),
        sa.Column('price_inr_annual', sa.Numeric(10, 2), nullable=True),
        sa.Column(
            'trial_days', sa.Integer(), nullable=False, server_default='0',
        ),
        sa.Column(
            'status', plan_status_col, nullable=False, server_default='DRAFT',
        ),
        sa.Column(
            'features', JSONB, nullable=False, server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            'sort_order', sa.Integer(), nullable=False, server_default='0',
        ),
        sa.Column(
            'authored_by', sa.String(20), nullable=False,
            server_default='tenant',
        ),
        # TimestampMixin
        sa.Column(
            'created_at', sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text('CURRENT_TIMESTAMP'),
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text('CURRENT_TIMESTAMP'),
        ),
        # SoftDeleteMixin
        sa.Column(
            'is_deleted', sa.Boolean(), nullable=False,
            server_default=sa.false(), index=True,
        ),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        # AuditMixin
        sa.Column(
            'created_by_id', UUID(as_uuid=True),
            sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True,
        ),
        sa.Column(
            'updated_by_id', UUID(as_uuid=True),
            sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True,
        ),
        sa.CheckConstraint(
            'trial_days >= 0', name='ck_tenant_provider_plan_trial_nonneg',
        ),
        sa.CheckConstraint(
            "authored_by IN ('tenant', 'platform')",
            name='ck_tenant_provider_plan_authored_by',
        ),
    )
    op.create_index(
        'ux_tenant_provider_plans_code',
        'tenant_provider_plans', ['tenant_id', 'code'],
        unique=True,
        postgresql_where=sa.text('is_deleted = false'),
    )
    op.create_index(
        'ix_tenant_provider_plans_vertical',
        'tenant_provider_plans',
        ['tenant_id', 'vertical', 'status'],
    )

    # ── tenant_provider_subscriptions ───────────────────────────────
    op.create_table(
        'tenant_provider_subscriptions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        # TenantMixin
        sa.Column(
            'tenant_id', UUID(as_uuid=True),
            # Tenant's primary key column is literally named ``id`` —
            # the python attribute happens to be ``id`` too. TenantMixin
            # uses ``tenants.id`` everywhere else; mirror that here so
            # the downgrade→upgrade roundtrip lines up.
            sa.ForeignKey('tenants.id', ondelete='CASCADE'),
            nullable=False, index=True,
        ),
        sa.Column(
            'user_id', UUID(as_uuid=True),
            sa.ForeignKey('users.user_id', ondelete='CASCADE'),
            nullable=False, index=True,
        ),
        sa.Column('provider_type', vertical_col, nullable=False),
        sa.Column('provider_id', UUID(as_uuid=True), nullable=False),
        sa.Column(
            'tenant_provider_plan_id', UUID(as_uuid=True),
            sa.ForeignKey('tenant_provider_plans.id', ondelete='RESTRICT'),
            nullable=False, index=True,
        ),
        sa.Column(
            'billing_cycle', billing_cycle_col, nullable=False,
            server_default='MONTHLY',
        ),
        # NB: ``server_default`` cannot reference ``PENDING`` here —
        # Postgres added that value to the enum in migration
        # ``v2q3r4s5t6u7`` which runs inside the same upgrade
        # transaction as this one, and Postgres rejects use of a
        # newly-added enum value in the same transaction
        # (``UnsafeNewEnumValueUsage``). Default to ``TRIAL`` (which
        # existed before this chain). The application service layer
        # (``TenantProviderSubscriptionService.create_pending_for_provider``)
        # always inserts an explicit ``PENDING`` value on every new
        # row, so the SQL default is only a safety net and the actual
        # signup flow is unaffected.
        sa.Column(
            'status', sub_status_col, nullable=False,
            server_default='TRIAL',
        ),
        sa.Column('trial_ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'current_period_start', sa.DateTime(timezone=True), nullable=True,
        ),
        sa.Column(
            'current_period_end', sa.DateTime(timezone=True), nullable=True,
        ),
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
        # TimestampMixin
        sa.Column(
            'created_at', sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text('CURRENT_TIMESTAMP'),
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text('CURRENT_TIMESTAMP'),
        ),
        # SoftDeleteMixin
        sa.Column(
            'is_deleted', sa.Boolean(), nullable=False,
            server_default=sa.false(), index=True,
        ),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        # AuditMixin
        sa.Column(
            'created_by_id', UUID(as_uuid=True),
            sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True,
        ),
        sa.Column(
            'updated_by_id', UUID(as_uuid=True),
            sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True,
        ),
    )
    op.create_index(
        'ix_tenant_provider_subs_provider',
        'tenant_provider_subscriptions',
        ['tenant_id', 'provider_type', 'provider_id'],
    )
    # Partial unique — "at most one live-ish subscription per provider
    # profile per tenant." Same caveat as the column default above:
    # ``PENDING`` was added to the enum in this same upgrade chain, so
    # referencing it in the index predicate trips
    # ``UnsafeNewEnumValueUsage``. Dropped from the predicate; the
    # ``create_pending_for_provider`` service explicitly checks for an
    # existing PENDING / TRIAL / ACTIVE row before insert, so app-level
    # uniqueness is preserved. A follow-up migration once the enum is
    # in its own transaction can ALTER this index to include PENDING.
    op.create_index(
        'ux_tenant_provider_subs_active',
        'tenant_provider_subscriptions',
        ['tenant_id', 'provider_type', 'provider_id'],
        unique=True,
        postgresql_where=sa.text(
            "is_deleted = false AND "
            "status IN ('TRIAL', 'ACTIVE')"
        ),
    )

    # ── Row-Level Security ──────────────────────────────────────────
    for stmt in generate_rls_sql('tenant_provider_plans'):
        op.execute(stmt)
    for stmt in generate_rls_sql('tenant_provider_subscriptions'):
        op.execute(stmt)


def downgrade():
    # Drop RLS policies first.
    for table in ('tenant_provider_subscriptions', 'tenant_provider_plans'):
        op.execute(
            f"DROP POLICY IF EXISTS tenant_insert_{table} ON {table}"
        )
        op.execute(
            f"DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}"
        )
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_index(
        'ux_tenant_provider_subs_active',
        table_name='tenant_provider_subscriptions',
    )
    op.drop_index(
        'ix_tenant_provider_subs_provider',
        table_name='tenant_provider_subscriptions',
    )
    op.drop_table('tenant_provider_subscriptions')

    op.drop_index(
        'ix_tenant_provider_plans_vertical',
        table_name='tenant_provider_plans',
    )
    op.drop_index(
        'ux_tenant_provider_plans_code',
        table_name='tenant_provider_plans',
    )
    op.drop_table('tenant_provider_plans')

    # NOTE: do NOT drop the membership* enums or billingcycle — they're
    # owned by their original migrations and still used by sibling tables.
