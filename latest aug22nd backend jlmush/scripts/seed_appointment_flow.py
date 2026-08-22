"""Seed the platform tenant for END-TO-END appointment-flow testing.

Builds on top of ``scripts/seed_platform_users.py`` (which creates the
bare doctors/patients). This script makes a focused subset FLOW-READY and
lays down sample data across the whole journey:

    doctor publishes slots -> patient books -> admin/doctor approves ->
    consultation completes -> admin initiates payout

What it seeds (all in the default/platform tenant, all idempotent):

  * BillingConfig        — one active row (charges + GST + TDS) the payout
                           calculation reads.
  * Categories           — 6 specializations.
  * Doctors 01..06       — enriched to verified + active + live + approved,
                           with a primary VERIFIED bank account, 2 services,
                           a primary specialization, and a consultation fee.
                             - 01..04 also get 14 days of published slots.
                             - 05..06 are left slot-less ON PURPOSE so you
                               can test the "publish slots" step yourself.
                             - 01,02,03,05 auto-accept; 04,06 are manual
                               (so the accept/reject approval screen has data).
  * Sample appointments  — 5 across every state, with linked payments and
                           one already-created payout:
      A1  pending_payment   (doc01/pat01)  — awaiting payment
      A2  pending (manual)  (doc04/pat02)  — awaiting doctor accept/reject
      A3  confirmed (auto)  (doc02/pat03)  — upcoming, paid
      A4  completed         (doc03/pat04)  — paid, READY to initiate payout
      A5  completed         (doc01/pat05)  — paid, payout row already exists

Sample appointments use time_slot_id=NULL so they do NOT consume the
bookable published slots — those stay free for your own live booking test.

USAGE
-----
    docker compose exec backend python scripts/seed_appointment_flow.py

Prereq: run scripts/seed_platform_users.py first (creates doctor01..06 +
patient01..06). Safe to re-run; every step is guarded by a lookup.
"""
import os
import sys
from datetime import date, time, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

_PARENT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)


# ── Config ────────────────────────────────────────────────────────────

SLOT_DAYS = 14                       # publish this many days of slots
SLOT_STARTS = [time(10, 0), time(11, 30), time(15, 0)]
DEMO_TXN_GATEWAY = 'razorpay_test'

# Per-doctor plan: idx -> (accepting, fee, has_slots, specialization)
DOCTOR_PLAN = [
    (1, 'auto_accept', 600, True,  'Cardiology'),
    (2, 'auto_accept', 500, True,  'Dermatology'),
    (3, 'auto_accept', 700, True,  'Pediatrics'),
    (4, 'manual',      800, True,  'General Medicine'),
    (5, 'auto_accept', 550, False, 'Orthopedics'),
    (6, 'manual',      650, False, 'Gynecology'),
]
SPECIALIZATIONS = [p[4] for p in DOCTOR_PLAN]

_c = 0  # created counter for the summary
_s = 0  # skipped/existing counter


def created(msg):
    global _c
    _c += 1
    print(f'  [OK]  {msg}')


def skipped(msg):
    global _s
    _s += 1
    print(f'  [--]  {msg}')


def _compute_charge(charge_type, value, amount):
    """Mirror of app/api/admin/payout.py::_compute_charge."""
    value = Decimal(str(value or 0))
    if str(charge_type) == 'percentage':
        return (amount * value / Decimal('100')).quantize(Decimal('0.01'), ROUND_HALF_UP)
    return value.quantize(Decimal('0.01'), ROUND_HALF_UP)


def main():
    from app import create_app
    from app.extensions import db
    from flask import g
    from app.models._base import set_tenant_context
    from app.common.encryption import hash_for_search
    from app.models import (
        Tenant, User, Doctor, Patient, Category,
        DoctorQualificationSpecialization, DoctorService,
        ProfileBankAccount, TimeSlot, TimeSlotType,
        Appointment, Payment, BillingConfig, DoctorPayout,
        UserRole,
    )
    from app.models._enums import (
        UserVerificationStatus, PublishStatus, AvailabilityApprovalStatus,
        AcceptingAppointmentType, AppointmentType, AppointmentStatus,
        ConsultationType, PaymentStatus, PayoutStatus,
        DocumentVerificationStatus, ServiceName, AcceptanceMethod,
    )

    app = create_app()
    with app.app_context():
        tenant = Tenant.query.filter_by(is_default=True, is_deleted=False).first()
        if not tenant:
            print('[ERR] No default/platform tenant. Run scripts/migrate.py + '
                  'scripts/bootstrap_local.py first.')
            return 1
        g.tenant_id = tenant.id
        set_tenant_context(db.session, tenant.id)

        print('=' * 64)
        print(' Seeding APPOINTMENT FLOW into the platform tenant')
        print(f'   tenant = {tenant.slug}  ({tenant.id})')
        print('=' * 64)

        # ── helpers scoped to this tenant ─────────────────────────────
        def doctor_by_idx(idx):
            email = f'doctor{idx:02d}@platform-seed.test'
            u = User.query.filter_by(
                _email_hash=hash_for_search(email), tenant_id=tenant.id,
                is_deleted=False,
            ).first()
            if not u:
                return None
            return Doctor.query.filter_by(user_id=u.id, tenant_id=tenant.id).first()

        def patient_by_idx(idx):
            email = f'patient{idx:02d}@platform-seed.test'
            u = User.query.filter_by(
                _email_hash=hash_for_search(email), tenant_id=tenant.id,
                is_deleted=False,
            ).first()
            if not u:
                return None
            p = Patient.query.filter_by(user_id=u.id, tenant_id=tenant.id).first()
            return (p, u)

        # Pre-flight: the bare doctors/patients must exist.
        missing = [i for i, *_ in DOCTOR_PLAN if doctor_by_idx(i) is None]
        if missing:
            print(f'[ERR] doctor{missing} not found. Run '
                  'scripts/seed_platform_users.py first.')
            return 1

        # ── 1. BillingConfig (active) ─────────────────────────────────
        print('\n1. Billing config (payout charges / GST / TDS):')
        config = BillingConfig.query.filter_by(tenant_id=tenant.id, is_active=True).first()
        if config:
            skipped(f'active BillingConfig exists (id={config.id})')
        else:
            config = BillingConfig(
                tenant_id=tenant.id,
                charge1_name='Platform Fee', charge1_type='percentage', charge1_value=Decimal('10'),
                # charge2/charge3 keep model defaults (0). GST 9+9, TDS 10 by default.
                is_active=True,
            )
            db.session.add(config)
            db.session.commit()
            created(f'BillingConfig (Platform Fee 10%, GST 18%, TDS 10%)')

        # ── 2. Categories / specializations ───────────────────────────
        print('\n2. Specialization categories:')
        cats = {}
        for name in SPECIALIZATIONS:
            cat = Category.query.filter_by(tenant_id=tenant.id, name=name).first()
            if not cat:
                cat = Category(
                    tenant_id=tenant.id, name=name,
                    description=f'{name} specialization',
                    category_type='specialization', is_active=True,
                )
                db.session.add(cat)
                db.session.flush()
                created(f'category {name}')
            else:
                skipped(f'category {name}')
            cats[name] = cat
        db.session.commit()

        # ── 3. Enrich doctors ─────────────────────────────────────────
        print('\n3. Doctors (verify + activate + bank + services + slots):')
        doctors = {}
        for idx, accepting, fee, has_slots, spec in DOCTOR_PLAN:
            doc = doctor_by_idx(idx)
            doctors[idx] = doc
            accept_enum = (AcceptingAppointmentType.AUTO_ACCEPT
                           if accepting == 'auto_accept'
                           else AcceptingAppointmentType.MANUAL)

            # 3a. flip the doctor to a fully publishable state
            doc.verification_status = UserVerificationStatus.VERIFIED
            doc.publish_status = PublishStatus.ACTIVE
            doc.is_live = True
            doc.availability_approval_status = AvailabilityApprovalStatus.APPROVED
            doc.slot_visibility_approval_status = AvailabilityApprovalStatus.APPROVED
            doc.accepting_appointments = accept_enum
            doc.admin_allowed_appointment_modes = (
                ['manual', 'auto_accept'] if accepting == 'auto_accept' else ['manual']
            )
            doc.consultation_fee = Decimal(str(fee))
            doc.experience_years = doc.experience_years or (5 + idx)
            doc.languages_known = doc.languages_known or ['en', 'hi']
            print(f'  doctor{idx:02d}: {spec}, fee=Rs.{fee}, '
                  f'{accepting}, slots={"yes" if has_slots else "NO (publish-test)"}')

            # 3b. primary specialization
            link = DoctorQualificationSpecialization.query.filter_by(
                tenant_id=tenant.id, doctor_id=doc.id, category_id=cats[spec].id,
            ).first()
            if not link:
                db.session.add(DoctorQualificationSpecialization(
                    tenant_id=tenant.id, doctor_id=doc.id,
                    category_id=cats[spec].id, is_primary=True,
                ))
                created(f'  doctor{idx:02d} specialization {spec}')

            # 3c. services (online + instant)
            for svc_name, svc_price in (
                (ServiceName.ONLINE_CONSULTATION, fee),
                (ServiceName.INSTANT_CONSULTATION, fee + 100),
            ):
                svc = DoctorService.query.filter_by(
                    tenant_id=tenant.id, doctor_id=doc.id, service_name=svc_name,
                ).first()
                if not svc:
                    db.session.add(DoctorService(
                        tenant_id=tenant.id, doctor_id=doc.id,
                        service_name=svc_name, price=Decimal(str(svc_price)),
                        duration_minutes=30, is_available=True,
                    ))
                    created(f'  doctor{idx:02d} service {svc_name.value}')

            # 3d. primary VERIFIED bank account (order_index=0) for payouts
            bank = ProfileBankAccount.query.filter_by(
                tenant_id=tenant.id, doctor_id=doc.id, order_index=0,
            ).first()
            if not bank:
                db.session.add(ProfileBankAccount(
                    tenant_id=tenant.id, doctor_id=doc.id, order_index=0,
                    bank_name='HDFC Bank',
                    account_name=f'Doctor {idx:02d} Platform',
                    account_number=f'50100{idx:010d}'[:18],
                    ifsc_code='HDFC0001234', branch='MG Road',
                    passbook_verification_status=DocumentVerificationStatus.VERIFIED,
                    check_leaf_verification_status=DocumentVerificationStatus.VERIFIED,
                    bank_statement_verification_status=DocumentVerificationStatus.VERIFIED,
                    verification_status=DocumentVerificationStatus.VERIFIED,
                ))
                created(f'  doctor{idx:02d} primary bank account (verified)')

            db.session.commit()

            # 3e. publish slots for the doctors that should have them
            if has_slots:
                today = date.today()
                n_new = 0
                for d_off in range(SLOT_DAYS):
                    slot_date = today + timedelta(days=d_off)
                    for s_i, start in enumerate(SLOT_STARTS):
                        end = (datetime.combine(slot_date, start)
                               + timedelta(minutes=30)).time()
                        exists = TimeSlot.query.filter_by(
                            tenant_id=tenant.id, doctor_id=doc.id,
                            date=slot_date, start_time=start,
                        ).first()
                        if exists:
                            continue
                        slot = TimeSlot(
                            tenant_id=tenant.id, doctor_id=doc.id,
                            date=slot_date, start_time=start, end_time=end,
                            is_booked=False,
                        )
                        db.session.add(slot)
                        db.session.flush()
                        types = [ConsultationType.VIDEO]
                        if s_i % 2 == 0:
                            types.append(ConsultationType.AUDIO)
                        for ct in types:
                            db.session.add(TimeSlotType(
                                tenant_id=tenant.id, time_slot_id=slot.id,
                                consultation_type=ct,
                            ))
                        n_new += 1
                db.session.commit()
                if n_new:
                    created(f'  doctor{idx:02d} published {n_new} slots '
                            f'({SLOT_DAYS} days)')
                else:
                    skipped(f'  doctor{idx:02d} slots already present')

        # ── 4. Sample appointments across every state ─────────────────
        print('\n4. Sample appointments (whole-flow states):')
        # a super_admin to attribute the pre-made payout to (optional).
        admin_user = User.query.filter_by(
            _email_hash=hash_for_search('super_admin01@platform-seed.test'),
            tenant_id=tenant.id,
        ).first()

        # (tag, doc_idx, pat_idx, status, day_offset, pay, payout)
        PLAN = [
            ('A1-pending-payment', 1, 1, AppointmentStatus.PENDING_PAYMENT,  2, False, False),
            ('A2-manual-pending',  4, 2, AppointmentStatus.PENDING,          3, True,  False),
            ('A3-confirmed',       2, 3, AppointmentStatus.CONFIRMED,        4, True,  False),
            ('A4-completed-ready', 3, 4, AppointmentStatus.COMPLETED,       -2, True,  False),
            ('A5-completed-paid',  1, 5, AppointmentStatus.COMPLETED,       -5, True,  True),
        ]

        for tag, di, pi, status, day_off, pay, payout in PLAN:
            doc = doctors[di]
            pat_tuple = patient_by_idx(pi)
            if not pat_tuple or not pat_tuple[0]:
                skipped(f'{tag}: patient{pi:02d} missing, skipped')
                continue
            patient, pat_user = pat_tuple
            fee = Decimal(str({p[0]: p[2] for p in DOCTOR_PLAN}[di]))

            appt = Appointment.query.filter_by(
                tenant_id=tenant.id, doctor_id=doc.id, patient_id=patient.id,
                chief_complaint=tag,
            ).first()
            if appt:
                skipped(f'{tag}: appointment exists ({appt.status.value})')
            else:
                appt_date = date.today() + timedelta(days=day_off)
                is_completed = status == AppointmentStatus.COMPLETED
                is_confirmed = status == AppointmentStatus.CONFIRMED
                accepted = is_completed or is_confirmed
                appt = Appointment(
                    tenant_id=tenant.id, doctor_id=doc.id, patient_id=patient.id,
                    appointment_date=appt_date, start_time=time(10, 0), end_time=time(10, 30),
                    appointment_type=AppointmentType.ONLINE,
                    consultation_type=ConsultationType.VIDEO,
                    consultation_fee=fee, status=status,
                    chief_complaint=tag, notes='Seed sample appointment',
                    time_slot_id=None,  # do not consume bookable inventory
                    doctor_accepted=accepted,
                    doctor_accepted_at=(datetime.now(timezone.utc) if accepted else None),
                    acceptance_method=(AcceptanceMethod.AUTO_APPROVED if accepted else None),
                    doctor_verified=is_completed,
                    doctor_joined=is_completed,
                    patient_joined=is_completed,
                )
                db.session.add(appt)
                db.session.flush()
                created(f'{tag}: appointment ({status.value}) '
                        f'doc{di:02d}/pat{pi:02d} on {appt_date}')

            # payment
            payment = None
            if pay:
                txn = f'SEEDPAY-{tag}'
                payment = Payment.query.filter_by(
                    tenant_id=tenant.id, transaction_id=txn,
                ).first()
                if not payment:
                    payment = Payment(
                        tenant_id=tenant.id, appointment_id=appt.id,
                        user_id=pat_user.id, amount=fee, currency='INR',
                        payment_gateway=DEMO_TXN_GATEWAY, transaction_id=txn,
                        status=PaymentStatus.SUCCESS,
                        payment_date=datetime.now(timezone.utc),
                    )
                    db.session.add(payment)
                    db.session.flush()
                    created(f'{tag}: payment SUCCESS Rs.{fee}')
            db.session.commit()

            # pre-made payout (so the payout list screen has data)
            if payout and payment:
                existing_po = DoctorPayout.query.filter_by(
                    tenant_id=tenant.id, appointment_id=appt.id,
                ).first()
                if existing_po:
                    skipped(f'{tag}: payout exists ({existing_po.bill_number})')
                else:
                    bank = ProfileBankAccount.query.filter_by(
                        tenant_id=tenant.id, doctor_id=doc.id, order_index=0,
                    ).first()
                    amt = Decimal(str(payment.amount))
                    gst = (amt * (Decimal(str(config.cgst_rate))
                                  + Decimal(str(config.sgst_rate))) / Decimal('100')
                           ).quantize(Decimal('0.01'), ROUND_HALF_UP)
                    c1 = _compute_charge(config.charge1_type, config.charge1_value, amt)
                    c2 = _compute_charge(config.charge2_type, config.charge2_value, amt)
                    c3 = _compute_charge(config.charge3_type, config.charge3_value, amt)
                    total_charges = c1 + c2 + c3
                    net = amt - total_charges
                    tds = (net * Decimal(str(config.tds_rate)) / Decimal('100')
                           ).quantize(Decimal('0.01'), ROUND_HALF_UP)
                    payout_amount = net - tds
                    db.session.add(DoctorPayout(
                        tenant_id=tenant.id, doctor_id=doc.id, appointment_id=appt.id,
                        payment_id=payment.id, bill_number=f'SEEDPO-{tag}',
                        appointment_amount=Decimal(str(appt.consultation_fee or fee)),
                        payment_amount=amt, total_charges=total_charges,
                        taxes_gst=gst, tds_amount=tds, razorpay_fee=Decimal('0'),
                        payout_amount=payout_amount,
                        charge1_amount=c1, charge2_amount=c2, charge3_amount=c3,
                        bank_account_id=bank.id if bank else None,
                        status=PayoutStatus.PENDING,
                        consultation_type='video',
                        initiated_by_id=admin_user.id if admin_user else None,
                        initiated_at=datetime.now(timezone.utc),
                    ))
                    db.session.commit()
                    created(f'{tag}: payout SEEDPO-{tag} '
                            f'(payout_amount=Rs.{payout_amount})')

        # ── Summary ───────────────────────────────────────────────────
        print('\n' + '=' * 64)
        print(f'  created: {_c}   skipped/existing: {_s}')
        print('  tenant totals now:')
        for label, q in (
            ('categories',   Category.query.filter_by(tenant_id=tenant.id)),
            ('doctor_services', DoctorService.query.filter_by(tenant_id=tenant.id)),
            ('bank_accounts', ProfileBankAccount.query.filter_by(tenant_id=tenant.id)),
            ('time_slots',   TimeSlot.query.filter_by(tenant_id=tenant.id)),
            ('appointments', Appointment.query.filter_by(tenant_id=tenant.id)),
            ('payments',     Payment.query.filter_by(tenant_id=tenant.id)),
            ('payouts',      DoctorPayout.query.filter_by(tenant_id=tenant.id)),
        ):
            print(f'    {label:16}: {q.count()}')
        print('=' * 64)
        print('\nFlow-ready. Suggested test path:')
        print('  * Patient search: doctor01..04 have bookable VIDEO/AUDIO slots.')
        print('  * Publish-slots test: doctor05/06 have NO slots yet.')
        print('  * Manual approval: A2 (doctor04) is PENDING doctor accept/reject.')
        print('  * Payout initiate: A4 (doctor03) is COMPLETED + paid, bank verified.')
        print('  * Payout list: A5 (doctor01) already has payout SEEDPO0001.')
        print('  * All accounts password: Demo@1234')
        return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(2)
