"""Reseed a fresh ON_HOLD payout so the admin Push button can be exercised in the UI."""
from datetime import datetime, timedelta, timezone
from app import create_app
from app.extensions import db
from flask import g
from app.models._base import set_tenant_context
from app.models import Tenant, DoctorPayout, PayoutStatus

DOCTOR = '34b8df45-5690-4ab8-9420-8e5812c4f45f'
BANK = '508434d7-1db5-444e-8262-2e16a718f581'

app = create_app()
with app.app_context():
    t = Tenant.query.filter_by(is_default=True).first()
    g.tenant_id = t.id
    set_tenant_context(db.session, t.id)

    src = DoctorPayout.query.filter_by(tenant_id=t.id, bill_number='CFCLAIM01').first()
    if not src:
        raise SystemExit('no template payout found')

    for bill, mode, matured in (('CFPUSH01', 'claim', True), ('CFPUSH02', 'claim', False)):
        p = DoctorPayout.query.filter_by(tenant_id=t.id, bill_number=bill).first()
        if not p:
            p = DoctorPayout(
                tenant_id=t.id, doctor_id=DOCTOR, bank_account_id=BANK,
                appointment_id=src.appointment_id, bill_number=bill,
                payment_amount=src.payment_amount, total_charges=src.total_charges,
                tds_amount=src.tds_amount, razorpay_fee=src.razorpay_fee,
                payout_amount=src.payout_amount, consultation_type=src.consultation_type,
            )
            db.session.add(p)
        p.status = PayoutStatus.ON_HOLD
        p.payout_mode = mode
        p.razorpay_transfer_id = None
        p.status_reason = None
        p.completed_at = None
        p.claim_requested_at = None
        p.claimed_by_id = None
        # One already matured (Push is the normal action), one still holding
        # (Push should read as an early release).
        p.hold_until = datetime.now(timezone.utc) + timedelta(days=-1 if matured else 5)

    db.session.commit()
    for p in DoctorPayout.query.filter(DoctorPayout.tenant_id == t.id,
                                       DoctorPayout.bill_number.in_(['CFPUSH01', 'CFPUSH02'])).all():
        print('  %-9s %-8s mode=%-6s hold_until=%s' % (p.bill_number, p.status.value, p.payout_mode, p.hold_until))
