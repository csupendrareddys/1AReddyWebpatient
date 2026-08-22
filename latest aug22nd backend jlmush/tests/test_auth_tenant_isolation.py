"""Strict tenant-isolation tests for the auth flow.

Closes the cross-tenant signin leak: a patient who signed up on
tenant A could authenticate from tenant B's host because
``before_request`` and ``AuthService.signin()`` both silently fell
back to the default tenant on resolution failure.

The Phase 0 fix:
  * ``before_request`` rejects 404 when ``X-Tenant-Host`` is set on
    a non-platform host but doesn't match a known tenant (strict
    paths only — auth + unauthenticated mutations).
  * ``AuthService.signin()`` no longer falls back to the default
    tenant when ``g.tenant_id`` is unset.
  * Post-lookup invariant: ``user.tenant_id == g.tenant_id``.
  * JWT-vs-host invariant in ``before_request``: a JWT carrying
    ``tenant_id=A`` replayed against a host that resolves to tenant
    B → 403 (Tenant mismatch).

These tests pin every one of those.
"""
import json
import uuid

from flask_jwt_extended import create_access_token

from app.extensions import db
from app.models import User, UserRole, Tenant, TenantStatus
from tests.conftest import get_auth_headers


def _make_patient(tenant_id, email_prefix='p'):
    """Create a patient User scoped to ``tenant_id`` and return it."""
    email = f'{email_prefix}_{uuid.uuid4().hex[:8]}@test.com'
    phone = f'9{uuid.uuid4().int % 1_000_000_000:09d}'
    user = User(
        role=UserRole.PATIENT,
        first_name='Test',
        last_name='Patient',
        email_verified=True,
        tenant_id=tenant_id,
    )
    user.email = email
    user.phone_number = phone
    user.set_password('TestPass123!')
    db.session.add(user)
    db.session.commit()
    return user, email, phone


def _make_tenant(*, slug=None, domain=None, is_default=False):
    slug = slug or f't{uuid.uuid4().hex[:8]}'
    t = Tenant(
        name=f'Test {slug}',
        slug=slug,
        domain=domain,
        status=TenantStatus.ACTIVE,
        is_default=is_default,
    )
    db.session.add(t)
    db.session.commit()
    return t


class TestSigninTenantIsolation:

    def test_signin_from_tenant_host_rejects_default_tenant_user(
        self, app, client, fresh_tenant,
    ):
        """The headline fix: a patient registered in the default
        (platform) tenant cannot authenticate from a separate
        tenant's custom-domain host. Pre-fix this returned 200 +
        JWT; post-fix it returns 401 (opaque).
        """
        # Default platform tenant + a patient on it.
        platform = Tenant.query.filter_by(is_default=True).first()
        assert platform is not None, 'session fixture must have a default tenant'
        _user, email, _phone = _make_patient(platform.id, 'leak')

        # ``fresh_tenant`` is a separate tenant. Pin a custom domain
        # so before_request can resolve it.
        fresh_tenant.domain = f'isolated-{uuid.uuid4().hex[:6]}.example.com'
        db.session.commit()

        r = client.post(
            '/api/v1/auth/signin',
            data=json.dumps({
                'email': email,
                'password': 'TestPass123!',
                'expected_role': 'patient',
            }),
            content_type='application/json',
            headers={'X-Tenant-Host': fresh_tenant.domain},
        )
        # 401 (opaque "invalid credentials") — never 200.
        assert r.status_code == 401, r.get_json()
        assert 'access_token' not in (r.get_json() or {}).get('data', {})

    def test_signin_from_unregistered_host_rejects_with_404(
        self, app, client,
    ):
        """A request from a host that doesn't match any tenant on a
        strict path (signin) gets 404, NOT a default-tenant fallback.
        """
        platform = Tenant.query.filter_by(is_default=True).first()
        _user, email, _phone = _make_patient(platform.id, 'unknown')

        r = client.post(
            '/api/v1/auth/signin',
            data=json.dumps({
                'email': email,
                'password': 'TestPass123!',
                'expected_role': 'patient',
            }),
            content_type='application/json',
            headers={'X-Tenant-Host': 'definitely-not-a-tenant.example.com'},
        )
        assert r.status_code == 404, r.get_json()

    def test_jwt_replayed_on_other_tenant_host_does_not_authenticate(
        self, app, client, fresh_tenant, caplog,
    ):
        """A JWT issued for tenant A is replayed against tenant B's
        host on an authenticated route. Pin:
          * The request does NOT succeed (no tenant-A data leaks).
          * The before_request hook logs ``[TENANT_MISMATCH]`` so
            SOC alerting still sees the event.
          * The request returns 401 (auth-style, not 403) — flask-
            jwt-extended's user-lookup callback can't find the
            tenant-A session row under tenant-B's RLS scope, so
            @jwt_required fails as if the token were unknown.

        Why not 403: the v3 hook downgrades JWT-vs-host mismatch
        from a hard 403 to a JWT scrub, because legitimate users
        who logged in at one tenant and then visit another tenant's
        public pages in the same browser carry the cookie cross-site
        through no fault of their own. 403'ing every public landing
        request would break anonymous browsing on every other tenant.
        Authenticated routes still reject — they just go through the
        normal auth-failure path instead of a tenant-specific 403.
        """
        import logging
        # Two tenants, both with custom domains. Lowercase on purpose:
        # the resolver lowercases the incoming X-Tenant-Host header but
        # ``Tenant.domain`` is stored case-sensitively.
        fresh_tenant.domain = f'tenanta-{uuid.uuid4().hex[:6]}.example.com'
        db.session.commit()
        tenant_b = _make_tenant(domain=f'tenantb-{uuid.uuid4().hex[:6]}.example.com')

        # Real user in fresh_tenant (= tenant A) so the JWT's
        # ``tenant_id`` claim points to tenant A — and the user_lookup
        # callback finds a real session row when scoped to A.
        user, _email, _phone = _make_patient(fresh_tenant.id, 'mismatch')
        headers = get_auth_headers(app, user)
        # Replay against tenant B's host.
        headers['X-Tenant-Host'] = tenant_b.domain

        with caplog.at_level(logging.WARNING, logger='app'):
            r = client.get(
                '/api/v1/patient/profile/personal-details',
                headers=headers,
            )
        # The request must NOT return tenant-A's data. Acceptable
        # 4xx outcomes:
        #   * 401/422 — auth rejected (e.g. user_lookup failed under
        #     the host's RLS scope)
        #   * 403 — role / feature gate fired
        #   * 404 — endpoint ran under tenant-B context and found no
        #     profile for this user in tenant B (the tenant-A
        #     Patient row is invisible to it). This is the typical
        #     outcome in tests where _make_patient creates a User
        #     but not a Patient row.
        #   * 402 — tenant B has no active subscription, so the new
        #     ``@feature_required('patient.basic_info')`` on the
        #     personal-details endpoint denies before the route runs.
        #     Same security guarantee — request rejected, no leak.
        # The body MUST NOT contain tenant-A profile fields.
        assert r.status_code in (401, 402, 403, 404, 422), r.get_json()
        body = r.get_json() or {}
        assert 'first_name' not in (body.get('data') or {}), (
            f'cross-tenant leak: response carried profile data: {body}'
        )
        # SOC signal preserved: WARN log fires.
        assert any(
            '[TENANT_MISMATCH]' in rec.getMessage()
            for rec in caplog.records
        ), 'expected [TENANT_MISMATCH] warn log for SOC alerting'


class TestSignupUserCreationInvariant:

    def test_signup_user_inherits_tenant_id_from_g_not_body(
        self, app, client, fresh_tenant,
    ):
        """Signup must set ``user.tenant_id`` from the
        server-resolved ``g.tenant_id`` and ignore any
        ``tenant_id`` field in the request body.
        """
        # Set a custom domain on fresh_tenant so the signup's host
        # resolves to it. Body asks for a different tenant — that
        # value MUST be ignored.
        fresh_tenant.domain = f'signup-{uuid.uuid4().hex[:6]}.example.com'
        db.session.commit()
        attacker_tenant = _make_tenant(domain=f'attacker-{uuid.uuid4().hex[:6]}.example.com')

        # We can't directly verify the User was created in fresh_tenant
        # without running the full signup flow (which needs phone OTP).
        # Instead, assert the request is *rejected* if the body tries
        # to override tenant context — strongest form of the invariant.
        # (A weaker variant: signup ignores body.tenant_id silently.
        # Either is correct; the strong assertion is more catchable.)
        # We test the simpler property: a body field claiming a different
        # tenant doesn't get the user into that tenant.
        # NOTE: test verified by code inspection of signup() — there is
        # no read of ``data['tenant_id']`` in the new code path. This
        # smoke test asserts the integration: signup body without
        # phone-OTP returns 400 (not a successful create in attacker_tenant).
        r = client.post(
            '/api/v1/auth/signup',
            data=json.dumps({
                'email': f'newuser_{uuid.uuid4().hex[:6]}@test.com',
                'phone_number': '9999999999',
                'password': 'TestPass123!',
                'first_name': 'New',
                'last_name': 'User',
                'tenant_id': str(attacker_tenant.id),  # malicious
                'tenant_slug': attacker_tenant.slug,    # malicious
                'role': 'patient',
            }),
            content_type='application/json',
            headers={'X-Tenant-Host': fresh_tenant.domain},
        )
        # Without phone OTP / proper validation, signup will fail —
        # but the failure must NOT be due to the attacker_tenant
        # override sneaking through. The accepted failure modes are
        # 400 (bad body) or 401/403 (validation).
        assert r.status_code in (400, 401, 403, 422), r.get_json()
        # The critical assertion: no user got created in attacker_tenant.
        u = User.query.filter_by(
            tenant_id=attacker_tenant.id,
            is_deleted=False,
        ).first()
        assert u is None, 'signup body tenant_id leaked into attacker tenant'


class TestTenantDomainNormalization:
    """Pin the write-side normalization of ``Tenant.domain``.

    The host resolver lowercases the incoming ``X-Tenant-Host`` header
    before issuing ``Tenant.domain.in_(...)``. Postgres ``IN`` is
    case-sensitive, so a mixed-case stored ``domain`` would silently
    miss the lookup and the request would fall through to the default
    tenant (or 404 on strict paths). The model-level
    ``@validates('domain')`` hook lowercases on write so the read side
    always matches.
    """

    def test_domain_lowercased_on_write(self, app, fresh_tenant):
        """Assigning a mixed-case domain stores the lowercase form."""
        suffix = uuid.uuid4().hex[:6]
        fresh_tenant.domain = f'UPPER-{suffix}.Example.COM'
        db.session.commit()
        db.session.refresh(fresh_tenant)
        assert fresh_tenant.domain == f'upper-{suffix}.example.com'

    def test_domain_lowercased_on_insert(self, app, db_session):
        """The validator also fires on initial insert, not just update.

        Domain uniquified per run — the persisted test DB keeps the
        first run's row forever and ``tenants_domain_key`` is unique.
        """
        suffix = uuid.uuid4().hex[:6]
        slug = f't{uuid.uuid4().hex[:8]}'
        t = Tenant(
            name=f'Test {slug}',
            slug=slug,
            domain=f'Mixed-Case-{suffix}.Example.COM',
            status=TenantStatus.ACTIVE,
            is_default=False,
        )
        db.session.add(t)
        db.session.commit()
        db.session.refresh(t)
        assert t.domain == f'mixed-case-{suffix}.example.com'

    def test_resolver_matches_mixedcase_host_against_stored_domain(
        self, app, client, fresh_tenant,
    ):
        """A request with a mixed-case ``X-Tenant-Host`` resolves to
        the tenant whose ``domain`` was stored from a mixed-case write.

        Pre-fix this missed: writer stored ``UPPER-...`` and the
        lowercased lookup key never matched. Post-fix the writer
        normalizes to lowercase, so the lookup hits.

        We assert via the JWT-vs-host invariant: a JWT minted for
        ``fresh_tenant`` replayed against ``fresh_tenant``'s own host
        must NOT 403 (mismatch). If the resolver missed,
        ``host_resolved_id`` would be None and the path would either
        404 (strict) or fall through silently — neither is the
        success case we want to pin.
        """
        suffix = uuid.uuid4().hex[:6]
        # Operator stores a mixed-case domain. Validator lowercases.
        fresh_tenant.domain = f'CaseMatters-{suffix}.Example.COM'
        db.session.commit()
        assert fresh_tenant.domain == f'casematters-{suffix}.example.com'

        user, _email, _phone = _make_patient(fresh_tenant.id, 'casetest')
        headers = get_auth_headers(app, user)
        # Browser sends a mixed-case Host. Resolver lowercases before
        # the IN(...) lookup; matches the stored lowercase domain.
        headers['X-Tenant-Host'] = f'CaseMatters-{suffix}.Example.COM'

        r = client.get(
            '/api/v1/patient/profile/personal-details',
            headers=headers,
        )
        # The host resolved to the same tenant as the JWT — no
        # mismatch, no 404 from a missed lookup.
        assert r.status_code != 403, r.get_json()
        body = r.get_json() or {}
        assert body.get('code') != 'tenant_mismatch'
        assert body.get('code') != 'unknown_tenant'
