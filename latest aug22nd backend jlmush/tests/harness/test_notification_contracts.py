"""Contracts for the notifications + device-registration surface.

This is the surface the mobile app touches on every launch (feed poll,
push-token registration), so its input handling gets the full class
treatment. The device token cases include the boundary shapes Expo can
actually produce plus garbage.
"""
import uuid

import pytest

from tests.conftest import get_auth_headers
from tests.harness.engine import Contract, Field

_UNKNOWN_ID = str(uuid.uuid4())

FEED = Contract(
    'feed', 'GET', '/api/v1/notifications',
    baseline=(200,),
)

READ_UNKNOWN = Contract(
    'read_unknown', 'POST', f'/api/v1/notifications/{_UNKNOWN_ID}/read',
    payload={},
    baseline=(404,),
)

# Regression lock: malformed uuid in path answered 500 before the
# DataError handler; must stay a clean 404.
READ_MALFORMED = Contract(
    'read_malformed', 'POST', '/api/v1/notifications/not-a-uuid/read',
    payload={},
    baseline=(404,),
)

READ_ALL = Contract(
    'read_all', 'POST', '/api/v1/notifications/read-all',
    payload={},
    baseline=(200,),
)

DEVICE_REGISTER = Contract(
    'device_register', 'POST', '/api/v1/notifications/devices',
    payload={'token': 'ExponentPushToken[contract-case-token-0001]'},
    fields={
        'token': Field(max_len=512),
    },
    baseline=(200, 201),
)

DEVICE_DELETE_EMPTY = Contract(
    'device_delete_no_token', 'DELETE', '/api/v1/notifications/devices',
    payload={},
    baseline='refused',
)

_ALL = [FEED, READ_UNKNOWN, READ_MALFORMED, READ_ALL, DEVICE_REGISTER,
        DEVICE_DELETE_EMPTY]
_CASES = [c for contract in _ALL for c in contract.cases()]


@pytest.fixture()
def patient_headers(app, sample_patient):
    user, _patient = sample_patient
    return get_auth_headers(app, user)


@pytest.mark.parametrize('case', _CASES, ids=str)
def test_notification_contract(client, db_session, patient_headers, case):
    case.run(client, headers=patient_headers)


def test_feed_requires_auth(client, db_session):
    resp = client.get('/api/v1/notifications')
    assert resp.status_code == 401
    assert (resp.get_json() or {}).get('code')
