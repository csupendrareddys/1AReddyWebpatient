"""reseller hierarchy — tenant parentage + plan kinds/ownership/child quotas

Hand-written (house rule — autogenerate sweeps in local drift). Schema only;
the larazen apex conversion is a script (scripts/create_larazen_plan.py).

Live-DB fact this encodes: plans.code uniqueness is the UNIQUE INDEX
``ix_plans_code`` (no table constraint) — verified via pg_indexes before
writing. It is replaced by a plain index plus two PARTIAL unique indexes
scoping codes per catalog owner (NULLs are distinct in PG unique indexes,
so one composite unique would NOT protect the vendor catalog).

Revision ID: rsl1_reseller_hierarchy
Revises: saascat1_saas_categories
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = 'rsl1_reseller_hierarchy'
down_revision = 'saascat1_saas_categories'
branch_labels = None
depends_on = None


def upgrade():
    # ── tenants: parentage ──────────────────────────────────────────────
    op.add_column('tenants', sa.Column(
        'parent_tenant_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_tenants_parent_tenant_id', 'tenants', 'tenants',
                          ['parent_tenant_id'], ['id'], ondelete='RESTRICT')
    op.create_index('ix_tenants_parent_tenant_id', 'tenants',
                    ['parent_tenant_id'])
    op.create_check_constraint(
        'ck_tenants_not_own_parent', 'tenants',
        'parent_tenant_id IS NULL OR parent_tenant_id <> id')

    # ── plans: kind / owner / child quotas ──────────────────────────────
    op.add_column('plans', sa.Column(
        'kind', sa.String(10), nullable=False, server_default='normal'))
    op.add_column('plans', sa.Column(
        'owner_tenant_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_plans_owner_tenant_id', 'plans', 'tenants',
                          ['owner_tenant_id'], ['id'], ondelete='RESTRICT')
    op.create_index('ix_plans_owner_tenant_id', 'plans', ['owner_tenant_id'])
    op.add_column('plans', sa.Column(
        'max_child_subdomains', sa.Integer(), nullable=True))
    op.add_column('plans', sa.Column(
        'max_child_custom_domains', sa.Integer(), nullable=True))

    op.create_check_constraint('ck_plans_kind', 'plans',
                               "kind IN ('normal','apex')")
    op.create_check_constraint('ck_plans_apex_vendor_only', 'plans',
                               "owner_tenant_id IS NULL OR kind = 'normal'")
    op.create_check_constraint(
        'ck_plans_child_quotas_apex_only', 'plans',
        "kind = 'apex' OR (max_child_subdomains IS NULL "
        "AND max_child_custom_domains IS NULL)")

    # ── plans.code: rescope uniqueness per catalog owner ────────────────
    op.drop_index('ix_plans_code', table_name='plans')
    op.create_index('ix_plans_code', 'plans', ['code'])  # plain lookup index
    op.create_index('ux_plans_vendor_code', 'plans', ['code'], unique=True,
                    postgresql_where=sa.text('owner_tenant_id IS NULL'))
    op.create_index('ux_plans_owner_code', 'plans',
                    ['owner_tenant_id', 'code'], unique=True,
                    postgresql_where=sa.text('owner_tenant_id IS NOT NULL'))


def downgrade():
    # Recreating the global unique index fails loudly if apex-owned
    # duplicate codes exist — delete reseller catalogs before downgrading.
    op.drop_index('ux_plans_owner_code', table_name='plans')
    op.drop_index('ux_plans_vendor_code', table_name='plans')
    op.drop_index('ix_plans_code', table_name='plans')
    op.create_index('ix_plans_code', 'plans', ['code'], unique=True)
    op.drop_constraint('ck_plans_child_quotas_apex_only', 'plans', type_='check')
    op.drop_constraint('ck_plans_apex_vendor_only', 'plans', type_='check')
    op.drop_constraint('ck_plans_kind', 'plans', type_='check')
    op.drop_column('plans', 'max_child_custom_domains')
    op.drop_column('plans', 'max_child_subdomains')
    op.drop_index('ix_plans_owner_tenant_id', table_name='plans')
    op.drop_constraint('fk_plans_owner_tenant_id', 'plans', type_='foreignkey')
    op.drop_column('plans', 'owner_tenant_id')
    op.drop_column('plans', 'kind')
    op.drop_constraint('ck_tenants_not_own_parent', 'tenants', type_='check')
    op.drop_index('ix_tenants_parent_tenant_id', table_name='tenants')
    op.drop_constraint('fk_tenants_parent_tenant_id', 'tenants',
                       type_='foreignkey')
    op.drop_column('tenants', 'parent_tenant_id')
