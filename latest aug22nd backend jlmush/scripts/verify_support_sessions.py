"""Prove the vendor can no longer reach customer data unannounced.

Drives real HTTP through the Flask test client, because the whole point is
what the decorators do to a live request.

Checks, in order:
  1. Control plane still works on the vendor host  (must stay 200)
  2. A customer tenant's business API, no session   (must be 403)
  3. Open a support session                          (201)
  4. Same call again                                 (must be 200)
  5. Revoke                                          (200)
  6. Same call again                                 (must be 403 again)
  7. The tenant's OWN super-admin is unaffected      (must not be 403)
  8. The grant is recorded and shows it was used

Exits non-zero on any failure.
"""
import sys

from app import create_app
from app.extensions import db
from app.models import Tenant, User, UserRole
from app.models.support_session import SupportSession

FAILURES = []

# A tenant-scoped business API behind @role_required(SUPER_ADMIN):
# reading a tenant's own admin roster.
TARGET_PATH = '/api/admin/super-admin/admins'


def check(label, actual, expected):
    ok = actual == expected
    print('  [%s] %-52s got=%s want=%s'
          % ('PASS' if ok else 'FAIL', label, actual, expected))
    if not ok:
        FAILURES.append(label)


def check_not(label, actual, forbidden):
    ok = actual != forbidden
    print('  [%s] %-52s got=%s want!=%s'
          % ('PASS' if ok else 'FAIL', label, actual, forbidden))
    if not ok:
        FAILURES.append(label)


def signin(client, email, password, host):
    r = client.post('/auth/signin', json={'email': email, 'password': password},
                    headers={'Host': host})
    body = r.get_json() or {}
    return (body.get('data') or {}).get('access_token')


def main():
    app = create_app()
    with app.app_context():
        vendor = Tenant.query.filter_by(is_platform=True).first()
        customer = Tenant.query.filter_by(slug='larazen').first()
        if not vendor or not customer:
            raise SystemExit('need both a vendor tenant and the larazen tenant')

        owner = User.query.filter_by(
            role=UserRole.PLATFORM_OWNER, is_deleted=False,
        ).first()

        # Start from a clean slate so a leftover grant can't fake a pass.
        SupportSession.query.filter_by(
            platform_user_id=owner.id, target_tenant_id=customer.id,
        ).delete(synchronize_session=False)
        db.session.commit()

        client = app.test_client()
        vendor_host = (vendor.domain or 'localhost')
        customer_host = customer.domain

        token = signin(client, 'owner@platform-seed.test', 'Owner@1234', vendor_host)
        if not token:
            raise SystemExit(
                'could not sign in the platform owner on %s (session cap?)'
                % vendor_host
            )
        auth = {'Authorization': 'Bearer %s' % token}

        print('vendor host   =', vendor_host)
        print('customer host =', customer_host)
        print()

        print('== 1. control plane still works ==')
        r = client.get('/api/platform/tenants',
                       headers={**auth, 'Host': vendor_host})
        check('GET /api/platform/tenants', r.status_code, 200)

        # Reaching a customer tenant means resolving into it. The header is
        # the same lever an attacker would pull, which is exactly why the
        # decorator must not rely on the host alone.
        cust_headers = {**auth, 'Host': vendor_host,
                        'X-Tenant-Host': customer_host}

        print('== 2. customer data WITHOUT a session ==')
        r = client.get(TARGET_PATH, headers=cust_headers)
        check('%s -> denied' % TARGET_PATH, r.status_code, 403)

        print('== 3. open a support session ==')
        r = client.post(
            '/api/platform/support-sessions',
            headers={**auth, 'Host': vendor_host},
            json={'tenant_id': str(customer.id),
                  'reason': 'Investigating a reported booking failure',
                  'minutes': 30},
        )
        check('POST /support-sessions', r.status_code, 201)
        session_id = ((r.get_json() or {}).get('data') or {}).get('id')

        print('== 4. same call WITH a session ==')
        r = client.get(TARGET_PATH, headers=cust_headers)
        check_not('%s -> allowed' % TARGET_PATH, r.status_code, 403)

        print('== 5-6. revoke, then denied again ==')
        r = client.delete('/api/platform/support-sessions/%s' % session_id,
                          headers={**auth, 'Host': vendor_host})
        check('DELETE /support-sessions/<id>', r.status_code, 200)

        r = client.get(TARGET_PATH, headers=cust_headers)
        check('%s -> denied after revoke' % TARGET_PATH, r.status_code, 403)

        print('== 7. the tenant\'s own super-admin is unaffected ==')
        sa_token = signin(client, 'super_admin01@platform-seed.test',
                          'Demo@1234', customer_host)
        if sa_token:
            r = client.get(TARGET_PATH, headers={
                'Authorization': 'Bearer %s' % sa_token, 'Host': customer_host,
            })
            check_not('tenant super_admin still allowed', r.status_code, 403)
        else:
            print('  [SKIP] could not sign in tenant super_admin (session cap)')

        print('== 8. the grant is on the record ==')
        row = SupportSession.query.get(session_id)
        check('recorded', row is not None, True)
        if row:
            check('status after revoke', row.status, 'revoked')
            check('reason kept', bool(row.reason), True)
            ok = (row.use_count or 0) > 0
            print('  [%s] grant records it was used (use_count=%s)'
                  % ('PASS' if ok else 'FAIL', row.use_count))
            if not ok:
                FAILURES.append('use_count')

    print()
    if FAILURES:
        print('FAILED (%d): %s' % (len(FAILURES), ', '.join(FAILURES)))
        sys.exit(1)
    print('all checks passed')


if __name__ == '__main__':
    main()
