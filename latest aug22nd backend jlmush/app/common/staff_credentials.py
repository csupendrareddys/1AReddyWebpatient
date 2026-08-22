"""
Giving a ``ProviderStaff`` row a login, and taking it away.

One module because two surfaces create staff — the admin's Operations screen
and the provider's own My Link — and a login is the part where getting it
subtly different between them matters. Both call ``ensure_staff_user``.

**What a staff login is.** A normal ``User`` with ``role=PROVIDER_STAFF``, on
the staff member's tenant, linked from ``ProviderStaff.user_id``. It is not a
second kind of account: it goes through the same sign-in, the same session
limit, the same lockout. What differs is only where the post-login redirect
sends them and what their roles let them reach.

**Which portal.** ``/auth/service-provider`` — the same door as the practice
they work for, because from a receptionist's side it IS their clinic's login.
The auth role gate lists PROVIDER_STAFF alongside doctor/clinic/hospital for
that portal.

**Phone.** ``users._phone_hash`` is NOT NULL and unique per tenant, but staff
are identified by email and a practice often doesn't have a distinct mobile
for a front desk. So a staff user without a phone gets a deterministic
placeholder derived from their staff id — unique by construction, never a real
number, and obviously synthetic if anyone reads it.
"""
import logging

from app.extensions import db
from app.models import User, UserRole, UserStatus

logger = logging.getLogger(__name__)

# Marks a generated phone as not-a-real-number. A real Indian mobile can't
# start with this, so it can never collide with one a human would enter.
STAFF_PHONE_PREFIX = '0000'

MIN_PASSWORD_LENGTH = 8


def _placeholder_phone(staff_id):
    """A unique, obviously-fake phone for a staff account with no real one."""
    digits = ''.join(c for c in str(staff_id) if c.isdigit())[:8].ljust(8, '0')
    return f'{STAFF_PHONE_PREFIX}{digits}'


def email_taken(email, tenant_id, exclude_user_id=None):
    q = User.query.filter(User.tenant_id == tenant_id, User._email_hash != None)  # noqa: E711
    for user in q.all():
        if (user.email or '').lower() == email.lower():
            if exclude_user_id and str(user.id) == str(exclude_user_id):
                continue
            return True
    return False


def phone_taken(phone, tenant_id, exclude_user_id=None):
    """Whether ``phone`` already belongs to another user on this tenant.

    ``users._phone_hash`` is tenant-unique (``uq_users_tenant_phone``), so a
    colliding number makes the INSERT raise. Checking the search hash up front
    turns that 500 into a friendly, actionable message. Matches the setter's
    hashing so the comparison is exact."""
    from app.common.encryption import hash_for_search
    ph = hash_for_search(phone)
    q = User.query.filter(User.tenant_id == tenant_id, User._phone_hash == ph)
    for user in q.all():
        if exclude_user_id and str(user.id) == str(exclude_user_id):
            continue
        return True
    return False


def ensure_staff_user(staff, email=None, password=None, phone_number=None):
    """Create or update the login attached to ``staff``.

    Returns ``(user_or_None, error_message_or_None)``.

    Called with neither email nor password it is a no-op — most staff rows have
    no login, and "no credentials supplied" has to mean "leave it alone" rather
    than "revoke it", or every unrelated edit to a name would sign someone out
    permanently.

    Creating a login needs both an email and a password. Updating one may carry
    either: a new email alone changes the sign-in address, a new password alone
    is a reset.
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
            return None, 'Both a login email and a password are required to create a staff login'
        if email_taken(email, staff.tenant_id):
            return None, f'{email} is already in use on this tenant'

        # Only a REAL number can collide; the id-derived placeholder is unique
        # by construction. Guard before the insert so a shared number is a
        # friendly message, not a 500 on uq_users_tenant_phone.
        real_phone = (phone_number or staff.phone_number or '').strip() or None
        if real_phone and phone_taken(real_phone, staff.tenant_id):
            return None, (f'The phone number {real_phone} is already in use by '
                          'another account on this practice.')

        user = User(
            tenant_id=staff.tenant_id,
            role=UserRole.PROVIDER_STAFF,
            # Active immediately: an admin or the practice owner created this
            # deliberately and is standing right there. There is no
            # self-signup path for staff to verify an address through.
            status=UserStatus.ACTIVE,
            first_name=staff.first_name or 'Staff',
            last_name=staff.last_name or '',
            email_verified=True,
        )
        user.email = email
        user.phone_number = real_phone or _placeholder_phone(staff.id)
        user.set_password(password)
        db.session.add(user)
        db.session.flush()
        staff.user_id = user.id
        logger.info('Created staff login user=%s for staff=%s', user.id, staff.id)
        return user, None

    if email and (user.email or '').lower() != email.lower():
        if email_taken(email, staff.tenant_id, exclude_user_id=user.id):
            return None, f'{email} is already in use on this tenant'
        user.email = email
    if password:
        user.set_password(password)
        logger.info('Reset staff login password for staff=%s', staff.id)
    # Keep the login's display name in step with the staff record — they are
    # the same person, and a stale name here shows up in audit trails.
    user.first_name = staff.first_name or user.first_name
    user.last_name = staff.last_name or ''
    return user, None


def revoke_staff_login(staff):
    """Disable a staff member's sign-in without deleting the person.

    Suspends the User rather than dropping it: audit rows, sessions and any
    record they touched still point at that user id, and deleting it would
    orphan all of them. Re-activating is a status flip.
    """
    if staff.user:
        staff.user.status = UserStatus.INACTIVE
        logger.info('Revoked staff login for staff=%s', staff.id)
