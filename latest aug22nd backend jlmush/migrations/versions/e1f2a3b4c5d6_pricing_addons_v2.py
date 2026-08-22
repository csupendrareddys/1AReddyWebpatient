"""Pricing v2 — add-on catalog expansion, usage caps, prerequisites.

Schema additions (zero edits to existing columns):
    * ``addons.prerequisites``   JSON nullable — list of addon-code strings
                                 that must be active on the same tenant.
    * ``addons.usage_deltas``    JSON nullable — additive monthly-cap
                                 deltas, same merge logic as ``addons.limits``.
    * ``plans.usage_limits``     JSON nullable — per-plan default usage caps
                                 (``video_minutes`` / ``audio_minutes`` /
                                 ``chat_messages`` / ``sms_sends`` /
                                 ``email_sends``). Convention: ``-1``
                                 unlimited, ``0`` disabled, positive int = cap.
                                 Each metric carries window sub-keys
                                 (``monthly`` / ``daily`` /
                                 ``rolling_days`` + ``rolling_limit``).
    * ``plans.default_addons``   JSON nullable — list of addon codes that
                                 auto-attach when a tenant subscribes to
                                 this plan. Lets the platform owner curate
                                 Plan B / Plan C bundles without code.
    * **New table** ``tenant_usage_counters`` (RLS) — atomic per-tenant
                                 per-metric per-window counters.

Seeds:
    * 28 add-ons spanning consultation modes, patient features, doctor
      features, admin governance, communication, payments, capacity packs,
      usage-cap boosts, language support.
    * Plan B (``plan2`` — Pro) and Plan C (``plan3`` — Premium), with
      ``default_addons`` curated for each.

No edits to Plan1: it stays minimal. New feature paths land in the
``ALLOWED_FEATURE_PATHS`` whitelist (one constant edit in service.py).

Revision ID: e1f2a3b4c5d6
Revises: d4e5f6a7b8c9
"""
from __future__ import annotations

import json
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSON, UUID


revision = 'e1f2a3b4c5d6'
# Re-parented to chain after the latest pre-existing head (the
# notification/email/landing chain) so ``flask db upgrade`` walks a
# single linear path. The pricing-v2 deltas are independent of those
# other tables, so the order doesn't matter functionally.
down_revision = 'c9d0e1f2a3b4'
branch_labels = None
depends_on = None


# --------------------------------------------------------------------------- #
# Catalog data — kept in this migration so the seed is auditable in git.
# Platform owner overrides any of this via the admin UI after migration runs.
# --------------------------------------------------------------------------- #

# ── Add-ons ────────────────────────────────────────────────────────────────
# Keys: code, name, description, monthly₹, annual₹, features, limits,
# usage_deltas, prerequisites.
# A None price means "platform decides at billing engine time".
ADDON_SEED = [
    # ── Consultation modes ────
    {
        'code': 'addon_consult_in_person',
        'name': 'In-clinic consultations',
        'description': 'Schedule patients for in-person clinic visits.',
        'price_inr_monthly': 0, 'price_inr_annual': 0,
        'features': {'consultation': {'in_person': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_consult_video',
        'name': 'Video consultations',
        'description': 'Twilio-backed video calls between doctor and patient.',
        'price_inr_monthly': 199, 'price_inr_annual': 1999,
        'features': {'consultation': {'video': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_consult_audio',
        'name': 'Audio consultations',
        'description': 'Voice-only doctor-patient calls.',
        'price_inr_monthly': 99, 'price_inr_annual': 999,
        'features': {'consultation': {'audio': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_consult_chat',
        'name': 'Async chat consultations',
        'description': 'Text-based consult flow with persistent message history.',
        'price_inr_monthly': 99, 'price_inr_annual': 999,
        'features': {'consultation': {'chat': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_consult_home_visit',
        'name': 'Home-visit consultations',
        'description': 'Schedule providers for at-home patient visits.',
        'price_inr_monthly': 149, 'price_inr_annual': 1499,
        'features': {'consultation': {'home_visit': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_consult_camp',
        'name': 'Camp / group consultations',
        'description': 'Run on-site health camps with batch scheduling.',
        'price_inr_monthly': 199, 'price_inr_annual': 1999,
        'features': {'consultation': {'camp': True}},
        'prerequisites': [],
    },

    # ── Patient features ────
    {
        'code': 'addon_patient_vitals',
        'name': 'Patient vitals capture',
        'description': 'Doctors record height, weight, BP, vitals during the visit.',
        'price_inr_monthly': 99, 'price_inr_annual': 999,
        'features': {'patient': {'vitals': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_patient_documents',
        'name': 'Patient document uploads',
        'description': 'Patients can upload and share medical documents.',
        'price_inr_monthly': 99, 'price_inr_annual': 999,
        'features': {'patient': {'documents': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_patient_family',
        'name': 'Family / house group',
        'description': 'Manage multiple family members under one patient account.',
        'price_inr_monthly': 49, 'price_inr_annual': 499,
        'features': {'patient': {'family': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_patient_intake_forms',
        'name': 'Custom intake forms',
        'description': 'Symptom and questionnaire blocks completed before the visit.',
        'price_inr_monthly': 149, 'price_inr_annual': 1499,
        'features': {'patient': {'intake_forms': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_patient_health_records',
        'name': 'Longitudinal health records',
        'description': 'Patient health-record timeline aggregating vitals, attachments, prescriptions.',
        'price_inr_monthly': 199, 'price_inr_annual': 1999,
        'features': {'patient': {'health_records': True}},
        'prerequisites': ['addon_patient_vitals'],
    },

    # ── Doctor / clinical ────
    {
        'code': 'addon_prescriptions',
        'name': 'Prescriptions & lab orders',
        'description': 'Doctors issue digital prescriptions and lab orders.',
        'price_inr_monthly': 99, 'price_inr_annual': 999,
        'features': {'doctor': {'prescriptions': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_prescriptions_pdf',
        'name': 'Branded prescription PDFs',
        'description': 'Generate clinic-branded PDF prescriptions with template editor.',
        'price_inr_monthly': 49, 'price_inr_annual': 499,
        'features': {'doctor': {'prescriptions_pdf': True}},
        'prerequisites': ['addon_prescriptions'],
    },
    {
        'code': 'addon_followup',
        'name': 'Follow-up invites',
        'description': 'Automated follow-up booking flows after a visit.',
        'price_inr_monthly': 49, 'price_inr_annual': 499,
        'features': {'doctor': {'follow_up': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_doctor_attendance',
        'name': 'Doctor attendance tracking',
        'description': 'Daily attendance + activity tracking for in-clinic providers.',
        'price_inr_monthly': 49, 'price_inr_annual': 499,
        'features': {'doctor': {'attendance': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_doctor_analytics',
        'name': 'Doctor analytics dashboard',
        'description': 'Revenue, patient-load, and metric overrides per provider.',
        'price_inr_monthly': 199, 'price_inr_annual': 1999,
        'features': {'doctor': {'analytics': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_multi_location',
        'name': 'Multiple practice locations',
        'description': 'Run providers across more than one clinic / hospital.',
        'price_inr_monthly': 299, 'price_inr_annual': 2999,
        'features': {'clinic': {'multi_location': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_appointment_ratings',
        'name': 'Patient ratings & feedback',
        'description': 'Collect post-visit ratings and surface testimonials.',
        'price_inr_monthly': 49, 'price_inr_annual': 499,
        'features': {'clinic': {'feedback': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_marketplace',
        'name': 'Doctor marketplace',
        'description': 'Doctors list product offerings and patients buy directly.',
        'price_inr_monthly': 199, 'price_inr_annual': 1999,
        'features': {'clinic': {'marketplace': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_doctor_payouts',
        'name': 'Doctor payouts',
        'description': 'Automated revenue split + payout statements for providers.',
        'price_inr_monthly': 199, 'price_inr_annual': 1999,
        'features': {'clinic': {'doctor_payouts': True}},
        'prerequisites': [],
    },

    # ── Admin / governance ────
    {
        'code': 'addon_page_configuration',
        'name': 'Custom login & signup pages',
        'description': 'Per-tenant page builder for login, signup, and branding.',
        'price_inr_monthly': 199, 'price_inr_annual': 1999,
        'features': {'admin': {'page_configuration': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_landing_builder',
        'name': '3-level landing builder',
        'description': 'Build modular landing pages with hero, modules, features.',
        'price_inr_monthly': 299, 'price_inr_annual': 2999,
        'features': {'admin': {'landing_builder': True}},
        'prerequisites': ['addon_page_configuration'],
    },
    {
        'code': 'addon_field_approval',
        'name': 'Field-level approval workflow',
        'description': 'Per-field changes require sign-off from a senior admin.',
        'price_inr_monthly': 99, 'price_inr_annual': 999,
        'features': {'admin': {'field_approval': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_audit_logs',
        'name': 'Audit logs',
        'description': 'Immutable audit trail of permission and config changes.',
        'price_inr_monthly': 49, 'price_inr_annual': 499,
        'features': {'admin': {'audit_logs': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_billing_config',
        'name': 'Billing configuration',
        'description': 'Configure platform / GST / TDS charges and bill templates.',
        'price_inr_monthly': 99, 'price_inr_annual': 999,
        'features': {'admin': {'billing_config': True}},
        'prerequisites': [],
    },

    # ── Communication ────
    {
        'code': 'addon_sms',
        'name': 'SMS notifications',
        'description': 'Send SMS appointment reminders and OTP via the platform gateway.',
        'price_inr_monthly': 99, 'price_inr_annual': 999,
        'features': {'communication': {'sms': {'enabled': True, 'control': 'platform'}}},
        'usage_deltas': {'sms_sends': {'monthly': 100}},
        'prerequisites': [],
    },
    {
        'code': 'addon_custom_email_templates',
        'name': 'Custom email templates',
        'description': 'Edit transactional email templates per-tenant.',
        'price_inr_monthly': 49, 'price_inr_annual': 499,
        'features': {'communication': {'custom_email': True}},
        'prerequisites': [],
    },
    {
        'code': 'addon_custom_sms_templates',
        'name': 'Custom SMS templates',
        'description': 'Edit transactional SMS templates per-tenant.',
        'price_inr_monthly': 49, 'price_inr_annual': 499,
        'features': {'communication': {'custom_sms': True}},
        'prerequisites': ['addon_sms'],
    },

    # ── Internationalisation ────
    {
        'code': 'addon_multi_language',
        'name': 'Multi-language portal',
        'description': 'Hindi, Telugu, Tamil and other Indian languages on the patient portal.',
        'price_inr_monthly': 49, 'price_inr_annual': 499,
        'features': {'i18n': {'multi_language': {'enabled': True, 'allowed': ['en', 'hi', 'te', 'ta']}}},
        'prerequisites': [],
    },

    # ── Capacity packs (additive seat deltas) ────
    {
        'code': 'addon_extra_5_providers',
        'name': '+5 provider seats',
        'description': 'Adds 5 provider seats on top of the plan default.',
        'price_inr_monthly': 499, 'price_inr_annual': 4999,
        'features': {},
        'limits': {'provider': 5, 'total': 5},
        'prerequisites': [],
    },
    {
        'code': 'addon_extra_3_subadmins',
        'name': '+3 sub-admin seats',
        'description': 'Adds 3 sub-admin seats on top of the plan default.',
        'price_inr_monthly': 199, 'price_inr_annual': 1999,
        'features': {},
        'limits': {'sub_admin': 3, 'total': 3},
        'prerequisites': [],
    },

    # ── Usage-cap boosts ────
    {
        'code': 'addon_video_500_minutes',
        'name': '+500 video minutes / month',
        'description': 'Boost monthly video-consultation minutes by 500.',
        'price_inr_monthly': 299, 'price_inr_annual': 2999,
        'features': {},
        'usage_deltas': {'video_minutes': {'monthly': 500}},
        'prerequisites': ['addon_consult_video'],
    },
    {
        'code': 'addon_chat_5000_messages',
        'name': '+5,000 chat messages / month',
        'description': 'Boost monthly async chat throughput by 5,000 messages.',
        'price_inr_monthly': 199, 'price_inr_annual': 1999,
        'features': {},
        'usage_deltas': {'chat_messages': {'monthly': 5000}},
        'prerequisites': ['addon_consult_chat'],
    },
]


# ── Plan B (Pro) ───────────────────────────────────────────────────────────
PLAN_B = {
    'code': 'plan2',
    'name': 'Pro',
    'description': 'For multi-doctor practices with patient engagement, video, and analytics.',
    'is_default': False,
    'price_inr_monthly': 1999,
    'price_inr_annual': 19999,
    'trial_days': 14,
    'max_total_users': 50, 'max_super_admins': 2,
    'max_sub_admins': 10, 'max_providers': 38,
    'over_limit_action': 'BLOCK_NEW',
    'grace_period_days': 0,
    'razorpay_supported': True, 'tenant_keys_allowed': False,
    'features': {
        'patient': {'basic_info': True},
        'doctor': {'profile': True, 'calendar': True, 'pricing': True},
        'admin': {'manage_users': True, 'page_configuration': False},
        'communication': {
            'email': {'enabled': True, 'control': 'platform'},
            'sms': {'enabled': False, 'control': 'platform'},
        },
        'payments': {'razorpay': {'enabled': True, 'control': 'platform'}},
        'domain': {
            'subdomain': {'enabled': True, 'configurable': True},
            'custom_domain': {'enabled': False, 'configurable': False},
        },
    },
    'usage_limits': {
        'video_minutes': {'monthly': 1000, 'daily': 60},
        'audio_minutes': {'monthly': 500, 'daily': 30},
        'chat_messages': {'monthly': 5000, 'daily': 300},
        'sms_sends':     {'monthly': 100,  'daily': 30},
        'email_sends':   {'monthly': 5000, 'daily': 500},
    },
    'default_addons': [
        'addon_consult_in_person', 'addon_consult_video',
        'addon_prescriptions', 'addon_prescriptions_pdf',
        'addon_patient_vitals', 'addon_patient_documents',
        'addon_appointment_ratings', 'addon_doctor_attendance',
        'addon_followup',
    ],
}


# ── Plan C (Premium) ───────────────────────────────────────────────────────
PLAN_C = {
    'code': 'plan3',
    'name': 'Premium',
    'description': 'For larger clinics needing custom branding, multi-location, full analytics.',
    'is_default': False,
    'price_inr_monthly': 4999,
    'price_inr_annual': 49999,
    'trial_days': 14,
    'max_total_users': 150, 'max_super_admins': 3,
    'max_sub_admins': 30, 'max_providers': 117,
    'over_limit_action': 'BLOCK_NEW',
    'grace_period_days': 0,
    'razorpay_supported': True, 'tenant_keys_allowed': False,
    'features': {
        'patient': {'basic_info': True},
        'doctor': {'profile': True, 'calendar': True, 'pricing': True},
        'admin': {'manage_users': True, 'page_configuration': True},
        'communication': {
            'email': {'enabled': True, 'control': 'platform'},
            'sms': {'enabled': True, 'control': 'platform'},
        },
        'payments': {'razorpay': {'enabled': True, 'control': 'platform'}},
        'domain': {
            'subdomain': {'enabled': True, 'configurable': True},
            'custom_domain': {'enabled': False, 'configurable': False},
        },
    },
    'usage_limits': {
        'video_minutes': {'monthly': 5000, 'daily': 300},
        'audio_minutes': {'monthly': 2000, 'daily': 120},
        'chat_messages': {'monthly': 25000, 'daily': 1500},
        'sms_sends':     {'monthly': 500,   'daily': 100},
        'email_sends':   {'monthly': 25000, 'daily': 2000},
    },
    'default_addons': [
        # Consult modes
        'addon_consult_in_person', 'addon_consult_video', 'addon_consult_audio',
        'addon_consult_chat', 'addon_consult_home_visit',
        # Patient features
        'addon_patient_vitals', 'addon_patient_documents', 'addon_patient_family',
        'addon_patient_intake_forms', 'addon_patient_health_records',
        # Doctor / clinical
        'addon_prescriptions', 'addon_prescriptions_pdf', 'addon_followup',
        'addon_doctor_attendance', 'addon_doctor_analytics', 'addon_multi_location',
        'addon_appointment_ratings', 'addon_marketplace', 'addon_doctor_payouts',
        # Admin / governance
        'addon_page_configuration', 'addon_landing_builder',
        'addon_field_approval', 'addon_audit_logs', 'addon_billing_config',
        # Communication
        'addon_sms', 'addon_custom_email_templates', 'addon_custom_sms_templates',
        # i18n
        'addon_multi_language',
    ],
}


# --------------------------------------------------------------------------- #
# Schema migration
# --------------------------------------------------------------------------- #

def upgrade():
    # ── 1. Schema additions ─────────────────────────────────────────
    op.add_column('addons', sa.Column('prerequisites', JSON, nullable=True))
    op.add_column('addons', sa.Column('usage_deltas', JSON, nullable=True))
    op.add_column('plans', sa.Column('usage_limits', JSON, nullable=True))
    op.add_column('plans', sa.Column('default_addons', JSON, nullable=True))

    # ── 2. tenant_usage_counters table ─────────────────────────────
    op.create_table(
        'tenant_usage_counters',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('metric', sa.String(50), nullable=False),
        # window: 'monthly' | 'daily' | 'rolling'
        sa.Column('window', sa.String(20), nullable=False),
        # Period anchor — for monthly = first-of-month UTC, daily = UTC midnight,
        # rolling = subscription anchor + N * rolling_days.
        sa.Column('period_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('period_end', sa.DateTime(timezone=True), nullable=False),
        sa.Column('count', sa.BigInteger, nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.UniqueConstraint(
            'tenant_id', 'metric', 'window', 'period_start',
            name='uq_tenant_usage_counter',
        ),
    )
    # Threshold check is the hot path — composite index covers it.
    op.create_index(
        'ix_tenant_usage_counter_lookup',
        'tenant_usage_counters', ['tenant_id', 'metric', 'window', 'period_start'],
    )

    # ── 3. RLS on the new tenant-scoped table ───────────────────────
    from app.models._base import generate_rls_sql
    for stmt in generate_rls_sql('tenant_usage_counters'):
        op.execute(stmt)

    # ── 4. Seed add-on catalog ──────────────────────────────────────
    # Note: ``is_deleted`` is set explicitly because tables created by
    # ``db.create_all()`` (bootstrap path) don't carry a Postgres-level
    # default — only the Python-side mixin default — and raw-SQL
    # INSERTs bypass that. SoftDeleteMixin now declares ``server_default``
    # too, but explicit values keep this migration safe to replay against
    # legacy schemas.
    conn = op.get_bind()
    for a in ADDON_SEED:
        conn.execute(
            sa.text("""
                INSERT INTO addons (
                    id, code, name, description, status,
                    price_inr_monthly, price_inr_annual,
                    features, limits, usage_deltas, prerequisites,
                    is_deleted, created_at, updated_at
                ) VALUES (
                    :id, :code, :name, :description, 'ACTIVE',
                    :price_m, :price_y,
                    CAST(:features AS JSON),
                    CAST(:limits AS JSON),
                    CAST(:usage_deltas AS JSON),
                    CAST(:prereqs AS JSON),
                    false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                ON CONFLICT (code) DO NOTHING
            """),
            {
                'id': str(uuid.uuid4()),
                'code': a['code'], 'name': a['name'],
                'description': a.get('description'),
                'price_m': a.get('price_inr_monthly'),
                'price_y': a.get('price_inr_annual'),
                'features': json.dumps(a.get('features') or {}),
                'limits': json.dumps(a['limits']) if a.get('limits') else None,
                'usage_deltas': json.dumps(a['usage_deltas']) if a.get('usage_deltas') else None,
                'prereqs': json.dumps(a.get('prerequisites') or []),
            },
        )

    # ── 5. Seed Plan B + Plan C ─────────────────────────────────────
    # Same explicit ``is_deleted = false`` rationale as the addons seed.
    for plan in (PLAN_B, PLAN_C):
        conn.execute(
            sa.text("""
                INSERT INTO plans (
                    id, code, name, description, status, is_default,
                    price_inr_monthly, price_inr_annual, trial_days,
                    max_total_users, max_super_admins, max_sub_admins, max_providers,
                    over_limit_action, grace_period_days,
                    razorpay_supported, tenant_keys_allowed,
                    features, usage_limits, default_addons,
                    is_deleted, created_at, updated_at
                ) VALUES (
                    :id, :code, :name, :description, 'ACTIVE', :is_default,
                    :price_m, :price_y, :trial_days,
                    :max_total, :max_sa, :max_sub, :max_prov,
                    :over_limit_action, :grace,
                    :razorpay_supported, :tenant_keys_allowed,
                    CAST(:features AS JSON),
                    CAST(:usage_limits AS JSON),
                    CAST(:default_addons AS JSON),
                    false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                ON CONFLICT (code) DO NOTHING
            """),
            {
                'id': str(uuid.uuid4()),
                'code': plan['code'], 'name': plan['name'],
                'description': plan['description'],
                'is_default': plan['is_default'],
                'price_m': plan['price_inr_monthly'],
                'price_y': plan['price_inr_annual'],
                'trial_days': plan['trial_days'],
                'max_total': plan['max_total_users'],
                'max_sa': plan['max_super_admins'],
                'max_sub': plan['max_sub_admins'],
                'max_prov': plan['max_providers'],
                'over_limit_action': plan['over_limit_action'],
                'grace': plan['grace_period_days'],
                'razorpay_supported': plan['razorpay_supported'],
                'tenant_keys_allowed': plan['tenant_keys_allowed'],
                'features': json.dumps(plan['features']),
                'usage_limits': json.dumps(plan['usage_limits']),
                'default_addons': json.dumps(plan['default_addons']),
            },
        )

    # ── 6. Plan1 also gets baseline usage_limits (small caps for the
    # Standard tier — platform owner can edit). We don't touch features.
    conn.execute(
        sa.text("""
            UPDATE plans
            SET usage_limits = CAST(:ul AS JSON)
            WHERE code = 'plan1' AND usage_limits IS NULL
        """),
        {'ul': json.dumps({
            'video_minutes': {'monthly': 0, 'daily': 0},   # disabled by default on Standard
            'audio_minutes': {'monthly': 0, 'daily': 0},
            'chat_messages': {'monthly': 0, 'daily': 0},
            'sms_sends':     {'monthly': 0, 'daily': 0},
            'email_sends':   {'monthly': 1000, 'daily': 200},
        })},
    )


def downgrade():
    op.execute("DELETE FROM addons WHERE code LIKE 'addon_%'")
    op.execute("DELETE FROM plans WHERE code IN ('plan2', 'plan3')")

    op.execute("DROP POLICY IF EXISTS tenant_insert_tenant_usage_counters ON tenant_usage_counters")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_tenant_usage_counters ON tenant_usage_counters")
    op.execute("ALTER TABLE tenant_usage_counters NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenant_usage_counters DISABLE ROW LEVEL SECURITY")
    op.drop_index('ix_tenant_usage_counter_lookup', table_name='tenant_usage_counters')
    op.drop_table('tenant_usage_counters')

    op.drop_column('plans', 'default_addons')
    op.drop_column('plans', 'usage_limits')
    op.drop_column('addons', 'usage_deltas')
    op.drop_column('addons', 'prerequisites')
