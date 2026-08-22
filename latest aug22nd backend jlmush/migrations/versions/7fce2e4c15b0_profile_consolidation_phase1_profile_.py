"""profile consolidation phase1 profile_extended specialization degree

Revision ID: 7fce2e4c15b0
Revises: 06cc45ffb9bf
Create Date: 2026-07-16

Phase 1 (ADDITIVE) of the profile consolidation. Creates the three new
consolidated tables and losslessly backfills them from the legacy tables/columns:

  * profile_extended               <- admin_profiles_extended ONLY
       (identity/professional + the absorbed communication_address /
        permanent_address / self_declaration_data JSON so nothing is dropped).
        Doctors keep their extended fields on the `doctors` table and are NOT
        copied here (that table isn't pruned; copies would only drift).
  * profile_education_specialization <- doctor_qualification_specializations (1:1)
  * profile_education_degree         <- doctor_qualification_degrees (1:1, lossless:
        degree_name / institution / passing_year / certificate_link all preserved).

NO drops here. Backfills run as the postgres superuser (RLS bypassed), are
idempotent on the create (tables are freshly created empty).

down_revision is '06cc45ffb9bf' (the branch/main merge migration) so the branch
has a single linear head 06cc45ffb9bf -> 7fce2e4c15b0 -> aa11bb22cc33.
NOTE: the local dev dress-rehearsal applied this off be1adf4e1a11 instead,
because the dev DB can't reach 06cc45ffb9bf (main's chain carries the untouched
`9a2be5a4a60e` DROP INDEX divergence). The upgrade/downgrade BODY is identical
and was validated end-to-end locally; only the parent pointer differs.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '7fce2e4c15b0'
down_revision = '06cc45ffb9bf'
branch_labels = None
depends_on = None

_JSON = postgresql.JSON(astext_type=sa.Text())


def upgrade():
    conn = op.get_bind()

    # ---------------------------------------------------------- profile_extended
    op.create_table(
        'profile_extended',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('profile_owner_id', sa.UUID(), nullable=False),
        sa.Column('aadhaar_number', sa.String(255), nullable=True),
        sa.Column('aadhaar_attachment', sa.String(500), nullable=True),
        sa.Column('pan_number', sa.String(50), nullable=True),
        sa.Column('pan_attachment', sa.String(500), nullable=True),
        sa.Column('registration_number', sa.String(100), nullable=True),
        sa.Column('experience_years', sa.Integer(), nullable=True),
        sa.Column('consultation_fee', sa.Numeric(10, 2), nullable=True),
        sa.Column('height', sa.Numeric(5, 2), nullable=True),
        sa.Column('weight', sa.Numeric(5, 2), nullable=True),
        sa.Column('category', sa.String(100), nullable=True),
        sa.Column('religion', sa.String(100), nullable=True),
        sa.Column('citizenship', sa.String(100), nullable=True),
        sa.Column('alternative_phone', sa.String(20), nullable=True),
        sa.Column('alternative_email', sa.String(254), nullable=True),
        sa.Column('languages_known', _JSON, nullable=True),
        sa.Column('slot_pricing', _JSON, nullable=True),
        sa.Column('female_health_details', _JSON, nullable=True),
        sa.Column('communication_address', _JSON, nullable=True),
        sa.Column('permanent_address', _JSON, nullable=True),
        sa.Column('self_declaration_data', _JSON, nullable=True),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['profile_owner_id'], ['profile_owner.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('profile_owner_id', name='uq_profile_extended_profile_owner'),
    )
    with op.batch_alter_table('profile_extended', schema=None) as b:
        b.create_index('ix_profile_extended_tenant_id', ['tenant_id'], unique=False)
        b.create_index('ix_profile_extended_profile_owner_id', ['profile_owner_id'], unique=False)

    # ------------------------------------------ profile_education_specialization
    op.create_table(
        'profile_education_specialization',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('profile_owner_id', sa.UUID(), nullable=False),
        sa.Column('doctor_id', sa.UUID(), nullable=False),
        sa.Column('category_id', sa.UUID(), nullable=False),
        sa.Column('qualification_level', sa.String(20), nullable=True),
        sa.Column('is_primary', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('years_experience', sa.Integer(), nullable=True),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['profile_owner_id'], ['profile_owner.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctors.doctor_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['category_id'], ['categories.category_id']),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'profile_owner_id', 'category_id',
                            name='uq_prof_edu_spec_tenant_owner_category'),
    )
    with op.batch_alter_table('profile_education_specialization', schema=None) as b:
        b.create_index('ix_prof_edu_spec_tenant_id', ['tenant_id'], unique=False)
        b.create_index('ix_prof_edu_spec_profile_owner_id', ['profile_owner_id'], unique=False)
        b.create_index('ix_prof_edu_spec_doctor_id', ['doctor_id'], unique=False)
        b.create_index('ix_prof_edu_spec_category_id', ['category_id'], unique=False)
        b.create_index('ix_prof_edu_spec_tenant_category_primary',
                       ['tenant_id', 'category_id', 'is_primary'], unique=False)

    # ------------------------------------------------- profile_education_degree
    op.create_table(
        'profile_education_degree',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('profile_owner_id', sa.UUID(), nullable=False),
        sa.Column('doctor_id', sa.UUID(), nullable=False),
        sa.Column('degree_name', sa.String(200), nullable=True),
        sa.Column('institution', sa.String(300), nullable=True),
        sa.Column('passing_year', sa.Integer(), nullable=True),
        sa.Column('certificate_link', sa.String(500), nullable=True),
        sa.Column('degree_category_id', sa.UUID(), nullable=True),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['profile_owner_id'], ['profile_owner.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctors.doctor_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['degree_category_id'], ['categories.category_id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('profile_education_degree', schema=None) as b:
        b.create_index('ix_prof_edu_degree_tenant_id', ['tenant_id'], unique=False)
        b.create_index('ix_prof_edu_degree_profile_owner_id', ['profile_owner_id'], unique=False)
        b.create_index('ix_prof_edu_degree_doctor_id', ['doctor_id'], unique=False)
        b.create_index('ix_prof_edu_degree_tenant_doctor', ['tenant_id', 'doctor_id'], unique=False)

    from app.models._base import generate_rls_sql
    for table in ('profile_extended', 'profile_education_specialization', 'profile_education_degree'):
        for stmt in generate_rls_sql(table):
            op.execute(stmt)

    # ================================ BACKFILLS (lossless) ====================
    # profile_extended <- admin_profiles_extended ONLY (aadhar_* -> aadhaar_*).
    # Doctors are NOT backfilled: their extended fields stay on the `doctors`
    # table (read+written there); the doctors table is not pruned, so copying
    # them here would only create dead rows that drift out of sync.
    conn.execute(sa.text("""
        INSERT INTO profile_extended (
            id, tenant_id, profile_owner_id,
            aadhaar_number, aadhaar_attachment, pan_number, pan_attachment,
            registration_number, experience_years, consultation_fee,
            height, weight, category, religion, citizenship,
            alternative_phone, alternative_email,
            languages_known, slot_pricing, female_health_details,
            communication_address, permanent_address, self_declaration_data,
            created_at, updated_at)
        SELECT gen_random_uuid(), o.tenant_id, o.id,
            d.aadhar_number, d.aadhar_attachment, d.pan_number, d.pan_attachment,
            d.registration_number, d.experience_years, d.consultation_fee,
            d.height, d.weight, d.category, d.religion, d.citizenship,
            d.alternative_phone, d.alternative_email,
            d.languages_known, d.slot_pricing, d.female_health_details,
            d.communication_address, d.permanent_address, d.self_declaration_data,
            now(), now()
        FROM profile_owner o
        JOIN admin_profiles_extended d ON d.admin_id = o.admin_id
        WHERE o.owner_type = 'admin'
        ON CONFLICT (profile_owner_id) DO NOTHING
    """))

    # profile_education_specialization <- doctor_qualification_specializations (1:1)
    conn.execute(sa.text("""
        INSERT INTO profile_education_specialization
            (id, tenant_id, profile_owner_id, doctor_id, category_id,
             qualification_level, is_primary, years_experience, created_at, updated_at)
        SELECT gen_random_uuid(), s.tenant_id, o.id, s.doctor_id, s.category_id,
               c.qualification_level, COALESCE(s.is_primary, false), s.years_experience, now(), now()
        FROM doctor_qualification_specializations s
        JOIN profile_owner o ON o.tenant_id = s.tenant_id AND o.doctor_id = s.doctor_id
        LEFT JOIN categories c ON c.category_id = s.category_id AND c.tenant_id = s.tenant_id
        ON CONFLICT (tenant_id, profile_owner_id, category_id) DO NOTHING
    """))

    # profile_education_degree <- doctor_qualification_degrees (1:1, LOSSLESS).
    # Idempotent guard: skip if an equivalent row already exists for this doctor.
    conn.execute(sa.text("""
        INSERT INTO profile_education_degree
            (id, tenant_id, profile_owner_id, doctor_id, degree_name, institution,
             passing_year, certificate_link, degree_category_id, created_at, updated_at)
        SELECT gen_random_uuid(), d.tenant_id, o.id, d.doctor_id, d.degree_name, d.institution,
               d.passing_year, d.certificate_link, cat.category_id, now(), now()
        FROM doctor_qualification_degrees d
        JOIN profile_owner o ON o.tenant_id = d.tenant_id AND o.doctor_id = d.doctor_id
        LEFT JOIN categories cat ON cat.tenant_id = d.tenant_id
             AND lower(cat.name) = lower(d.degree_name) AND cat.category_type = 'degree'
        WHERE NOT EXISTS (
            SELECT 1 FROM profile_education_degree ped
            WHERE ped.doctor_id = d.doctor_id
              AND ped.degree_name IS NOT DISTINCT FROM d.degree_name
              AND ped.institution IS NOT DISTINCT FROM d.institution
              AND ped.passing_year IS NOT DISTINCT FROM d.passing_year
        )
    """))


def downgrade():
    for table in ('profile_education_degree', 'profile_education_specialization', 'profile_extended'):
        op.execute(f"DROP POLICY IF EXISTS tenant_insert_{table} ON {table}")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}")
        op.drop_table(table)
