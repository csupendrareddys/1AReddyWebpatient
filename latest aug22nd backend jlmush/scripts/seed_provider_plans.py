"""Throwaway: seed a few ACTIVE TenantProviderPlan rows into the default tenant
so /join (and the provider-plans admin) have data to show locally."""
from app import create_app
from app.extensions import db
from app.common.tenant_context import with_background_tenant_context
from app.models import TenantProviderPlan, MembershipVertical, MembershipPlanStatus

TID = '60f903af-61ac-4609-9f2c-08e379f9baed'  # default tenant (localhost)

PLANS = [
    ('DOCTOR', 'doc_starter', 'Doctor — Starter', 'For solo practitioners getting started', 499,
     ['Listing on the network', 'Up to 50 bookings / month', 'Email support'], 10),
    ('DOCTOR', 'doc_pro', 'Doctor — Pro', 'For busy independent practices', 999,
     ['Everything in Starter', 'Unlimited bookings', 'Priority support', 'Basic analytics'], 20),
    ('CLINIC', 'clinic_basic', 'Clinic — Basic', 'Small multi-doctor clinics', 1499,
     ['Up to 5 doctors', 'Shared patient records', 'Internal referrals'], 10),
    ('CLINIC', 'clinic_growth', 'Clinic — Growth', 'Growing clinics', 2999,
     ['Up to 20 doctors', 'Patient engagement tools', 'Analytics dashboard'], 20),
    ('HOSPITAL', 'hosp_standard', 'Hospital — Standard', 'Hospitals on the marketplace', 4999,
     ['Multi-department workflows', 'Integrated billing'], 10),
    ('HOSPITAL', 'hosp_enterprise', 'Hospital — Enterprise', 'Large hospital networks', 9999,
     ['Everything in Standard', 'Full ecosystem', 'Dedicated support'], 20),
]

app = create_app()
with with_background_tenant_context(app, TID):
    created = 0
    for vertical, code, name, desc, price, bullets, sort in PLANS:
        if TenantProviderPlan.query.filter_by(tenant_id=TID, code=code).first():
            print('skip existing', code)
            continue
        db.session.add(TenantProviderPlan(
            tenant_id=TID, code=code, name=name, description=desc,
            vertical=MembershipVertical[vertical],
            price_inr_monthly=price, trial_days=14,
            status=MembershipPlanStatus.ACTIVE,
            features={'bullets': bullets},
            sort_order=sort, authored_by='tenant',
        ))
        created += 1
        print('created', code)
    db.session.commit()
    print(f'done — created {created} plan(s)')
