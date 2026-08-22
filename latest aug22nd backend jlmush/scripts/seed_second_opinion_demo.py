"""Seed a MEETING-READY second-opinion / family-doctor commission demo.

Story (all in the platform tenant, all idempotent):

  * doctor01  — the FAMILY DOCTOR (empanelling doctor). Earns second-opinion
                health credits when their empanelled patient books with ANY
                OTHER doctor.
  * patient04 — the empanelled patient, linked to doctor01.
  * doctor02 / doctor03 — OTHER doctors. patient04's completed bookings with
                them generate second-opinion commission for doctor01.

What it lays down:
  1. A CreditPolicy on doctor01's active plan with per-type flat + % rates
     (so the "lower of flat vs % of cost" rule is visible in the numbers).
  2. An active FamilyDoctorLink  patient04 -> doctor01.
  3. Two COMPLETED consultations (doctor02 fee 800, doctor03 fee 1200), each
     with an APPROVED final prescription (diagnosis + medicines).
  4. One COMPLETED service order (doctor02, ₹1500).
  5. The three second-opinion credit awards to doctor01:
        consultation 800  -> min(flat 60, 5% = 40)  = 40
        consultation 1200 -> min(flat 60, 5% = 60)  = 60
        service      1500 -> min(flat 50, 4% = 60)  = 50
        -------------------------------------------------
        doctor01 wallet                              = 150 credits
  6. A partial redeem-to-cash (100 credits -> ₹100 DoctorPayout,
     source_type='second_opinion') leaving a 50-credit balance.

USAGE
-----
    docker compose exec backend python scripts/seed_second_opinion_demo.py

Prereq: scripts/seed_platform_users.py + scripts/seed_appointment_flow.py
(so doctor01..03 / patient04 exist and are verified/active). Safe to re-run.
All accounts password: Demo@1234
"""
import os
import sys
from datetime import date, time, datetime, timedelta, timezone
from decimal import Decimal

_PARENT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)


# Per-type second-opinion rates for the demo (flat credits, % of cost).
POLICY = {
    'default_flat': 50, 'default_pct': 5, 'threshold': 100,
    'grants': {'consultation': 60, 'service': 50, 'group': 60},
    'pcts':   {'consultation': 5,  'service': 4,  'group': 5},
}
REDEEM_CREDITS = 100

_c = 0


def ok(msg):
    global _c
    _c += 1
    print(f'  [OK]  {msg}')


def skip(msg):
    print(f'  [--]  {msg}')


def main():
    from app import create_app
    from app.extensions import db
    from flask import g
    from app.models._base import set_tenant_context, utcnow
    from app.common.encryption import hash_for_search
    from app.models import (
        Tenant, User, Doctor, Patient, CreditPolicy,
        MembershipSubscription, MembershipVertical, MembershipSubscriptionStatus,
        FamilyDoctorLink, Appointment, Prescription, PrescriptionMedicine,
        DoctorProduct, DoctorMarketplaceProduct, MarketplaceOrder,
        HealthCreditWallet, HealthCreditLedger, DoctorPayout,
    )
    from app.models._enums import (
        UserVerificationStatus, PublishStatus, AppointmentType,
        AppointmentStatus, ConsultationType, AcceptanceMethod,
        PrescriptionStatus,
    )
    from app.api.family_doctor.credit_service import award_for_booking, resolve_threshold
    from app.api.admin.payout import _generate_bill_number
    from app.api.common.payment.billing_service import apply_hold

    app = create_app()
    with app.app_context():
        tenant = Tenant.query.filter_by(is_default=True, is_deleted=False).first()
        if not tenant:
            print('[ERR] No default/platform tenant.')
            return 1
        g.tenant_id = tenant.id
        set_tenant_context(db.session, tenant.id)

        print('=' * 64)
        print(' Seeding SECOND-OPINION / FAMILY-DOCTOR COMMISSION demo')
        print(f'   tenant = {tenant.slug}  ({tenant.id})')
        print('=' * 64)

        def doctor_by_idx(idx):
            u = User.query.filter_by(
                _email_hash=hash_for_search(f'doctor{idx:02d}@platform-seed.test'),
                tenant_id=tenant.id, is_deleted=False).first()
            return Doctor.query.filter_by(user_id=u.id, tenant_id=tenant.id).first() if u else None

        def patient_by_idx(idx):
            u = User.query.filter_by(
                _email_hash=hash_for_search(f'patient{idx:02d}@platform-seed.test'),
                tenant_id=tenant.id, is_deleted=False).first()
            if not u:
                return None, None
            return Patient.query.filter_by(user_id=u.id, tenant_id=tenant.id).first(), u

        fam = doctor_by_idx(1)          # family doctor (earns credits)
        d2 = doctor_by_idx(2)           # other doctor
        d3 = doctor_by_idx(3)           # other doctor
        patient, pat_user = patient_by_idx(4)
        if not all([fam, d2, d3, patient]):
            print('[ERR] doctor01..03 / patient04 missing. Run '
                  'seed_platform_users.py + seed_appointment_flow.py first.')
            return 1

        # Make sure the three doctors are publishable (in case the flow seed
        # didn't run) — cheap idempotent flips.
        for d in (fam, d2, d3):
            d.verification_status = UserVerificationStatus.VERIFIED
            d.publish_status = PublishStatus.ACTIVE
            d.is_live = True
        db.session.commit()

        # ── 1. CreditPolicy on doctor01's active plan ─────────────────
        print('\n1. Credit policy on the family doctor\'s plan:')
        sub = (MembershipSubscription.query
               .filter(MembershipSubscription.tenant_id == tenant.id,
                       MembershipSubscription.provider_type == MembershipVertical.DOCTOR,
                       MembershipSubscription.provider_id == fam.id,
                       MembershipSubscription.is_deleted.is_(False),
                       MembershipSubscription.status.in_([
                           MembershipSubscriptionStatus.ACTIVE,
                           MembershipSubscriptionStatus.TRIAL]))
               .order_by(MembershipSubscription.created_at.desc())
               .first())
        if not sub or not sub.membership_plan_id:
            print('[ERR] doctor01 has no active/trial DOCTOR subscription.')
            return 1
        cp = CreditPolicy.query.filter_by(tenant_id=tenant.id, plan_id=sub.membership_plan_id).first()
        if not cp:
            cp = CreditPolicy(tenant_id=tenant.id, plan_id=sub.membership_plan_id)
            db.session.add(cp)
        cp.is_active = True
        cp.second_opinion_grant = POLICY['default_flat']
        cp.second_opinion_pct = POLICY['default_pct']
        cp.second_opinion_redeem_threshold = POLICY['threshold']
        cp.second_opinion_grants = dict(POLICY['grants'])
        cp.second_opinion_pcts = dict(POLICY['pcts'])
        db.session.commit()
        ok(f'policy set — flat {POLICY["grants"]}, pct {POLICY["pcts"]}, '
           f'threshold {POLICY["threshold"]} (lower-of-two applies)')

        # ── 2. Family doctor link  patient04 -> doctor01 ──────────────
        print('\n2. Family-doctor link (patient04 -> doctor01):')
        link = FamilyDoctorLink.query.filter_by(
            tenant_id=tenant.id, patient_id=patient.id, is_active=True).first()
        if link and str(link.doctor_id) != str(fam.id):
            link.is_active = False   # retire a link to a different doctor
            db.session.flush()
            link = None
        if not link:
            link = FamilyDoctorLink(
                tenant_id=tenant.id, patient_id=patient.id, doctor_id=fam.id,
                linked_via='doctor', is_active=True)
            db.session.add(link)
            db.session.commit()
            ok('linked patient04 to family doctor doctor01')
        else:
            skip('link already active')

        # ── 3. Two completed consultations + final prescriptions ──────
        print('\n3. Completed consultations with final prescriptions:')

        def seed_consult(provider, fee, tag, diagnosis, meds):
            appt = Appointment.query.filter_by(
                tenant_id=tenant.id, doctor_id=provider.id,
                patient_id=patient.id, chief_complaint=tag).first()
            if not appt:
                appt_date = date.today() - timedelta(days=6)
                appt = Appointment(
                    tenant_id=tenant.id, doctor_id=provider.id, patient_id=patient.id,
                    appointment_date=appt_date, start_time=time(11, 0), end_time=time(11, 30),
                    appointment_type=AppointmentType.ONLINE,
                    consultation_type=ConsultationType.VIDEO,
                    consultation_fee=Decimal(str(fee)),
                    status=AppointmentStatus.COMPLETED,
                    chief_complaint=tag, notes='Second-opinion demo consultation',
                    time_slot_id=None, doctor_accepted=True,
                    doctor_accepted_at=datetime.now(timezone.utc),
                    acceptance_method=AcceptanceMethod.AUTO_APPROVED,
                    doctor_verified=True, doctor_joined=True, patient_joined=True)
                db.session.add(appt)
                db.session.flush()
                ok(f'{tag}: completed consult (fee Rs.{fee})')
            else:
                skip(f'{tag}: consult exists')
            rx = Prescription.query.filter_by(
                tenant_id=tenant.id, appointment_id=appt.id).first()
            if not rx:
                rx = Prescription(
                    tenant_id=tenant.id, appointment_id=appt.id,
                    patient_id=patient.id, doctor_id=provider.id,
                    diagnosis=diagnosis, notes='Final prescription (demo).',
                    doctors_advice='Rest, hydration, follow up in 2 weeks.',
                    status=PrescriptionStatus.APPROVED)
                db.session.add(rx)
                db.session.flush()
                for i, (name, dosage, freq, dur) in enumerate(meds, start=1):
                    db.session.add(PrescriptionMedicine(
                        tenant_id=tenant.id, prescription_id=rx.id,
                        custom_brand_name=name, dosage=dosage, frequency=freq,
                        duration=dur, serial_no=i))
                db.session.commit()
                ok(f'{tag}: final prescription ({len(meds)} medicines)')
            else:
                skip(f'{tag}: prescription exists')
            return appt

        a2 = seed_consult(
            d2, 800, 'SO-DEMO consult (doctor02)',
            'Seasonal allergic rhinitis',
            [('Levocetirizine 5mg', '1 tablet', 'Once daily (night)', '7 days'),
             ('Montelukast 10mg', '1 tablet', 'Once daily', '14 days')])
        a3 = seed_consult(
            d3, 1200, 'SO-DEMO consult (doctor03)',
            'Vitamin D deficiency; mild anemia',
            [('Cholecalciferol 60k IU', '1 sachet', 'Once weekly', '8 weeks'),
             ('Ferrous ascorbate', '1 tablet', 'Once daily', '30 days')])

        # ── 4. One completed service order (doctor02) ─────────────────
        print('\n4. Completed service order (doctor02, Rs.1500):')
        prod = DoctorProduct.query.filter_by(
            tenant_id=tenant.id, name='SO-DEMO Diet & Lifestyle Plan').first()
        if not prod:
            prod = DoctorProduct(
                tenant_id=tenant.id, name='SO-DEMO Diet & Lifestyle Plan',
                description='4-week personalised diet & lifestyle plan (demo).',
                min_price=Decimal('1000'), max_price=Decimal('2000'),
                is_active=True, is_group_service=False)
            db.session.add(prod)
            db.session.flush()
            ok('created demo service product')
        listing = DoctorMarketplaceProduct.query.filter_by(
            tenant_id=tenant.id, doctor_id=d2.id, product_id=prod.id).first()
        if not listing:
            listing = DoctorMarketplaceProduct(
                tenant_id=tenant.id, doctor_id=d2.id, product_id=prod.id,
                doctor_price=Decimal('1500'),
                doctor_description='Diet & lifestyle plan by doctor02 (demo).',
                is_active=True, approval_status='approved')
            db.session.add(listing)
            db.session.flush()
            ok('listed service for doctor02')
        order = MarketplaceOrder.query.filter_by(
            tenant_id=tenant.id, doctor_id=d2.id, patient_id=patient.id,
            product_id=prod.id).first()
        if not order:
            order = MarketplaceOrder(
                tenant_id=tenant.id, patient_id=patient.id, doctor_id=d2.id,
                product_id=prod.id, price_at_purchase=Decimal('1500'),
                status='completed', doctor_notes='Second-opinion demo service order.')
            db.session.add(order)
            db.session.flush()
            ok('completed service order (Rs.1500)')
        else:
            order.status = 'completed'
            skip('service order exists (ensured completed)')
        db.session.commit()

        # ── 5. Second-opinion credit awards to doctor01 ───────────────
        print('\n5. Second-opinion credit awards to doctor01 (idempotent):')
        award_for_booking(tenant.id, patient.id, d2.id, 'appointment', a2.id,
                          label='Second opinion — consultation',
                          amount=float(a2.consultation_fee or 0))
        award_for_booking(tenant.id, patient.id, d3.id, 'appointment', a3.id,
                          label='Second opinion — consultation',
                          amount=float(a3.consultation_fee or 0))
        award_for_booking(tenant.id, patient.id, d2.id, 'order', order.id,
                          label='Second opinion — service',
                          amount=float(order.price_at_purchase or 0))
        db.session.commit()
        wallet = HealthCreditWallet.query.filter_by(
            tenant_id=tenant.id, user_id=fam.user_id).first()
        bal = float(wallet.available(utcnow())) if wallet else 0.0
        ok(f'doctor01 second-opinion balance = {bal:g} credits '
           f'(expected 150: 40 + 60 + 50)')

        # ── 6. Partial redeem-to-cash → DoctorPayout ──────────────────
        print('\n6. Redeem-to-cash (partial):')
        existing_po = DoctorPayout.query.filter_by(
            tenant_id=tenant.id, doctor_id=fam.id, source_type='second_opinion').first()
        threshold = resolve_threshold(tenant.id, fam)
        if existing_po:
            skip(f'redemption payout already exists ({existing_po.bill_number})')
        elif wallet and bal >= max(threshold, REDEEM_CREDITS):
            amount = float(REDEEM_CREDITS)
            wallet.balance = float(wallet.balance) - amount
            ledger = HealthCreditLedger(
                tenant_id=tenant.id, wallet_id=wallet.id, user_id=fam.user_id,
                amount=-amount, kind='spend', ref_type='second_opinion_redeem',
                note='Redeemed to cash (demo)')
            db.session.add(ledger)
            db.session.flush()
            payout = DoctorPayout(
                tenant_id=tenant.id, doctor_id=fam.id, bill_number=_generate_bill_number(),
                source_type='second_opinion', source_ref_id=ledger.id,
                source_label='Second opinion credit redemption',
                payout_amount=Decimal(str(amount)), payout_mode='autopay')
            apply_hold(payout, fam)
            db.session.add(payout)
            db.session.commit()
            ok(f'redeemed {amount:g} credits -> payout {payout.bill_number} '
               f'(Rs.{amount:g}); balance now {float(wallet.balance):g}')
        else:
            skip(f'balance {bal:g} < threshold {threshold:g}; no redemption')

        # ── Summary ───────────────────────────────────────────────────
        print('\n' + '=' * 64)
        print(f'  created/updated steps: {_c}')
        print('  Demo login (all Demo@1234):')
        print('    family doctor : doctor01@platform-seed.test')
        print('    patient       : patient04@platform-seed.test')
        print('    other doctors : doctor02 / doctor03@platform-seed.test')
        print('    admin         : super_admin01@platform-seed.test')
        print('  Where to look:')
        print('    * Doctor > Panel Patients: patient04 empanelled; open bookings')
        print('      to see the two consults + service + final prescriptions.')
        print('    * Doctor > My Bills > Second Opinion: 150 credits, ₹100 redeemed.')
        print('    * Admin > Payout Management > Second Opinion: the ₹100 payout.')
        print('    * Admin > Membership > Health Credits: per-type flat + % rates.')
        print('=' * 64)
        return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(2)
