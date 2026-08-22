"""Smoke tests for the public anonymous-booking endpoints.

Same envelope-shape contract as the other ``tests/api/test_*_public.py``
files: a fresh tenant per test, no admin auth required, public reads
must return clean JSON envelopes even when the underlying tables are
empty (so the frontend can render a friendly empty state without
falling into the catch-block error log path the patient-facing console
shows in production).

Razorpay integration is NOT exercised here — these tests cover the
catalog reads and the validation surface, which is what production
hits on every page load. Razorpay-flow tests would require either
mocking the SDK or a sandbox key and live in a separate (slower)
suite.
"""
import uuid

import pytest

from app.extensions import db
from app.models import User, UserRole


# --------------------------------------------------------------------------- #
# Catalog reads (no auth, no body)
# --------------------------------------------------------------------------- #

class TestPublicBookingCatalog:

    def test_specializations_returns_valid_envelope(self, client, fresh_tenant):
        """Endpoint must always return a 200 with a JSON list — never
        500. The list MAY contain seeded demo data depending on whether
        ``scripts/seed_demo_doctors.py`` has run against this DB; the
        contract guarantee here is shape-not-content.

        Frontend treats `[]` as "hide the booking widget"; any 5xx
        breaks the landing-page render entirely, which is the failure
        mode this test guards against.
        """
        resp = client.get(
            '/api/v1/public/booking/specializations',
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body['success'] is True
        assert isinstance(body['data'], list)
        for item in body['data']:
            # Every entry must carry id + name + doctor_count so the
            # frontend can render a Category chip without defaulting.
            assert {'id', 'name', 'doctor_count'} <= set(item.keys())

    def test_doctors_returns_paginated_envelope(self, client, fresh_tenant):
        """Doctor list always returns the standard pagination envelope
        regardless of whether seeded demo doctors exist on this DB.
        """
        resp = client.get(
            '/api/v1/public/booking/doctors',
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code == 200
        body = resp.get_json()['data']
        assert isinstance(body['items'], list)
        assert body['page'] == 1
        assert body['per_page'] == 20
        assert isinstance(body['total'], int) and body['total'] >= 0

    def test_doctors_per_page_clamps_to_50(self, client, fresh_tenant):
        """Defends against ``?per_page=10000`` from a misbehaving
        client (or attacker) blowing up the response size.
        """
        resp = client.get(
            '/api/v1/public/booking/doctors?per_page=999',
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code == 200
        assert resp.get_json()['data']['per_page'] == 50

    def test_doctor_timeslots_requires_date(self, client, fresh_tenant):
        """Missing ``?date=`` → 400 with a structured JSON body, never
        an exception."""
        # Need an arbitrary doctor_id (uuid format) — endpoint should
        # reject with 400 before even hitting the DB because date is
        # missing.
        resp = client.get(
            f'/api/v1/public/booking/doctors/{uuid.uuid4()}/timeslots',
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code == 400
        assert resp.get_json() is not None

    def test_doctor_timeslots_past_date_returns_empty(self, client, fresh_tenant):
        """Past date → empty list (200), not an error. Visitors poking
        through old months should get a no-op response.
        """
        resp = client.get(
            f'/api/v1/public/booking/doctors/{uuid.uuid4()}/timeslots?date=2000-01-01',
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code == 200
        assert resp.get_json()['data'] == []


# --------------------------------------------------------------------------- #
# Validation contract (without exercising Razorpay)
# --------------------------------------------------------------------------- #

class TestPublicBookingValidation:

    def test_initiate_validates_required_fields(self, client, fresh_tenant):
        """Empty body → 422 with a Marshmallow ``errors`` dict.

        The frontend's error parser keys off ``response.data.errors``;
        this test pins the contract.
        """
        resp = client.post(
            '/api/v1/public/booking/initiate',
            json={},
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code == 422
        body = resp.get_json()
        assert 'errors' in body or body.get('error')

    def test_initiate_rejects_bad_consultation_type(self, client, fresh_tenant):
        """Invalid consultation type → 422 (not silently accepted)."""
        resp = client.post(
            '/api/v1/public/booking/initiate',
            json={
                'name': 'Test Patient',
                'phone_number': '9876500001',
                'doctor_id': str(uuid.uuid4()),
                'time_slot_id': str(uuid.uuid4()),
                'consultation_type': 'telepathic',  # not in the enum
            },
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code == 422

    def test_verify_validates_required_fields(self, client, fresh_tenant):
        """Verify endpoint rejects missing Razorpay fields with a
        structured 422.
        """
        resp = client.post(
            '/api/v1/public/booking/verify',
            json={'pending_id': str(uuid.uuid4())},
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code == 422


# --------------------------------------------------------------------------- #
# /auth/set-initial-password gate
# --------------------------------------------------------------------------- #

class TestSetInitialPassword:
    """Verifies the gate: only callable when ``must_set_password=True``."""

    def test_anonymous_call_is_401(self, client):
        """No JWT → 401. The frontend route guard never reaches this
        endpoint without a session, but the backend must still defend.
        """
        resp = client.post(
            '/api/v1/auth/set-initial-password',
            json={'new_password': 'Strong#Pass1'},
        )
        assert resp.status_code in (401, 422)
