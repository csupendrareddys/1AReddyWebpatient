"""Cloudflare for SaaS: per-tenant custom-hostname state + migration audit.

Why
---
We're migrating tenant custom-domain provisioning off AWS Amplify (which
caps each app at 5 domains and forces us to pool 3+ Amplify apps) onto
Cloudflare for SaaS / Custom Hostnames API (thousands of hostnames per
zone, no pool). The migration is per-tenant: each row carries a
``domain_provider`` discriminator so existing Amplify tenants keep
working while new tenants and migrated-tenant ops route through CF.

This revision is purely additive:

* New ``tenants.domain_provider`` column (defaults to 'amplify' on
  existing rows — the migration backfill is idempotent on the column
  default). Service layer will default new tenants to 'cloudflare' once
  Group B ships.
* Seven new ``tenants.cf_*`` columns mirroring the Amplify state
  block — created once, then mutated only by ``CloudflareSaasService``.
* New ``tenant_domain_migration_audit`` table for the migration phase
  machine. Every Amplify- and Cloudflare-side mutation writes one row;
  the precutover_check probes write one row per probe. Indexed by
  ``tenant_id`` + ``created_at`` so the admin UI can pull the last 50
  events cheaply.

Existing ``amplify_*`` columns stay live — they're torn out only in
Group G, after every tenant has been on Cloudflare for ≥30 days.

Revision ID: q7l8g9b0c1d2
Revises: p6k7f8a9b0c1
Create Date: 2026-05-12
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = 'q7l8g9b0c1d2'
down_revision = 'p6k7f8a9b0c1'
branch_labels = None
depends_on = None


def upgrade():
    # ── tenants.domain_provider ────────────────────────────────────────
    # Default 'amplify' so existing rows stay on the old path. New
    # tenants land on 'cloudflare' via a service-layer default once
    # Group B is in production.
    op.add_column(
        'tenants',
        sa.Column(
            'domain_provider',
            sa.String(length=20),
            nullable=False,
            server_default='amplify',
        ),
    )
    op.create_index(
        'ix_tenants_domain_provider', 'tenants', ['domain_provider'],
    )

    # ── tenants.cf_* state columns ─────────────────────────────────────
    op.add_column('tenants', sa.Column('cf_hostname_id', sa.String(length=64), nullable=True))
    op.add_column('tenants', sa.Column('cf_hostname_status', sa.String(length=40), nullable=True))
    op.create_index('ix_tenants_cf_hostname_status', 'tenants', ['cf_hostname_status'])
    op.add_column('tenants', sa.Column('cf_ssl_status', sa.String(length=40), nullable=True))
    op.add_column('tenants', sa.Column('cf_ownership_verification', JSONB(), nullable=True))
    op.add_column('tenants', sa.Column('cf_ssl_validation_records', JSONB(), nullable=True))
    op.add_column('tenants', sa.Column('cf_synced_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('tenants', sa.Column('cf_error', sa.Text(), nullable=True))

    # ── tenant_domain_migration_audit table ────────────────────────────
    # One row per provider operation (success or failure). The phase
    # machine in PlatformDomainService.migrate_to_cloudflare writes here
    # too — including one row per precutover_check probe so a partial
    # failure is pinpointable.
    op.create_table(
        'tenant_domain_migration_audit',
        sa.Column('id', UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('provider', sa.String(length=20), nullable=False),
        sa.Column('phase', sa.String(length=20), nullable=True),
        sa.Column('operation', sa.String(length=40), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('actor_user_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text('now()')),
    )
    op.create_index(
        'ix_tdma_tenant_created',
        'tenant_domain_migration_audit',
        ['tenant_id', sa.text('created_at DESC')],
    )


def downgrade():
    op.drop_index('ix_tdma_tenant_created', table_name='tenant_domain_migration_audit')
    op.drop_table('tenant_domain_migration_audit')

    op.drop_column('tenants', 'cf_error')
    op.drop_column('tenants', 'cf_synced_at')
    op.drop_column('tenants', 'cf_ssl_validation_records')
    op.drop_column('tenants', 'cf_ownership_verification')
    op.drop_column('tenants', 'cf_ssl_status')
    op.drop_index('ix_tenants_cf_hostname_status', table_name='tenants')
    op.drop_column('tenants', 'cf_hostname_status')
    op.drop_column('tenants', 'cf_hostname_id')

    op.drop_index('ix_tenants_domain_provider', table_name='tenants')
    op.drop_column('tenants', 'domain_provider')
