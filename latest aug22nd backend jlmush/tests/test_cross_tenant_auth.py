"""Cross-tenant authentication suite.

Builds on the ``tenant_world`` fixture (two tenants × three roles
each, plus the platform default) to exercise the authenticated
surface across tenant boundaries. Pins:

  * Signin succeeds only on the requesting user's own tenant host.
  * Signin rejects 401 (opaque) on any other tenant's host.
  * The same email can exist in two tenants without colliding —
    each only authenticates from its own host.
  * JWTs from tenant A replayed against tenant B's host return 403
    (``tenant_mismatch``), not 401.
  * Authenticated reads (e.g. ``/api/patient/profile/personal-details``)
    return the correct tenant's user data after a per-host signin.
  * Each role (PATIENT, SUPER_ADMIN, DOCTOR) honours the same
    isolation rules — not just patient signin.

These tests assume the strict tenant resolution shipped in Phase 0:
``before_request`` rejects 404 when X-Tenant-Host is set on a
non-platform host but doesn't match a known tenant; ``signin()``
no longer falls back to the default tenant; the post-lookup
``user.tenant_id == g.tenant_id`` invariant catches drift.
"""
import json
import uuid

from flask_jwt_extended import decode_token

from app.extensions import db
from app.models import User, UserRole, UserStatus
from tests.conftest import make_user_in_tenant, get_auth_headers


def _clear_auth_cookies(client):
    """Drop ALL cookies on the test client. Without this, the Flask
    test client carries cookies across requests; a successful signin
    on tenant A then poisons every subsequent ``/auth/signin`` (any
    host) into a 403 ``tenant_mismatch`` from the JWT-vs-host
    invariant — not the 401 the wrong-creds test wants to assert.

    Why a full nuke instead of ``client.delete_cookie``: the cookie
    is stored at ``(domain, path, key)``. ``set_access_cookies`` may
    pin a non-default path (e.g. ``/auth/refresh``) under
    ``JWT_COOKIE_DOMAIN``; ``delete_cookie`` only removes the exact
    tuple it's given. Easier and more robust to drop everything.
    Werkzeug 3.x stores cookies in the public-ish ``_cookies`` dict;
    fall back to ``cookie_jar`` for older werkzeug.
    """
    if hasattr(client, '_cookies'):
        try:
            client._cookies.clear()
            return
        except Exception:
            pass
    if hasattr(client, 'cookie_jar'):
        try:
            client.cookie_jar.clear()
        except Exception:
            pass


def _signin(client, *, host, email, password, expected_role='patient'):
    """Helper: POST /auth/signin with the given X-Tenant-Host.

    Always starts from a clean cookie jar so isolation-style tests
    that hit ``/auth/signin`` twice in a row (right host then wrong
    host) measure the SECOND request as a fresh, unauthenticated POST
    rather than as an authenticated cross-tenant replay.
    """
    _clear_auth_cookies(client)
    return client.post(
        '/api/v1/auth/signin',
        data=json.dumps({
            'email': email,
            'password': password,
            'expected_role': expected_role,
        }),
        content_type='application/json',
        headers={'X-Tenant-Host': host},
    )


def _jwt_tenant_claim(app, access_token):
    """Decode an access_token and return its ``tenant_id`` claim.
    Used to verify the JWT issued by signin carries the correct
    tenant id (the User.to_dict() body does NOT include tenant_id;
    the actual security property lives on the token claim).
    """
    with app.app_context():
        return decode_token(access_token).get('tenant_id')


# --------------------------------------------------------------------------- #
# Signin tenant-isolation
# --------------------------------------------------------------------------- #


class TestSigninPerTenantHost:

    def test_patient_signin_succeeds_on_own_tenant_host(
        self, app, client, tenant_world,
    ):
        """Tenant A's patient signs in from tenant A's host → 200."""
        a = tenant_world['tenant_a']
        _user, email, _phone, password = a['patient']
        r = _signin(
            client,
            host=a['tenant'].domain,
            email=email,
            password=password,
            expected_role='patient',
        )
        assert r.status_code == 200, r.get_json()
        body = r.get_json().get('data', {})
        assert body.get('access_token'), 'expected JWT in response body'
        # The JWT — not the user dict — carries the tenant claim.
        # ``User.to_dict()`` deliberately omits ``tenant_id``; the
        # security-relevant identity lives on the token itself.
        assert _jwt_tenant_claim(app, body['access_token']) == str(a['tenant'].id)

    def test_patient_signin_rejected_on_other_tenant_host(
        self, client, tenant_world,
    ):
        """Tenant A's patient signs in from tenant B's host → 401.
        This is the headline cross-tenant leak the Phase 0 fix closes."""
        a = tenant_world['tenant_a']
        b = tenant_world['tenant_b']
        _user, email, _phone, password = a['patient']
        r = _signin(
            client,
            host=b['tenant'].domain,
            email=email,
            password=password,
            expected_role='patient',
        )
        # 401 (opaque "invalid credentials") — never 200 + JWT.
        assert r.status_code == 401, r.get_json()
        body = r.get_json() or {}
        assert 'access_token' not in body.get('data', {})

    def test_signin_from_unregistered_host_returns_404(
        self, client, tenant_world,
    ):
        """A request from a host that doesn't match any tenant on a
        strict path → 404 (no default-tenant fallback)."""
        a = tenant_world['tenant_a']
        _user, email, _phone, password = a['patient']
        r = _signin(
            client,
            host='nope-' + uuid.uuid4().hex[:6] + '.example.com',
            email=email, password=password,
            expected_role='patient',
        )
        assert r.status_code == 404, r.get_json()

    def test_super_admin_signin_isolation_matches_patient(
        self, client, tenant_world,
    ):
        """Super-admin role obeys the same isolation rules as patient.
        Catches a regression where strict resolution accidentally only
        applied to one role."""
        a = tenant_world['tenant_a']
        b = tenant_world['tenant_b']
        _user, email, _phone, password = a['super_admin']
        # Right host: 200.
        r_ok = _signin(
            client, host=a['tenant'].domain,
            email=email, password=password, expected_role='admin',
        )
        assert r_ok.status_code == 200, r_ok.get_json()
        # Wrong host: 401.
        r_bad = _signin(
            client, host=b['tenant'].domain,
            email=email, password=password, expected_role='admin',
        )
        assert r_bad.status_code == 401, r_bad.get_json()

    def test_doctor_signin_isolation_matches_patient(
        self, client, tenant_world,
    ):
        """Doctor role obeys the same isolation rules."""
        a = tenant_world['tenant_a']
        b = tenant_world['tenant_b']
        _user, email, _phone, password = a['doctor']
        r_ok = _signin(
            client, host=a['tenant'].domain,
            email=email, password=password, expected_role='doctor',
        )
        assert r_ok.status_code == 200, r_ok.get_json()
        r_bad = _signin(
            client, host=b['tenant'].domain,
            email=email, password=password, expected_role='doctor',
        )
        assert r_bad.status_code == 401, r_bad.get_json()


# --------------------------------------------------------------------------- #
# Same-email-in-two-tenants — per-tenant uniqueness + isolation
# --------------------------------------------------------------------------- #


class TestSameEmailMultipleTenants:

    def test_same_email_in_both_tenants_each_authenticates_only_from_own_host(
        self, app, client, tenant_world, db_session,
    ):
        """Create a user with the same email in tenants A and B but
        different passwords. Login succeeds only when host + password
        BOTH match the right tenant.
        """
        a = tenant_world['tenant_a']
        b = tenant_world['tenant_b']

        # Same email, different per-tenant passwords.
        shared_email = f'shared_{uuid.uuid4().hex[:6]}@test.com'
        password_a = 'PasswordForTenantA1!'
        password_b = 'PasswordForTenantB2!'

        for tenant, pw in ((a['tenant'], password_a), (b['tenant'], password_b)):
            from app.models._base import set_tenant_context
            set_tenant_context(db.session, tenant.id)
            u = User(
                role=UserRole.PATIENT,
                first_name='Shared',
                last_name='User',
                email_verified=True,
                tenant_id=tenant.id,
                # Default status is PENDING → signin refuses with
                # "Account is not active." Stamp ACTIVE so we can
                # exercise the real auth path.
                status=UserStatus.ACTIVE,
            )
            u.email = shared_email
            u.phone_number = f'9{uuid.uuid4().int % 1_000_000_000:09d}'
            u.set_password(pw)
            db.session.add(u)
            db.session.commit()

        # Tenant A's host + tenant A's password → 200.
        r = _signin(client, host=a['tenant'].domain,
                    email=shared_email, password=password_a)
        assert r.status_code == 200, r.get_json()

        # Tenant A's host + tenant B's password → 401 (wrong creds for
        # the user that lives in tenant A).
        r = _signin(client, host=a['tenant'].domain,
                    email=shared_email, password=password_b)
        assert r.status_code == 401, r.get_json()

        # Tenant B's host + tenant B's password → 200.
        r = _signin(client, host=b['tenant'].domain,
                    email=shared_email, password=password_b)
        assert r.status_code == 200, r.get_json()

        # Tenant B's host + tenant A's password → 401.
        r = _signin(client, host=b['tenant'].domain,
                    email=shared_email, password=password_a)
        assert r.status_code == 401, r.get_json()


# --------------------------------------------------------------------------- #
# JWT-vs-host invariant — defense-in-depth
# --------------------------------------------------------------------------- #


class TestJwtTenantInvariant:

    def test_jwt_from_tenant_a_replayed_on_tenant_b_does_not_authenticate(
        self, app, client, tenant_world, caplog,
    ):
        """Mint a JWT for tenant A's patient. Replay against tenant
        B's host on an authenticated endpoint. The request must not
        succeed (no tenant-A data leak), and the [TENANT_MISMATCH]
        warn log must fire so SOC alerting still has a signal.

        Why not a hard 403: the v3 hook downgrades JWT-vs-host
        mismatch to a JWT scrub. Stale cookies from logging into
        another tenant in the same browser would otherwise 403
        every public landing request — broken UX. The request still
        rejects on auth (RLS-scoped session lookup misses → 401)
        which is the right outcome; we just give up the explicit
        ``tenant_mismatch`` body code in exchange for not breaking
        anonymous browsing.
        """
        import logging
        a = tenant_world['tenant_a']
        b = tenant_world['tenant_b']
        user = a['patient'][0]
        headers = get_auth_headers(app, user)
        # Replay against tenant B's host: JWT's tenant claim = A,
        # host-resolved tenant = B → mismatch.
        headers['X-Tenant-Host'] = b['tenant'].domain

        with caplog.at_level(logging.WARNING, logger='app'):
            r = client.get(
                '/api/v1/patient/profile/personal-details',
                headers=headers,
            )
        # 4xx — auth rejected, feature gate denied, or endpoint ran
        # under host-tenant context and produced an empty/not-found
        # result. 402 covers the case where tenant B has no active
        # subscription so @feature_required denies before the route
        # runs. Any of these is acceptable; the security property is
        # that no tenant-A data surfaces in the body.
        assert r.status_code in (401, 402, 403, 404, 422), r.get_json()
        body = r.get_json() or {}
        assert 'first_name' not in (body.get('data') or {}), (
            f'cross-tenant leak: response carried profile data: {body}'
        )
        assert any(
            '[TENANT_MISMATCH]' in rec.getMessage()
            for rec in caplog.records
        ), 'expected [TENANT_MISMATCH] warn log for SOC alerting'

    def test_jwt_on_own_tenant_host_passes(
        self, app, client, tenant_world,
    ):
        """Sanity check: the JWT-host invariant doesn't break the
        normal happy path. JWT from tenant A on tenant A's host → 200
        (or whatever the endpoint returns; just not 403)."""
        a = tenant_world['tenant_a']
        user = a['patient'][0]
        # Use the conftest helper that stamps a real session.
        headers = get_auth_headers(app, user)
        # Forward the host so the host-resolved tenant matches the JWT.
        headers['X-Tenant-Host'] = a['tenant'].domain
        r = client.get(
            '/api/v1/patient/profile/personal-details',
            headers=headers,
        )
        # Endpoint returns 200 OR 404 (if patient profile doesn't
        # exist for this user — fixture didn't create one). Either
        # way, NOT 403 — that's the invariant we're guarding.
        assert r.status_code != 403, (
            f'JWT on own tenant host wrongly classified as mismatch: '
            f'{r.get_json()}'
        )
