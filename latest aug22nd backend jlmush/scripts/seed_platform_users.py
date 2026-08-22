"""Platform-side user seeder.

Populates the **product tenant** -- ``larazen`` by default, override with
``SEED_TENANT_SLUG`` -- with:

  *  5 super_admins   (role = SUPER_ADMIN, via SuperAdminService)
  * 20 doctors        (role = DOCTOR,      direct User + Doctor insert)
  * 20 patients       (role = PATIENT,     direct User + Patient insert)

These are ordinary product users and belong on a CUSTOMER tenant. They
must NOT land on the vendor row: the vendor sells the SaaS and owns no
product data, and seeding 20 doctors into it would make the entitlement
bypass look like a working product. Selecting by ``is_default`` used to
be right, but after the vendor split that flag points at the vendor —
hence the slug lookup below. The only genuinely cross-tenant role is
PLATFORM_OWNER, which this script does not touch
(use create_platform_owner.py for that).

Idempotent: uses a dedicated phone/email block and skips any user that
already exists in the default tenant. Safe to re-run.

USAGE (inside the backend container on the EC2 host)
----------------------------------------------------
    # container name may differ — see `docker ps`
    docker exec jlmush-backend python scripts/seed_platform_users.py

    # or, if you're already on a shell inside the container (WORKDIR=/app):
    python scripts/seed_platform_users.py

EXIT CODES
----------
    0 — every user is in place (created now or already existed)
    1 — a pre-flight check or a create step failed; review the output
"""
import os
import sys
import traceback

# Make ``app`` importable whether run as ``scripts/seed_platform_users.py``
# from /app (WORKDIR) or from within the scripts/ directory.
_PARENT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)


# ─── Config ───────────────────────────────────────────────────────────

# Standard demo password (meets the signup policy: upper/lower/digit/
# special/8+). Change here if you want a different secret.
DEMO_PASSWORD = 'Demo@1234'

# How many of each role to seed on the platform tenant.
DOCTOR_COUNT = 20
PATIENT_COUNT = 20
SUPER_ADMIN_COUNT = 5

# A dedicated phone/email block for platform-side seed data so it never
# collides with customer-tenant seeds (which use prefixes 70-73 in
# seed_full_demo.py). Every phone is a valid 10-digit Indian mobile
# (starts 6-9) and is unique within the tenant.
#
# Layout: 9 | 95 (block) | role_digit | idx(2) | 0000  = 10 digits
#   e.g.  9 95 2 07 0000 = 9952070000  -> platform doctor #7
PHONE_BLOCK = '95'
ROLE_DIGIT = {'super_admin': '0', 'doctor': '2', 'patient': '3'}
EMAIL_DOMAIN = 'platform-seed.test'


# ─── Tiny output helpers ──────────────────────────────────────────────

PASS = '[OK] '
SKIP = '[--] '
FAIL = '[ERR]'

_created = 0
_skipped = 0
_failed = 0


def _phone(role, idx):
    return f'9{PHONE_BLOCK}{ROLE_DIGIT[role]}{idx:02d}0000'


def make_payload(role, idx):
    """Deterministic user payload -> stable across re-runs (idempotent)."""
    return {
        'first_name': f'{role.replace("_", " ").title().replace(" ", "")}{idx:02d}',
        'last_name': 'Platform',
        'phone_number': _phone(role, idx),
        'email': f'{role}{idx:02d}@{EMAIL_DOMAIN}',
        'password': DEMO_PASSWORD,
    }


# ─── Idempotent per-role creators ─────────────────────────────────────

def ensure_super_admin(payload, tenant_id):
    from app.models import User
    from app.common.encryption import hash_for_search
    from app.api.admin.super_admin.service import (
        SuperAdminService, FieldValidationError,
    )

    existing = User.query.filter_by(
        _phone_hash=hash_for_search(payload['phone_number']),
        tenant_id=tenant_id,
        is_deleted=False,
    ).first()
    if existing:
        return 'skip'
    try:
        user, _admin = SuperAdminService.create_admin(
            {**payload, 'role': 'super_admin'}, tenant_id=tenant_id,
        )
    except FieldValidationError as exc:
        raise RuntimeError(f'super_admin {exc.field}: {exc.message}')

    # The service marks email_verified=True but leaves phone_verified at
    # its False default. This is dummy seed data with no OTP round, so
    # tick the phone verified too.
    from app.extensions import db
    user.phone_verified = True
    db.session.commit()
    return 'create'


def ensure_doctor(payload, tenant_id, idx):
    from app.extensions import db
    from app.models import User, Doctor, UserRole, UserStatus
    from app.common.encryption import hash_for_search

    existing = User.query.filter_by(
        _phone_hash=hash_for_search(payload['phone_number']),
        tenant_id=tenant_id,
        is_deleted=False,
    ).first()
    if existing:
        return 'skip'

    user = User(
        first_name=payload['first_name'], last_name=payload['last_name'],
        role=UserRole.DOCTOR, status=UserStatus.ACTIVE,
        tenant_id=tenant_id, email_verified=True, phone_verified=True,
    )
    user.phone_number = payload['phone_number']
    user.email = payload['email']
    user.set_password(payload['password'])
    db.session.add(user)
    db.session.flush()

    # NOT NULL file-reference / identity columns. Deterministic Aadhaar
    # (unique per tenant) derived from the phone so re-runs stay stable.
    aadhar = f'99{payload["phone_number"]}'  # 12 digits
    doctor = Doctor(
        user_id=user.id, tenant_id=tenant_id,
        aadhar_number=aadhar,
        aadhar_attachment=f'seed/aadhar/{user.id}.pdf',
        registration_number=f'PLAT-REG-{idx:03d}',
        registration_certificate=f'seed/reg/{user.id}.pdf',
    )
    db.session.add(doctor)
    db.session.commit()
    return 'create'


def ensure_patient(payload, tenant_id):
    from app.extensions import db
    from app.models import User, Patient, UserRole, UserStatus
    from app.common.encryption import hash_for_search

    existing = User.query.filter_by(
        _phone_hash=hash_for_search(payload['phone_number']),
        tenant_id=tenant_id,
        is_deleted=False,
    ).first()
    if existing:
        return 'skip'

    user = User(
        first_name=payload['first_name'], last_name=payload['last_name'],
        role=UserRole.PATIENT, status=UserStatus.ACTIVE,
        tenant_id=tenant_id, email_verified=True, phone_verified=True,
    )
    user.phone_number = payload['phone_number']
    user.email = payload['email']
    user.set_password(payload['password'])
    db.session.add(user)
    db.session.flush()

    patient = Patient(user_id=user.id, tenant_id=tenant_id)
    db.session.add(patient)
    db.session.commit()
    return 'create'


# ─── Main ─────────────────────────────────────────────────────────────

def _run(label, fn):
    global _created, _skipped, _failed
    try:
        result = fn()
    except Exception as exc:  # noqa: BLE001 — report and keep going
        _failed += 1
        print(f'  {FAIL} {label}: {exc}')
        from app.extensions import db
        db.session.rollback()
        return
    if result == 'create':
        _created += 1
        print(f'  {PASS} {label}')
    else:
        _skipped += 1
        print(f'  {SKIP} {label} (already exists)')


def main():
    from app import create_app
    from app.models import Tenant, User, UserRole

    app = create_app()
    with app.app_context():
        # Pre-flight: resolve the PRODUCT tenant to seed into.
        #
        # Never the vendor row (is_platform) -- see the module docstring.
        slug = os.environ.get('SEED_TENANT_SLUG', 'larazen')
        tenant = Tenant.query.filter_by(slug=slug, is_deleted=False).first()
        if not tenant:
            print(f'{FAIL} No tenant with slug {slug!r} found. '
                  'Run scripts/bootstrap_local.py first, or set '
                  'SEED_TENANT_SLUG to an existing customer tenant.')
            return 1
        if tenant.is_platform:
            print(f'{FAIL} Tenant {slug!r} is the SaaS vendor row. '
                  'Product users must not be seeded into it -- pick a '
                  'customer tenant via SEED_TENANT_SLUG.')
            return 1

        print('=' * 60)
        print(' Seeding product users into the customer tenant')
        print('=' * 60)
        print(f'  tenant : {tenant.slug}  ({tenant.id})')
        print(f'  target : {SUPER_ADMIN_COUNT} super_admin, '
              f'{DOCTOR_COUNT} doctor, {PATIENT_COUNT} patient')
        print(f'  passwd : {DEMO_PASSWORD}')
        print('-' * 60)

        print('\nSuper admins:')
        for idx in range(1, SUPER_ADMIN_COUNT + 1):
            p = make_payload('super_admin', idx)
            _run(f"super_admin {p['phone_number']}  {p['email']}",
                 lambda p=p: ensure_super_admin(p, tenant.id))

        print('\nDoctors:')
        for idx in range(1, DOCTOR_COUNT + 1):
            p = make_payload('doctor', idx)
            _run(f"doctor      {p['phone_number']}  {p['email']}",
                 lambda p=p, idx=idx: ensure_doctor(p, tenant.id, idx))

        print('\nPatients:')
        for idx in range(1, PATIENT_COUNT + 1):
            p = make_payload('patient', idx)
            _run(f"patient     {p['phone_number']}  {p['email']}",
                 lambda p=p: ensure_patient(p, tenant.id))

        # Summary + live counts straight from the DB.
        print('\n' + '=' * 60)
        print(f'  created: {_created}   skipped: {_skipped}   failed: {_failed}')
        for role in (UserRole.SUPER_ADMIN, UserRole.DOCTOR, UserRole.PATIENT):
            n = User.query.filter_by(
                tenant_id=tenant.id, role=role, is_deleted=False,
            ).count()
            print(f'  tenant total {role.value:12}: {n}')
        print('=' * 60)
        print(f'\nDemo password for every seeded account: {DEMO_PASSWORD!r}')
        print('Super admins sign in at /auth/admin/login')
        return 1 if _failed else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(2)
