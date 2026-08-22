"""profile_owner central profile ownership phase A

Revision ID: a52b139f7fb0
Revises: d04dfd753240
Create Date: 2026-07-16 10:40:03.987085

Phase A of centralizing per-actor profile details
(see docs/profile-owner-centralization.md). PURELY ADDITIVE:

  * Creates ``profile_owner`` — one row per Doctor / Admin / Clinic / Hospital /
    AuthorizedPersonnel, with an exactly-one-owner CHECK and the standard
    tenant RLS policy.
  * Adds a NULLABLE ``profile_owner_id`` FK to each of the six profile
    sub-tables. Nothing is backfilled and nothing is made NOT NULL here; the
    existing doctor_id / admin_id / authorized_personnel_id owner columns are
    left untouched (they are migrated + dropped in later phases).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a52b139f7fb0'
down_revision = 'd04dfd753240'
branch_labels = None
depends_on = None


SUBTABLES = (
    'profile_signatures',
    'profile_about',
    'profile_education',
    'profile_bank_accounts',
    'profile_declaration_responses',
    'profile_documents',
)


def upgrade():
    op.create_table(
        'profile_owner',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('owner_type', sa.String(length=20), nullable=False),
        sa.Column('doctor_id', sa.UUID(), nullable=True),
        sa.Column('admin_id', sa.UUID(), nullable=True),
        sa.Column('clinic_id', sa.UUID(), nullable=True),
        sa.Column('hospital_id', sa.UUID(), nullable=True),
        sa.Column('authorized_personnel_id', sa.UUID(), nullable=True),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            '(CASE WHEN doctor_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN admin_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN clinic_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN hospital_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN authorized_personnel_id IS NOT NULL THEN 1 ELSE 0 END) = 1',
            name='ck_profile_owner_exactly_one_owner',
        ),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctors.doctor_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['admin_id'], ['admins.admin_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['hospital_id'], ['hospitals.hospital_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['authorized_personnel_id'], ['authorized_personnel.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'doctor_id', name='uq_profile_owner_tenant_doctor'),
        sa.UniqueConstraint('tenant_id', 'admin_id', name='uq_profile_owner_tenant_admin'),
        sa.UniqueConstraint('tenant_id', 'clinic_id', name='uq_profile_owner_tenant_clinic'),
        sa.UniqueConstraint('tenant_id', 'hospital_id', name='uq_profile_owner_tenant_hospital'),
        sa.UniqueConstraint('tenant_id', 'authorized_personnel_id', name='uq_profile_owner_tenant_personnel'),
    )
    with op.batch_alter_table('profile_owner', schema=None) as batch_op:
        batch_op.create_index('ix_profile_owner_tenant_id', ['tenant_id'], unique=False)
        batch_op.create_index('ix_profile_owner_doctor_id', ['doctor_id'], unique=False)
        batch_op.create_index('ix_profile_owner_admin_id', ['admin_id'], unique=False)
        batch_op.create_index('ix_profile_owner_clinic_id', ['clinic_id'], unique=False)
        batch_op.create_index('ix_profile_owner_hospital_id', ['hospital_id'], unique=False)
        batch_op.create_index('ix_profile_owner_authorized_personnel_id', ['authorized_personnel_id'], unique=False)

    # Additive nullable FK on every profile sub-table.
    for tbl in SUBTABLES:
        with op.batch_alter_table(tbl, schema=None) as batch_op:
            batch_op.add_column(sa.Column('profile_owner_id', sa.UUID(), nullable=True))
            batch_op.create_index(f'ix_{tbl}_profile_owner_id', ['profile_owner_id'], unique=False)
            batch_op.create_foreign_key(
                f'fk_{tbl}_profile_owner', 'profile_owner',
                ['profile_owner_id'], ['id'], ondelete='CASCADE',
            )

    # Same tenant RLS policy as every other TenantMixin table.
    from app.models._base import generate_rls_sql
    for stmt in generate_rls_sql('profile_owner'):
        op.execute(stmt)


def downgrade():
    op.execute("DROP POLICY IF EXISTS tenant_insert_profile_owner ON profile_owner")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_profile_owner ON profile_owner")
    op.execute("ALTER TABLE profile_owner NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE profile_owner DISABLE ROW LEVEL SECURITY")

    for tbl in SUBTABLES:
        with op.batch_alter_table(tbl, schema=None) as batch_op:
            batch_op.drop_constraint(f'fk_{tbl}_profile_owner', type_='foreignkey')
            batch_op.drop_index(f'ix_{tbl}_profile_owner_id')
            batch_op.drop_column('profile_owner_id')

    op.drop_table('profile_owner')
