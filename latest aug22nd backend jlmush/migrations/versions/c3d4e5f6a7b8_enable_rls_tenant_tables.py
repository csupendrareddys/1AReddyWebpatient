"""Enable Row-Level Security on every tenant-scoped table.

Before this migration, tenant isolation was enforced by:

  * a ``before_request`` hook that sets ``app.current_tenant_id`` on the
    Postgres session, plus
  * RLS policies that compare each row's ``tenant_id`` to that session
    variable.

…but the RLS policies themselves had never been applied on the actual
tables (neither locally nor, for some tables, in production). Every
admin list endpoint relied on RLS alone and had no explicit
``.filter(tenant_id=…)`` clause, so with RLS off every admin saw rows
across every tenant.

This migration applies :func:`app.models._base.generate_rls_sql` to all
80 tables that carry a ``tenant_id`` column. Running the migration is
idempotent-ish (the policies use ``IF EXISTS``-guarded drops in the
downgrade), and the Layer 3 explicit filters added alongside this PR
form the second, application-level security layer — either one alone
now prevents cross-tenant reads.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-04-21
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'c3d4e5f6a7b8'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


# Tables enumerated from ``information_schema.columns`` — every table that
# carries a ``tenant_id`` column. The list is explicit (vs. discovered at
# migration time) so the DDL set is reproducible across dev / staging /
# prod and doesn't shift if a future model re-uses the ``tenant_id`` name
# for something non-tenant-scoped.
TENANT_TABLES = [
    'addresses',
    'admin_permission_overrides',
    'admin_profiles_extended',
    'admins',
    'allergy_master',
    'appointment_documents',
    'appointment_medical_contexts',
    'appointment_products',
    'appointment_ratings',
    'appointment_symptoms',
    'appointments',
    'approval_actions',
    'approval_requests',
    'asset_library_usages',
    'attendance_page_configs',
    'banned_medicines',
    'billing_configs',
    'categories',
    'config_audit_logs',
    'consultation_messages',
    'consultations',
    'declaration_configs',
    'doctor_admin_requests',
    'doctor_hospital_affiliations',
    'doctor_marketplace_products',
    'doctor_payouts',
    'doctor_products',
    'doctor_qualification_degrees',
    'doctor_qualification_specializations',
    'doctor_questions',
    'doctor_services',
    'doctor_symptoms',
    'doctors',
    'extra_button_configs',
    'field_approval_requests',
    'follow_up_invites',
    'health_records',
    'hospitals',
    'house_group_members',
    'house_group_requests',
    'landing_config_snapshots',
    'landing_configs',
    'landing_features',
    'landing_modules',
    'login_field_configs',
    'login_page_configs',
    'marketplace_orders',
    'master_colleges',
    'medicine_brands',
    'medicines',
    'metric_overrides',
    'page_config_assets',
    'page_configs',
    'page_field_configs',
    'patient_question_answers',
    'patients',
    'payments',
    'pharmacies',
    'prescription_medicines',
    'prescription_templates',
    'prescriptions',
    'profile_about',
    'profile_bank_accounts',
    'profile_declaration_responses',
    'profile_documents',
    'profile_education',
    'profile_signatures',
    'questionnaire_block_questions',
    'questionnaire_blocks',
    'role_permission_audit_log',
    'role_permissions',
    'roles',
    'sub_admin_roles',
    'symptoms',
    'tenant_permission_allocations',
    'time_slot_types',
    'time_slots',
    'user_sessions',
    'user_type_configs',
    'users',
]


def upgrade():
    # Imported lazily so the migration module loads even if the app package
    # isn't on sys.path (e.g. ``alembic show``).
    from app.models._base import generate_rls_sql

    for table in TENANT_TABLES:
        for stmt in generate_rls_sql(table):
            op.execute(stmt)


def downgrade():
    # Drop the policies and disable RLS — reverse order of upgrade. Use
    # ``IF EXISTS`` guards so a partially-applied upgrade can still be
    # rolled back cleanly.
    for table in reversed(TENANT_TABLES):
        op.execute(f"DROP POLICY IF EXISTS tenant_insert_{table} ON {table}")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
