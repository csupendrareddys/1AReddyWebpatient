"""Full-fat demo seed for the multi-tenant platform.

Creates:
  * 4 tenants:
      - 3 with subdomains  (acme-demo, lara-demo, sunrise-demo)
      - 1 with a custom domain  (ishazen.com — verification flow demoed)
  * 40 users per tenant  = 160 users:
      - 10 super_admins
      - 10 sub_admins
      - 10 doctors
      - 10 patients
  * Cross-tenant identity demo: the same physical person (same email +
    phone) is enrolled in TWO different tenants under TWO different
    roles, proving the per-tenant uniqueness model holds end-to-end.

Idempotent: skips tenants/users that already exist. Safe to re-run on a
freshly bootstrapped DB or on top of itself.

USAGE
-----
    docker exec jlmush-backend python scripts/seed_full_demo.py

EXIT CODES
----------
    0 — every seed step succeeded (or was already in place)
    1 — at least one assertion failed; review the printed list

The custom-domain verification step does NOT actually publish a TXT
record (we don't own the test domain), so it stops at status='pending'
and prints the operator-facing instructions exactly as the API would.
"""
import os
import sys
import logging
import traceback
import uuid

_PARENT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

logging.basicConfig(level=logging.WARNING, format='%(message)s')
log = logging.getLogger('seed-full')


# ─── Tiny test framework ──────────────────────────────────────────────

PASS = '\033[32m✓\033[0m'
FAIL = '\033[31m✗\033[0m'
INFO = '\033[36m▸\033[0m'

_results = []


def check(label, condition, detail=''):
    icon = PASS if condition else FAIL
    print(f'  {icon} {label}' + (f'  ({detail})' if detail else ''))
    _results.append((label, condition, detail))


def section(title):
    print()
    print(f'{INFO} {title}')
    print('  ' + '─' * (len(title) + 2))


# ─── Fixtures ─────────────────────────────────────────────────────────

# Phone-number block per tenant, used as a 4-digit prefix to keep every
# seeded phone unique within its tenant. Cross-tenant collisions ARE
# allowed by the data model and demoed at the end of the script.
TENANTS = [
    {
        'name': 'Acme Demo Clinic',  'slug': 'acme-demo',
        'phone_prefix': '70',  'email_domain': 'acme-demo.test',
        'kind': 'subdomain',
    },
    {
        'name': 'Lara Demo Clinic',  'slug': 'lara-demo',
        'phone_prefix': '71',  'email_domain': 'lara-demo.test',
        'kind': 'subdomain',
    },
    {
        'name': 'Sunrise Demo',      'slug': 'sunrise-demo',
        'phone_prefix': '72',  'email_domain': 'sunrise-demo.test',
        'kind': 'subdomain',
    },
    {
        'name': 'Ishazen Hospital',  'slug': 'ishazen',
        'phone_prefix': '73',  'email_domain': 'ishazen.com',
        'kind': 'custom-domain', 'custom_domain': 'ishazen.com',
    },
]

# How many of each role per tenant — flat 10 each.
ROLE_COUNTS = {
    'super_admin': 10,
    'sub_admin':   10,
    'doctor':      10,
    'patient':     10,
}

# Standard demo password for every seeded user. Trivial to type but
# clearly marked as DEMO so it's obvious in any leak.
DEMO_PASSWORD = 'Demo@1234'


# ─── Helpers ──────────────────────────────────────────────────────────

def make_user_payload(tenant, role, idx):
    """Return the dict used to instantiate a User row.

    Phone format: ``9{phone_prefix}{role_digit}{idx_2digit}{checksum}`` —
    keeps every seed phone unique inside its tenant and recognisable in
    logs (e.g. ``970 1 02 0`` = acme-demo, sub_admin, idx=2).
    """
    role_digit = {
        'super_admin': '0',
        'sub_admin':   '1',
        'doctor':      '2',
        'patient':     '3',
    }[role]
    # 10-digit Indian mobile: 9 + tenant prefix (2) + role (1) + idx (2) + pad (4) = 10
    # The model column has no format constraint, so garbage would silently
    # persist — keep this format strictly correct.
    phone = f'9{tenant["phone_prefix"]}{role_digit}{idx:02d}0000'
    email = f'{role}{idx:02d}@{tenant["email_domain"]}'
    first = f'{role.title().replace("_", "")}{idx:02d}'
    last  = tenant['slug'].replace('-', '').title()[:20]
    return {
        'first_name': first, 'last_name': last,
        'phone_number': phone, 'email': email,
        'password': DEMO_PASSWORD,
    }


def ensure_admin(payload, tenant_id, role):
    """Idempotent admin creation via SuperAdminService."""
    from app.models import User
    from app.common.encryption import hash_for_search
    from app.api.admin.super_admin.service import SuperAdminService, FieldValidationError

    existing = User.query.filter_by(
        _phone_hash=hash_for_search(payload['phone_number']),
        tenant_id=tenant_id,
    ).first()
    if existing:
        return existing, True  # already-existed
    try:
        user, _admin = SuperAdminService.create_admin(
            {**payload, 'role': role}, tenant_id=tenant_id,
        )
        return user, False
    except FieldValidationError as exc:
        raise RuntimeError(f'create_admin {role} failed: {exc.field}: {exc.message}')


def ensure_patient(payload, tenant_id):
    """Idempotent patient creation. Bypasses the public signup OTP gate
    (it's a seed) by writing the User + Patient row directly."""
    from app.models import User, Patient, UserRole, UserStatus
    from app.extensions import db
    from app.common.encryption import hash_for_search

    existing = User.query.filter_by(
        _phone_hash=hash_for_search(payload['phone_number']),
        tenant_id=tenant_id,
    ).first()
    if existing:
        return existing, True

    user = User(
        first_name=payload['first_name'], last_name=payload['last_name'],
        role=UserRole.PATIENT, status=UserStatus.ACTIVE,
        tenant_id=tenant_id, email_verified=True,
    )
    user.phone_number = payload['phone_number']
    user.email = payload['email']
    user.set_password(payload['password'])
    db.session.add(user); db.session.flush()

    patient = Patient(user_id=user.id, tenant_id=tenant_id)
    db.session.add(patient)
    db.session.commit()
    return user, False


def ensure_doctor(payload, tenant_id, idx):
    """Idempotent doctor creation. Provides placeholder file paths for
    the NOT NULL Aadhaar / registration certificate fields — these are
    file references, so dummy paths are fine for seed data."""
    from app.models import User, Doctor, UserRole, UserStatus
    from app.extensions import db
    from app.common.encryption import hash_for_search

    existing = User.query.filter_by(
        _phone_hash=hash_for_search(payload['phone_number']),
        tenant_id=tenant_id,
    ).first()
    if existing:
        return existing, True

    user = User(
        first_name=payload['first_name'], last_name=payload['last_name'],
        role=UserRole.DOCTOR, status=UserStatus.ACTIVE,
        tenant_id=tenant_id, email_verified=True,
    )
    user.phone_number = payload['phone_number']
    user.email = payload['email']
    user.set_password(payload['password'])
    db.session.add(user); db.session.flush()

    # Aadhaar must be unique per tenant by the doctor signup path's own
    # rule. Build a deterministic 12-digit value from idx + tenant prefix
    # so re-runs hit the same number and idempotency holds.
    aadhar = f'2{int(payload["phone_number"][-6:]):011d}'[:12]
    reg_no = f'REG-{tenant_id.hex[:6].upper()}-{idx:03d}'
    doctor = Doctor(
        user_id=user.id, tenant_id=tenant_id,
        aadhar_number=aadhar,
        aadhar_attachment=f'seed/aadhar/{user.id}.pdf',
        registration_number=reg_no,
        registration_certificate=f'seed/reg/{user.id}.pdf',
    )
    db.session.add(doctor)
    db.session.commit()
    return user, False


# ─── Main ─────────────────────────────────────────────────────────────

def main():
    from app import create_app
    from app.extensions import db
    from app.models import (
        User, UserRole, UserStatus, Tenant,
    )
    from app.api.platform.service import (
        PlatformTenantService, PlatformDomainService,
    )
    from app.services.domain_verification import DomainVerificationService

    app = create_app()
    with app.app_context():

        # 0. Sanity — default tenant + a PLATFORM_OWNER must exist so the
        # rest of the seed has something to anchor against. We don't
        # create them here; ``seed_test_combinations.py`` and
        # ``create_platform_owner.py`` do that.
        section('0. Pre-flight')
        default_tenant = Tenant.query.filter_by(is_default=True).first()
        check('default tenant exists', default_tenant is not None,
              detail='run scripts/migrate.py first if missing')
        owner = User.query.filter_by(role=UserRole.PLATFORM_OWNER).first()
        check('PLATFORM_OWNER exists', owner is not None,
              detail='run create_platform_owner.py if missing')
        if not default_tenant or not owner:
            print('aborting pre-flight failures.')
            return 1

        # 1. TENANTS — create each (idempotent), demo custom domain flow
        section('1. Tenants (3 subdomain + 1 custom domain)')
        tenant_objs = {}
        for spec in TENANTS:
            slug = spec['slug']
            existing = Tenant.query.filter_by(slug=slug).first()
            if existing:
                tenant_objs[slug] = existing
                check(f'tenant "{slug}" already exists',
                      True, f'id={existing.id}')
                continue
            try:
                tenant = PlatformTenantService.create_tenant({
                    'name': spec['name'], 'slug': slug,
                })
                tenant_objs[slug] = tenant
                check(f'created tenant "{slug}" ({spec["kind"]})',
                      True, f'id={tenant.id}')
            except Exception as exc:
                check(f'created tenant "{slug}"', False, str(exc))

        # 1b. Custom-domain verification flow on the ishazen tenant.
        # We can't actually publish the TXT record from this script
        # (we don't own the domain), so we set_pending and assert the
        # operator instructions look right. A real operator would then
        # add the TXT record at their DNS provider and POST /verify.
        section('1b. Custom-domain TXT challenge (ishazen.com)')
        ishazen = tenant_objs.get('ishazen')
        if ishazen:
            try:
                challenge = PlatformDomainService.set_domain(
                    ishazen.id, 'ishazen.com',
                )
                check('challenge issued for ishazen.com',
                      challenge['status'] == 'pending')
                check('  ↳ TXT record name uses _lz-verify prefix',
                      challenge['record_name'] == '_lz-verify.ishazen.com',
                      detail=challenge['record_name'])
                check('  ↳ token has lz-verify- prefix',
                      challenge['record_value'].startswith('lz-verify-'))
                print()
                print('  >> OPERATOR ACTION REQUIRED <<')
                print('  Add this DNS record at the ishazen.com authoritative DNS:')
                print(f'    Type:  {challenge["record_type"]}')
                print(f'    Name:  {challenge["record_name"]}')
                print(f'    Value: {challenge["record_value"]}')
                print('  Then POST /api/platform/tenants/<id>/domain/verify')
                print()
                # Re-fetch the row to assert verify() against an unpublished
                # record correctly returns False with status='failed'.
                ok = DomainVerificationService.verify(ishazen)
                check('verify() returns False before TXT is published', not ok,
                      detail=f'status={ishazen.domain_verification_status}')
            except Exception as exc:
                check('custom-domain challenge', False, str(exc))

        # 2. USERS — 10 super_admin / 10 sub_admin / 10 doctor / 10 patient
        # for each tenant. ``ensure_*`` functions are idempotent.
        section('2. Per-tenant users (10 of each role × 4 tenants = 160)')
        seeded = 0
        skipped = 0
        for spec in TENANTS:
            slug = spec['slug']
            tenant = tenant_objs.get(slug)
            if not tenant:
                continue
            t_seeded = 0
            t_skipped = 0
            try:
                for role, count in ROLE_COUNTS.items():
                    for idx in range(1, count + 1):
                        payload = make_user_payload(spec, role, idx)
                        if role in ('super_admin', 'sub_admin'):
                            _user, was_existing = ensure_admin(payload, tenant.id, role)
                        elif role == 'doctor':
                            _user, was_existing = ensure_doctor(payload, tenant.id, idx)
                        else:
                            _user, was_existing = ensure_patient(payload, tenant.id)
                        if was_existing:
                            t_skipped += 1
                        else:
                            t_seeded += 1
                check(f'{slug}: 40 users in place',
                      t_seeded + t_skipped == 40,
                      detail=f'new={t_seeded} existing={t_skipped}')
                seeded += t_seeded
                skipped += t_skipped
            except Exception as exc:
                traceback.print_exc()
                check(f'{slug}: user seeding', False, str(exc))

        # 3. CROSS-TENANT IDENTITY DEMO — same email + phone, two tenants
        # Use a deterministic identity so this stays idempotent.
        section('3. Cross-tenant identity (same person, two tenants)')
        cross_phone = '9999000123'
        cross_email = 'cross.tenant.person@example.com'
        try:
            from app.models import User
            from app.common.encryption import hash_for_search

            for slug in ('acme-demo', 'ishazen'):
                tenant = tenant_objs[slug]
                existing = User.query.filter_by(
                    _phone_hash=hash_for_search(cross_phone),
                    tenant_id=tenant.id,
                ).first()
                if existing:
                    check(f'cross-tenant person already enrolled in {slug}',
                          True, detail=f'user_id={existing.id}')
                    continue
                payload = {
                    'first_name': 'Crossy', 'last_name': 'Identity',
                    'phone_number': cross_phone, 'email': cross_email,
                    'password': DEMO_PASSWORD,
                }
                # Different role in each tenant on purpose:
                # - acme-demo  → super_admin
                # - ishazen    → patient
                if slug == 'acme-demo':
                    ensure_admin(payload, tenant.id, 'super_admin')
                else:
                    ensure_patient(payload, tenant.id)
                check(f'enrolled cross-tenant person in {slug}', True)

            rows = User.query.filter_by(
                _phone_hash=hash_for_search(cross_phone),
                is_deleted=False,
            ).all()
            check('two distinct User rows for same phone+email',
                  len(rows) == 2, detail=f'count={len(rows)}')
            if len(rows) == 2:
                tenant_ids = {str(r.tenant_id) for r in rows}
                expected = {
                    str(tenant_objs['acme-demo'].id),
                    str(tenant_objs['ishazen'].id),
                }
                check('  ↳ rows scoped to acme-demo + ishazen',
                      tenant_ids == expected)
                roles = sorted(r.role.value for r in rows)
                check('  ↳ different roles across tenants',
                      roles == sorted(['super_admin', 'patient']),
                      detail=','.join(roles))
        except Exception as exc:
            check('cross-tenant identity demo', False, str(exc))
            traceback.print_exc()

        # ── Summary ─────────────────────────────────────────────────
        section('Summary')
        passed = sum(1 for _, ok, _ in _results if ok)
        failed = sum(1 for _, ok, _ in _results if not ok)
        print(f'  {PASS} passed: {passed}')
        print(f'  {FAIL} failed: {failed}')
        print()
        print('  Tenants:')
        for spec in TENANTS:
            t = tenant_objs.get(spec['slug'])
            if not t:
                continue
            url = (f'https://{t.slug}.larazen.in'
                   if spec['kind'] == 'subdomain'
                   else f'https://{spec["custom_domain"]}  (DNS verification: {t.domain_verification_status})')
            print(f'    - {spec["slug"]:14} {url}')
        print()
        print(f'  Demo password for every seeded user: {DEMO_PASSWORD!r}')
        print()
        if failed:
            print('Failed checks:')
            for label, ok, detail in _results:
                if not ok:
                    print(f'  {FAIL} {label}  ({detail})')
            return 1
        print('All seed steps OK ✓')
        return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(2)
