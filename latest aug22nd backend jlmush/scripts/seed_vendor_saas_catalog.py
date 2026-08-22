"""Seed the SaaS vendor's sellable catalog: plan types + public plans.

Why this exists: after the vendor/customer split the only plans in the DB
were ``plan1`` (a bare starter row granting zero features) and
``larazen-ops`` (private, DRAFT, sized for one tenant). There were **no
``saas_plan_types`` rows at all**, so ``/api/public/plan-types`` returned
``[]`` and ``/api/public/plans`` 400'd with "Plan type is required" --
the vendor's own pricing page had nothing to sell and spun forever.

Two plan types, per the decision to sell to organisations AND solo
practitioners:

  * ``organization`` -- teams. Seats and provider-entity quotas scale.
  * ``individual``   -- one practitioner running their own practice.
    Deliberately NOT a crippled org plan: it drops multi-location,
    payouts and marketplace listings, which a solo user has no use for,
    and prices for one person.

Pricing here is a **starting point, not a decision**. Every number is
editable by the platform owner in the console (Plans admin) -- this
script only makes the funnel real. Change prices there, not by editing
and re-running this, or you will overwrite live edits.

Idempotent: re-running updates rows in place by ``code``.

    docker exec -w /app -e PYTHONPATH=/app jlmush-backend \\
        python scripts/seed_vendor_saas_catalog.py
"""
from decimal import Decimal

from app import create_app
from app.extensions import db
from app.models.plan import Plan, SAASPlanType
from app.models._enums import PlanStatus, OverLimitAction

from scripts.create_larazen_plan import build_feature_tree

PLAN_TYPES = [
    {
        'code': 'organization',
        'name': 'Organisations',
        'icon_key': 'business',
        'description': (
            'Clinics, hospitals, firms and agencies running a team on '
            'their own branded portal.'
        ),
        'is_receiver': False,
    },
    {
        'code': 'individual',
        'name': 'Individual practitioners',
        'icon_key': 'person',
        'description': (
            'One practitioner running their own practice, with their own '
            'subdomain and patient portal.'
        ),
        'is_receiver': False,
    },
]

# Feature bundles, smallest first. Each tier is a superset of the one
# before it so an upgrade never takes something away.
_CORE = [
    'patient.basic_info', 'patient.vitals', 'patient.health_records',
    'doctor.profile', 'doctor.calendar', 'doctor.pricing',
    'doctor.prescriptions',
    'consultation.in_person', 'consultation.video',
    'communication.email',
    'payments.razorpay',
    'domain.subdomain',
]
_GROWTH = _CORE + [
    'patient.documents', 'patient.family',
    'doctor.prescriptions_pdf', 'doctor.follow_up', 'doctor.attendance',
    'consultation.audio', 'consultation.chat',
    'communication.sms', 'communication.channel',
    'admin.manage_users', 'admin.landing_builder', 'admin.billing_config',
    'service.offer',
    'domain.custom_domain',
]
_SCALE = _GROWTH + [
    'patient.intake_forms',
    'doctor.analytics',
    'consultation.home_visit', 'consultation.camp',
    'admin.audit_logs', 'admin.field_approval', 'admin.page_configuration',
    'admin.invite_doctor', 'admin.invite_patient',
    'clinic.multi_location', 'organization.multi_location',
    'clinic.feedback', 'organization.feedback',
    'clinic.doctor_payouts', 'organization.doctor_payouts',
    'clinic.marketplace', 'organization.marketplace',
    'marketplace.doctor.listing', 'marketplace.clinic.listing',
    'marketplace.hospital.listing',
    'tenant.can_create_membership_doctor_plans',
    'tenant.can_create_membership_clinic_plans',
    'tenant.can_create_membership_hospital_plans',
    'group_offering.offer',
    'communication.scheduled_calls', 'communication.documents',
    'i18n.multi_language',
]

# A solo practitioner is one person: one super_admin seat, one provider,
# no sub-admins, one provider-entity (themselves). Not a "small org".
_SOLO = _CORE + [
    'patient.documents',
    'doctor.prescriptions_pdf', 'doctor.follow_up',
    'consultation.audio', 'consultation.chat',
    'communication.sms',
    'service.offer',
]

PLANS = [
    {
        'code': 'solo', 'name': 'Solo', 'plan_type': 'individual',
        'description': 'One practitioner, own subdomain and patient portal.',
        'price_monthly': '999', 'price_annual': '9990', 'trial_days': 14,
        'seats': dict(total=3, super_admin=1, sub_admin=0, provider=1),
        'entities': dict(doctors=1, clinics=0, hospitals=0),
        'features': _SOLO,
    },
    {
        'code': 'starter', 'name': 'Starter', 'plan_type': 'organization',
        'description': 'A small team getting online.',
        'price_monthly': '2999', 'price_annual': '29990', 'trial_days': 14,
        'seats': dict(total=15, super_admin=2, sub_admin=3, provider=10),
        'entities': dict(doctors=10, clinics=1, hospitals=0),
        'features': _CORE + ['admin.manage_users'],
    },
    {
        'code': 'growth', 'name': 'Growth', 'plan_type': 'organization',
        'description': 'Own domain, richer workflows, more of the team.',
        'price_monthly': '7999', 'price_annual': '79990', 'trial_days': 14,
        'seats': dict(total=45, super_admin=5, sub_admin=10, provider=30),
        'entities': dict(doctors=30, clinics=5, hospitals=2),
        'features': _GROWTH,
    },
    {
        'code': 'scale', 'name': 'Scale', 'plan_type': 'organization',
        'description': 'Multi-location, marketplace and payouts.',
        'price_monthly': '19999', 'price_annual': '199990', 'trial_days': 14,
        'seats': dict(total=150, super_admin=15, sub_admin=35, provider=100),
        'entities': dict(doctors=100, clinics=25, hospitals=15),
        'features': _SCALE,
    },
]


def main():
    app = create_app()
    with app.app_context():
        from app.api.pricing.service import ALLOWED_FEATURE_PATHS

        types_by_code = {}
        for spec in PLAN_TYPES:
            pt = SAASPlanType.query.filter_by(code=spec['code']).first()
            created = pt is None
            if created:
                pt = SAASPlanType(code=spec['code'])
                db.session.add(pt)
            pt.name = spec['name']
            pt.description = spec['description']
            pt.icon_key = spec['icon_key']
            pt.is_receiver = spec['is_receiver']
            db.session.flush()
            types_by_code[spec['code']] = pt
            print('%s plan type %s' % ('created' if created else 'updated',
                                       spec['code']))

        for spec in PLANS:
            paths = sorted(set(spec['features']))
            unknown = [p for p in paths if p not in ALLOWED_FEATURE_PATHS]
            if unknown:
                raise SystemExit('%s: unknown feature paths %s'
                                 % (spec['code'], unknown))

            seats, ents = spec['seats'], spec['entities']
            if seats['total'] < (seats['super_admin'] + seats['sub_admin']
                                 + seats['provider']):
                raise SystemExit('%s violates ck_plan_limits_sum' % spec['code'])

            plan = Plan.query.filter_by(code=spec['code'], owner_tenant_id=None).first()
            created = plan is None
            if created:
                plan = Plan(code=spec['code'])
                db.session.add(plan)

            plan.name = spec['name']
            plan.description = spec['description']
            plan.saas_plan_type_id = types_by_code[spec['plan_type']].id
            plan.status = PlanStatus.ACTIVE      # sellable
            plan.is_default = False
            plan.trial_days = spec['trial_days']
            plan.price_inr_monthly = Decimal(spec['price_monthly'])
            plan.price_inr_annual = Decimal(spec['price_annual'])
            # Keys MUST be ``price_inr_<period>`` -- the frontend reads
            # ``plan.pricing['price_inr_annual']`` etc. (planPricing.js).
            # The scalar price_inr_monthly/annual columns below are the
            # deprecated path and are not what the cards render.
            plan.pricing = {
                'price_inr_monthly': float(spec['price_monthly']),
                'price_inr_annual': float(spec['price_annual']),
            }
            plan.max_total_users = seats['total']
            plan.max_super_admins = seats['super_admin']
            plan.max_sub_admins = seats['sub_admin']
            plan.max_providers = seats['provider']
            plan.max_provider_doctors = ents['doctors']
            plan.max_provider_clinics = ents['clinics']
            plan.max_provider_hospitals = ents['hospitals']
            plan.over_limit_action = OverLimitAction.BLOCK_NEW
            plan.grace_period_days = 7
            plan.razorpay_supported = True
            plan.tenant_keys_allowed = False
            plan.features = build_feature_tree(paths)
            plan.usage_limits = plan.usage_limits or {}
            plan.default_addons = plan.default_addons or []

            print('%s plan %-9s type=%-12s seats=%-3d features=%d'
                  % ('created' if created else 'updated', spec['code'],
                     spec['plan_type'], seats['total'], len(paths)))

        db.session.commit()
        print('\ndone. Edit prices in the platform console, not this script.')


if __name__ == '__main__':
    main()
