"""Integration tests for the apex-marketplace doctor↔hospital
affiliation surface (Round 8 + 8.5).

Covers:

  * Doctor invite-code lifecycle — get / regenerate / revoke.
  * Hospital + clinic admin request-by-code → PENDING affiliation.
  * Doctor approve / reject → APPROVED / REJECTED.
  * Hospital + clinic admin invite-doctor — creates User+Doctor in
    pending-activation state, dispatches activation token.
  * Activation flow — lookup, set-password, send/verify email OTP,
    send/verify phone OTP. Final signin works with the password the
    doctor set.
  * Signin gates for invited doctors:
      - ``PENDING_ACTIVATION`` (must_set_password=True)
      - ``PHONE_NOT_VERIFIED``
    Both scoped to ``role == DOCTOR`` (patient anon-booking
    untouched).
  * Duplicate detection — re-inviting a user whose email or phone
    already exists returns a clear 400.
  * Polymorphic facility — hospital_id XOR clinic_id (CHECK
    constraint via the DB layer).

These mirror the existing tests/api/* style. They use the conftest
``app`` + ``db_session`` + ``get_auth_headers`` helpers.

Skipped cleanly when no Postgres is available.
"""
from __future__ import annotations

import uuid

import pytest


pytestmark = pytest.mark.skipif(
    not pytest.importorskip('psycopg2', reason='requires postgres') or False,
    reason='affiliation integration tests require a live Postgres',
)


# --------------------------------------------------------------------------- #
# Helpers / fixtures
# --------------------------------------------------------------------------- #

def _set_tenant(tenant_id):
    """Set RLS tenant context on the test session."""
    from app.extensions import db
    from app.models._base import set_tenant_context
    set_tenant_context(db.session, tenant_id)


def _platform_tenant():
    from app.models import Tenant
    t = Tenant.query.filter_by(is_default=True).first()
    assert t, 'session fixture must seed a default tenant'
    return t


def _make_user(*, role, first_name='Test', email=None, phone=None,
               phone_verified=True, email_verified=True,
               must_set_password=False, status=None, password='TestPass123!'):
    """Create a User in the platform tenant with the given role."""
    from app.extensions import db
    from app.models import User, UserRole, UserStatus

    t = _platform_tenant()
    _set_tenant(t.id)

    u = User(
        role=role,
        status=status or UserStatus.ACTIVE,
        first_name=first_name,
        last_name='User',
        state='Telangana',
        tenant_id=t.id,
        email_verified=email_verified,
        phone_verified=phone_verified,
        must_set_password=must_set_password,
    )
    u.email = email or f'{first_name.lower()}_{uuid.uuid4().hex[:8]}@test.com'
    u.phone_number = phone or f'9{uuid.uuid4().int % 1_000_000_000:09d}'
    u.set_password(password)
    db.session.add(u)
    db.session.commit()
    return u


def _make_doctor(user):
    from app.extensions import db
    from app.models import Doctor, UserVerificationStatus

    _set_tenant(user.tenant_id)
    d = Doctor(
        user_id=user.id, tenant_id=user.tenant_id,
        aadhar_number=f'{2_000_000_000_000 + uuid.uuid4().int % 1_000_000_000_000}',
        aadhar_attachment='/tmp/aadhar.pdf',
        registration_number=f'MCI-{uuid.uuid4().hex[:6].upper()}',
        registration_certificate='/tmp/reg.pdf',
        verification_status=UserVerificationStatus.VERIFIED,
    )
    db.session.add(d)
    db.session.commit()
    return d


def _make_hospital(admin_user):
    from app.extensions import db
    from app.models import Hospital, UserVerificationStatus
    _set_tenant(admin_user.tenant_id)
    h = Hospital(
        name=f'Test Hospital {uuid.uuid4().hex[:6]}',
        tenant_id=admin_user.tenant_id,
        address='123 Test St', city='Hyderabad', state='Telangana',
        pincode='500001', is_active=True,
        verification_status=UserVerificationStatus.VERIFIED,
        admin_user_id=admin_user.id,
    )
    db.session.add(h)
    db.session.commit()
    return h


def _make_clinic(admin_user):
    from app.extensions import db
    from app.models import Clinic, UserVerificationStatus
    _set_tenant(admin_user.tenant_id)
    c = Clinic(
        name=f'Test Clinic {uuid.uuid4().hex[:6]}',
        tenant_id=admin_user.tenant_id,
        address='456 Lotus Rd', city='Hyderabad', state='Telangana',
        pincode='500002', is_active=True,
        verification_status=UserVerificationStatus.VERIFIED,
        admin_user_id=admin_user.id,
    )
    db.session.add(c)
    db.session.commit()
    return c


# Each fixture returns the user_id (UUID). Tests / helpers re-attach
# the User in a fresh app_context so we don't trip
# ``DetachedInstanceError`` when accessing lazy-loaded attributes from
# outside the fixture's own context.
@pytest.fixture
def doctor_user_id(app, db_session):
    """A doctor User + Doctor row, ready to sign in. Returns user_id."""
    with app.app_context():
        from app.models import UserRole
        u = _make_user(role=UserRole.DOCTOR, first_name='Diya')
        _make_doctor(u)
        return u.id


@pytest.fixture
def hospital_admin_id(app, db_session):
    with app.app_context():
        from app.models import UserRole
        admin = _make_user(role=UserRole.HOSPITAL, first_name='Apollo')
        _make_hospital(admin)
        return admin.id


@pytest.fixture
def clinic_admin_id(app, db_session):
    with app.app_context():
        from app.models import UserRole
        admin = _make_user(role=UserRole.CLINIC, first_name='Lotus')
        _make_clinic(admin)
        return admin.id


def _auth(app, user_id):
    """Re-fetch the User by id, then mint auth headers."""
    from tests.conftest import get_auth_headers
    from app.models import User
    with app.app_context():
        u = User.query.get(user_id)
        return get_auth_headers(app, u)


# --------------------------------------------------------------------------- #
# Doctor: invite-code lifecycle
# --------------------------------------------------------------------------- #

def test_doctor_invite_code_get_returns_null_when_unset(app, client, doctor_user_id):
    headers = _auth(app, doctor_user_id)
    resp = client.get('/api/v1/affiliation/invite', headers=headers)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body['success'] is True
    assert body['data']['code'] is None


def test_doctor_invite_code_regenerate_then_get(app, client, doctor_user_id):
    headers = _auth(app, doctor_user_id)
    r1 = client.post('/api/v1/affiliation/invite/regenerate', headers=headers)
    assert r1.status_code == 200
    code = r1.get_json()['data']['code']
    assert code and len(code) >= 8

    r2 = client.get('/api/v1/affiliation/invite', headers=headers)
    assert r2.status_code == 200
    assert r2.get_json()['data']['code'] == code


def test_doctor_invite_code_revoke(app, client, doctor_user_id):
    headers = _auth(app, doctor_user_id)
    client.post('/api/v1/affiliation/invite/regenerate', headers=headers)

    r = client.delete('/api/v1/affiliation/invite', headers=headers)
    assert r.status_code == 200

    after = client.get('/api/v1/affiliation/invite', headers=headers)
    assert after.get_json()['data']['code'] is None


def test_invite_code_endpoints_require_doctor_role(app, client, hospital_admin_id):
    """Hospital admin can't generate a doctor invite code."""
    headers = _auth(app, hospital_admin_id)
    r = client.post('/api/v1/affiliation/invite/regenerate', headers=headers)
    assert r.status_code == 403


# --------------------------------------------------------------------------- #
# Facility admin: request-by-code path
# --------------------------------------------------------------------------- #

def test_hospital_request_by_code_creates_pending_affiliation(
    app, client, doctor_user_id, hospital_admin_id,
):
    # Doctor generates code
    code = client.post(
        '/api/v1/affiliation/invite/regenerate', headers=_auth(app, doctor_user_id),
    ).get_json()['data']['code']

    # Hospital admin submits the code
    r = client.post(
        '/api/v1/affiliation/facility/request-by-code',
        headers=_auth(app, hospital_admin_id),
        json={'code': code, 'employment_type': 'full_time'},
    )
    assert r.status_code == 200
    body = r.get_json()['data']
    assert body['status'] == 'pending'
    assert body['is_active'] is False
    assert body['facility_kind'] == 'hospital'
    assert body['request_method'] == 'code'


def test_clinic_request_by_code_creates_pending_affiliation(
    app, client, doctor_user_id, clinic_admin_id,
):
    """Round 8.5: clinic admins use the same surface."""
    code = client.post(
        '/api/v1/affiliation/invite/regenerate', headers=_auth(app, doctor_user_id),
    ).get_json()['data']['code']

    r = client.post(
        '/api/v1/affiliation/facility/request-by-code',
        headers=_auth(app, clinic_admin_id),
        json={'code': code, 'employment_type': 'consultant'},
    )
    assert r.status_code == 200
    body = r.get_json()['data']
    assert body['facility_kind'] == 'clinic'
    assert body['clinic_id'] is not None
    assert body['hospital_id'] is None


def test_request_by_code_unknown_code_rejected(app, client, hospital_admin_id):
    r = client.post(
        '/api/v1/affiliation/facility/request-by-code',
        headers=_auth(app, hospital_admin_id),
        json={'code': 'NOPE-XXX', 'employment_type': 'full_time'},
    )
    assert r.status_code == 400
    assert 'No doctor' in r.get_json()['error']


def test_request_by_code_empty_code_rejected(app, client, hospital_admin_id):
    r = client.post(
        '/api/v1/affiliation/facility/request-by-code',
        headers=_auth(app, hospital_admin_id),
        json={'code': '', 'employment_type': 'full_time'},
    )
    assert r.status_code == 400


def test_request_by_code_duplicate_returns_existing_pending(
    app, client, doctor_user_id, hospital_admin_id,
):
    code = client.post(
        '/api/v1/affiliation/invite/regenerate', headers=_auth(app, doctor_user_id),
    ).get_json()['data']['code']

    r1 = client.post(
        '/api/v1/affiliation/facility/request-by-code',
        headers=_auth(app, hospital_admin_id),
        json={'code': code, 'employment_type': 'full_time'},
    )
    r2 = client.post(
        '/api/v1/affiliation/facility/request-by-code',
        headers=_auth(app, hospital_admin_id),
        json={'code': code, 'employment_type': 'full_time'},
    )
    # Both return the same PENDING row
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.get_json()['data']['id'] == r2.get_json()['data']['id']


# --------------------------------------------------------------------------- #
# Doctor: approve / reject
# --------------------------------------------------------------------------- #

def test_doctor_approve_flips_to_active(
    app, client, doctor_user_id, hospital_admin_id,
):
    code = client.post(
        '/api/v1/affiliation/invite/regenerate', headers=_auth(app, doctor_user_id),
    ).get_json()['data']['code']
    request_id = client.post(
        '/api/v1/affiliation/facility/request-by-code',
        headers=_auth(app, hospital_admin_id),
        json={'code': code, 'employment_type': 'full_time'},
    ).get_json()['data']['id']

    r = client.post(
        f'/api/v1/affiliation/requests/{request_id}/approve',
        headers=_auth(app, doctor_user_id),
    )
    assert r.status_code == 200
    body = r.get_json()['data']
    assert body['status'] == 'approved'
    assert body['is_active'] is True
    assert body['responded_at']


def test_doctor_reject_with_reason(app, client, doctor_user_id, hospital_admin_id):
    code = client.post(
        '/api/v1/affiliation/invite/regenerate', headers=_auth(app, doctor_user_id),
    ).get_json()['data']['code']
    request_id = client.post(
        '/api/v1/affiliation/facility/request-by-code',
        headers=_auth(app, hospital_admin_id),
        json={'code': code, 'employment_type': 'full_time'},
    ).get_json()['data']['id']

    r = client.post(
        f'/api/v1/affiliation/requests/{request_id}/reject',
        headers=_auth(app, doctor_user_id),
        json={'reason': 'Not joining'},
    )
    assert r.status_code == 200
    body = r.get_json()['data']
    assert body['status'] == 'rejected'
    assert body['rejection_reason'] == 'Not joining'
    assert body['is_active'] is False


def test_already_approved_cant_be_re_approved(
    app, client, doctor_user_id, hospital_admin_id,
):
    code = client.post(
        '/api/v1/affiliation/invite/regenerate', headers=_auth(app, doctor_user_id),
    ).get_json()['data']['code']
    request_id = client.post(
        '/api/v1/affiliation/facility/request-by-code',
        headers=_auth(app, hospital_admin_id),
        json={'code': code, 'employment_type': 'full_time'},
    ).get_json()['data']['id']

    client.post(f'/api/v1/affiliation/requests/{request_id}/approve',
                headers=_auth(app, doctor_user_id))

    r = client.post(f'/api/v1/affiliation/requests/{request_id}/approve',
                    headers=_auth(app, doctor_user_id))
    assert r.status_code == 400


# --------------------------------------------------------------------------- #
# Facility admin: invite-doctor (no password, no OTP)
# --------------------------------------------------------------------------- #

def _invite_payload():
    """Minimal multipart payload mirroring what the frontend submits."""
    import io
    return {
        'first_name': 'Priya',
        'last_name': 'Sharma',
        'phone_number': f'9{uuid.uuid4().int % 1_000_000_000:09d}',
        'email': f'priya_{uuid.uuid4().hex[:8]}@test.com',
        'state': 'Telangana',
        'registration_number': f'MCI-{uuid.uuid4().hex[:6].upper()}',
        'aadhar_number': f'{2_000_000_000_000 + uuid.uuid4().int % 1_000_000_000_000}',
        'qualifications': '[]',
        'employment_type': 'full_time',
        'registration_certificate': (io.BytesIO(b'dummy'), 'reg.pdf'),
        'aadhar_attachment': (io.BytesIO(b'dummy'), 'aadhar.pdf'),
    }


def test_hospital_invite_doctor_creates_pending_account(
    app, client, hospital_admin_id,
):
    payload = _invite_payload()
    r = client.post(
        '/api/v1/affiliation/facility/doctors/invite',
        headers={'Authorization': _auth(app, hospital_admin_id)['Authorization']},
        data=payload, content_type='multipart/form-data',
    )
    assert r.status_code == 201, r.get_json()
    body = r.get_json()['data']
    assert body['user_id'] and body['doctor_id']
    assert body['affiliation']['status'] == 'approved'
    assert body['affiliation']['request_method'] == 'invite'
    assert body['activation_link'].startswith('http')
    assert 'token=' in body['activation_link']


def test_clinic_invite_doctor_works_too(app, client, clinic_admin_id):
    payload = _invite_payload()
    r = client.post(
        '/api/v1/affiliation/facility/doctors/invite',
        headers={'Authorization': _auth(app, clinic_admin_id)['Authorization']},
        data=payload, content_type='multipart/form-data',
    )
    assert r.status_code == 201
    aff = r.get_json()['data']['affiliation']
    assert aff['facility_kind'] == 'clinic'
    assert aff['clinic_id'] and not aff['hospital_id']


def _doctor_contact(app, doctor_user_id):
    """Re-fetch the doctor's email + phone (avoids DetachedInstanceError)."""
    from app.models import User
    with app.app_context():
        u = User.query.get(doctor_user_id)
        return u.email, u.phone_number


def test_invite_doctor_duplicate_email_rejected(
    app, client, hospital_admin_id, doctor_user_id,
):
    """Second invite with an existing user's email returns a clear 400."""
    email, _ = _doctor_contact(app, doctor_user_id)
    payload = _invite_payload()
    payload['email'] = email  # collide with existing doctor
    r = client.post(
        '/api/v1/affiliation/facility/doctors/invite',
        headers={'Authorization': _auth(app, hospital_admin_id)['Authorization']},
        data=payload, content_type='multipart/form-data',
    )
    assert r.status_code == 400
    assert 'email already exists' in r.get_json()['error'].lower()


def test_invite_doctor_duplicate_phone_rejected(
    app, client, hospital_admin_id, doctor_user_id,
):
    _, phone = _doctor_contact(app, doctor_user_id)
    payload = _invite_payload()
    payload['phone_number'] = phone
    r = client.post(
        '/api/v1/affiliation/facility/doctors/invite',
        headers={'Authorization': _auth(app, hospital_admin_id)['Authorization']},
        data=payload, content_type='multipart/form-data',
    )
    assert r.status_code == 400
    assert 'phone' in r.get_json()['error'].lower()


def test_invite_doctor_missing_required_field_rejected(
    app, client, hospital_admin_id,
):
    payload = _invite_payload()
    payload['first_name'] = ''
    r = client.post(
        '/api/v1/affiliation/facility/doctors/invite',
        headers={'Authorization': _auth(app, hospital_admin_id)['Authorization']},
        data=payload, content_type='multipart/form-data',
    )
    assert r.status_code == 400
    assert 'first name' in r.get_json()['error'].lower()


# --------------------------------------------------------------------------- #
# Activation flow
# --------------------------------------------------------------------------- #

def _activation_token_from_invite(client, app, hospital_admin_id):
    """Run an invite + return the activation token + payload it carried."""
    payload = _invite_payload()
    r = client.post(
        '/api/v1/affiliation/facility/doctors/invite',
        headers={'Authorization': _auth(app, hospital_admin_id)['Authorization']},
        data=payload, content_type='multipart/form-data',
    )
    assert r.status_code == 201, r.get_json()
    link = r.get_json()['data']['activation_link']
    return link.split('token=')[-1], payload


def test_activation_lookup_returns_identity_and_step_state(
    app, client, hospital_admin_id,
):
    token, payload = _activation_token_from_invite(client, app, hospital_admin_id)
    r = client.post('/api/v1/affiliation/activate/lookup', json={'token': token})
    assert r.status_code == 200
    body = r.get_json()['data']
    assert body['first_name'] == payload['first_name']
    assert body['must_set_password'] is True
    assert body['email_verified'] is False
    assert body['phone_verified'] is False


def test_activation_lookup_invalid_token(app, client):
    r = client.post(
        '/api/v1/affiliation/activate/lookup', json={'token': 'totally-bogus'},
    )
    assert r.status_code == 400
    assert 'invalid' in r.get_json()['error'].lower()


def test_activation_set_password_clears_flag(app, client, hospital_admin_id):
    token, _ = _activation_token_from_invite(client, app, hospital_admin_id)
    r = client.post(
        '/api/v1/affiliation/activate/set-password',
        json={'token': token, 'password': 'NewPass@1234'},
    )
    assert r.status_code == 200
    assert r.get_json()['data']['must_set_password'] is False

    lookup = client.post(
        '/api/v1/affiliation/activate/lookup', json={'token': token},
    )
    assert lookup.get_json()['data']['must_set_password'] is False


def test_activation_set_password_too_short_rejected(
    app, client, hospital_admin_id,
):
    token, _ = _activation_token_from_invite(client, app, hospital_admin_id)
    r = client.post(
        '/api/v1/affiliation/activate/set-password',
        json={'token': token, 'password': 'short'},
    )
    assert r.status_code == 400


def test_activation_email_otp_send_and_verify(app, client, hospital_admin_id):
    token, payload = _activation_token_from_invite(client, app, hospital_admin_id)

    r = client.post(
        '/api/v1/affiliation/activate/send-email-otp', json={'token': token},
    )
    assert r.status_code == 200

    # Read the OTP straight out of Redis (the same key the verify path checks).
    from app.extensions import redis_client
    otp_key = f'pre_signup_email_otp:{payload["email"].lower()}'
    otp = redis_client.get(otp_key)
    assert otp, 'OTP should be in Redis after send'
    if isinstance(otp, bytes):
        otp = otp.decode()

    r2 = client.post(
        '/api/v1/affiliation/activate/verify-email-otp',
        json={'token': token, 'otp': otp},
    )
    assert r2.status_code == 200
    assert r2.get_json()['data']['email_verified'] is True


def test_activation_phone_otp_send_and_verify(app, client, hospital_admin_id):
    token, payload = _activation_token_from_invite(client, app, hospital_admin_id)

    r = client.post(
        '/api/v1/affiliation/activate/send-phone-otp', json={'token': token},
    )
    assert r.status_code == 200

    from app.extensions import redis_client
    otp_key = f'pre_signup_phone_otp:{payload["phone_number"]}'
    otp = redis_client.get(otp_key)
    assert otp, 'OTP should be in Redis after send'
    if isinstance(otp, bytes):
        otp = otp.decode()

    r2 = client.post(
        '/api/v1/affiliation/activate/verify-phone-otp',
        json={'token': token, 'otp': otp},
    )
    assert r2.status_code == 200
    body = r2.get_json()['data']
    assert body['phone_verified'] is True


def test_activation_verify_bad_otp_rejected(app, client, hospital_admin_id):
    token, _ = _activation_token_from_invite(client, app, hospital_admin_id)
    client.post('/api/v1/affiliation/activate/send-email-otp',
                json={'token': token})

    r = client.post(
        '/api/v1/affiliation/activate/verify-email-otp',
        json={'token': token, 'otp': '000000'},
    )
    assert r.status_code == 400


# --------------------------------------------------------------------------- #
# Signin gates for invited doctors
# --------------------------------------------------------------------------- #

def test_signin_blocked_by_must_set_password(app, client, db_session):
    """Doctor with must_set_password=True can't sign in via regular path."""
    from app.models import UserRole
    with app.app_context():
        u = _make_user(
            role=UserRole.DOCTOR, first_name='Pending', email_verified=False,
            phone_verified=False, must_set_password=True,
            password='KnownPass@1234',
        )
        _make_doctor(u)
        email = u.email

    r = client.post('/api/v1/auth/signin', json={
        'email': email, 'password': 'KnownPass@1234',
    })
    # Pending activation runs BEFORE email-verified gate so the user
    # gets the most specific message ("open your activation link").
    assert r.status_code == 403
    assert r.get_json().get('code') == 'PENDING_ACTIVATION'


def test_signin_blocked_by_phone_not_verified(app, client, db_session):
    """Doctor with password set + email verified but phone unverified
    hits PHONE_NOT_VERIFIED (mid-activation case)."""
    from app.models import UserRole
    with app.app_context():
        u = _make_user(
            role=UserRole.DOCTOR, first_name='HalfActivated',
            email_verified=True, phone_verified=False,
            must_set_password=False, password='KnownPass@1234',
        )
        _make_doctor(u)
        email = u.email

    r = client.post('/api/v1/auth/signin', json={
        'email': email, 'password': 'KnownPass@1234',
    })
    assert r.status_code == 403
    assert r.get_json().get('code') == 'PHONE_NOT_VERIFIED'


def test_signin_succeeds_for_fully_activated_doctor(app, client, db_session):
    """Sanity: a doctor who's completed all activation steps signs in."""
    from app.models import UserRole
    with app.app_context():
        u = _make_user(
            role=UserRole.DOCTOR, first_name='Ready',
            email_verified=True, phone_verified=True,
            must_set_password=False, password='KnownPass@1234',
        )
        _make_doctor(u)
        email = u.email

    r = client.post('/api/v1/auth/signin', json={
        'email': email, 'password': 'KnownPass@1234',
    })
    assert r.status_code == 200
    assert r.get_json()['data']['access_token']


def test_signin_gate_scoped_to_doctor_role(app, client, db_session):
    """The new gates only fire for DOCTOR role — a patient-style
    must_set_password=True user logging in via password is rejected by
    the standard check_password() path, not the new gates.

    ``phone_verified=True`` models the anon-booking patient this test
    is about: booking verifies the phone via OTP before the account
    exists. An UNVERIFIED-phone patient now hits the Round-9
    pending-activation signin gate by design.
    """
    from app.models import UserRole
    with app.app_context():
        u = _make_user(
            role=UserRole.PATIENT, first_name='Pat',
            email_verified=True, phone_verified=True,
            must_set_password=True, password='KnownPass@1234',
        )
        email = u.email

    r = client.post('/api/v1/auth/signin', json={
        'email': email, 'password': 'KnownPass@1234',
    })
    # Patient sign-in succeeds — the new gates were scoped to DOCTOR
    # so the anon-booking patient flow is preserved.
    assert r.status_code == 200
    assert r.get_json()['data']['access_token']


# --------------------------------------------------------------------------- #
# Polymorphic facility CHECK constraint
# --------------------------------------------------------------------------- #

def test_facility_xor_check_constraint_enforced(app, db_session):
    """DB level — can't insert with both hospital_id AND clinic_id set,
    nor with neither set."""
    from sqlalchemy.exc import IntegrityError
    from app.extensions import db
    from app.models import (
        DoctorHospitalAffiliation, DoctorAffiliationRequestStatus,
        EmploymentType, UserRole,
    )

    with app.app_context():
        # Create a doctor + hospital + clinic to reference
        admin_h = _make_user(role=UserRole.HOSPITAL, first_name='HAdmin')
        h = _make_hospital(admin_h)
        admin_c = _make_user(role=UserRole.CLINIC, first_name='CAdmin')
        c = _make_clinic(admin_c)
        doc_u = _make_user(role=UserRole.DOCTOR, first_name='Doc')
        d = _make_doctor(doc_u)

        _set_tenant(d.tenant_id)

        # Both facility columns set → CHECK violation
        bad = DoctorHospitalAffiliation(
            tenant_id=d.tenant_id,
            doctor_id=d.id,
            hospital_id=h.id,
            clinic_id=c.id,
            employment_type=EmploymentType.FULL_TIME,
            status=DoctorAffiliationRequestStatus.PENDING,
            is_active=False,
        )
        db.session.add(bad)
        with pytest.raises(IntegrityError):
            db.session.commit()
        db.session.rollback()

        # Neither set → CHECK violation
        neither = DoctorHospitalAffiliation(
            tenant_id=d.tenant_id,
            doctor_id=d.id,
            hospital_id=None,
            clinic_id=None,
            employment_type=EmploymentType.FULL_TIME,
            status=DoctorAffiliationRequestStatus.PENDING,
            is_active=False,
        )
        db.session.add(neither)
        with pytest.raises(IntegrityError):
            db.session.commit()
        db.session.rollback()


def test_facility_xor_allows_hospital_only(app, db_session):
    from app.extensions import db
    from app.models import (
        DoctorHospitalAffiliation, DoctorAffiliationRequestStatus,
        EmploymentType, UserRole,
    )
    with app.app_context():
        admin = _make_user(role=UserRole.HOSPITAL, first_name='HAdmin2')
        h = _make_hospital(admin)
        doc_u = _make_user(role=UserRole.DOCTOR, first_name='Doc2')
        d = _make_doctor(doc_u)
        _set_tenant(d.tenant_id)

        ok = DoctorHospitalAffiliation(
            tenant_id=d.tenant_id,
            doctor_id=d.id, hospital_id=h.id, clinic_id=None,
            employment_type=EmploymentType.FULL_TIME,
            status=DoctorAffiliationRequestStatus.APPROVED, is_active=True,
        )
        db.session.add(ok)
        db.session.commit()  # should NOT raise
        assert ok.id


def test_facility_xor_allows_clinic_only(app, db_session):
    from app.extensions import db
    from app.models import (
        DoctorHospitalAffiliation, DoctorAffiliationRequestStatus,
        EmploymentType, UserRole,
    )
    with app.app_context():
        admin = _make_user(role=UserRole.CLINIC, first_name='CAdmin2')
        c = _make_clinic(admin)
        doc_u = _make_user(role=UserRole.DOCTOR, first_name='Doc3')
        d = _make_doctor(doc_u)
        _set_tenant(d.tenant_id)

        ok = DoctorHospitalAffiliation(
            tenant_id=d.tenant_id,
            doctor_id=d.id, hospital_id=None, clinic_id=c.id,
            employment_type=EmploymentType.FULL_TIME,
            status=DoctorAffiliationRequestStatus.APPROVED, is_active=True,
        )
        db.session.add(ok)
        db.session.commit()  # should NOT raise
        assert ok.id
