"""provider staff, provider roles and their permissions

Revision ID: 150e59a82b7c
Revises: aa56b48109fc
Create Date: 2026-08-06

Creates the four tables behind Operations → Manage Roles & Permissions for
the provider verticals:

    provider_staff              a person working for one doctor/clinic/hospital
    provider_roles              a named role within one vertical
    provider_role_permissions   one row per (role, module path) grant
    provider_staff_roles        which staff hold which roles

Hand-adjusted from autogenerate in three ways:

1. **Enum creation is explicit.** ``datarange`` already exists (the admin
   ``role_permissions`` table owns it), and ``staffprovidertype`` is referenced
   by two of the new tables. Left as generated, the first would fail with
   "type already exists" and the second would try to CREATE TYPE twice in one
   migration. So the two new types are created once up front with
   ``checkfirst``, and every column reference uses ``create_type=False``.

2. **Unrelated drift dropped.** Autogenerate also emitted a ``charge_policies``
   tenant FK and index renames on ``feature_doctors`` /
   ``platform_feature_doctors`` — pre-existing differences between the models
   and this database that have nothing to do with provider staff. Carrying
   them here would hide someone else's schema change inside this one.

3. **Downgrade drops the new types.** Autogenerate leaves orphaned enum types
   behind, which makes a down/up cycle fail on the second up.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '150e59a82b7c'
down_revision = 'aa56b48109fc'
branch_labels = None
depends_on = None


# Referenced by name with create_type=False everywhere below; see the docstring.
_provider_type = postgresql.ENUM(
    'DOCTOR', 'CLINIC', 'HOSPITAL', name='staffprovidertype', create_type=False)
_staff_status = postgresql.ENUM(
    'ACTIVE', 'SUSPENDED', name='providerstaffstatus', create_type=False)
_data_range = postgresql.ENUM(
    'LAST_15_DAYS', 'LAST_30_DAYS', 'LAST_60_DAYS', 'LAST_90_DAYS',
    'LAST_180_DAYS', 'LAST_360_DAYS', 'ALL', name='datarange', create_type=False)


def upgrade():
    bind = op.get_bind()
    postgresql.ENUM(
        'DOCTOR', 'CLINIC', 'HOSPITAL', name='staffprovidertype',
    ).create(bind, checkfirst=True)
    postgresql.ENUM(
        'ACTIVE', 'SUSPENDED', name='providerstaffstatus',
    ).create(bind, checkfirst=True)

    # ── provider_roles ────────────────────────────────────────────────────
    op.create_table(
        'provider_roles',
        sa.Column('provider_role_id', sa.UUID(), nullable=False),
        sa.Column('provider_type', _provider_type, nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_system', sa.Boolean(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by_id', sa.UUID(), nullable=True),
        sa.Column('updated_by_id', sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.user_id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by_id'], ['users.user_id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('provider_role_id'),
    )
    op.create_index('ix_provider_roles_is_active', 'provider_roles', ['is_active'])
    op.create_index('ix_provider_roles_is_deleted', 'provider_roles', ['is_deleted'])
    op.create_index('ix_provider_roles_provider_type', 'provider_roles', ['provider_type'])
    op.create_index('ix_provider_roles_tenant_id', 'provider_roles', ['tenant_id'])
    # Unique per vertical, not per tenant — a clinic "Front Desk" and a
    # hospital "Front Desk" grant over different module trees. Partial on
    # is_deleted so a deleted role's name can be reused.
    op.create_index(
        'uq_provider_role_name', 'provider_roles',
        ['tenant_id', 'provider_type', 'name'],
        unique=True, postgresql_where=sa.text('is_deleted = FALSE'),
    )

    # ── provider_role_permissions ─────────────────────────────────────────
    op.create_table(
        'provider_role_permissions',
        sa.Column('provider_permission_id', sa.UUID(), nullable=False),
        sa.Column('role_id', sa.UUID(), nullable=False),
        # The dotted path into the module catalog. A string because the tree
        # is configuration, not schema; validated against the catalog on write.
        sa.Column('module_key', sa.String(length=200), nullable=False),
        sa.Column('full_access', sa.Boolean(), nullable=False),
        sa.Column('can_view', sa.Boolean(), nullable=False),
        sa.Column('can_create', sa.Boolean(), nullable=False),
        sa.Column('can_edit', sa.Boolean(), nullable=False),
        sa.Column('can_update', sa.Boolean(), nullable=False),
        sa.Column('can_delete', sa.Boolean(), nullable=False),
        sa.Column('can_l1_verify', sa.Boolean(), nullable=False),
        sa.Column('can_l2_verify', sa.Boolean(), nullable=False),
        sa.Column('can_l3_verify', sa.Boolean(), nullable=False),
        sa.Column('can_lock', sa.Boolean(), nullable=False),
        sa.Column('can_unlock', sa.Boolean(), nullable=False),
        sa.Column('data_range', _data_range, nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['role_id'], ['provider_roles.provider_role_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('provider_permission_id'),
        sa.UniqueConstraint('role_id', 'module_key', name='uq_provider_role_module'),
    )
    op.create_index('ix_provider_role_permissions_module_key',
                    'provider_role_permissions', ['module_key'])
    op.create_index('ix_provider_role_permissions_role_id',
                    'provider_role_permissions', ['role_id'])
    op.create_index('ix_provider_role_permissions_tenant_id',
                    'provider_role_permissions', ['tenant_id'])

    # ── provider_staff ────────────────────────────────────────────────────
    op.create_table(
        'provider_staff',
        sa.Column('staff_id', sa.UUID(), nullable=False),
        sa.Column('provider_type', _provider_type, nullable=False),
        sa.Column('doctor_id', sa.UUID(), nullable=True),
        sa.Column('clinic_id', sa.UUID(), nullable=True),
        sa.Column('hospital_id', sa.UUID(), nullable=True),
        sa.Column('first_name', sa.String(length=120), nullable=False),
        sa.Column('last_name', sa.String(length=120), nullable=True),
        sa.Column('email', sa.String(length=255), nullable=True),
        sa.Column('phone_number', sa.String(length=20), nullable=True),
        sa.Column('designation', sa.String(length=150), nullable=True),
        sa.Column('employee_code', sa.String(length=60), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('status', _staff_status, nullable=False),
        # The login seat. Null on every row today — nothing signs in as staff.
        sa.Column('user_id', sa.UUID(), nullable=True),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by_id', sa.UUID(), nullable=True),
        sa.Column('updated_by_id', sa.UUID(), nullable=True),
        # Exactly one anchor, and it has to be the one provider_type names.
        # Without the second check a row could claim CLINIC while pointing at
        # a doctor — which reads fine and grants the wrong practice's staff.
        sa.CheckConstraint(
            "(provider_type = 'DOCTOR' AND doctor_id IS NOT NULL) OR "
            "(provider_type = 'CLINIC' AND clinic_id IS NOT NULL) OR "
            "(provider_type = 'HOSPITAL' AND hospital_id IS NOT NULL)",
            name='ck_provider_staff_anchor_matches_type'),
        sa.CheckConstraint('num_nonnulls(doctor_id, clinic_id, hospital_id) = 1',
                           name='ck_provider_staff_one_anchor'),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.user_id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctors.doctor_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['hospital_id'], ['hospitals.hospital_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by_id'], ['users.user_id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.user_id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('staff_id'),
    )
    op.create_index('ix_provider_staff_active', 'provider_staff',
                    ['tenant_id', 'provider_type', 'status'],
                    postgresql_where=sa.text('is_deleted = FALSE'))
    op.create_index('ix_provider_staff_clinic_id', 'provider_staff', ['clinic_id'])
    op.create_index('ix_provider_staff_doctor_id', 'provider_staff', ['doctor_id'])
    op.create_index('ix_provider_staff_email', 'provider_staff', ['email'])
    op.create_index('ix_provider_staff_hospital_id', 'provider_staff', ['hospital_id'])
    op.create_index('ix_provider_staff_is_deleted', 'provider_staff', ['is_deleted'])
    op.create_index('ix_provider_staff_phone_number', 'provider_staff', ['phone_number'])
    op.create_index('ix_provider_staff_provider_type', 'provider_staff', ['provider_type'])
    op.create_index('ix_provider_staff_status', 'provider_staff', ['status'])
    op.create_index('ix_provider_staff_tenant_id', 'provider_staff', ['tenant_id'])
    op.create_index('ix_provider_staff_user_id', 'provider_staff', ['user_id'], unique=True)

    # ── provider_staff_roles ──────────────────────────────────────────────
    op.create_table(
        'provider_staff_roles',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('staff_id', sa.UUID(), nullable=False),
        sa.Column('role_id', sa.UUID(), nullable=False),
        sa.Column('assigned_by_id', sa.UUID(), nullable=True),
        sa.Column('assigned_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('deactivated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(['assigned_by_id'], ['users.user_id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['role_id'], ['provider_roles.provider_role_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['staff_id'], ['provider_staff.staff_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('staff_id', 'role_id', name='uq_provider_staff_role'),
    )
    op.create_index('ix_provider_staff_roles_is_active', 'provider_staff_roles', ['is_active'])
    op.create_index('ix_provider_staff_roles_role_id', 'provider_staff_roles', ['role_id'])
    op.create_index('ix_provider_staff_roles_staff_id', 'provider_staff_roles', ['staff_id'])
    op.create_index('ix_provider_staff_roles_tenant_id', 'provider_staff_roles', ['tenant_id'])


def downgrade():
    op.drop_table('provider_staff_roles')
    op.drop_table('provider_staff')
    op.drop_table('provider_role_permissions')
    op.drop_table('provider_roles')
    # ``datarange`` is NOT dropped — the admin role_permissions table still
    # uses it. Only the two types this migration created come out.
    bind = op.get_bind()
    postgresql.ENUM(name='providerstaffstatus').drop(bind, checkfirst=True)
    postgresql.ENUM(name='staffprovidertype').drop(bind, checkfirst=True)
