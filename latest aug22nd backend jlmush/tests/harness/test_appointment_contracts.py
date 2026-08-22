"""Contracts for the appointment surface (authenticated patient).

Booking here exercises the VALIDATION layer with equivalence classes —
date/time formats, past dates, enum members, unknown/malformed ids. The
happy path (real slot, gates, notifications) lives in
tests/test_appointments.py and the live verification recipes; a
contract baseline that needed a bookable slot would be testing fixtures,
not the endpoint's input handling.

The malformed-uuid cases double as the regression lock for the
"malformed UUID in a path → 500" bug class (now a clean 404 via the
DataError handler).
"""
import uuid

import pytest

from tests.conftest import get_auth_headers
from tests.harness.engine import Contract, Field

_UNKNOWN_ID = str(uuid.uuid4())

BOOK = Contract(
    'book', 'POST', '/api/v1/appointment',
    payload={
        'doctor_id': _UNKNOWN_ID,
        'appointment_date': '2030-01-15',
        'start_time': '10:00',
        'consultation_type': 'video',
    },
    fields={
        'doctor_id': Field(fmt='uuid'),
        'appointment_date': Field(fmt='date'),
        'start_time': Field(fmt='time'),
        'consultation_type': Field(required=False, allowed=('video',)),
    },
    # Well-formed payload for a doctor that doesn't exist → clean 404.
    baseline=(404,),
)

BOOK_PAST_DATE = Contract(
    'book_past', 'POST', '/api/v1/appointment',
    payload={
        'doctor_id': _UNKNOWN_ID,
        'appointment_date': '2020-01-15',
        'start_time': '10:00',
    },
    baseline='refused',
)

RESCHEDULE_UNKNOWN = Contract(
    'reschedule_unknown', 'PUT',
    f'/api/v1/appointment/{_UNKNOWN_ID}/reschedule',
    payload={'time_slot_id': _UNKNOWN_ID},
    fields={'time_slot_id': Field(fmt='uuid')},
    baseline=(404,),
)

# Path-parameter boundary: a malformed uuid in the URL itself.
DETAIL_MALFORMED_ID = Contract(
    'detail_malformed_id', 'GET', '/api/v1/appointment/not-a-uuid',
    baseline=(404,),
)

DETAIL_UNKNOWN_ID = Contract(
    'detail_unknown_id', 'GET', f'/api/v1/appointment/{_UNKNOWN_ID}',
    baseline=(404,),
)

CANCEL_MALFORMED_ID = Contract(
    'cancel_malformed_id', 'PUT', '/api/v1/appointment/not-a-uuid/cancel',
    payload={},
    baseline=(404, 405),
)

_ALL = [BOOK, BOOK_PAST_DATE, RESCHEDULE_UNKNOWN, DETAIL_MALFORMED_ID,
        DETAIL_UNKNOWN_ID, CANCEL_MALFORMED_ID]
_CASES = [c for contract in _ALL for c in contract.cases()]


@pytest.fixture()
def patient_headers(app, sample_patient):
    user, _patient = sample_patient
    return get_auth_headers(app, user)


@pytest.mark.parametrize('case', _CASES, ids=str)
def test_appointment_contract(client, db_session, patient_headers, case):
    case.run(client, headers=patient_headers)


def test_appointment_requires_auth(client, db_session):
    """The whole surface is authenticated: anonymous → 401 with a code."""
    resp = client.get(f'/api/v1/appointment/{_UNKNOWN_ID}')
    assert resp.status_code == 401
    assert (resp.get_json() or {}).get('code')
