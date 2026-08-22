"""Giving a ``PatientStaff`` row a login, and taking it away.

Mirror of ``app/common/staff_credentials.py`` for the patient side. A caregiver's
login is a normal ``User`` with ``role=PATIENT_STAFF``, on the patient's tenant,
linked from ``PatientStaff.user_id``. It is not a second kind of account: same
sign-in, session limit and lockout as everyone — only the post-login redirect
and the screens they reach differ.

**Which portal.** ``/auth/service-receiver`` — the same door as the patient they
care for. The auth role gate lists ``PATIENT_STAFF`` alongside ``PATIENT`` for
that portal.

The generic parts (placeholder phone, email/phone-taken guards, password length)
are reused from ``staff_credentials`` so the two credential paths can't drift on
the bits that are identical.
"""
import logging

from app.extensions import db
from app.models import User, UserRole, UserStatus
from app.common.staff_credentials import (
    MIN_PASSWORD_LENGTH, _placeholder_phone, email_taken, phone_taken,
)

logger = logging.getLogger(__name__)


def ensure_patient_staff_user(staff, email=None, password=None, phone_number=None):
    """Create or update the login attached to ``staff``.

    Returns ``(user_or_None, error_message_or_None)``. Same contract as
    ``ensure_staff_user``: called with neither email nor password it is a no-op
    (an unrelated name edit must not sign anyone out); creating a login needs
    both an email and a password; updating one may carry either — a new email
    changes the sign-in address, a new password is a reset.
    """
    email = (email or '').strip() or None
    password = (password or '').strip() or None

    if not email and not password:
        return staff.user, None

    if password and len(password) < MIN_PASSWORD_LENGTH:
        return None, f'Password must be at least {MIN_PASSWORD_LENGTH} characters'

    user = staff.user

    if user is None:
        if not email or not password:
            return None, 'Both a login email and a password are required to create a caregiver login'
        if email_taken(email, staff.tenant_id):
            return None, f'{email} is already in use on this tenant'

        # Only a REAL number can collide; the id-derived placeholder is unique
        # by construction. Guard before the insert so a shared number is a
        # friendly message, not a 500 on uq_users_tenant_phone.
        real_phone = (phone_number or staff.phone_number or '').strip() or None
        if real_phone and phone_taken(real_phone, staff.tenant_id):
            return None, (f'The phone number {real_phone} is already in use by '
                          'another account.')

        user = User(
            tenant_id=staff.tenant_id,
            role=UserRole.PATIENT_STAFF,
            # Active immediately: the patient created this deliberately. There
            # is no self-signup path for a caregiver to verify an address.
            status=UserStatus.ACTIVE,
            first_name=staff.first_name or 'Caregiver',
            last_name=staff.last_name or '',
            email_verified=True,
        )
        user.email = email
        user.phone_number = real_phone or _placeholder_phone(staff.id)
        user.set_password(password)
        db.session.add(user)
        db.session.flush()
        staff.user_id = user.id
        logger.info('Created patient-staff login user=%s for staff=%s', user.id, staff.id)
        return user, None

    if email and (user.email or '').lower() != email.lower():
        if email_taken(email, staff.tenant_id, exclude_user_id=user.id):
            return None, f'{email} is already in use on this tenant'
        user.email = email
    if password:
        user.set_password(password)
        logger.info('Reset patient-staff login password for staff=%s', staff.id)
    # Keep the login's display name in step with the staff record — same person,
    # and a stale name here shows up in audit trails.
    user.first_name = staff.first_name or user.first_name
    user.last_name = staff.last_name or ''
    return user, None


def revoke_patient_staff_login(staff):
    """Disable a caregiver's sign-in without deleting the person.

    Suspends the ``User`` rather than dropping it: audit rows, sessions and any
    record they touched still point at that user id. Re-activating is a status
    flip.
    """
    if staff.user:
        staff.user.status = UserStatus.INACTIVE
        logger.info('Revoked patient-staff login for staff=%s', staff.id)
