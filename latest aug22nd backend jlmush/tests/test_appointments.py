"""
Tests for appointment endpoints.
"""
import pytest
import json
from tests.conftest import get_auth_headers


class TestAppointmentBooking:
    """Tests for appointment booking."""
    
    def test_book_appointment(self, app, client, sample_patient, sample_doctor, db_session):
        """Test patient can book an appointment.

        ``appointment_date`` + ``start_time`` are required now (422
        without them), and a past date is refused — book tomorrow.
        """
        from datetime import date, timedelta

        patient_user, _ = sample_patient
        _, doctor = sample_doctor

        headers = get_auth_headers(app, patient_user)

        response = client.post('/api/v1/appointment/',
            data=json.dumps({
                'doctor_id': str(doctor.id),
                'appointment_type': 'online',
                'appointment_date': (date.today() + timedelta(days=1)).isoformat(),
                'start_time': '10:00',
                'end_time': '10:15',
                'chief_complaint': 'Headache and fever'
            }),
            headers=headers
        )

        assert response.status_code in [200, 201]
        data = response.get_json()
        assert data.get('success') == True
        assert 'id' in data.get('data', {})
    
    def test_book_appointment_invalid_doctor(self, app, client, sample_patient, db_session):
        """Test booking fails with invalid doctor ID."""
        patient_user, _ = sample_patient
        
        headers = get_auth_headers(app, patient_user)
        
        response = client.post('/api/v1/appointment/',
            data=json.dumps({
                'doctor_id': '00000000-0000-0000-0000-000000000000',
                'appointment_type': 'online',
                'chief_complaint': 'Test'
            }),
            headers=headers
        )
        
        assert response.status_code == 404


class TestDoctorAppointmentActions:
    """Tests for doctor appointment actions."""
    
    def test_doctor_accept_appointment(self, app, client, sample_appointment, sample_doctor, db_session):
        """Test doctor can accept a pending appointment."""
        doctor_user, _ = sample_doctor
        appointment = sample_appointment
        
        headers = get_auth_headers(app, doctor_user)
        
        response = client.post(f'/api/v1/doctor/appointments/{appointment.id}/accept',
            headers=headers
        )
        
        assert response.status_code == 200
        data = response.get_json()
        assert data.get('success') == True
        assert data.get('data', {}).get('status') == 'confirmed'
    
    def test_doctor_reject_appointment(self, app, client, sample_appointment, sample_doctor, db_session):
        """Test doctor can reject a pending appointment.

        Rejection now runs the doctor-action approval matrix; with no
        override it queues a PendingDoctorAction instead of cancelling.
        Opt this doctor into auto mode via the production-configurable
        per-doctor override so the direct-cancel path is exercised.
        """
        from app.extensions import db as _db

        doctor_user, doctor = sample_doctor
        appointment = sample_appointment

        doctor.approval_action_modes = {'appointment_cancel': 'auto_accept'}
        _db.session.commit()

        headers = get_auth_headers(app, doctor_user)

        response = client.post(f'/api/v1/doctor/appointments/{appointment.id}/reject',
            headers=headers
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data.get('success') == True
        assert data.get('data', {}).get('status') == 'cancelled'
    
    def test_complete_appointment(self, app, client, sample_doctor, sample_patient, db_session):
        """Test doctor can complete a confirmed appointment.

        Reuses ``sample_patient`` (post-split shape: names on User,
        email/phone via encrypted setters) instead of hand-building a
        pre-split Patient; tenant_id passed explicitly — the autofill
        only fires in a request context.
        """
        import uuid as _uuid
        from datetime import date, datetime, time, timezone

        from app.extensions import db as _db
        from app.models import Appointment, AppointmentStatus, AppointmentType

        doctor_user, doctor = sample_doctor
        _, patient = sample_patient

        # ONLINE completion is gated on BOTH sides having joined the
        # call (no phantom consultations) — stamp the join timestamps
        # the /api/v1/video/join handler would have set.
        now = datetime.now(timezone.utc)
        appointment = Appointment(
            tenant_id=doctor.tenant_id,
            patient_id=patient.id,
            doctor_id=doctor.id,
            appointment_date=date.today(),
            start_time=time(10, 0),
            appointment_type=AppointmentType.ONLINE,
            status=AppointmentStatus.CONFIRMED,
            chief_complaint=f'complete-{_uuid.uuid4().hex[:6]}',
            doctor_joined_at=now,
            patient_joined_at=now,
        )
        _db.session.add(appointment)
        _db.session.commit()

        headers = get_auth_headers(app, doctor_user)

        response = client.post(f'/api/v1/doctor/appointments/{appointment.id}/complete',
            data=json.dumps({'notes': 'Patient doing well'}),
            headers=headers
        )

        assert response.status_code == 200


class TestPatientAppointments:
    """Tests for patient appointment views."""
    
    def test_get_upcoming_appointments(self, app, client, sample_patient, sample_appointment, db_session):
        """Test patient can view upcoming appointments."""
        patient_user, _ = sample_patient
        
        headers = get_auth_headers(app, patient_user)
        
        response = client.get('/api/v1/appointment/patient/upcoming',
            headers=headers
        )
        
        assert response.status_code == 200
        data = response.get_json()
        assert 'appointments' in data.get('data', {})
    
    def test_get_history_appointments(self, app, client, sample_patient, db_session):
        """Test patient can view appointment history."""
        patient_user, _ = sample_patient
        
        headers = get_auth_headers(app, patient_user)
        
        response = client.get('/api/v1/appointment/patient/history',
            headers=headers
        )
        
        assert response.status_code == 200
        data = response.get_json()
        assert 'appointments' in data.get('data', {})
        assert 'pagination' in data.get('data', {})
