"""entity_profiles and authorized_personnel

Revision ID: d04dfd753240
Revises: 236d70d5180c
Create Date: 2026-07-15 13:50:20.895403

Adds the shared corporate-entity profile (hospital / clinic / patient) and its
authorized-personnel records, and widens profile_education to a third owner
(authorized_personnel) so the education→certification structure is reused.

Autogenerate also surfaced unrelated pre-existing model↔DB drift (appointments,
doctor_billing_profiles, doctors.offered_consultation_types, bank-account and
subscription index renames); that drift is intentionally NOT included here — it
belongs to its own reconciliation, not this feature migration.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'd04dfd753240'
down_revision = '236d70d5180c'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'entity_profiles',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('hospital_id', sa.UUID(), nullable=True),
        sa.Column('clinic_id', sa.UUID(), nullable=True),
        sa.Column('patient_id', sa.UUID(), nullable=True),
        sa.Column('entity_type', sa.Enum('INDIVIDUAL', 'PROPRIETORSHIP', 'PARTNERSHIP', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'SECTION_8', 'TRUST', name='entitytype'), nullable=False),
        sa.Column('entity_name', sa.String(length=300), nullable=True),
        sa.Column('promoters', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('year_of_establishment', sa.Integer(), nullable=True),
        sa.Column('trade_name', sa.String(length=300), nullable=True),
        sa.Column('legal_name', sa.String(length=300), nullable=True),
        sa.Column('logo_url', sa.String(length=500), nullable=True),
        sa.Column('logo_s3_key', sa.String(length=500), nullable=True),
        sa.Column('logo_s3_bucket', sa.String(length=200), nullable=True),
        sa.Column('entity_logo_url', sa.String(length=500), nullable=True),
        sa.Column('entity_logo_s3_key', sa.String(length=500), nullable=True),
        sa.Column('entity_logo_s3_bucket', sa.String(length=200), nullable=True),
        sa.Column('entity_image_url', sa.String(length=500), nullable=True),
        sa.Column('entity_image_s3_key', sa.String(length=500), nullable=True),
        sa.Column('entity_image_s3_bucket', sa.String(length=200), nullable=True),
        sa.Column('registration_license_number', sa.String(length=120), nullable=True),
        sa.Column('registration_license_doc_url', sa.String(length=500), nullable=True),
        sa.Column('registration_license_doc_s3_key', sa.String(length=500), nullable=True),
        sa.Column('registration_license_doc_s3_bucket', sa.String(length=200), nullable=True),
        sa.Column('registration_license_doc_verification_status', postgresql.ENUM('PENDING', 'VERIFIED', 'REJECTED', name='documentverificationstatus', create_type=False), nullable=False),
        sa.Column('cin_number', sa.String(length=120), nullable=True),
        sa.Column('cin_doc_url', sa.String(length=500), nullable=True),
        sa.Column('cin_doc_s3_key', sa.String(length=500), nullable=True),
        sa.Column('cin_doc_s3_bucket', sa.String(length=200), nullable=True),
        sa.Column('cin_doc_verification_status', postgresql.ENUM('PENDING', 'VERIFIED', 'REJECTED', name='documentverificationstatus', create_type=False), nullable=False),
        sa.Column('gst_number', sa.String(length=120), nullable=True),
        sa.Column('gst_doc_url', sa.String(length=500), nullable=True),
        sa.Column('gst_doc_s3_key', sa.String(length=500), nullable=True),
        sa.Column('gst_doc_s3_bucket', sa.String(length=200), nullable=True),
        sa.Column('gst_doc_verification_status', postgresql.ENUM('PENDING', 'VERIFIED', 'REJECTED', name='documentverificationstatus', create_type=False), nullable=False),
        sa.Column('pan_number', sa.String(length=120), nullable=True),
        sa.Column('pan_doc_url', sa.String(length=500), nullable=True),
        sa.Column('pan_doc_s3_key', sa.String(length=500), nullable=True),
        sa.Column('pan_doc_s3_bucket', sa.String(length=200), nullable=True),
        sa.Column('pan_doc_verification_status', postgresql.ENUM('PENDING', 'VERIFIED', 'REJECTED', name='documentverificationstatus', create_type=False), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by_id', sa.UUID(), nullable=True),
        sa.Column('updated_by_id', sa.UUID(), nullable=True),
        sa.CheckConstraint('(CASE WHEN hospital_id IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN clinic_id IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN patient_id IS NOT NULL THEN 1 ELSE 0 END) = 1', name='ck_entity_profile_exactly_one_owner'),
        sa.ForeignKeyConstraint(['clinic_id'], ['clinics.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.user_id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['hospital_id'], ['hospitals.hospital_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['patient_id'], ['patients.patient_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by_id'], ['users.user_id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'clinic_id', name='uq_entity_profile_clinic'),
        sa.UniqueConstraint('tenant_id', 'hospital_id', name='uq_entity_profile_hospital'),
        sa.UniqueConstraint('tenant_id', 'patient_id', name='uq_entity_profile_patient'),
    )
    with op.batch_alter_table('entity_profiles', schema=None) as batch_op:
        batch_op.create_index('ix_entity_profiles_clinic', ['tenant_id', 'clinic_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_entity_profiles_clinic_id'), ['clinic_id'], unique=False)
        batch_op.create_index('ix_entity_profiles_hospital', ['tenant_id', 'hospital_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_entity_profiles_hospital_id'), ['hospital_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_entity_profiles_is_deleted'), ['is_deleted'], unique=False)
        batch_op.create_index('ix_entity_profiles_patient', ['tenant_id', 'patient_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_entity_profiles_patient_id'), ['patient_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_entity_profiles_tenant_id'), ['tenant_id'], unique=False)

    op.create_table(
        'authorized_personnel',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('entity_profile_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('designation', sa.String(length=150), nullable=True),
        sa.Column('display_order', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['entity_profile_id'], ['entity_profiles.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('authorized_personnel', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_authorized_personnel_entity_profile_id'), ['entity_profile_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_authorized_personnel_is_deleted'), ['is_deleted'], unique=False)
        batch_op.create_index(batch_op.f('ix_authorized_personnel_tenant_id'), ['tenant_id'], unique=False)

    # profile_education: widen to a third owner (authorized_personnel).
    with op.batch_alter_table('profile_education', schema=None) as batch_op:
        batch_op.add_column(sa.Column('authorized_personnel_id', sa.UUID(), nullable=True))
        batch_op.create_index(batch_op.f('ix_profile_education_authorized_personnel_id'), ['authorized_personnel_id'], unique=False)
        batch_op.create_index('ix_profile_education_tenant_personnel', ['tenant_id', 'authorized_personnel_id'], unique=False)
        batch_op.create_unique_constraint('uq_prof_edu_tenant_personnel', ['tenant_id', 'authorized_personnel_id'])
        batch_op.create_foreign_key('fk_profile_education_authorized_personnel', 'authorized_personnel', ['authorized_personnel_id'], ['id'], ondelete='CASCADE')

    # Swap the exactly-one-owner CHECK from 2 owners to 3 (autogenerate does
    # not diff CHECK bodies). IF EXISTS guards against a name drift.
    op.execute("ALTER TABLE profile_education DROP CONSTRAINT IF EXISTS ck_profile_education_exactly_one_owner")
    op.create_check_constraint(
        'ck_profile_education_exactly_one_owner', 'profile_education',
        '(CASE WHEN doctor_id IS NOT NULL THEN 1 ELSE 0 END) + '
        '(CASE WHEN admin_id IS NOT NULL THEN 1 ELSE 0 END) + '
        '(CASE WHEN authorized_personnel_id IS NOT NULL THEN 1 ELSE 0 END) = 1',
    )

    # RLS on the two new tenant-scoped tables (same policy as every other
    # TenantMixin table).
    from app.models._base import generate_rls_sql
    for table in ('entity_profiles', 'authorized_personnel'):
        for stmt in generate_rls_sql(table):
            op.execute(stmt)


def downgrade():
    for table in ('authorized_personnel', 'entity_profiles'):
        op.execute(f"DROP POLICY IF EXISTS tenant_insert_{table} ON {table}")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.execute("ALTER TABLE profile_education DROP CONSTRAINT IF EXISTS ck_profile_education_exactly_one_owner")
    op.create_check_constraint(
        'ck_profile_education_exactly_one_owner', 'profile_education',
        '(doctor_id IS NOT NULL AND admin_id IS NULL) OR (doctor_id IS NULL AND admin_id IS NOT NULL)',
    )
    with op.batch_alter_table('profile_education', schema=None) as batch_op:
        batch_op.drop_constraint('fk_profile_education_authorized_personnel', type_='foreignkey')
        batch_op.drop_constraint('uq_prof_edu_tenant_personnel', type_='unique')
        batch_op.drop_index('ix_profile_education_tenant_personnel')
        batch_op.drop_index(batch_op.f('ix_profile_education_authorized_personnel_id'))
        batch_op.drop_column('authorized_personnel_id')

    op.drop_table('authorized_personnel')
    op.drop_table('entity_profiles')
    # Enums are dropped explicitly (entitytype is new; documentverificationstatus
    # is shared, so leave it).
    op.execute("DROP TYPE IF EXISTS entitytype")
