"""Throwaway: seed a hospital, a clinic, and a corporate patient — each with a
linked EntityProfile — into the default tenant so entity flows can be tested.
Login: <email> / Demo@1234 (all ACTIVE)."""
from app import create_app
from app.extensions import db
from app.common.tenant_context import with_background_tenant_context
from app.models import (
    User, UserRole, UserStatus, UserVerificationStatus,
    Hospital, Clinic, Patient, EntityProfile, EntityType,
)

PW = 'Demo@1234'

# The default tenant, resolved at run time. This was a hard-coded uuid, which
# is only ever right on the database it was captured from — everywhere else the
# insert dies on ``users_tenant_id_fkey`` because that tenant doesn't exist.
# The script's own docstring says "into the default tenant", so ask for it.
def _default_tenant_id():
    from app import create_app as _ca
    from app.models import Tenant
    _app = _ca()
    with _app.app_context():
        t = Tenant.query.filter_by(is_default=True).first()
        if t is None:
            raise SystemExit('no default tenant on this database')
        return str(t.id)


TID = _default_tenant_id()


def _mk_user(email, phone, first_name, role):
    u = User(first_name=first_name, state='Karnataka', role=role,
             status=UserStatus.ACTIVE, tenant_id=TID)
    u.email = email
    u.email_verified = True
    u.phone_number = phone
    u.phone_verified = True
    u.set_password(PW)
    db.session.add(u)
    db.session.flush()
    return u


def _entity(owner_kwargs, etype, name, legal, promoters, gst):
    db.session.add(EntityProfile(
        tenant_id=TID, entity_type=etype, entity_name=name, legal_name=legal,
        promoters=promoters, year_of_establishment=2015, gst_number=gst,
        pan_number='AAAAA0000A', cin_number='U00000KA2015PTC000000',
        registration_license_number='REG-' + name[:6].upper(),
        **owner_kwargs,
    ))


app = create_app()
with with_background_tenant_context(app, TID):
    from app.models.user import User as U
    from app.common.encryption import hash_for_search

    def exists(email):
        return U.query.filter_by(_email_hash=hash_for_search(email),
                                 tenant_id=TID, is_deleted=False).first()

    # ── Hospital (Private Limited) ────────────────────────────────
    if not exists('corp.hospital@seed.test'):
        hu = _mk_user('corp.hospital@seed.test', '9800000001', 'Apollo', UserRole.HOSPITAL)
        h = Hospital(tenant_id=TID, admin_user_id=hu.id, name='Apollo Health Pvt Ltd',
                     registration_number='HOSP-REG-001', address='1 MG Road', city='Bengaluru',
                     state='Karnataka', pincode='560001', phone='9800000001',
                     email='corp.hospital@seed.test', verification_status=UserVerificationStatus.PENDING)
        db.session.add(h); db.session.flush()
        _entity(dict(hospital_id=h.id), EntityType.PRIVATE_LIMITED,
                'Apollo Health Pvt Ltd', 'Apollo Health Private Limited', ['Dr. A Rao', 'Dr. B Menon'], '29AAAAA1111A1Z5')
        print('created hospital corp.hospital@seed.test')
    else:
        print('skip hospital (exists)')

    # ── Clinic (Partnership) ──────────────────────────────────────
    if not exists('corp.clinic@seed.test'):
        cu = _mk_user('corp.clinic@seed.test', '9800000002', 'CityCare', UserRole.CLINIC)
        c = Clinic(tenant_id=TID, admin_user_id=cu.id, name='City Care Clinic LLP',
                   registration_number='CLIN-REG-001', address='42 Residency Rd', city='Bengaluru',
                   state='Karnataka', pincode='560025', phone='9800000002',
                   email='corp.clinic@seed.test', verification_status=UserVerificationStatus.PENDING)
        db.session.add(c); db.session.flush()
        _entity(dict(clinic_id=c.id), EntityType.PARTNERSHIP,
                'City Care Clinic LLP', 'City Care Clinic LLP', ['P Sharma', 'R Gupta'], '29BBBBB2222B1Z5')
        print('created clinic corp.clinic@seed.test')
    else:
        print('skip clinic (exists)')

    # ── Corporate patient (Trust) ─────────────────────────────────
    if not exists('corp.patient@seed.test'):
        pu = _mk_user('corp.patient@seed.test', '9800000003', 'Wellness', UserRole.PATIENT)
        p = Patient(tenant_id=TID, user_id=pu.id)
        db.session.add(p); db.session.flush()
        _entity(dict(patient_id=p.id), EntityType.TRUST,
                'Wellness Trust', 'Wellness Charitable Trust', ['Trustee One', 'Trustee Two'], '29CCCCC3333C1Z5')
        print('created corporate patient corp.patient@seed.test')
    else:
        print('skip patient (exists)')

    db.session.commit()
    print('done — login with <email> / Demo@1234')
