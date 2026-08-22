"""Go-live QA seed — populate the DEFAULT tenant with 10s of every entity plus
rich, coherent data so the UI can be regression-tested before launch.

Idempotent and SECTION-ISOLATED: each section commits on its own and is wrapped
so one failure never aborts the rest. Re-running tops up toward the targets and
skips what already exists (matched by the ``qa.*@seed.test`` email pattern and a
``QA_SEED`` marker on generated appointments / records).

Creates / ensures, all in the default (localhost) tenant:
  * 12 clinics + 12 hospitals (mostly VERIFIED, a few PENDING) + EntityProfile
  * 15 rich patients (profile, address, emergency contact) + health records
  * ~15 doctors enriched to verified/live/approved with a fee + published slots
  * ~45 appointments across EVERY status, each with a linked Payment
  * prescriptions on completed appointments
  * healthy (future-dated) memberships on a subset

Run:
  docker compose exec -w /app -e PYTHONPATH=/app backend python scripts/seed_golive_qa.py
"""
import random
from datetime import date, time, timedelta

from app import create_app
from app.extensions import db
from app.common.tenant_context import with_background_tenant_context
from app.common.encryption import hash_for_search
from app.models import (
    Tenant, User, UserRole, UserStatus, UserVerificationStatus,
    Hospital, Clinic, Patient, Doctor, EntityProfile, EntityType,
    Appointment, Payment, HealthRecord, Prescription,
    TimeSlot, TimeSlotType,
)
from app.models._enums import (
    AppointmentStatus, AppointmentType, ConsultationType, PaymentStatus,
    AvailabilityApprovalStatus, BloodGroup, PrescriptionStatus,
    PublishStatus, AcceptanceMethod,
)
from app.models._base import utcnow

PW = 'Demo@1234'
FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Diya', 'Ananya', 'Ishaan', 'Kabir',
         'Meera', 'Riya', 'Arjun', 'Saanvi', 'Reyansh', 'Anaya', 'Vihaan',
         'Kiara', 'Rohan', 'Naina', 'Dev', 'Tara', 'Yash']
LAST = ['Sharma', 'Verma', 'Rao', 'Menon', 'Iyer', 'Gupta', 'Nair', 'Reddy',
        'Patel', 'Singh', 'Bose', 'Kulkarni']
CITIES = [('Bengaluru', 'Karnataka', '560001'), ('Mumbai', 'Maharashtra', '400001'),
          ('Chennai', 'Tamil Nadu', '600001'), ('Delhi', 'Delhi', '110001'),
          ('Pune', 'Maharashtra', '411001')]


def _log(msg):
    print(f'[qa-seed] {msg}')


def _phone(prefix4, i):
    """A deterministic, tenant-unique 10-digit phone: prefix + 00 + 4-digit i."""
    return f'{prefix4}00{i:04d}'


def _exists(email, tid):
    return User.query.filter_by(
        _email_hash=hash_for_search(email), tenant_id=tid, is_deleted=False).first()


def _mk_user(tid, email, phone, first, last, role):
    u = User(first_name=first, last_name=last, state='Karnataka', role=role,
             status=UserStatus.ACTIVE, tenant_id=tid, email_verified=True,
             phone_verified=True)
    u.email = email
    u.phone_number = phone
    u.set_password(PW)
    db.session.add(u)
    db.session.flush()
    return u


def _entity(tid, owner_kwargs, etype, name, legal, gst):
    db.session.add(EntityProfile(
        tenant_id=tid, entity_type=etype, entity_name=name, legal_name=legal,
        promoters=['Promoter One', 'Promoter Two'], year_of_establishment=2016,
        gst_number=gst, pan_number='AAAAA0000A',
        cin_number='U00000KA2016PTC000000',
        registration_license_number='REG-' + name[:8].upper().replace(' ', ''),
        **owner_kwargs,
    ))


# ─────────────────────────────────────────────────────────────────────────────
def seed_facilities(tid):
    """12 clinics + 12 hospitals. First ~9 VERIFIED+ACTIVE, rest PENDING (so the
    admin approval / holding-vendor screens have pending items too)."""
    made_c = made_h = 0
    for i in range(1, 13):
        verified = i <= 9
        vs = UserVerificationStatus.VERIFIED if verified else UserVerificationStatus.PENDING
        # Clinic
        cemail = f'qa.clinic{i:02d}@seed.test'
        if not _exists(cemail, tid):
            cu = _mk_user(tid, cemail, _phone('7100', i), f'Clinic{i:02d}', 'Admin', UserRole.CLINIC)
            city, st, pin = CITIES[i % len(CITIES)]
            c = Clinic(tenant_id=tid, admin_user_id=cu.id, name=f'QA Clinic {i:02d}',
                       registration_number=f'QCLIN-{i:03d}', address=f'{i} Health St',
                       city=city, state=st, pincode=pin, phone=_phone('7100', i),
                       email=cemail, verification_status=vs)
            db.session.add(c); db.session.flush()
            _entity(tid, dict(clinic_id=c.id), EntityType.PARTNERSHIP,
                    f'QA Clinic {i:02d}', f'QA Clinic {i:02d} LLP', f'29QCLIN{i:03d}A1Z5')
            made_c += 1
        # Hospital
        hemail = f'qa.hospital{i:02d}@seed.test'
        if not _exists(hemail, tid):
            hu = _mk_user(tid, hemail, _phone('7200', i), f'Hospital{i:02d}', 'Admin', UserRole.HOSPITAL)
            city, st, pin = CITIES[(i + 2) % len(CITIES)]
            h = Hospital(tenant_id=tid, admin_user_id=hu.id, name=f'QA Hospital {i:02d}',
                         registration_number=f'QHOSP-{i:03d}', address=f'{i} Care Ave',
                         city=city, state=st, pincode=pin, phone=_phone('7200', i),
                         email=hemail, verification_status=vs)
            db.session.add(h); db.session.flush()
            _entity(tid, dict(hospital_id=h.id), EntityType.PRIVATE_LIMITED,
                    f'QA Hospital {i:02d}', f'QA Hospital {i:02d} Pvt Ltd', f'29QHOSP{i:03d}A1Z5')
            made_h += 1
    db.session.commit()
    _log(f'facilities: +{made_c} clinics, +{made_h} hospitals')


# ─────────────────────────────────────────────────────────────────────────────
def seed_patients(tid, n=15):
    """n rich patients with profile + address + emergency contact."""
    made = 0
    created = []
    for i in range(1, n + 1):
        email = f'qa.patient{i:02d}@seed.test'
        u = _exists(email, tid)
        if u:
            p = Patient.query.filter_by(user_id=u.id).first()
            if p:
                created.append(p)
            continue
        first = FIRST[i % len(FIRST)]
        last = LAST[i % len(LAST)]
        u = _mk_user(tid, email, _phone('7300', i), first, last, UserRole.PATIENT)
        city, st, pin = CITIES[i % len(CITIES)]
        p = Patient(
            tenant_id=tid, user_id=u.id,
            blood_group=list(BloodGroup)[i % len(list(BloodGroup))],
            languages_known=['English', 'Hindi'],
            emergency_contact_name=f'{FIRST[(i + 1) % len(FIRST)]} {last}',
            emergency_contact_phone=_phone('7399', i),
            emergency_contact_relation='Spouse',
            address_details={'address_line1': f'{i} Residency Rd', 'city': city,
                             'state': st, 'pincode': pin, 'country': 'India'},
        )
        db.session.add(p); db.session.flush()
        created.append(p)
        made += 1
    db.session.commit()
    _log(f'patients: +{made} (total qa patients: {len(created)})')
    return created


# ─────────────────────────────────────────────────────────────────────────────
def seed_health_records(tid, patients):
    """2-3 health records per QA patient (skips patients that already have QA ones)."""
    types = [('blood_test', {'title': 'Complete Blood Count', 'result': 'Normal'}),
             ('vitals', {'title': 'Vitals', 'bp': '120/80', 'pulse': 72, 'temp': 98.6}),
             ('allergy', {'title': 'Allergy Profile', 'allergen': 'Penicillin'})]
    made = 0
    for p in patients:
        have = HealthRecord.query.filter_by(
            tenant_id=tid, patient_id=p.id, notes='QA_SEED').count()
        if have >= 2:
            continue
        for rt, details in types[:2 + (hash(str(p.id)) % 2)]:
            db.session.add(HealthRecord(
                tenant_id=tid, patient_id=p.id, uploaded_by=p.user_id,
                record_type=rt, record_date=date.today() - timedelta(days=random.randint(5, 120)),
                details=details, attachment_links=[], notes='QA_SEED'))
            made += 1
    db.session.commit()
    _log(f'health_records: +{made}')


# ─────────────────────────────────────────────────────────────────────────────
def enrich_doctors(tid, target=15):
    """Flip up to `target` doctors to verified/live/approved with a fee, and
    publish 14 days of slots for any of them that have none. Returns the
    bookable doctor list."""
    docs = (Doctor.query.filter_by(tenant_id=tid, is_deleted=False)
            .limit(target).all())
    fees = [300, 400, 500, 600, 750, 800]
    enriched = 0
    slotted = 0
    for idx, d in enumerate(docs):
        d.verification_status = UserVerificationStatus.VERIFIED
        # publish_status ACTIVE is the actual patient-booking visibility gate
        # (verified + publish ACTIVE); is_live/approval flags are doctor-side.
        d.publish_status = PublishStatus.ACTIVE
        d.is_live = True
        d.availability_approval_status = AvailabilityApprovalStatus.APPROVED
        d.slot_visibility_approval_status = AvailabilityApprovalStatus.APPROVED
        if not d.consultation_fee:
            d.consultation_fee = fees[idx % len(fees)]
        u = User.query.get(d.user_id) if d.user_id else None
        if u and u.status != UserStatus.ACTIVE:
            u.status = UserStatus.ACTIVE
        enriched += 1
        # Publish slots if the doctor has none.
        if d.time_slots.count() == 0:
            for dd in range(1, 15):
                day = date.today() + timedelta(days=dd)
                for h, ctype in [(10, ConsultationType.VIDEO), (11, ConsultationType.AUDIO),
                                 (15, ConsultationType.VIDEO)]:
                    ts = TimeSlot(tenant_id=tid, doctor_id=d.id, date=day,
                                  start_time=time(h, 0), end_time=time(h, 30), is_booked=False)
                    db.session.add(ts); db.session.flush()
                    db.session.add(TimeSlotType(tenant_id=tid, time_slot_id=ts.id,
                                                consultation_type=ctype))
            slotted += 1
    db.session.commit()
    _log(f'doctors: enriched {enriched}, published slots for {slotted}')
    return docs


# ─────────────────────────────────────────────────────────────────────────────
def seed_appointments(tid, doctors, patients, target=45):
    """Appointments across EVERY status with a linked Payment. Idempotent via a
    QA_SEED marker in notes; tops up toward `target`."""
    existing = Appointment.query.filter_by(tenant_id=tid, notes='QA_SEED', is_deleted=False).count()
    if existing >= target:
        _log(f'appointments: already {existing} (>= {target}), skipping')
        return
    if not doctors or not patients:
        _log('appointments: no doctors/patients, skipping')
        return

    # (status, in_past, doctor flags, payment status)
    plan = [
        (AppointmentStatus.PENDING_PAYMENT, False, {}, PaymentStatus.PENDING),
        (AppointmentStatus.PENDING, False, {}, PaymentStatus.SUCCESS),
        (AppointmentStatus.CONFIRMED, False, {'doctor_verified': True, 'doctor_accepted': True}, PaymentStatus.SUCCESS),
        (AppointmentStatus.COMPLETED, True, {'doctor_verified': True, 'doctor_accepted': True}, PaymentStatus.SUCCESS),
        (AppointmentStatus.CANCELLED, True, {'doctor_cancelled': True, 'doctor_cancelled_reason': 'QA cancel'}, PaymentStatus.REFUNDED),
        (AppointmentStatus.NO_SHOW, True, {'missed_by_patient': True}, PaymentStatus.SUCCESS),
        (AppointmentStatus.EXPIRED, True, {}, PaymentStatus.FAILED),
    ]
    ctypes = [ConsultationType.VIDEO, ConsultationType.AUDIO, ConsultationType.CHAT]
    made = 0
    completed_appts = []
    i = existing
    while i < target:
        status, in_past, flags, pay_status = plan[i % len(plan)]
        d = doctors[i % len(doctors)]
        p = patients[i % len(patients)]
        if in_past:
            appt_date = date.today() - timedelta(days=random.randint(1, 40))
        else:
            appt_date = date.today() + timedelta(days=random.randint(1, 12))
        fee = float(d.consultation_fee or 500)
        appt = Appointment(
            tenant_id=tid, patient_id=p.id, doctor_id=d.id,
            appointment_date=appt_date, start_time=time(10 + (i % 6), 0),
            end_time=time(10 + (i % 6), 30),
            appointment_type=AppointmentType.ONLINE,
            consultation_type=ctypes[i % len(ctypes)],
            status=status, consultation_fee=fee,
            chief_complaint='Routine consultation (QA)', notes='QA_SEED',
            **flags,
        )
        if flags.get('doctor_accepted'):
            appt.doctor_accepted_at = utcnow()
            appt.acceptance_method = AcceptanceMethod.AUTO_APPROVED
        db.session.add(appt); db.session.flush()
        # Linked payment (skip a gateway id — offline QA data).
        db.session.add(Payment(
            tenant_id=tid, appointment_id=appt.id, user_id=p.user_id,
            amount=fee, currency='INR', payment_gateway='qa_seed',
            transaction_id=f'QA-{appt.id.hex[:12]}', status=pay_status))
        if status == AppointmentStatus.COMPLETED:
            completed_appts.append(appt)
        made += 1
        i += 1
    db.session.commit()
    _log(f'appointments: +{made} across all statuses')
    return completed_appts


# ─────────────────────────────────────────────────────────────────────────────
def seed_prescriptions(tid):
    """A finalized prescription on each completed QA appointment that lacks one."""
    completed = Appointment.query.filter_by(
        tenant_id=tid, notes='QA_SEED', status=AppointmentStatus.COMPLETED,
        is_deleted=False).all()
    made = 0
    for appt in completed:
        if Prescription.query.filter_by(tenant_id=tid, appointment_id=appt.id).first():
            continue
        db.session.add(Prescription(
            tenant_id=tid, appointment_id=appt.id, patient_id=appt.patient_id,
            doctor_id=appt.doctor_id, diagnosis='Viral fever',
            notes='Rest and hydration', instructions='Paracetamol 500mg TID x3d',
            doctors_advice='Follow up if symptoms persist',
            status=PrescriptionStatus.ACTIVE))
        made += 1
    db.session.commit()
    _log(f'prescriptions: +{made}')


# ─────────────────────────────────────────────────────────────────────────────
def seed_memberships(tid, patients):
    """Attach a healthy (future-dated) receiver membership to a few patients so
    the membership screens populate without a hold page."""
    from app.models import MembershipPlan, MembershipVertical, MembershipSubscriptionStatus
    from app.api.membership.service import MembershipSubscriptionService
    plan = (MembershipPlan.query.filter_by(tenant_id=tid, is_deleted=False)
            .join(MembershipPlan.vertical_plan_type)
            .filter_by(is_receiver=True).first())
    if not plan:
        _log('memberships: no receiver plan found, skipping')
        return
    made = 0
    for p in patients[:5]:
        sub = MembershipSubscriptionService.resolve_for_provider(
            tid, MembershipVertical.PATIENT, p.id)
        if not sub:
            sub = MembershipSubscriptionService.assign_plan_for_provider(
                tid, MembershipVertical.PATIENT, p.id, plan.id)
        sub.status = MembershipSubscriptionStatus.ACTIVE
        now = utcnow()
        sub.current_period_start = now
        sub.current_period_end = now + timedelta(days=365)
        sub.trial_ends_at = None
        made += 1
    db.session.commit()
    _log(f'memberships: {made} patients on "{plan.name}" (active, 1yr)')


# ─────────────────────────────────────────────────────────────────────────────
def main():
    app = create_app()
    t_id = None
    with app.app_context():
        t = Tenant.query.filter_by(is_default=True).first()
        if not t:
            raise SystemExit('no default tenant')
        t_id = str(t.id)

    with with_background_tenant_context(app, t_id):
        # patients / doctors feed later sections, so run inline and capture.
        patients = []
        docs = []
        try:
            seed_facilities(t_id)
        except Exception as e:
            db.session.rollback(); _log(f'ERROR facilities: {e!r}')
        try:
            patients = seed_patients(t_id, 15)
        except Exception as e:
            db.session.rollback(); _log(f'ERROR patients: {e!r}')
        try:
            seed_health_records(t_id, patients)
        except Exception as e:
            db.session.rollback(); _log(f'ERROR health_records: {e!r}')
        try:
            docs = enrich_doctors(t_id, 15)
        except Exception as e:
            db.session.rollback(); _log(f'ERROR doctors: {e!r}')
        try:
            # include some existing patients too for appointment variety
            all_patients = patients or Patient.query.filter_by(tenant_id=t_id, is_deleted=False).limit(20).all()
            seed_appointments(t_id, docs, all_patients, 45)
        except Exception as e:
            db.session.rollback(); _log(f'ERROR appointments: {e!r}')
        try:
            seed_prescriptions(t_id)
        except Exception as e:
            db.session.rollback(); _log(f'ERROR prescriptions: {e!r}')
        try:
            seed_memberships(t_id, patients)
        except Exception as e:
            db.session.rollback(); _log(f'ERROR memberships: {e!r}')

    print('\n' + '=' * 60)
    print(' GO-LIVE QA SEED COMPLETE')
    print('=' * 60)
    print(' Logins (password Demo@1234):')
    print('   Clinics : qa.clinic01..12@seed.test')
    print('   Hospitals: qa.hospital01..12@seed.test')
    print('   Patients: qa.patient01..15@seed.test')
    print('=' * 60)


if __name__ == '__main__':
    main()
