"""Equivalence-class / boundary contracts for the auth surface.

The engine (see harness/engine.py) expands each Contract into the full
case family; every case additionally asserts the universal invariants
(JSON envelope, machine ``code`` on errors, never a 5xx).

Baselines here deliberately expect REFUSALS (401 wrong password, 422
missing OTP proof) — auth happy paths need OTP/session state and are
covered by the flow tests and the live verification recipes; what this
file locks down is that every malformed shape is refused cleanly.
"""
import pytest

from tests.harness.engine import Contract, Field

SIGNIN = Contract(
    'signin', 'POST', '/api/v1/auth/signin',
    payload={'email': 'contract-nobody@test.com', 'password': 'Secret123!'},
    fields={
        'email': Field(fmt='email'),
        # LoginSchema caps password at 128; 129 must refuse, 128 must not 5xx.
        'password': Field(max_len=128, min_len=8),
    },
    baseline=(401,),  # unknown account with a well-formed payload
)

SIGNUP = Contract(
    'signup', 'POST', '/api/v1/auth/signup',
    payload={
        'email': 'contract-signup@test.com',
        'password': 'Secret123!',
        'first_name': 'Contract',
        'last_name': 'Case',
        'phone_number': '9876500001',
        'state': 'Karnataka',
        'role': 'patient',
        'phone_verification_token': 'not-a-real-token',
    },
    fields={
        'email': Field(required=False, fmt='email'),
        'password': Field(min_len=8, max_len=128),
        'first_name': Field(max_len=50),
        'phone_number': Field(fmt='phone'),
        'state': Field(allowed=('Karnataka',)),
        'role': Field(allowed=('patient',)),
        'phone_verification_token': Field(),
    },
    # A fake OTP token is refused by the service — but AFTER validation,
    # proving the schema accepted the well-formed payload.
    baseline='refused',
)

LOGIN_VIA_OTP = Contract(
    'login_via_otp', 'POST', '/api/v1/auth/login-via-otp',
    payload={'phone_number': '9876500001', 'otp': '000000'},
    fields={
        'phone_number': Field(fmt='phone'),
        'otp': Field(max_len=6),
    },
    baseline='refused',  # no OTP was ever issued for this number
)

FORGOT_PASSWORD = Contract(
    'forgot_password', 'POST', '/api/v1/auth/forgot-password',
    payload={'email': 'contract-nobody@test.com'},
    fields={'email': Field(fmt='email')},
    # Anti-enumeration surfaces commonly answer 200 for unknown accounts;
    # some answer 404. Either way: clean, never a crash.
    baseline='no_crash',
)

VERIFY_RESET_OTP = Contract(
    'verify_reset_otp', 'POST', '/api/v1/auth/verify-reset-otp',
    payload={'email': 'contract-nobody@test.com', 'otp': '000000'},
    fields={'email': Field(fmt='email'), 'otp': Field(max_len=6)},
    baseline='refused',
)

SEND_PHONE_OTP = Contract(
    'pre_signup_send_phone_otp', 'POST', '/api/v1/auth/pre-signup/send-phone-otp',
    payload={'phone_number': '9876500002'},
    fields={'phone_number': Field(fmt='phone')},
    # Sending may fail on SMS-provider state — refusal or success are both
    # acceptable; a crash is not.
    baseline='no_crash',
)

_ALL = [SIGNIN, SIGNUP, LOGIN_VIA_OTP, FORGOT_PASSWORD, VERIFY_RESET_OTP,
        SEND_PHONE_OTP]
_CASES = [c for contract in _ALL for c in contract.cases()]


@pytest.mark.parametrize('case', _CASES, ids=str)
def test_auth_contract(client, db_session, case):
    case.run(client)
