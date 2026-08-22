"""Both-joined gate on appointment completion.

Operator-reported gap: a doctor could accept an online appointment,
skip the video call entirely, and still write a prescription +
mark the appointment COMPLETED + push the prescription to the
patient — with no record that the consultation never happened.

Fix shape:
  * ``POST /api/video/join`` (VideoService.join_appointment) auto-
    stamps ``doctor_joined`` + ``doctor_joined_at`` for the doctor
    and ``patient_joined`` + ``patient_joined_at`` for the patient
    the moment they get a Twilio token. Idempotent — re-firing
    keeps the first join time.
  * ``AppointmentService.complete`` refuses to flip status to
    COMPLETED on an ONLINE appointment unless BOTH timestamps are
    set. IN_CLINIC appointments are exempt (the physical visit
    IS the join equivalent).

These tests pin both halves end-to-end through the service layer
without needing a Twilio token (we monkeypatch the token + room
helpers since the test env has no Twilio creds).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest

from app.extensions import db
from app.models import (
    Appointment, AppointmentStatus, AppointmentType, Doctor,
    Patient, Tenant, TenantStatus, User, UserRole, UserStatus,
)
from app.models._base import set_tenant_context


@pytest.fixture
def appt_setup(app, db_session):
    """Tenant + doctor (with User) + patient (with User) +
    CONFIRMED ONLINE appointment, dated TODAY at the current minute
    so the time-window check passes.
    """
    slug = f't{uuid.uuid4().hex[:6]}'
    t = Tenant(
        name=f'T {slug}', slug=slug,
        status=TenantStatus.ACTIVE, is_default=False,
    )
    db.session.add(t)
    db.session.commit()
    set_tenant_context(db.session, t.id)

    def _user(role):
        u = User(
            role=role, first_name=role.value.title(),
            last_name='Test', tenant_id=t.id,
            status=UserStatus.ACTIVE,
        )
        u.email = f'{role.value}_{uuid.uuid4().hex[:6]}@test.com'
        u.phone_number = f'9{uuid.uuid4().int % 1000000000:09d}'
        u.email_verified = True
        u.phone_verified = True
        u.set_password('Pwd123!')
        db.session.add(u)
        db.session.commit()
        return u

    doctor_user = _user(UserRole.DOCTOR)
    patient_user = _user(UserRole.PATIENT)

    doc = Doctor(
        tenant_id=t.id, user_id=doctor_user.id,
        aadhar_number=f'AAD-{uuid.uuid4().hex[:6]}',
        aadhar_attachment='s3://x',
        registration_number=f'MED-{uuid.uuid4().hex[:6]}',
        registration_certificate='s3://x',
    )
    pat = Patient(tenant_id=t.id, user_id=patient_user.id)
    db.session.add_all([doc, pat])
    db.session.commit()

    now = datetime.now()
    appt = Appointment(
        tenant_id=t.id,
        doctor_id=doc.id,
        patient_id=pat.id,
        appointment_type=AppointmentType.ONLINE,
        appointment_date=now.date(),
        start_time=time(now.hour, max(0, now.minute - 1)),
        end_time=time(min(23, now.hour + 1), now.minute),
        status=AppointmentStatus.CONFIRMED,
    )
    db.session.add(appt)
    db.session.commit()

    return {
        'tenant': t, 'doctor': doc, 'patient': pat,
        'doctor_user': doctor_user, 'patient_user': patient_user,
        'appointment': appt,
    }


class TestVideoJoinStampsAttendance:
    """``/api/video/join`` must record the joining party's attendance
    so the completion gate has something to check against."""

    def test_doctor_join_stamps_doctor_fields(
        self, app, db_session, appt_setup, monkeypatch,
    ):
        from app.api.common.video.service import VideoService
        # Twilio is not configured in test env — stub the two
        # network calls so join_appointment runs end-to-end.
        monkeypatch.setattr(
            VideoService, 'create_room', lambda *a, **kw: None,
        )
        monkeypatch.setattr(
            VideoService, 'generate_token', lambda *a, **kw: 'tok',
        )
        with app.test_request_context():
            VideoService.join_appointment(
                appointment_id=appt_setup['appointment'].id,
                current_user=appt_setup['doctor_user'],
            )
        db.session.refresh(appt_setup['appointment'])
        assert appt_setup['appointment'].doctor_joined is True
        assert appt_setup['appointment'].doctor_joined_at is not None
        # Patient hasn't joined yet — fields untouched.
        assert appt_setup['appointment'].patient_joined is False
        assert appt_setup['appointment'].patient_joined_at is None
        # Status flipped to IN_PROGRESS the moment one party joined.
        assert appt_setup['appointment'].status == (
            AppointmentStatus.IN_PROGRESS
        )

    def test_patient_join_stamps_patient_fields(
        self, app, db_session, appt_setup, monkeypatch,
    ):
        from app.api.common.video.service import VideoService
        monkeypatch.setattr(
            VideoService, 'create_room', lambda *a, **kw: None,
        )
        monkeypatch.setattr(
            VideoService, 'generate_token', lambda *a, **kw: 'tok',
        )
        with app.test_request_context():
            VideoService.join_appointment(
                appointment_id=appt_setup['appointment'].id,
                current_user=appt_setup['patient_user'],
            )
        db.session.refresh(appt_setup['appointment'])
        assert appt_setup['appointment'].patient_joined is True
        assert appt_setup['appointment'].patient_joined_at is not None
        assert appt_setup['appointment'].doctor_joined is False

    def test_idempotent_on_rejoin(
        self, app, db_session, appt_setup, monkeypatch,
    ):
        from app.api.common.video.service import VideoService
        monkeypatch.setattr(VideoService, 'create_room', lambda *a, **kw: None)
        monkeypatch.setattr(VideoService, 'generate_token', lambda *a, **kw: 'tok')
        with app.test_request_context():
            VideoService.join_appointment(
                appointment_id=appt_setup['appointment'].id,
                current_user=appt_setup['doctor_user'],
            )
            first_ts = appt_setup['appointment'].doctor_joined_at
            # Re-join — first timestamp wins.
            VideoService.join_appointment(
                appointment_id=appt_setup['appointment'].id,
                current_user=appt_setup['doctor_user'],
            )
        db.session.refresh(appt_setup['appointment'])
        assert appt_setup['appointment'].doctor_joined_at == first_ts


class TestCompletionBothJoinedGate:
    """``AppointmentService.complete`` must refuse an ONLINE
    appointment until BOTH parties have a joined_at timestamp."""

    def test_refuses_when_neither_joined(self, app, db_session, appt_setup):
        from app.api.common.appointment.service import AppointmentService
        with pytest.raises(ValueError, match='have not joined'):
            AppointmentService.complete(
                appointment_id=appt_setup['appointment'].id,
                doctor_user_id=appt_setup['doctor_user'].id,
            )

    def test_refuses_when_only_doctor_joined(
        self, app, db_session, appt_setup,
    ):
        from app.api.common.appointment.service import AppointmentService
        appt_setup['appointment'].doctor_joined = True
        appt_setup['appointment'].doctor_joined_at = (
            datetime.now(timezone.utc)
        )
        db.session.commit()
        with pytest.raises(ValueError, match='patient has not joined'):
            AppointmentService.complete(
                appointment_id=appt_setup['appointment'].id,
                doctor_user_id=appt_setup['doctor_user'].id,
            )

    def test_succeeds_when_both_joined(
        self, app, db_session, appt_setup,
    ):
        from app.api.common.appointment.service import AppointmentService
        now = datetime.now(timezone.utc)
        appt_setup['appointment'].doctor_joined = True
        appt_setup['appointment'].doctor_joined_at = now
        appt_setup['appointment'].patient_joined = True
        appt_setup['appointment'].patient_joined_at = now
        db.session.commit()
        result = AppointmentService.complete(
            appointment_id=appt_setup['appointment'].id,
            doctor_user_id=appt_setup['doctor_user'].id,
        )
        assert result.status == AppointmentStatus.COMPLETED

    def test_in_clinic_appointment_exempt_from_gate(
        self, app, db_session, appt_setup,
    ):
        """IN_CLINIC appointments don't have a video call to join;
        the physical visit IS the join equivalent. Gate must skip
        these — operator just marks complete after the consult."""
        from app.api.common.appointment.service import AppointmentService
        appt_setup['appointment'].appointment_type = (
            AppointmentType.IN_CLINIC
        )
        db.session.commit()
        # Neither joined_at set — would fail for ONLINE.
        result = AppointmentService.complete(
            appointment_id=appt_setup['appointment'].id,
            doctor_user_id=appt_setup['doctor_user'].id,
        )
        assert result.status == AppointmentStatus.COMPLETED
