"""Remove the PLATFORM_OWNER cross-tenant bypass from all RLS policies.

Reverses ``k7f8g9h0i1j2_rls_platform_owner_bypass`` forward — keeps
the migration chain linear so prod DBs already stamped at k7 can
upgrade cleanly to the strict-tenant state we want.

Why not just delete k7?
  k7 was deployed to prod before the design decision was reversed.
  The prod DB is stamped at k7 in ``alembic_version``. If we delete
  the file, ``flask db upgrade`` on prod can't resolve the current
  head and bails (the failing CI deploy we just hit). So we ship
  this forward-roll instead — k7 stays in history (as it was once
  applied), and l8 is the migration that takes prod back to strict
  RLS.

Behaviour:
  * ``upgrade()`` — rebuilds every ``tenant_isolation_<table>``
    policy WITHOUT the ``OR app.bypass_rls = 'true'`` branch.
    Identical to the post-downgrade state of k7. Same idempotent
    "skip tables whose policy doesn't exist" guard.
  * ``downgrade()`` — restores the bypass branch (the upgrade
    state of k7). Only useful for symmetry; nothing is supposed
    to go back to the bypassed state in practice.

After this migration, the strict tenant-isolation policies are
the only ones in place. PLATFORM_OWNER cross-tenant work must
use the explicit ``with_tenant_context`` helper on the
``/api/platform/*`` surface — same as before k7 ever landed.

Revision ID: l8g9h0i1j2k3
Revises: k7f8g9h0i1j2
Create Date: 2026-05-23
"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text


revision = 'l8g9h0i1j2k3'
down_revision = 'k7f8g9h0i1j2'
branch_labels = None
depends_on = None


# Same table list as k7 — superset of the original RLS migration's
# TENANT_TABLES plus everything added since. Hardcoded so the
# migration is hermetic (Alembic runs before the app is importable
# in CI bootstrap).
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
    """Skip tables whose ``tenant_isolation_<table>`` policy doesn't
    exist (older DBs / tables without tenant_id like ``plans``)."""
    conn = op.get_bind()
    return conn.execute(
        text(
            "SELECT 1 FROM pg_policies WHERE schemaname = current_schema() "
            "  AND tablename = :t AND policyname = :p"
        ),
        {'t': table_name, 'p': f'tenant_isolation_{table_name}'},
    ).first() is not None


def upgrade():
    """Strip the bypass OR-branch from every ``tenant_isolation_*``
    policy. After this runs, RLS is strict-tenant only (matches
    the original ``generate_rls_sql`` shape)."""
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


def downgrade():
    """Restore the bypass branch. Symmetric counterpart of
    ``upgrade()`` — only useful if someone genuinely wants to put
    the bypass back; the application no longer sets the flag."""
    for table in TENANT_TABLES:
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
