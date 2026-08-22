"""
Tests for prescription endpoints.

Rewritten for the role-scoped surface: the legacy standalone
``/api/v1/prescription/*`` blueprint is gone — creation/update live
under ``/api/v1/doctor/*`` and patient reads under ``/api/v1/patient/*``.
Fixtures follow the post-split schema (names on User, encrypted
email/phone setters, explicit tenant_id — the autofill only fires in a
request context) and the persisted-test-DB rule (unique values per run).
"""
import json
import uuid

import pytest

from tests.conftest import get_auth_headers


def _make_patient(doctor, tag):
    """Post-split patient pair scoped to the doctor's tenant."""
    from app.extensions import db
    from app.models import Patient, User, UserRole

    patient_user = User(
        role=UserRole.PATIENT,
        first_name=tag.title(),
        last_name='Patient',
        email_verified=True,
        tenant_id=doctor.tenant_id,
    )
    patient_user.email = f'{tag}_{uuid.uuid4().hex[:8]}@test.com'
    patient_user.phone_number = f'9{uuid.uuid4().int % 1_000_000_000:09d}'
    patient_user.set_password('TestPass123!')
    db.session.add(patient_user)
    db.session.flush()

    patient = Patient(user_id=patient_user.id, tenant_id=doctor.tenant_id)
    db.session.add(patient)
    db.session.flush()
    return patient_user, patient


class TestPrescriptionCreation:
    """Tests for prescription creation by doctors."""

    def test_create_prescription(self, app, client, sample_doctor, db_session):
        """Doctor creates a prescription on a completed appointment."""
        from datetime import date, time

        from app.extensions import db
        from app.models import Appointment, AppointmentStatus, AppointmentType

        doctor_user, doctor = sample_doctor
        _, patient = _make_patient(doctor, 'rx')

        appointment = Appointment(
            tenant_id=doctor.tenant_id,
            patient_id=patient.id,
            doctor_id=doctor.id,
            appointment_date=date.today(),
            start_time=time(10, 0),
            appointment_type=AppointmentType.ONLINE,
            status=AppointmentStatus.COMPLETED,
        )
        db.session.add(appointment)
        db.session.commit()

        headers = get_auth_headers(app, doctor_user)

        response = client.post(
            f'/api/v1/doctor/appointments/{appointment.id}/prescription',
            data=json.dumps({
                'diagnosis': 'Common cold',
                'notes': 'Rest and hydration recommended',
                'medicines': [
                    {
                        'custom_generic_name': 'Paracetamol',
                        'custom_brand_name': 'Paracetamol 500mg',
                        'dosage': '1 tablet',
                        'frequency': '3 times a day',
                        'duration': '5 days',
                        'special_instructions': 'Take after meals',
                    }
                ],
            }),
            headers=headers,
        )

        assert response.status_code == 200, response.get_json()
        data = response.get_json()
        assert data.get('success') is True
        assert 'id' in data.get('data', {})
        assert len(data['data'].get('medicines', [])) >= 1

    def test_create_prescription_invalid_appointment(
        self, app, client, sample_doctor, db_session,
    ):
        """Unknown appointment id → genuine 404 from the lookup."""
        doctor_user, _ = sample_doctor
        headers = get_auth_headers(app, doctor_user)

        response = client.post(
            '/api/v1/doctor/appointments/'
            '00000000-0000-0000-0000-000000000000/prescription',
            data=json.dumps({'diagnosis': 'Test'}),
            headers=headers,
        )

        assert response.status_code == 404


class TestAddMedicine:
    """Medicines are replaced wholesale via the doctor update route —
    the old add-one-medicine POST is gone."""

    def test_add_medicine_to_prescription(
        self, app, client, sample_doctor, db_session,
    ):
        from app.extensions import db
        from app.models import Prescription

        doctor_user, doctor = sample_doctor
        _, patient = _make_patient(doctor, 'med')

        prescription = Prescription(
            tenant_id=doctor.tenant_id,
            doctor_id=doctor.id,
            patient_id=patient.id,
            diagnosis='Test diagnosis',
        )
        db.session.add(prescription)
        db.session.commit()

        headers = get_auth_headers(app, doctor_user)

        response = client.put(
            f'/api/v1/doctor/prescriptions/{prescription.id}',
            data=json.dumps({
                'medicines': [
                    {
                        'custom_generic_name': 'Ibuprofen',
                        'custom_brand_name': 'Ibuprofen 400mg',
                        'dosage': '1 tablet',
                        'frequency': '2 times a day',
                        'duration': '3 days',
                    }
                ],
            }),
            headers=headers,
        )

        assert response.status_code == 200, response.get_json()
        data = response.get_json()
        assert data.get('success') is True
        assert len(data.get('data', {}).get('medicines', [])) == 1


class TestPatientPrescriptions:
    """Tests for patient prescription views."""

    def test_patient_view_prescriptions(
        self, app, client, sample_patient, db_session,
    ):
        patient_user, _ = sample_patient
        headers = get_auth_headers(app, patient_user)

        response = client.get('/api/v1/patient/prescriptions',
                              headers=headers)

        assert response.status_code == 200
        data = response.get_json()
        assert 'prescriptions' in data.get('data', {})

    def test_patient_view_prescription_details(
        self, app, client, sample_patient, sample_doctor, sample_appointment,
        db_session,
    ):
        """Patient reads prescriptions through the appointment surface —
        no standalone by-prescription-id GET exists anymore."""
        from app.extensions import db
        from app.models import Prescription

        patient_user, patient = sample_patient
        _, doctor = sample_doctor
        appointment = sample_appointment

        prescription = Prescription(
            tenant_id=doctor.tenant_id,
            doctor_id=doctor.id,
            patient_id=patient.id,
            appointment_id=appointment.id,
            diagnosis='Test diagnosis for view',
        )
        db.session.add(prescription)
        db.session.commit()

        headers = get_auth_headers(app, patient_user)

        response = client.get(
            f'/api/v1/patient/appointments/{appointment.id}/prescriptions',
            headers=headers,
        )

        assert response.status_code == 200
        rx_list = response.get_json()['data']['prescriptions']
        assert rx_list, 'expected at least the prescription just created'
        rx = rx_list[0]
        assert rx['diagnosis'] == 'Test diagnosis for view'
        assert 'medicines' in rx
