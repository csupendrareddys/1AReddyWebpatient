"""Add PLATFORM_OWNER cross-tenant SELECT bypass to all RLS policies.

Round 12 — SaaS multi-tenancy audit follow-up. The platform owner
needs to read across every tenant from the apex (approvals,
hospitals/clinics list, audit logs, etc.) but RLS was filtering
to ``current_setting('app.current_tenant_id')`` only, so cross-
tenant SELECTs returned empty even when the operator had every
authority over the row.

Solution: rebuild every ``tenant_isolation_<table>`` policy to add
an OR-branch that lets the row through when the session-scoped
``app.bypass_rls`` flag is ``'true'``. The Flask before-request
hook sets the flag ONLY when the JWT's ``role`` claim is
``platform_owner`` — every other request keeps tenant isolation.

INSERT policies (``tenant_insert_<table>``) are NOT touched here.
PLATFORM_OWNER writes still go through ``with_tenant_context``
to set the target tenant on insert; allowing the bypass to skip
WITH CHECK would let an ungated INSERT land tenant_id = NULL,
which the existing auto-fill hook can't fix.

Idempotent: ``DROP POLICY IF EXISTS`` lets a re-run on a partial
upgrade complete cleanly. Downgrade restores the original
tenant-only policy.

Touches the same 80 tables listed in
``c3d4e5f6a7b8_enable_rls_tenant_tables.py`` plus the four added
in the landing-page / pricing / tenant-provider-plans migrations.

Revision ID: k7f8g9h0i1j2
Revises: j6e7f8a9b0c1
Create Date: 2026-05-23
"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text


revision = 'k7f8g9h0i1j2'
down_revision = 'j6e7f8a9b0c1'
branch_labels = None
depends_on = None


# Full list of tenant-scoped tables — superset of the original RLS
# migration's TENANT_TABLES plus everything added in landing-page,
# pricing, and tenant-provider-plan migrations. Hardcoded here so
# the migration is hermetic (Alembic runs before the app is
# importable in CI bootstrap).
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
    'clinics',
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
    'landing_brands',
    'landing_doctors',
    'landing_recognitions',
    'landing_reviews',
    'landing_videos',
    'login_field_configs',
    'login_page_configs',
    'marketplace_orders',
    'master_colleges',
    'medicine_brands',
    'medicines',
    'metric_overrides',
    'module_configs',
    'page_config_assets',
    'page_configs',
    'page_field_configs',
    'patient_question_answers',
    'patients',
    'payments',
    'pharmacies',
    'plan_addons',
    'plans',
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
    'subscription_addons',
    'subscriptions',
    'symptoms',
    'tenant_permission_allocations',
    'tenant_provider_plans',
    'tenant_provider_subscriptions',
    'tenant_subscriptions',
    'time_slot_types',
    'time_slots',
    'user_sessions',
    'user_type_configs',
    'users',
]


_CURRENT_TENANT = "current_setting('app.current_tenant_id', true)"
_BYPASS = "current_setting('app.bypass_rls', true)"


def _table_has_rls_policy(table_name):
    """Skip tables that don't have a ``tenant_isolation_<table>``
    policy already — protects against:
      * tables that don't exist on older DBs (additive over time),
      * tables without a ``tenant_id`` column (e.g. ``plans``,
        ``plan_addons`` — those are global catalogs and never had
        the RLS policy in the first place; CREATE POLICY would
        fail with "column tenant_id does not exist").
    """
    conn = op.get_bind()
    return conn.execute(
        text(
            "SELECT 1 FROM pg_policies WHERE schemaname = current_schema() "
            "  AND tablename = :t AND policyname = :p"
        ),
        {'t': table_name, 'p': f'tenant_isolation_{table_name}'},
    ).first() is not None


def upgrade():
    """Drop the old tenant-only ``tenant_isolation_*`` policies and
    recreate them with the bypass branch. The INSERT policies stay
    strict (no bypass clause)."""
    for table in TENANT_TABLES:
        # Some tables may not exist in older databases (additive over
        # time). Skip silently — DROP/CREATE POLICY without IF EXISTS
        # is what Postgres supports here.
        if not _table_has_rls_policy(table):
            continue
        op.execute(
            f"DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}"
        )
        op.execute(
            f"CREATE POLICY tenant_isolation_{table} ON {table} "
            f"USING (tenant_id = {_CURRENT_TENANT}::uuid "
            f"       OR {_BYPASS} = 'true')"
        )


def downgrade():
    """Restore strict tenant-only policies — drops the bypass branch."""
    for table in TENANT_TABLES:
        if not _table_has_rls_policy(table):
            continue
        op.execute(
            f"DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}"
        )
        op.execute(
            f"CREATE POLICY tenant_isolation_{table} ON {table} "
            f"USING (tenant_id = {_CURRENT_TENANT}::uuid)"
        )
