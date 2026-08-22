"""Throwaway: seed the apex marketplace catalog (MembershipPlan, global /
not tenant-scoped) so /join at localhost (default/apex tenant) shows tiers."""
from app import create_app
from app.extensions import db
from app.models import MembershipPlan, MembershipVertical, MembershipTier, MembershipPlanStatus

# (vertical, tier, code, name, price_monthly, price_annual, bullets, featured)
PLANS = [
    ('DOCTOR', 'BASIC', 'doctor_basic', 'Doctor — Basic', 499, 4990,
     ['Marketplace listing', 'Up to 50 bookings / month', 'Email support'], False),
    ('DOCTOR', 'GROWTH', 'doctor_growth', 'Doctor — Growth', 999, 9990,
     ['Everything in Basic', 'Unlimited bookings', 'Priority support', 'Analytics'], True),
    ('DOCTOR', 'PRO', 'doctor_pro', 'Doctor — Pro', 1999, 19990,
     ['Everything in Growth', 'Featured placement', 'Dedicated onboarding'], False),

    ('CLINIC', 'BASIC', 'clinic_basic', 'Clinic — Basic', 1499, 14990,
     ['Up to 5 doctors', 'Shared records', 'Internal referrals'], False),
    ('CLINIC', 'GROWTH', 'clinic_growth', 'Clinic — Growth', 2999, 29990,
     ['Up to 20 doctors', 'Patient engagement', 'Analytics dashboard'], True),
    ('CLINIC', 'PRO', 'clinic_pro', 'Clinic — Pro', 4999, 49990,
     ['Unlimited doctors', 'Multi-branch', 'Dedicated support'], False),

    ('HOSPITAL', 'BASIC', 'hospital_basic', 'Hospital — Standard', 4999, 49990,
     ['Multi-department workflows', 'Integrated billing'], False),
    ('HOSPITAL', 'GROWTH', 'hospital_growth', 'Hospital — Advanced', 9999, 99990,
     ['Everything in Standard', 'Analytics suite', 'Priority support'], True),
    ('HOSPITAL', 'PRO', 'hospital_pro', 'Hospital — Enterprise', 19999, 199990,
     ['Full ecosystem', 'Custom integrations', 'Dedicated account manager'], False),
]

SORT = {'BASIC': 10, 'GROWTH': 20, 'PRO': 30}

app = create_app()
with app.app_context():
    created = 0
    for vertical, tier, code, name, pm, pa, bullets, featured in PLANS:
        if MembershipPlan.query.filter_by(code=code).first():
            print('skip existing', code)
            continue
        db.session.add(MembershipPlan(
            code=code, name=name, description=f'{name} marketplace membership',
            vertical=MembershipVertical[vertical],
            tier=MembershipTier[tier],
            price_inr_monthly=pm, price_inr_annual=pa, trial_days=14,
            status=MembershipPlanStatus.ACTIVE,
            is_featured=featured,
            commission_pct=10, platform_fee_inr=20,
            features={'bullets': bullets},
            sort_order=SORT[tier],
        ))
        created += 1
        print('created', code)
    db.session.commit()
    print(f'done — created {created} membership plan(s)')
