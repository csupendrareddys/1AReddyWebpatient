"""Tenant-scope the marketplace membership catalog.

Promotes ``membership_plans`` and ``membership_subscriptions`` from a
global / platform-owner-only catalog to per-tenant, RLS-isolated tables
— mirroring ``tenant_provider_plans``. Each tenant (the apex/default
tenant included) now authors its own membership tiers.

Migration steps (populated-table safe):
  1. Add ``tenant_id`` NULLABLE to both tables.
  2. Backfill: plans → the default tenant; subscriptions → their plan's
     tenant (default tenant for any orphan).
  3. Set ``tenant_id`` NOT NULL + FK + index.
  4. Swap the global unique on ``membership_plans.code`` for a partial
     unique on ``(tenant_id, code)``, and fold ``tenant_id`` into the
     active-membership uniqueness on ``membership_subscriptions``.
  5. Enable RLS on both (LAST, so backfill runs unfiltered).

Revision ID: mts1membscope2
Revises: f8801ca289cd
Create Date: 2026-07-20
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

from app.models._base import generate_rls_sql


# revision identifiers
revision = 'mts1membscope2'
down_revision = 'f8801ca289cd'
branch_labels = None
depends_on = None


_DEFAULT_TENANT_SQL = (
    "SELECT id FROM tenants WHERE is_default = true AND is_deleted = false "
    "LIMIT 1"
)


def upgrade():
    conn = op.get_bind()
    default_tenant = conn.execute(sa.text(_DEFAULT_TENANT_SQL)).scalar()

    def _require_tenant_for(table):
        """A default tenant is only needed if there are existing rows to
        backfill. A fresh ``db.create_all()`` + ``stamp head`` bootstrap
        (CI) has neither rows nor a seeded tenant — adding ``NOT NULL`` to
        an empty column is fine there."""
        count = conn.execute(sa.text(f'SELECT count(*) FROM {table}')).scalar()
        if count and default_tenant is None:
            raise RuntimeError(
                f'Cannot tenant-scope {table}: {count} existing row(s) but '
                'no default tenant (Tenant.is_default = true) to backfill to.'
            )

    # ── membership_plans ────────────────────────────────────────────
    _require_tenant_for('membership_plans')
    op.add_column(
        'membership_plans',
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=True),
    )
    if default_tenant is not None:
        conn.execute(
            sa.text(
                'UPDATE membership_plans SET tenant_id = :tid '
                'WHERE tenant_id IS NULL'
            ),
            {'tid': str(default_tenant)},
        )
    op.alter_column('membership_plans', 'tenant_id', nullable=False)
    op.create_foreign_key(
        'fk_membership_plans_tenant_id', 'membership_plans', 'tenants',
        ['tenant_id'], ['id'], ondelete='CASCADE',
    )
    op.create_index(
        'ix_membership_plans_tenant_id', 'membership_plans', ['tenant_id'],
    )
    # Swap the global unique on ``code`` for a per-tenant partial unique.
    op.drop_index('ix_membership_plans_code', table_name='membership_plans')
    op.create_index(
        'ix_membership_plans_code', 'membership_plans', ['code'],
    )
    op.create_index(
        'ux_membership_plans_tenant_code', 'membership_plans',
        ['tenant_id', 'code'], unique=True,
        postgresql_where=sa.text('is_deleted = false'),
    )

    # ── membership_subscriptions ────────────────────────────────────
    _require_tenant_for('membership_subscriptions')
    op.add_column(
        'membership_subscriptions',
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=True),
    )
    # Inherit each subscription's tenant from the plan it points at.
    conn.execute(sa.text(
        'UPDATE membership_subscriptions ms '
        'SET tenant_id = mp.tenant_id FROM membership_plans mp '
        'WHERE ms.membership_plan_id = mp.id AND ms.tenant_id IS NULL'
    ))
    # Any orphan (plan deleted / missing) → default tenant.
    if default_tenant is not None:
        conn.execute(
            sa.text(
                'UPDATE membership_subscriptions SET tenant_id = :tid '
                'WHERE tenant_id IS NULL'
            ),
            {'tid': str(default_tenant)},
        )
    op.alter_column('membership_subscriptions', 'tenant_id', nullable=False)
    op.create_foreign_key(
        'fk_membership_subscriptions_tenant_id', 'membership_subscriptions',
        'tenants', ['tenant_id'], ['id'], ondelete='CASCADE',
    )
    op.create_index(
        'ix_membership_subscriptions_tenant_id', 'membership_subscriptions',
        ['tenant_id'],
    )
    # Fold tenant_id into the "one active membership per provider" rule
    # so the same provider can be active in multiple tenants' marketplaces.
    op.drop_index(
        'ux_membership_subscriptions_active',
        table_name='membership_subscriptions',
    )
    op.create_index(
        'ux_membership_subscriptions_active', 'membership_subscriptions',
        ['tenant_id', 'provider_type', 'provider_id'], unique=True,
        postgresql_where=sa.text(
            "is_deleted = false AND status IN ('TRIAL', 'ACTIVE')"
        ),
    )

    # ── Row-Level Security (last — after backfill/NOT NULL) ──────────
    for stmt in generate_rls_sql('membership_plans'):
        op.execute(stmt)
    for stmt in generate_rls_sql('membership_subscriptions'):
        op.execute(stmt)


def downgrade():
    # Drop RLS first.
    for table in ('membership_subscriptions', 'membership_plans'):
        op.execute(f"DROP POLICY IF EXISTS tenant_insert_{table} ON {table}")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    # membership_subscriptions — restore the global active-uniqueness.
    op.drop_index(
        'ux_membership_subscriptions_active',
        table_name='membership_subscriptions',
    )
    op.create_index(
        'ux_membership_subscriptions_active', 'membership_subscriptions',
        ['provider_type', 'provider_id'], unique=True,
        postgresql_where=sa.text(
            "is_deleted = false AND status IN ('TRIAL', 'ACTIVE')"
        ),
    )
    op.drop_index(
        'ix_membership_subscriptions_tenant_id',
        table_name='membership_subscriptions',
    )
    # The FK name differs between a migration-built schema (``fk_…``) and a
    # ``db.create_all()``-built one (Postgres default ``…_tenant_id_fkey``);
    # drop whichever exists so the roundtrip works on both.
    op.execute(
        'ALTER TABLE membership_subscriptions DROP CONSTRAINT IF EXISTS '
        'fk_membership_subscriptions_tenant_id'
    )
    op.execute(
        'ALTER TABLE membership_subscriptions DROP CONSTRAINT IF EXISTS '
        'membership_subscriptions_tenant_id_fkey'
    )
    op.drop_column('membership_subscriptions', 'tenant_id')

    # membership_plans — restore the global unique on code.
    op.drop_index(
        'ux_membership_plans_tenant_code', table_name='membership_plans',
    )
    op.drop_index('ix_membership_plans_code', table_name='membership_plans')
    op.create_index(
        'ix_membership_plans_code', 'membership_plans', ['code'], unique=True,
    )
    op.drop_index(
        'ix_membership_plans_tenant_id', table_name='membership_plans',
    )
    op.execute(
        'ALTER TABLE membership_plans DROP CONSTRAINT IF EXISTS '
        'fk_membership_plans_tenant_id'
    )
    op.execute(
        'ALTER TABLE membership_plans DROP CONSTRAINT IF EXISTS '
        'membership_plans_tenant_id_fkey'
    )
    op.drop_column('membership_plans', 'tenant_id')
