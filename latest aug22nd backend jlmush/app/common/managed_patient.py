"""Create a MANAGED (guardian-owned) patient sub-profile — e.g. a MINOR.

A minor is a real ``Patient`` + a **credential-less** ``User`` (role=PATIENT), so
the entire patient system (health records, appointments, prescriptions, the
whole dashboard) is reused by ``patient_id`` with zero forking. The User can
never authenticate: it carries an unusable password, a synthetic phone,
``INACTIVE`` status, and ``is_managed=True`` (hard-blocked in every auth path,
see ``app/auth/service.py``). The guardian operates it through the patient-family
"act as" scope, not a login. Mirrors ``app/common/staff_credentials.py``.
"""
import logging
import secrets

from werkzeug.security import generate_password_hash

from app.extensions import db
from app.models import User, UserRole, UserStatus, Patient
from app.models._enums import Gender
from app.common.encryption import hash_for_search

logger = logging.getLogger(__name__)

# Same "obviously not a real number" prefix used for staff placeholders — a real
# Indian mobile can't start with it, so it never collides with a human's number.
MANAGED_PHONE_PREFIX = '0000'


def _allocate_synthetic_phone(tenant_id):
    """A tenant-unique, obviously-fake phone for a login-less managed account.
    Pre-checks the searchable hash so we never flush a colliding row (which
    would poison the caller's transaction)."""
    for _ in range(5):
        phone = f'{MANAGED_PHONE_PREFIX}{secrets.randbelow(10 ** 8):08d}'
        taken = User.query.filter_by(
            _phone_hash=hash_for_search(phone), tenant_id=tenant_id).first()
        if not taken:
            return phone
    raise RuntimeError('Could not allocate a synthetic phone for the managed user.')


def create_managed_patient(tenant_id, first_name, last_name, dob=None, gender=None):
    """Mint a credential-less ``User`` + ``Patient`` for a managed sub-profile.

    Flushes (so callers get ``patient.id``) but does NOT commit — the caller owns
    the transaction (member row, quota checks, etc.). Returns the ``Patient``.
    """
    if gender and isinstance(gender, str):
        try:
            gender = Gender(gender)
        except ValueError:
            gender = None

    user = User(
        tenant_id=tenant_id,
        role=UserRole.PATIENT,
        status=UserStatus.INACTIVE,   # never active
        is_managed=True,              # hard-blocks every auth path
        first_name=(first_name or 'Member').strip() or 'Member',
        last_name=(last_name or '').strip(),
        dob=dob or None,
        gender=gender,
        email_verified=False,
        phone_verified=False,
    )
    # Unusable password (token generated then discarded) — satisfies
    # users.password_hash NOT NULL while making any sign-in impossible.
    user.password_hash = generate_password_hash(secrets.token_urlsafe(48))
    # Synthetic phone satisfies _phone_hash NOT NULL + tenant-unique without ever
    # colliding with a real number.
    user.phone_number = _allocate_synthetic_phone(tenant_id)
    db.session.add(user)
    db.session.flush()

    patient = Patient(user_id=user.id, tenant_id=tenant_id)
    db.session.add(patient)
    db.session.flush()
    logger.info('[MANAGED_PATIENT] created patient=%s user=%s tenant=%s',
                patient.id, user.id, tenant_id)
    return patient
