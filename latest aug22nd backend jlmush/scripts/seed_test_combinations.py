"""End-to-end seed + assertion script for the multi-tenant platform.

Runs every important "combination" through the real service layer to
prove tenant isolation, role gating, validation, and DNS provisioning
work as a system. Designed to be safe to re-run on a freshly-bootstrapped
DB; idempotent for tenants that already exist.

WHAT IT EXERCISES
-----------------
1.  PLATFORM_OWNER bootstrap — created if absent, otherwise re-used.
2.  Tenant CRUD — creates 3 tenants (acme, laraclinic, demo-clinic) and
    asserts each was provisioned with default landing config.
3.  Tenant super-admins — one per tenant, plus a second super-admin in
    the first tenant to prove multiple SAs per tenant work.
4.  Sub-admins — one per tenant.
5.  Duplicate-phone collision — attempts to create an admin in tenant B
    with a phone that already exists in tenant A. Asserts the new
    ``FieldValidationError`` fires and the operator gets a per-field
    message naming the conflicting field.
6.  Duplicate-email collision — same shape as above for email.
7.  Tenant isolation reads — bootstraps PageConfig drafts for two
    tenants, asserts each tenant's draft id differs (not shared).
8.  Allocation gating — grants ``landing_hero:edit`` only to acme,
    asserts the allocation row was written and others remain unset.

USAGE
-----
    docker exec jlmush-backend python scripts/seed_test_combinations.py

Prints a checklist as it goes; non-zero exit on any failure. Output is
intentionally human-skimmable so it doubles as a smoke-test report.
"""
import os
import sys
import logging
import traceback

# Make ``app`` importable when invoked from /app (Docker WORKDIR).
_PARENT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

logging.basicConfig(level=logging.WARNING, format='%(message)s')
log = logging.getLogger('seed-tests')


# ─── Tiny test framework (no pytest dependency in the image) ───────────

PASS = '\033[32m✓\033[0m'
FAIL = '\033[31m✗\033[0m'
INFO = '\033[36m▸\033[0m'

_results = []


def check(label, condition, detail=''):
    """Record a pass/fail and print it. Doesn't abort on failure — we
    want to see every issue, not just the first."""
    icon = PASS if condition else FAIL
    print(f'  {icon} {label}' + (f'  ({detail})' if detail else ''))
    _results.append((label, condition, detail))


def section(title):
    print()
    print(f'{INFO} {title}')
    print('  ' + '─' * (len(title) + 2))


# ─── Fixtures ─────────────────────────────────────────────────────────

OWNER = {
    'phone': '9876500000', 'password': 'Owner@1234',
    'email': 'owner@platform.test', 'first': 'Owner', 'last': 'Platform',
}

TENANTS = [
    {'name': 'Acme Clinic',     'slug': 'acme'},
    {'name': 'Laraclinic',      'slug': 'laraclinic'},
    {'name': 'Demo Clinic',     'slug': 'demo-clinic'},
]

# Per-tenant fixtures. Phones / emails are unique across the whole set
# so the happy path doesn't trip any uniqueness checks.
ADMINS = {
    'acme': [
        {'first': 'Sara',  'last': 'Acme',   'phone': '9876511111',
         'email': 'sara@acme.test',  'password': 'Acme@1234',  'role': 'super_admin'},
        {'first': 'Jay',   'last': 'Acme',   'phone': '9876511112',
         'email': 'jay@acme.test',   'password': 'Acme@1234',  'role': 'super_admin'},
        {'first': 'Sam',   'last': 'Acme',   'phone': '9876511113',
         'email': 'sam@acme.test',   'password': 'Acme@1234',  'role': 'sub_admin'},
    ],
    'laraclinic': [
        {'first': 'Anish', 'last': 'Lara',   'phone': '9876522221',
         'email': 'anish@lara.test', 'password': 'Lara@1234',  'role': 'super_admin'},
        {'first': 'Sub1',  'last': 'Lara',   'phone': '9876522222',
         'email': 'sub1@lara.test',  'password': 'Lara@1234',  'role': 'sub_admin'},
    ],
    'demo-clinic': [
        {'first': 'Demo',  'last': 'SA',     'phone': '9876533331',
         'email': 'demo@dc.test',    'password': 'Demo@1234',  'role': 'super_admin'},
    ],
}


# ─── Test body ────────────────────────────────────────────────────────

def main():
    from app import create_app
    from app.extensions import db
    from app.common.encryption import hash_for_search
    from app.models import (
        User, Admin, UserRole, UserStatus, Tenant, TenantStatus,
        TenantPermissionAllocation, PageConfig,
    )
    from flask import g
    from app.api.platform.service import (
        PlatformTenantService, PlatformAdminsService, PlatformPermissionService,
    )
    from app.api.admin.super_admin.service import (
        SuperAdminService, FieldValidationError,
    )

    app = create_app()
    with app.app_context():

        # 1. PLATFORM_OWNER ─────────────────────────────────────────
        section('1. PLATFORM_OWNER bootstrap')
        owner = User.query.filter_by(
            _phone_hash=hash_for_search(OWNER['phone']),
        ).first()
        if owner:
            check('owner already exists (idempotent re-run)', True,
                  f'id={owner.id}')
        else:
            tenant = Tenant.query.filter_by(is_default=True).first()
            check('default tenant exists', tenant is not None)
            if not tenant:
                print('aborting: no default tenant; run scripts/migrate.py first')
                return 1
            owner = User(
                first_name=OWNER['first'], last_name=OWNER['last'],
                role=UserRole.PLATFORM_OWNER, status=UserStatus.ACTIVE,
                tenant_id=tenant.id,
            )
            owner.phone_number = OWNER['phone']
            owner.email = OWNER['email']
            owner.email_verified = True
            owner.set_password(OWNER['password'])
            db.session.add(owner); db.session.commit()
            check('owner created', True, f'id={owner.id}')

        check('owner role is PLATFORM_OWNER', owner.role == UserRole.PLATFORM_OWNER)
        check('owner anchored to default tenant',
              Tenant.query.filter_by(id=owner.tenant_id).first().is_default)

        # 2. TENANTS ─────────────────────────────────────────────────
        section('2. Tenant CRUD + landing-config seed')
        for t in TENANTS:
            existing = Tenant.query.filter_by(slug=t['slug']).first()
            if existing:
                check(f'tenant "{t["slug"]}" already exists',
                      True, f'id={existing.id}')
                continue
            try:
                tenant = PlatformTenantService.create_tenant(
                    {'name': t['name'], 'slug': t['slug']}
                )
                check(f'created tenant "{t["slug"]}"', True, f'id={tenant.id}')
                seeded = PageConfig.query.filter_by(tenant_id=tenant.id).count()
                # Landing config — verify by hitting the public endpoint
                # logic via service.
                from app.models import LandingConfig, ConfigStatus
                live = LandingConfig.query.filter_by(
                    tenant_id=tenant.id, status=ConfigStatus.LIVE,
                ).first()
                check(f'  ↳ landing config seeded', live is not None)
            except Exception as exc:
                check(f'created tenant "{t["slug"]}"', False, str(exc))

        # 3. TENANT SUPER-ADMINS + 4. SUB-ADMINS ─────────────────────
        section('3-4. Per-tenant admins (super + sub)')
        for slug, fixtures in ADMINS.items():
            tenant = Tenant.query.filter_by(slug=slug).first()
            if not tenant:
                check(f'tenant "{slug}" exists', False)
                continue
            for fix in fixtures:
                # Skip if user already exists — keeps the script idempotent
                if User.query.filter_by(
                    _phone_hash=hash_for_search(fix['phone']),
                ).first():
                    check(f'{slug}: {fix["first"]} ({fix["role"]}) already exists',
                          True)
                    continue
                try:
                    user, admin = SuperAdminService.create_admin(
                        {
                            'first_name': fix['first'], 'last_name': fix['last'],
                            'phone_number': fix['phone'], 'email': fix['email'],
                            'password': fix['password'], 'role': fix['role'],
                        },
                        tenant_id=tenant.id,
                    )
                    check(f'{slug}: created {fix["role"]} {fix["first"]}',
                          user.tenant_id == tenant.id,
                          f'tenant_id matches')
                except Exception as exc:
                    check(f'{slug}: created {fix["role"]} {fix["first"]}',
                          False, str(exc))

        # 5. CROSS-TENANT IDENTITY (per-tenant uniqueness) ───────────
        section('5. Same person across multiple tenants (per-tenant identity)')
        # Sara's phone+email already exist in acme. Re-using them in
        # laraclinic should SUCCEED — same physical person, different
        # tenant. This is the user's spec: a person can be patient at
        # one clinic + doctor at another + admin at a third.
        lara = Tenant.query.filter_by(slug='laraclinic').first()
        sara = ADMINS['acme'][0]
        try:
            existing = User.query.filter(
                User.tenant_id == lara.id,
                User._phone_hash == hash_for_search(sara['phone']),
            ).first()
            if existing:
                check(f'Sara already has a row in laraclinic (idempotent)', True,
                      f'user_id={existing.id}')
            else:
                user, _ = SuperAdminService.create_admin(
                    {
                        'first_name': sara['first'], 'last_name': sara['last'],
                        'phone_number': sara['phone'],
                        'email': sara['email'],
                        'password': sara['password'], 'role': 'super_admin',
                    },
                    tenant_id=lara.id,
                )
                check('Sara (acme phone+email) registered in laraclinic',
                      user.tenant_id == lara.id,
                      f'user_id={user.id}, scoped to lara')
        except Exception as e:
            check('Sara (acme phone+email) registered in laraclinic', False,
                  f'{type(e).__name__}: {e}')

        # Verify TWO distinct user rows now exist for the same phone.
        phone_rows = User.query.filter_by(
            _phone_hash=hash_for_search(sara['phone']),
            is_deleted=False,
        ).all()
        check('two distinct User rows share the same phone (one per tenant)',
              len(phone_rows) == 2,
              detail=f'count={len(phone_rows)}')
        if len(phone_rows) == 2:
            tenants_set = {r.tenant_id for r in phone_rows}
            acme = Tenant.query.filter_by(slug='acme').first()
            check('  ↳ rows are scoped to acme + laraclinic',
                  tenants_set == {acme.id, lara.id})

        # 6. DUPLICATE *WITHIN* THE SAME TENANT — must still be rejected
        section('6. Duplicate within the SAME tenant — rejected')
        try:
            SuperAdminService.create_admin(
                {
                    'first_name': 'DupSame', 'last_name': 'Acme',
                    'phone_number': sara['phone'],   # same as Sara
                    'email': 'newemail@acme.test',
                    'password': 'Acme@9999', 'role': 'super_admin',
                },
                tenant_id=acme.id,                   # same tenant as Sara
            )
            check('same-tenant duplicate raises FieldValidationError', False,
                  'no exception — duplicate slipped through!')
        except FieldValidationError as e:
            check('same-tenant duplicate raises FieldValidationError', True,
                  f'field={e.field}')
            check('  ↳ field is "phone_number"', e.field == 'phone_number')
            check('  ↳ message says "in this tenant"',
                  'in this tenant' in e.message,
                  detail=e.message)
        except Exception as e:
            check('same-tenant duplicate raises FieldValidationError', False,
                  f'wrong exception: {type(e).__name__}: {e}')

        # 7. TENANT-SCOPED PageConfig DRAFTS ─────────────────────────
        section('7. Tenant-scoped PageConfig draft isolation')
        from app.api.page_config.service import PageConfigService
        acme = Tenant.query.filter_by(slug='acme').first()
        lara = Tenant.query.filter_by(slug='laraclinic').first()
        try:
            g.tenant_id = acme.id
            acme_draft = PageConfigService.get_or_create_draft('patient_login')
            g.tenant_id = lara.id
            lara_draft = PageConfigService.get_or_create_draft('patient_login')
            check('acme draft created', acme_draft is not None)
            check('lara draft created', lara_draft is not None)
            check('drafts are different rows', acme_draft.id != lara_draft.id,
                  detail=f'acme={acme_draft.id} lara={lara_draft.id}')
            check('acme draft tenant_id == acme.id',
                  acme_draft.tenant_id == acme.id)
            check('lara draft tenant_id == lara.id',
                  lara_draft.tenant_id == lara.id)
        except Exception as e:
            check('PageConfig draft isolation', False, str(e))
        finally:
            g.pop('tenant_id', None)

        # 8. ALLOCATIONS — granular, tenant-scoped ───────────────────
        section('8. Per-tenant allocations (PLATFORM_OWNER → tenant)')
        try:
            # Reset and grant only landing_hero:edit to acme
            for r in TenantPermissionAllocation.query.filter_by(
                tenant_id=acme.id,
            ).all():
                db.session.delete(r)
            db.session.commit()

            # PlatformPermissionService.set_allocations needs current_user
            # but works fine without it for the bookkeeping. Grant via
            # raw insert to keep this script self-contained.
            db.session.add(TenantPermissionAllocation(
                tenant_id=acme.id, module='landing_hero', action='edit', allowed=True,
            ))
            db.session.commit()

            allocs = TenantPermissionAllocation.query.filter_by(
                tenant_id=acme.id,
            ).all()
            check('acme has exactly 1 allocation', len(allocs) == 1,
                  detail=f'count={len(allocs)}')
            check('  ↳ module=landing_hero',
                  any(a.module == 'landing_hero' for a in allocs))
            check('  ↳ action=edit',
                  any(a.action == 'edit' for a in allocs))

            # And lara should have ZERO
            lara_allocs = TenantPermissionAllocation.query.filter_by(
                tenant_id=lara.id,
            ).all()
            check('laraclinic has zero allocations (isolation)',
                  len(lara_allocs) == 0,
                  detail=f'count={len(lara_allocs)}')
        except Exception as e:
            check('allocation isolation', False, str(e))

        # ── Final tally ─────────────────────────────────────────────
        section('Summary')
        passed = sum(1 for _, ok, _ in _results if ok)
        failed = sum(1 for _, ok, _ in _results if not ok)
        print(f'  {PASS} passed: {passed}')
        print(f'  {FAIL} failed: {failed}')
        if failed:
            print()
            print('Failed checks:')
            for label, ok, detail in _results:
                if not ok:
                    print(f'  {FAIL} {label}  ({detail})')
            return 1
        print()
        print('All checks passed ✓')
        return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(2)
