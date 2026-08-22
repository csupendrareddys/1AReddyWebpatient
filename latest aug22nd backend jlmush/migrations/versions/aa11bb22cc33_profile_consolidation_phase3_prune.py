"""profile consolidation phase3: populate + prune old tables

Revision ID: aa11bb22cc33
Revises: 7fce2e4c15b0
Create Date: 2026-07-16

The "populate + prune" step (run during the maintenance window, AFTER the
reader/writer-cutover code is deployed).

upgrade():
  1. Idempotent re-backfill (self-contained safety net).
  2. SAFETY CHECK — aborts (RuntimeError, transaction rolls back) if ANY legacy
     row is not present in the new tables, so a drop can never lose data.
  3. DROP the three legacy tables.

downgrade(): recreates the three tables (+RLS) and reverse-fills from the new
tables (lossless — degree_name/institution/certificate_link come back via the
profile_education_degree child table).
"""
from alembic import op
import sqlalchemy as sa


revision = 'aa11bb22cc33'
down_revision = '7fce2e4c15b0'
branch_labels = None
depends_on = None

_OLD_TABLES = (
    'doctor_qualification_specializations',
    'doctor_qualification_degrees',
    'admin_profiles_extended',
)


def _rebackfill(conn):
    # profile_extended <- admin_profiles_extended ONLY (doctors keep their own
    # columns; see phase1 migration). Idempotent safety net for the window.
    conn.execute(sa.text("""
        INSERT INTO profile_extended (
            id, tenant_id, profile_owner_id, aadhaar_number, aadhaar_attachment,
            pan_number, pan_attachment, registration_number, experience_years,
            consultation_fee, height, weight, category, religion, citizenship,
            alternative_phone, alternative_email, languages_known, slot_pricing,
            female_health_details, communication_address, permanent_address,
            self_declaration_data, created_at, updated_at)
        SELECT gen_random_uuid(), o.tenant_id, o.id, d.aadhar_number, d.aadhar_attachment,
            d.pan_number, d.pan_attachment, d.registration_number, d.experience_years,
            d.consultation_fee, d.height, d.weight, d.category, d.religion, d.citizenship,
            d.alternative_phone, d.alternative_email, d.languages_known, d.slot_pricing,
            d.female_health_details, d.communication_address, d.permanent_address,
            d.self_declaration_data, now(), now()
        FROM profile_owner o
        JOIN admin_profiles_extended d ON d.admin_id = o.admin_id
        WHERE o.owner_type = 'admin'
        ON CONFLICT (profile_owner_id) DO NOTHING
    """))
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


def _guard(conn, sql, msg):
    if conn.execute(sa.text(sql)).scalar():
        raise RuntimeError('PRUNE ABORTED (no data will be dropped): ' + msg)


def upgrade():
    conn = op.get_bind()
    _rebackfill(conn)

    # Safety: every legacy row MUST exist in the new tables before we drop.
    _guard(conn, """
        SELECT EXISTS (SELECT 1 FROM doctor_qualification_specializations s
            WHERE NOT EXISTS (SELECT 1 FROM profile_education_specialization n
                WHERE n.doctor_id = s.doctor_id AND n.category_id = s.category_id))
    """, 'a doctor_qualification_specializations row is missing from profile_education_specialization')
    _guard(conn, """
        SELECT (SELECT count(*) FROM doctor_qualification_degrees)
             > (SELECT count(*) FROM profile_education_degree)
    """, 'profile_education_degree has fewer rows than doctor_qualification_degrees')
    _guard(conn, """
        SELECT EXISTS (SELECT 1 FROM admin_profiles_extended a
            WHERE NOT EXISTS (SELECT 1 FROM profile_owner o
                JOIN profile_extended pe ON pe.profile_owner_id = o.id
                WHERE o.owner_type = 'admin' AND o.admin_id = a.admin_id))
    """, 'an admin_profiles_extended row is missing from profile_extended')

    for tbl in _OLD_TABLES:
        op.execute(f"DROP TABLE IF EXISTS {tbl} CASCADE")


def downgrade():
    from app.models._base import generate_rls_sql
    conn = op.get_bind()

    op.create_table(
        'doctor_qualification_specializations',
        sa.Column('specialization_id', sa.UUID(), nullable=False),
        sa.Column('doctor_id', sa.UUID(), nullable=False),
        sa.Column('category_id', sa.UUID(), nullable=False),
        sa.Column('years_experience', sa.Integer(), nullable=True),
        sa.Column('is_primary', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctors.doctor_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['category_id'], ['categories.category_id']),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('specialization_id'),
        sa.UniqueConstraint('doctor_id', 'category_id', name='uq_doctor_specialization'),
    )
    op.create_table(
        'doctor_qualification_degrees',
        sa.Column('qualification_id', sa.UUID(), nullable=False),
        sa.Column('doctor_id', sa.UUID(), nullable=False),
        sa.Column('degree_name', sa.String(200), nullable=False),
        sa.Column('institution', sa.String(300), nullable=False),
        sa.Column('passing_year', sa.Integer(), nullable=True),
        sa.Column('certificate_link', sa.String(500), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctors.doctor_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('qualification_id'),
    )
    op.create_table(
        'admin_profiles_extended',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('admin_id', sa.UUID(), nullable=False),
        sa.Column('aadhar_number', sa.String(255), nullable=True),
        sa.Column('aadhar_attachment', sa.String(500), nullable=True),
        sa.Column('pan_number', sa.String(50), nullable=True),
        sa.Column('pan_attachment', sa.String(500), nullable=True),
        sa.Column('registration_number', sa.String(100), nullable=True),
        sa.Column('experience_years', sa.Integer(), nullable=True),
        sa.Column('alternative_phone', sa.String(20), nullable=True),
        sa.Column('alternative_email', sa.String(254), nullable=True),
        sa.Column('height', sa.Numeric(5, 2), nullable=True),
        sa.Column('weight', sa.Numeric(5, 2), nullable=True),
        sa.Column('category', sa.String(100), nullable=True),
        sa.Column('religion', sa.String(100), nullable=True),
        sa.Column('citizenship', sa.String(100), nullable=True),
        sa.Column('languages_known', sa.JSON(), nullable=True),
        sa.Column('female_health_details', sa.JSON(), nullable=True),
        sa.Column('communication_address', sa.JSON(), nullable=True),
        sa.Column('permanent_address', sa.JSON(), nullable=True),
        sa.Column('consultation_fee', sa.Numeric(10, 2), nullable=True),
        sa.Column('slot_pricing', sa.JSON(), nullable=True),
        sa.Column('self_declaration_data', sa.JSON(), nullable=True),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['admin_id'], ['admins.admin_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('admin_id', name='uq_admin_profiles_extended_admin'),
    )
    for tbl in _OLD_TABLES:
        for stmt in generate_rls_sql(tbl):
            op.execute(stmt)

    conn.execute(sa.text("""
        INSERT INTO doctor_qualification_specializations
            (specialization_id, tenant_id, doctor_id, category_id, years_experience, is_primary, created_at, updated_at)
        SELECT gen_random_uuid(), tenant_id, doctor_id, category_id, years_experience, is_primary, now(), now()
        FROM profile_education_specialization
    """))
    conn.execute(sa.text("""
        INSERT INTO doctor_qualification_degrees
            (qualification_id, tenant_id, doctor_id, degree_name, institution, passing_year, certificate_link, created_at, updated_at)
        SELECT gen_random_uuid(), tenant_id, doctor_id,
               COALESCE(degree_name, ''), COALESCE(institution, ''), passing_year, COALESCE(certificate_link, ''), now(), now()
        FROM profile_education_degree
    """))
    conn.execute(sa.text("""
        INSERT INTO admin_profiles_extended
            (id, tenant_id, admin_id, aadhar_number, aadhar_attachment, pan_number, pan_attachment,
             registration_number, experience_years, alternative_phone, alternative_email,
             height, weight, category, religion, citizenship, languages_known, female_health_details,
             communication_address, permanent_address, consultation_fee, slot_pricing, self_declaration_data,
             created_at, updated_at)
        SELECT gen_random_uuid(), pe.tenant_id, o.admin_id, pe.aadhaar_number, pe.aadhaar_attachment,
             pe.pan_number, pe.pan_attachment, pe.registration_number, pe.experience_years,
             pe.alternative_phone, pe.alternative_email, pe.height, pe.weight, pe.category, pe.religion,
             pe.citizenship, pe.languages_known, pe.female_health_details, pe.communication_address,
             pe.permanent_address, pe.consultation_fee, pe.slot_pricing, pe.self_declaration_data, now(), now()
        FROM profile_extended pe
        JOIN profile_owner o ON o.id = pe.profile_owner_id AND o.owner_type = 'admin'
    """))
