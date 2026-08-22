"""Create the plan Larazen runs on once it stops being the apex tenant.

Larazen was never plan-gated (the old ``is_default`` bypass), and the
plan it nominally held -- ``plan1`` -- grants **zero** of the 72 feature
paths and caps seats below what Larazen already uses (1 super_admin vs 7
actual, 16 providers vs 20 actual). So it cannot simply be reused.

Everything below is derived from measured data, not guessed. Re-run the
measurements any time with::

    python scripts/measure_larazen_footprint.py
    python scripts/probe_larazen_feature_usage.py

Deliberately **no ``-1`` (unlimited) sentinels anywhere**: an exempt
Larazen is exactly the thing this split exists to remove. If a limit
turns out to be too tight, raise it here on purpose -- do not uncap it.

Idempotent: re-running updates the existing plan in place.
"""
from decimal import Decimal

from app import create_app
from app.extensions import db
from app.models.plan import Plan
from app.models._enums import PlanStatus, OverLimitAction

PLAN_CODE = 'larazen-ops'

# -- Seats -----------------------------------------------------------
# Measured 2026-08-18: super_admin=7, sub_admin=0, provider(DOCTOR)=20.
# Headroom is deliberate but finite.
MAX_SUPER_ADMINS = 12    # actual 7
MAX_SUB_ADMINS = 5       # actual 0 -- Larazen has none yet, leave room
MAX_PROVIDERS = 35       # actual 20
MAX_TOTAL_USERS = 60     # must be >= 12 + 5 + 35 = 52 (ck_plan_limits_sum)

# -- Provider entities -----------------------------------------------
# Measured: doctors=25, clinics=18, hospitals=16.
MAX_PROVIDER_DOCTORS = 40
MAX_PROVIDER_CLINICS = 30
MAX_PROVIDER_HOSPITALS = 30

# -- Features --------------------------------------------------------
# Each entry carries the evidence that earned it. Paths with no evidence
# are deliberately absent -- that is the point of the exercise.
FEATURES_WITH_EVIDENCE = {
    # 44 patients, 44 health_records, 13 patient_role rows
    'patient.basic_info': '44 patients',
    'patient.vitals': '44 health_records',
    'patient.health_records': '44 health_records',
    'patient.family': '13 patient_roles',
    # 25 doctors, 15 prescriptions
    'doctor.profile': '25 doctors',
    'doctor.calendar': '25 doctors',
    'doctor.pricing': '25 doctors',
    'doctor.prescriptions': '15 prescriptions',
    'doctor.prescriptions_pdf': '15 prescriptions',
    # 69 appointments, ALL appointment_type=ONLINE:
    # video=37, audio=17, chat=15. No in-person, home_visit or camp.
    'consultation.video': '37 video appointments',
    'consultation.audio': '17 audio appointments',
    'consultation.chat': '15 chat appointments',
    # Admin surfaces with real rows behind them
    'admin.landing_builder': '1 landing_config',
    'admin.billing_config': '1 billing_config',
    'admin.field_approval': '18 field_approval_requests',
    'admin.audit_logs': '117 operations_audit_logs + 6 config_audit_logs',
    'admin.manage_users': '7 super_admins + 4 provider_staff + 2 patient_staff',
    # 2 branch clinics (parent_clinic_id set), 5 membership plans, 7 payouts.
    # clinic.* and organization.* are bridged by
    # _apply_organization_clinic_alias -- grant both sides so the bridge
    # cannot disagree with itself.
    'clinic.multi_location': '2 branch clinics',
    'organization.multi_location': '2 branch clinics',
    'clinic.marketplace': '5 membership_plans',
    'organization.marketplace': '5 membership_plans',
    'clinic.doctor_payouts': '7 doctor_payouts',
    'organization.doctor_payouts': '7 doctor_payouts',
    'marketplace.doctor.listing': '5 membership_plans across 4 verticals',
    'marketplace.clinic.listing': '5 membership_plans across 4 verticals',
    'marketplace.hospital.listing': '5 membership_plans across 4 verticals',
    # 2 tenant_provider_plans authored
    'tenant.can_create_doctor_plans': '2 tenant_provider_plans',
    'tenant.can_create_clinic_plans': '2 tenant_provider_plans',
    'tenant.can_create_hospital_plans': '2 tenant_provider_plans',
    # Larazen authors membership tiers -- these gate that, and
    # _runs_marketplace() keys the marketplace signup path off them.
    'tenant.can_create_membership_doctor_plans': '5 membership_plans',
    'tenant.can_create_membership_clinic_plans': '5 membership_plans',
    'tenant.can_create_membership_hospital_plans': '5 membership_plans',
    # 25 service_channels
    'communication.channel': '25 service_channels',
    'communication.scheduled_calls': '25 service_channels',
    # 9 doctor_products, 7 group_offerings, 61 payments
    'service.offer': '9 doctor_products',
    'group_offering.offer': '7 group_offerings',
    'payments.razorpay': '61 payments',
}

# Granted on rationale rather than a row count. Kept separate so the
# distinction stays visible in review.
FEATURES_BY_RATIONALE = {
    'communication.email':
        'auth signup/verification demonstrably sends email; there is no '
        'per-tenant send log to count',
    'communication.sms':
        'auth signup/verification demonstrably sends SMS; same, no log',
    'domain.subdomain':
        'required BY the split -- Larazen must own routing once it stops '
        'being the zone apex',
    'domain.custom_domain':
        'required BY the split -- Larazen keeps its own custom domain',
}

# -- Usage limits ----------------------------------------------------
# There are NO TenantUsageCounter rows for this tenant, so unlike the
# seat/feature numbers these are policy, not measurement. Sized well
# above observed activity (69 appointments, 37 video, 25 channels) and
# finite on purpose.
USAGE_LIMITS = {
    'video_minutes': {'monthly': 20000},
    'audio_minutes': {'monthly': 10000},
    'video_calls': {'monthly': 2000},
    'audio_calls': {'monthly': 1000},
    'chat_messages': {'monthly': 50000},
    'sms_sends': {'monthly': 5000},
    'email_sends': {'monthly': 20000},
}


# Some leaves carry metadata beyond on/off. ``DomainPolicy`` reads
# ``configurable`` on domain.subdomain, so a bare ``True`` there would
# pass FeatureGate but still refuse the tenant a subdomain change.
FEATURE_LEAF_META = {
    'domain.subdomain': {'configurable': True},
}


def build_feature_tree(paths):
    """Dotted paths -> the nested tree the entitlement engine expects.

    Leaves are ``{'enabled': True}`` dicts, NOT bare booleans. Both are
    accepted by ``FeatureGate._walk_to_leaf``, but ``DomainPolicy`` reads
    leaves via ``_walk_to_leaf_meta``, which returns ``{}`` for a bool --
    so a bool leaf silently fails every DomainPolicy check while looking
    enabled everywhere else. The dict form is also what the platform
    owner's FeatureTreeEditor writes, so authoring a plan here and then
    editing it in the admin UI round-trips cleanly.
    """
    tree = {}
    for path in paths:
        node = tree
        parts = path.split('.')
        for part in parts[:-1]:
            nxt = node.get(part)
            if not isinstance(nxt, dict):
                nxt = {}
                node[part] = nxt
            node = nxt
        leaf = {'enabled': True}
        leaf.update(FEATURE_LEAF_META.get(path, {}))
        node[parts[-1]] = leaf
    return tree


# ── Reseller (apex) conversion, 2026-08-19 ──────────────────────────────
# Larazen is the FIRST apex tenant in the reseller hierarchy: its plan is
# kind='apex', granting the reseller console + child-tenant quotas. The
# plan stays vendor-authored (owner_tenant_id NULL) — larazen SUBSCRIBES
# to it, matching invariant I2. Quotas overridable at run time:
#   python scripts/create_larazen_plan.py --child-subdomains 10 --child-domains 3
MAX_CHILD_SUBDOMAINS = 5
MAX_CHILD_CUSTOM_DOMAINS = 2


def ensure_larazen_plan(verbose=True, child_subdomains=None, child_domains=None):
    """Create/update the Larazen plan. Assumes an active app context."""
    from app.api.pricing.service import ALLOWED_FEATURE_PATHS

    granted = sorted({**FEATURES_WITH_EVIDENCE, **FEATURES_BY_RATIONALE})

    unknown = [p for p in granted if p not in ALLOWED_FEATURE_PATHS]
    if unknown:
        raise SystemExit('Unknown feature paths (typo?): %s' % unknown)

    assert MAX_TOTAL_USERS >= (
        MAX_SUPER_ADMINS + MAX_SUB_ADMINS + MAX_PROVIDERS
    ), 'violates ck_plan_limits_sum'

    tree = build_feature_tree(granted)

    plan = Plan.query.filter_by(code=PLAN_CODE, owner_tenant_id=None).first()
    created = plan is None
    if created:
        plan = Plan(code=PLAN_CODE)
        db.session.add(plan)

    plan.name = 'Larazen Operations'
    plan.description = (
        'Private plan for Larazen, sized to its measured footprint when '
        'it was split out of the apex tenant. Not a public tier.'
    )
    # DRAFT = not sellable. Flip to ACTIVE only to offer this tier to
    # real customers.
    plan.status = PlanStatus.DRAFT
    plan.is_default = False
    plan.trial_days = 0
    plan.price_inr_monthly = Decimal('0.00')
    plan.max_total_users = MAX_TOTAL_USERS
    plan.max_super_admins = MAX_SUPER_ADMINS
    plan.max_sub_admins = MAX_SUB_ADMINS
    plan.max_providers = MAX_PROVIDERS
    plan.max_provider_doctors = MAX_PROVIDER_DOCTORS
    plan.max_provider_clinics = MAX_PROVIDER_CLINICS
    plan.max_provider_hospitals = MAX_PROVIDER_HOSPITALS
    plan.over_limit_action = OverLimitAction.BLOCK_NEW
    plan.grace_period_days = 14
    plan.razorpay_supported = True
    plan.tenant_keys_allowed = False
    plan.features = tree
    plan.usage_limits = USAGE_LIMITS
    plan.default_addons = []

    # Apex conversion (see header comment).
    plan.kind = 'apex'
    plan.owner_tenant_id = None
    plan.max_child_subdomains = (
        MAX_CHILD_SUBDOMAINS if child_subdomains is None else child_subdomains)
    plan.max_child_custom_domains = (
        MAX_CHILD_CUSTOM_DOMAINS if child_domains is None else child_domains)

    db.session.commit()

    withheld = sorted(set(ALLOWED_FEATURE_PATHS) - set(granted))
    if not verbose:
        return plan
    print('%s plan %s (id=%s)' % (
        'created' if created else 'updated', PLAN_CODE, plan.id))
    print('  seats    : total=%d super_admin=%d sub_admin=%d provider=%d'
          % (MAX_TOTAL_USERS, MAX_SUPER_ADMINS, MAX_SUB_ADMINS,
             MAX_PROVIDERS))
    print('  entities : doctors=%d clinics=%d hospitals=%d'
          % (MAX_PROVIDER_DOCTORS, MAX_PROVIDER_CLINICS,
             MAX_PROVIDER_HOSPITALS))
    print('  reseller : kind=%s child_subdomains=%s child_domains=%s'
          % (plan.kind, plan.max_child_subdomains,
             plan.max_child_custom_domains))
    print('  features : %d granted / %d total'
          % (len(granted), len(ALLOWED_FEATURE_PATHS)))
    print('  withheld : %d' % len(withheld))
    for p in withheld:
        print('      - %s' % p)
    return plan


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--child-subdomains', type=int, default=None)
    ap.add_argument('--child-domains', type=int, default=None)
    args = ap.parse_args()
    app = create_app()
    with app.app_context():
        ensure_larazen_plan(child_subdomains=args.child_subdomains,
                            child_domains=args.child_domains)


if __name__ == '__main__':
    main()
