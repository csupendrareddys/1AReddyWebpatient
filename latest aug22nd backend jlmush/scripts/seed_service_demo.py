"""Seed the 'missing' demo flows so a patient + doctor can actually SEE and use:
  (1) a viewable PRESCRIPTION (completed appointment + ACTIVE prescription),
  (2) a joinable CALL appointment (CONFIRMED video, ~now, with a meeting link),
  (3) SERVICE CHATS — a ServiceChannel (via ActivationService.activate) with a
      couple of chat messages AND a provider-scheduled call.

Idempotent: appointments tagged notes 'SVC_DEMO'; channels are idempotent per
(product, patient, provider); messages/calls skipped if the channel already has
them. Reuses an existing comm-enabled DoctorProduct.

Run:
  docker compose exec -w /app -e PYTHONPATH=/app backend python scripts/seed_service_demo.py
"""
from datetime import timedelta, time as dtime, datetime, timezone

from app import create_app
from app.extensions import db
from app.common.tenant_context import with_background_tenant_context
from app.common.encryption import hash_for_search
from app.models import (
    Tenant, User, Patient, Doctor, Appointment, Payment, Prescription,
    ServiceChannel, ChannelParticipant, ChannelMessage, ScheduledCall,
    DoctorProduct, ServiceCommunicationConfig,
)
from app.models._enums import (
    AppointmentStatus, AppointmentType, ConsultationType, PaymentStatus,
    PrescriptionStatus, AcceptanceMethod, ChannelMessageKind,
    ScheduledCallMode, ScheduledCallStatus, ChannelParticipantRole,
)
from app.models._base import utcnow

# (patient email, doctor email)
PAIRS = [
    ('patient04@platform-seed.test', 'doctor01@platform-seed.test'),
    ('qa.patient01@seed.test', 'doctor01@platform-seed.test'),
]


def _log(m):
    print(f'[svc-demo] {m}')


def _by_email(email):
    return User.query.filter_by(_email_hash=hash_for_search(email)).first()


def _now():
    return datetime.now(timezone.utc)


def seed_prescription_appt(tid, patient, doctor):
    """A COMPLETED appointment with a finalized (ACTIVE) prescription."""
    existing = Appointment.query.filter_by(
        tenant_id=tid, patient_id=patient.id, doctor_id=doctor.id,
        notes='SVC_DEMO_RX', is_deleted=False).first()
    if existing:
        return
    fee = float(doctor.consultation_fee or 500)
    appt = Appointment(
        tenant_id=tid, patient_id=patient.id, doctor_id=doctor.id,
        appointment_date=(_now() - timedelta(days=3)).date(),
        start_time=dtime(11, 0), end_time=dtime(11, 30),
        appointment_type=AppointmentType.ONLINE, consultation_type=ConsultationType.VIDEO,
        status=AppointmentStatus.COMPLETED, consultation_fee=fee,
        doctor_verified=True, doctor_accepted=True, doctor_accepted_at=utcnow(),
        acceptance_method=AcceptanceMethod.AUTO_APPROVED,
        chief_complaint='Follow-up (demo)', notes='SVC_DEMO_RX')
    db.session.add(appt)
    db.session.flush()
    db.session.add(Payment(
        tenant_id=tid, appointment_id=appt.id, user_id=patient.user_id,
        amount=fee, currency='INR', payment_gateway='svc_demo',
        transaction_id=f'RX-{appt.id.hex[:12]}', status=PaymentStatus.SUCCESS))
    db.session.add(Prescription(
        tenant_id=tid, appointment_id=appt.id, patient_id=patient.id,
        doctor_id=doctor.id, diagnosis='Seasonal allergic rhinitis',
        notes='Avoid dust exposure; steam inhalation twice daily.',
        instructions='Cetirizine 10mg once at night x5 days. Saline nasal spray PRN.',
        doctors_advice='Return if breathlessness or fever develops.',
        status=PrescriptionStatus.ACTIVE))
    db.session.commit()
    _log(f'  prescription appt for {patient.id} (doctor {doctor.id})')


def seed_call_appt(tid, patient, doctor):
    """A CONFIRMED video appointment starting ~now, with a meeting link, so the
    'Join call' affordance appears for both patient and doctor."""
    existing = Appointment.query.filter_by(
        tenant_id=tid, patient_id=patient.id, doctor_id=doctor.id,
        notes='SVC_DEMO_CALL', is_deleted=False).first()
    if existing:
        return
    now = _now()
    fee = float(doctor.consultation_fee or 500)
    appt = Appointment(
        tenant_id=tid, patient_id=patient.id, doctor_id=doctor.id,
        appointment_date=now.date(),
        start_time=(now - timedelta(minutes=5)).time().replace(second=0, microsecond=0),
        end_time=(now + timedelta(minutes=25)).time().replace(second=0, microsecond=0),
        appointment_type=AppointmentType.ONLINE, consultation_type=ConsultationType.VIDEO,
        status=AppointmentStatus.CONFIRMED, consultation_fee=fee,
        doctor_verified=True, doctor_accepted=True, doctor_accepted_at=utcnow(),
        acceptance_method=AcceptanceMethod.AUTO_APPROVED,
        meeting_link=f'https://meet.jlmush.local/room/{patient.id.hex[:10]}',
        chief_complaint='Video consultation (demo)', notes='SVC_DEMO_CALL')
    db.session.add(appt)
    db.session.flush()
    db.session.add(Payment(
        tenant_id=tid, appointment_id=appt.id, user_id=patient.user_id,
        amount=fee, currency='INR', payment_gateway='svc_demo',
        transaction_id=f'CALL-{appt.id.hex[:12]}', status=PaymentStatus.SUCCESS))
    db.session.commit()
    _log(f'  joinable call appt for {patient.id} (now, meeting link set)')


def seed_service_chat(tid, patient, doctor, product, actor_id):
    """A service channel (via the real activation service) + 2 chat messages +
    a provider-scheduled call."""
    from app.api.service_communication.service import ActivationService
    purchase, channel, created = ActivationService.activate(
        product_id=product.id, patient_id=patient.id,
        provider_type='doctor', provider_id=doctor.id,
        tenant_id=tid, actor_id=actor_id)
    if channel is None:
        _log('  (activate returned no channel — skipped)')
        return
    # Participants: one PATIENT, one PROVIDER.
    parts = ChannelParticipant.query.filter_by(
        tenant_id=tid, channel_id=channel.id, is_deleted=False).all()
    pat_part = next((p for p in parts if p.role == ChannelParticipantRole.PATIENT), None)
    prov_part = next((p for p in parts if p.role == ChannelParticipantRole.PROVIDER), None)

    if ChannelMessage.query.filter_by(channel_id=channel.id, is_deleted=False).count() == 0:
        msgs = [
            (prov_part, 'Welcome! I’ve reviewed your intake. Let’s start with a 3-day food diary.'),
            (pat_part, 'Thank you, doctor. I’ll upload it tonight. Is dairy okay in the mornings?'),
            (prov_part, 'Yes, in moderation. I’ll schedule a video check-in for next week.'),
        ]
        for part, body in msgs:
            if part is None:
                continue
            db.session.add(ChannelMessage(
                tenant_id=tid, channel_id=channel.id,
                sender_participant_id=part.id, kind=ChannelMessageKind.TEXT,
                body=body))
        _log('  +3 chat messages')

    if ScheduledCall.query.filter_by(channel_id=channel.id, is_deleted=False).count() == 0 and prov_part:
        start = _now() + timedelta(days=2)
        db.session.add(ScheduledCall(
            tenant_id=tid, channel_id=channel.id,
            created_by_participant_id=prov_part.id,
            mode=ScheduledCallMode.VIDEO, status=ScheduledCallStatus.SCHEDULED,
            scheduled_start=start, scheduled_end=start + timedelta(minutes=30)))
        _log('  +1 scheduled video call')
    db.session.commit()
    _log(f'  service channel {channel.id} ({"new" if created else "existing"}) ready')


def main():
    app = create_app()
    with app.app_context():
        t = Tenant.query.filter_by(is_default=True).first()
        tid = str(t.id)
    with with_background_tenant_context(app, tid):
        product = DoctorProduct.query.join(
            ServiceCommunicationConfig, ServiceCommunicationConfig.product_id == DoctorProduct.id
        ).filter(
            DoctorProduct.tenant_id == tid, DoctorProduct.is_deleted.is_(False),
            ServiceCommunicationConfig.is_enabled.is_(True),
            ServiceCommunicationConfig.is_deleted.is_(False),
        ).first()
        if not product:
            _log('No comm-enabled product found — cannot seed service chats.')
        admin = _by_email('super_admin01@platform-seed.test')
        actor_id = admin.id if admin else None

        for pemail, demail in PAIRS:
            pu, du = _by_email(pemail), _by_email(demail)
            if not pu or not du:
                _log(f'skip {pemail}/{demail} (missing user)')
                continue
            patient = Patient.query.filter_by(user_id=pu.id, tenant_id=tid).first()
            doctor = Doctor.query.filter_by(user_id=du.id, tenant_id=tid).first()
            if not patient or not doctor:
                _log(f'skip {pemail}/{demail} (missing profile)')
                continue
            _log(f'== {pemail} <-> {demail} ==')
            try:
                seed_prescription_appt(tid, patient, doctor)
            except Exception as e:
                db.session.rollback(); _log(f'  ERROR rx: {e!r}')
            try:
                seed_call_appt(tid, patient, doctor)
            except Exception as e:
                db.session.rollback(); _log(f'  ERROR call: {e!r}')
            if product:
                try:
                    seed_service_chat(tid, patient, doctor, product, actor_id)
                except Exception as e:
                    db.session.rollback(); _log(f'  ERROR chat: {e!r}')

    print('\n' + '=' * 58)
    print(' SERVICE DEMO SEEDED')
    print(' patient04@platform-seed.test / qa.patient01@seed.test (Demo@1234)')
    print(' doctor01@platform-seed.test — has the completed Rx, the joinable')
    print(' call, and the service chat too.')
    print('=' * 58)


if __name__ == '__main__':
    main()
