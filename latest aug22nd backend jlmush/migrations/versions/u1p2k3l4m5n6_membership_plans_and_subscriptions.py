"""Marketplace ``membership_plans`` + ``membership_subscriptions``.

Two tables + four enum types for the apex (``larazen.in``) marketplace
product line. Separate from the SaaS ``plans`` catalog and
``tenant_subscriptions``.

  * ``membership_plans``  — platform-wide catalog (NO tenant_id).
                           One row per (vertical, tier) combination.
  * ``membership_subscriptions`` — provider → plan link. Polymorphic via
                           ``provider_type`` + ``provider_id`` (no DB-level
                           FK; validators enforce). NOT tenant-scoped.

Round 1 ships catalog CRUD only. The subscriptions table is created here
so Round 2 (signup + payouts) doesn't need a separate migration —
nothing writes to it yet.

Revision ID: u1p2k3l4m5n6
Revises: t0o1j2e3f4g5
Create Date: 2026-05-16
"""
from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB, UUID


# revision identifiers
revision = 'u1p2k3l4m5n6'
down_revision = 't0o1j2e3f4g5'
branch_labels = None
depends_on = None


# SQLAlchemy's ``db.Enum(PyEnum)`` stores the Python NAME (uppercase),
# so the Postgres enum values must match the uppercase member names —
# same convention as ``planstatus`` / ``subscriptionstatus`` already in
# this schema.
_ENUM_DDL = [
    ("membershipvertical", "'DOCTOR','CLINIC','HOSPITAL'"),
    ("membershiptier", "'BASIC','GROWTH','PRO'"),
    ("membershipplanstatus", "'DRAFT','ACTIVE','ARCHIVED'"),
    (
        "membershipsubscriptionstatus",
        "'TRIAL','ACTIVE','PAST_DUE','CANCELLED','SUSPENDED'",
    ),
]


def upgrade():
    # ── Enum types ──────────────────────────────────────────────────
    for name, values in _ENUM_DDL:
        op.execute(
            f"DO $$ BEGIN "
            f"IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '{name}') THEN "
            f"CREATE TYPE {name} AS ENUM ({values}); "
            f"END IF; END $$;"
        )

    # Column-level enum handles — do NOT re-create the types.
    vertical_col = postgresql.ENUM(
        'DOCTOR', 'CLINIC', 'HOSPITAL',
        name='membershipvertical', create_type=False,
    )
    tier_col = postgresql.ENUM(
        'BASIC', 'GROWTH', 'PRO',
        name='membershiptier', create_type=False,
    )
    plan_status_col = postgresql.ENUM(
        'DRAFT', 'ACTIVE', 'ARCHIVED',
        name='membershipplanstatus', create_type=False,
    )
    sub_status_col = postgresql.ENUM(
        'TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'SUSPENDED',
        name='membershipsubscriptionstatus', create_type=False,
    )
    # ``billingcycle`` already exists from the SaaS pricing migration —
    # reuse it directly.
    billing_cycle_col = postgresql.ENUM(
        'MONTHLY', 'ANNUAL',
        name='billingcycle', create_type=False,
    )

    # ── membership_plans ────────────────────────────────────────────
    op.create_table(
        'membership_plans',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('code', sa.String(60), unique=True, nullable=False, index=True),
        sa.Column('name', sa.String(150), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('vertical', vertical_col, nullable=False, index=True),
        sa.Column('tier', tier_col, nullable=False),
        sa.Column('price_inr_monthly', sa.Numeric(10, 2), nullable=True),
        sa.Column('price_inr_annual', sa.Numeric(10, 2), nullable=True),
        sa.Column('trial_days', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('commission_pct', sa.Numeric(5, 2), nullable=True),
        sa.Column('platform_fee_inr', sa.Numeric(10, 2), nullable=True),
        sa.Column(
            'status', plan_status_col, nullable=False, server_default='DRAFT',
        ),
        sa.Column(
            'is_featured', sa.Boolean(), nullable=False, server_default=sa.false(),
        ),
        sa.Column(
            'features', JSONB, nullable=False, server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
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
            'trial_days >= 0', name='ck_membership_plan_trial_nonneg',
        ),
        sa.CheckConstraint(
            '(commission_pct IS NULL) OR '
            '(commission_pct >= 0 AND commission_pct <= 100)',
            name='ck_membership_plan_commission_pct_range',
        ),
    )
    op.create_index(
        'ux_membership_plans_vertical_tier',
        'membership_plans', ['vertical', 'tier'],
        unique=True,
        postgresql_where=sa.text('is_deleted = false'),
    )
    op.create_index(
        'ix_membership_plans_status', 'membership_plans', ['status'],
    )

    # ── membership_subscriptions ────────────────────────────────────
    op.create_table(
        'membership_subscriptions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column(
            'user_id', UUID(as_uuid=True),
            sa.ForeignKey('users.user_id', ondelete='CASCADE'),
            nullable=False, index=True,
        ),
        sa.Column('provider_type', vertical_col, nullable=False),
        sa.Column('provider_id', UUID(as_uuid=True), nullable=False),
        sa.Column(
            'membership_plan_id', UUID(as_uuid=True),
            sa.ForeignKey('membership_plans.id', ondelete='RESTRICT'),
            nullable=False, index=True,
        ),
        sa.Column(
            'billing_cycle', billing_cycle_col,
            nullable=False, server_default='MONTHLY',
        ),
        sa.Column(
            'status', sub_status_col,
            nullable=False, server_default='TRIAL',
        ),
        sa.Column('trial_ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('current_period_start', sa.DateTime(timezone=True), nullable=True),
        sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=True),
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
        'ix_membership_subscriptions_provider',
        'membership_subscriptions', ['provider_type', 'provider_id'],
    )
    # At most one active membership per provider profile.
    op.create_index(
        'ux_membership_subscriptions_active',
        'membership_subscriptions', ['provider_type', 'provider_id'],
        unique=True,
        postgresql_where=sa.text(
            "is_deleted = false AND status IN ('TRIAL', 'ACTIVE')"
        ),
    )


def downgrade():
    # Drop tables first (indexes drop with them in Postgres), then enums.
    op.drop_index(
        'ux_membership_subscriptions_active',
        table_name='membership_subscriptions',
    )
    op.drop_index(
        'ix_membership_subscriptions_provider',
        table_name='membership_subscriptions',
    )
    op.drop_table('membership_subscriptions')

    op.drop_index('ix_membership_plans_status', table_name='membership_plans')
    op.drop_index(
        'ux_membership_plans_vertical_tier', table_name='membership_plans',
    )
    op.drop_table('membership_plans')

    # Drop the membership-specific enums. ``billingcycle`` is shared with
    # the SaaS pricing schema, so leave it alone — that's owned by
    # ``d4e5f6a7b8c9_pricing_plans_subscriptions_addons``.
    for name in (
        'membershipsubscriptionstatus',
        'membershipplanstatus',
        'membershiptier',
        'membershipvertical',
    ):
        op.execute(f"DROP TYPE IF EXISTS {name};")
