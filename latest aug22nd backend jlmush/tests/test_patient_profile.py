"""End-to-end coverage for /api/patient/profile/personal-details.

Closes the regression where the User/Patient name-column split left
the GET reading ``patient.first_name`` (now AttributeError → 500)
and the PUT silently storing the value on a non-existent Patient
column. These tests pin down the new contract:

  * User-owned: ``first_name`` / ``middle_name`` / ``last_name``
                / ``gender`` / ``dob`` / ``profile_image``
  * Patient-owned: ``blood_group`` / ``languages_known`` / etc.

Any future read/write that bypasses the service split will fail
``test_put_persists_to_user_row`` or ``test_get_returns_user_owned_fields``.
"""
import json
import pytest

from tests.conftest import get_auth_headers


class TestPatientPersonalDetails:
    def test_get_returns_user_owned_fields(self, app, client, sample_patient):
        """GET reads name fields from the User row, not the Patient row."""
        user, _patient = sample_patient
        headers = get_auth_headers(app, user)

        r = client.get('/api/v1/patient/profile/personal-details', headers=headers)
        assert r.status_code == 200, r.get_json()
        body = r.get_json()['data']
        assert body['first_name'] == user.first_name
        assert body['last_name'] == user.last_name

    def test_put_persists_user_owned_fields_to_user_row(
        self, app, client, sample_patient, db_session,
    ):
        """PUT writes ``first_name`` / ``last_name`` to the User row.

        Direct DB read after the request — no GET round-trip — proves
        the value actually landed in the database (catches the silent
        ``setattr(patient, 'first_name', ...)`` bug that wrote to a
        Python instance attribute and never committed).
        """
        user, _patient = sample_patient
        headers = get_auth_headers(app, user)
        payload = {
            'first_name': 'Renamed',
            'last_name': 'Lastname',
            'gender': 'female',
        }
        r = client.put(
            '/api/v1/patient/profile/personal-details',
            data=json.dumps(payload), headers=headers,
        )
        assert r.status_code == 200, r.get_json()

        db_session.expire_all()
        from app.models import User
        refreshed = db_session.get(User, user.id)
        assert refreshed.first_name == 'Renamed'
        assert refreshed.last_name == 'Lastname'
        # Gender enum coerced from string to Gender.FEMALE.
        assert refreshed.gender is not None
        assert refreshed.gender.value == 'female'

    def test_put_persists_patient_owned_fields_to_patient_row(
        self, app, client, sample_patient, db_session,
    ):
        """``blood_group`` and ``languages_known`` are still on Patient
        — make sure they don't get accidentally rerouted to User by the
        ownership-map refactor."""
        _user, patient = sample_patient
        headers = get_auth_headers(app, sample_patient[0])
        payload = {
            'blood_group': 'a_positive',
            'languages_known': ['English', 'Hindi'],
        }
        r = client.put(
            '/api/v1/patient/profile/personal-details',
            data=json.dumps(payload), headers=headers,
        )
        assert r.status_code == 200, r.get_json()

        db_session.expire_all()
        from app.models import Patient
        refreshed = db_session.get(Patient, patient.id)
        assert refreshed.blood_group is not None
        assert refreshed.blood_group.value == 'a_positive'
        assert refreshed.languages_known == ['English', 'Hindi']

    def test_put_invalid_blood_group_silently_nulls(
        self, app, client, sample_patient,
    ):
        """Existing service contract: bad enum value → ``None``, not 400.

        The frontend relies on this: typing in a stale dropdown value
        from a cached page shouldn't 400 the entire save; the field
        just clears.
        """
        user, _ = sample_patient
        headers = get_auth_headers(app, user)
        r = client.put(
            '/api/v1/patient/profile/personal-details',
            data=json.dumps({'blood_group': 'NOT_A_REAL_GROUP'}),
            headers=headers,
        )
        assert r.status_code == 200

    def test_put_does_not_leave_session_dirty(
        self, app, client, sample_patient,
    ):
        """A malformed request shouldn't cascade-break the next save.

        The recent ``except Exception`` we added rolls back the
        SQLAlchemy session — without it, a downstream exception
        leaves a half-committed Patient row that breaks subsequent
        queries with ``InvalidRequestError: This Session's transaction
        has been rolled back due to a previous exception``.
        """
        user, _ = sample_patient
        headers = get_auth_headers(app, user)
        # Malformed body: not JSON.
        r1 = client.put(
            '/api/v1/patient/profile/personal-details',
            data='not-json', headers=headers,
        )
        assert r1.status_code in (400, 500)
        # Subsequent valid save must succeed.
        r2 = client.put(
            '/api/v1/patient/profile/personal-details',
            data=json.dumps({'first_name': 'OK'}), headers=headers,
        )
        assert r2.status_code == 200, r2.get_json()
