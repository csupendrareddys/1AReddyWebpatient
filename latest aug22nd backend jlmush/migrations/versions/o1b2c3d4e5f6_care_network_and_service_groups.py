"""Care network + marketplace service groups (group offerings) + order.group_id

Adds the schema for two features:

  * **Care network** — ``care_network_connections`` / ``care_network_requests``:
    a doctor's professional network of fellow doctors / hospitals / clinics,
    mirroring the patient house-group linking pattern (invite code / phone+name
    + request→accept). Doctor↔doctor connections gate the group-offering
    co-doctor picker. ``care_network_requests.status`` REUSES the existing
    ``housegrouprequeststatus`` PG enum (create_type=False).

  * **Group service offerings** — ``marketplace_service_groups`` /
    ``marketplace_service_group_members``: several doctors offering one catalog
    product together, admin-approved. ``marketplace_orders.group_id`` links a
    patient order to the serving group (order.doctor_id stays = lead so existing
    single-doctor queries keep working).

All four new tenant tables get RLS (matching their marketplace / house_group
siblings enabled in ``c3d4e5f6a7b8``). Only applied on existing DBs via
``flask db upgrade``; fresh DBs get the same shape from ``db.create_all()``.

Revision ID: o1b2c3d4e5f6
Revises: n0a1b2c3d4e5
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import UUID, JSON


revision = 'o1b2c3d4e5f6'
down_revision = 'n0a1b2c3d4e5'
branch_labels = None
depends_on = None


# New tenant-scoped tables that need Row-Level Security.
_NEW_TENANT_TABLES = [
    'marketplace_service_groups',
    'marketplace_service_group_members',
    'care_network_connections',
    'care_network_requests',
]


def upgrade():
    # 1. marketplace_service_groups ----------------------------------------
    op.create_table(
        'marketplace_service_groups',
        sa.Column('group_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('product_id', UUID(as_uuid=True),
                  sa.ForeignKey('doctor_products.product_id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by_doctor_id', UUID(as_uuid=True),
                  sa.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False),
        sa.Column('group_price', sa.Numeric(10, 2), nullable=False),
        sa.Column('group_description', sa.Text(), nullable=True),
        sa.Column('approval_status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('rejection_reason', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_marketplace_service_groups_tenant_id', 'marketplace_service_groups', ['tenant_id'])
    op.create_index('ix_marketplace_service_groups_product_id', 'marketplace_service_groups', ['product_id'])
    op.create_index('ix_marketplace_service_groups_created_by_doctor_id', 'marketplace_service_groups', ['created_by_doctor_id'])
    op.create_index('ix_marketplace_service_groups_approval_status', 'marketplace_service_groups', ['approval_status'])
    op.create_index('ix_marketplace_service_groups_is_active', 'marketplace_service_groups', ['is_active'])

    # 2. marketplace_service_group_members ---------------------------------
    op.create_table(
        'marketplace_service_group_members',
        sa.Column('member_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('group_id', UUID(as_uuid=True),
                  sa.ForeignKey('marketplace_service_groups.group_id', ondelete='CASCADE'), nullable=False),
        sa.Column('doctor_id', UUID(as_uuid=True),
                  sa.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(20), nullable=False, server_default='member'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('group_id', 'doctor_id', name='uq_service_group_member'),
    )
    op.create_index('ix_marketplace_service_group_members_tenant_id', 'marketplace_service_group_members', ['tenant_id'])
    op.create_index('ix_marketplace_service_group_members_group_id', 'marketplace_service_group_members', ['group_id'])
    op.create_index('ix_marketplace_service_group_members_doctor_id', 'marketplace_service_group_members', ['doctor_id'])

    # 3. marketplace_orders.group_id ---------------------------------------
    op.add_column('marketplace_orders', sa.Column('group_id', UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_marketplace_orders_group_id',
        'marketplace_orders', 'marketplace_service_groups',
        ['group_id'], ['group_id'], ondelete='SET NULL',
    )
    op.create_index('ix_marketplace_orders_group_id', 'marketplace_orders', ['group_id'])

    # 4. care_network_connections ------------------------------------------
    op.create_table(
        'care_network_connections',
        sa.Column('connection_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('doctor_id', UUID(as_uuid=True),
                  sa.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False),
        sa.Column('connection_type', sa.String(20), nullable=False),
        sa.Column('target_doctor_id', UUID(as_uuid=True),
                  sa.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=True),
        sa.Column('target_hospital_id', UUID(as_uuid=True),
                  sa.ForeignKey('hospitals.hospital_id', ondelete='CASCADE'), nullable=True),
        sa.Column('target_clinic_id', UUID(as_uuid=True),
                  sa.ForeignKey('clinics.id', ondelete='CASCADE'), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            'tenant_id', 'doctor_id', 'connection_type',
            'target_doctor_id', 'target_hospital_id', 'target_clinic_id',
            name='uq_care_network_connection',
        ),
    )
    op.create_index('ix_care_network_connections_tenant_id', 'care_network_connections', ['tenant_id'])
    op.create_index('ix_care_network_connections_doctor_id', 'care_network_connections', ['doctor_id'])
    op.create_index('ix_care_network_connections_connection_type', 'care_network_connections', ['connection_type'])
    op.create_index('ix_care_network_connections_target_doctor_id', 'care_network_connections', ['target_doctor_id'])

    # 5. care_network_requests ---------------------------------------------
    # Reuse the existing enum type; do NOT recreate it (already present from
    # the house_group bootstrap / create_all).
    house_status = postgresql.ENUM(
        'PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED',
        name='housegrouprequeststatus', create_type=False,
    )
    op.create_table(
        'care_network_requests',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('requester_doctor_id', UUID(as_uuid=True),
                  sa.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False),
        sa.Column('connection_type', sa.String(20), nullable=False, server_default='doctor'),
        sa.Column('target_user_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('target_phone', sa.String(20), nullable=True),
        sa.Column('target_name', sa.String(200), nullable=True),
        sa.Column('target_last_name', sa.String(100), nullable=True),
        sa.Column('invite_code', sa.String(20), nullable=True),
        sa.Column('status', house_status, nullable=False, server_default='PENDING'),
        sa.Column('permissions', JSON, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('tenant_id', 'invite_code', name='uq_care_network_request_invite_code'),
    )
    op.create_index('ix_care_network_requests_tenant_id', 'care_network_requests', ['tenant_id'])
    op.create_index('ix_care_network_requests_requester_doctor_id', 'care_network_requests', ['requester_doctor_id'])
    op.create_index('ix_care_network_requests_invite_code', 'care_network_requests', ['invite_code'])
    op.create_index('ix_care_network_requests_status', 'care_network_requests', ['status'])

    # 6. RLS on all new tenant tables --------------------------------------
    from app.models._base import generate_rls_sql
    for table in _NEW_TENANT_TABLES:
        for stmt in generate_rls_sql(table):
            op.execute(stmt)


def downgrade():
    for table in reversed(_NEW_TENANT_TABLES):
        op.execute(f"DROP POLICY IF EXISTS tenant_insert_{table} ON {table}")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.execute('DROP INDEX IF EXISTS ix_marketplace_orders_group_id')
    op.execute('ALTER TABLE marketplace_orders DROP CONSTRAINT IF EXISTS fk_marketplace_orders_group_id')
    op.drop_column('marketplace_orders', 'group_id')

    op.drop_table('care_network_requests')
    op.drop_table('care_network_connections')
    op.drop_table('marketplace_service_group_members')
    op.drop_table('marketplace_service_groups')
    # ``housegrouprequeststatus`` enum left intact (shared, not ours to drop).
