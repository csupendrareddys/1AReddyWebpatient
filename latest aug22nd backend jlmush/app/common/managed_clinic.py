"""Create a MANAGED (parent-owned) BRANCH clinic owner — a login-less account.

A branch is a real ``Clinic`` + a **credential-less** ``User`` (role=CLINIC), so
the entire clinic system (entity profile, doctors, bookings, verification) is
reused by ``clinic_id`` with zero forking — exactly as a minor reuses the patient
system. The owner User can never authenticate: unusable password, synthetic
phone, ``INACTIVE`` status, ``is_managed=True`` (hard-blocked in every auth path,
see ``app/auth/service.py``). The main clinic operates a branch through the branch
"act as" proxy, not a login.

A managed owner (rather than a NULL ``admin_user_id``) is REQUIRED: the
act-on-behalf proxy borrows ``target.user`` and ``resolve_principal`` reads
``clinic.admin_user_id`` — both break on a null owner. Mirrors
``app/common/managed_patient.py``.
"""
import logging
import secrets

from werkzeug.security import generate_password_hash

from app.extensions import db
from app.models import User, UserRole, UserStatus
from app.common.managed_patient import _allocate_synthetic_phone

logger = logging.getLogger(__name__)


def create_managed_clinic_user(tenant_id, name):
    """Mint a credential-less ``User`` (role=CLINIC) to own a branch clinic.

    Flushes (so the caller gets ``user.id`` for ``clinic.admin_user_id``) but
    does NOT commit — the caller owns the transaction. Returns the ``User``.
    """
    first = (name or 'Branch').strip() or 'Branch'
    user = User(
        tenant_id=tenant_id,
        role=UserRole.CLINIC,
        status=UserStatus.INACTIVE,   # never active
        is_managed=True,              # hard-blocks every auth path
        first_name=first[:120],
        last_name='',
        email_verified=False,
        phone_verified=False,
    )
    # Unusable password (token generated then discarded) — satisfies
    # users.password_hash NOT NULL while making any sign-in impossible.
    user.password_hash = generate_password_hash(secrets.token_urlsafe(48))
    # Synthetic phone satisfies _phone_hash NOT NULL + tenant-unique.
    user.phone_number = _allocate_synthetic_phone(tenant_id)
    db.session.add(user)
    db.session.flush()
    logger.info('[MANAGED_CLINIC] created owner user=%s tenant=%s', user.id, tenant_id)
    return user
