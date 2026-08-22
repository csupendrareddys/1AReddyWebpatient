"""reseller P4 — apex-owned Cloudflare zone credentials (tenant_dns_configs)

Hand-written (house rule — autogenerate sweeps in local drift). Mirrors
tenant_payment_configs structurally: soft-delete-aware partial unique per
tenant, encrypted secret column, audit/timestamp mixin columns.

DELIBERATELY NO RLS POLICY: host→tenant resolution reads this table
BEFORE the request's tenant context exists (matching
``<slug>.<base_domain>`` hosts). The admin API is the scoping boundary,
same as tenant_payment_configs (which also carries no policy).

Revision ID: rsl2_tenant_dns_configs
Revises: rsl1_reseller_hierarchy
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = 'rsl2_tenant_dns_configs'
down_revision = 'rsl1_reseller_hierarchy'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'tenant_dns_configs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('base_domain', sa.String(255), nullable=True),
        sa.Column('zone_id', sa.String(64), nullable=True),
        sa.Column('_api_token_encrypted', sa.Text(), nullable=True),
        sa.Column('ingress_target', sa.String(255), nullable=True),
        sa.Column('proxied', sa.Boolean(), nullable=False,
                  server_default=sa.text('false')),
        sa.Column('is_active', sa.Boolean(), nullable=False,
                  server_default=sa.text('true')),
        sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
        # Mixin columns (TimestampMixin / SoftDeleteMixin / AuditMixin).
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.Column('is_deleted', sa.Boolean(), nullable=False,
                  server_default=sa.text('false'), index=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('updated_by_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'),
                  nullable=True),
    )
    op.create_index(
        'ux_tenant_dns_configs_tenant', 'tenant_dns_configs',
        ['tenant_id'], unique=True,
        postgresql_where=sa.text('is_deleted = false'),
    )
    op.create_index(
        'ux_tenant_dns_configs_base_domain', 'tenant_dns_configs',
        ['base_domain'], unique=True,
        postgresql_where=sa.text('is_deleted = false'),
    )


def downgrade():
    op.drop_index('ux_tenant_dns_configs_base_domain',
                  table_name='tenant_dns_configs')
    op.drop_index('ux_tenant_dns_configs_tenant',
                  table_name='tenant_dns_configs')
    op.drop_table('tenant_dns_configs')
