"""Phase 3 tests — trusted-host tenant resolution.

Phase 0 wired ``X-Tenant-Host`` (a client-supplied header) as the
primary signal. Phase 3 demotes that to a legacy/test-only path and
makes ``request.host`` (the literal HTTP Host header, possibly
forwarded through ProxyFix) the source of truth.

Pin:
  * Resolution from ``request.host`` matches the same Tenant.domain
    that ``X-Tenant-Host`` would have. (Equivalence under the new path.)
  * When ``BACKEND_TRUST_TENANT_HOST_HEADER`` is OFF, sending
    ``X-Tenant-Host`` is a no-op — only ``request.host`` resolves.
  * When ProxyFix is enabled and ``X-Forwarded-Host`` is set, the
    forwarded value drives resolution.
  * Spoof guard: with ``TRUSTED_PROXY_IPS`` pinned, an
    ``X-Forwarded-Host`` from a non-allowlisted source returns 400
    ``untrusted_proxy``.

These tests run with the existing fixtures so they're additive — the
Phase 0/1/2 suites stay untouched.
"""
import json
import uuid

from app.extensions import db
from app.models import Tenant, TenantStatus, UserRole, UserStatus, User


def _signin_with_host(client, *, host, email, password):
    """Use Werkzeug's ``host=`` to set the literal HTTP Host header.
    No ``X-Tenant-Host`` sent — the Phase 3 way."""
    return client.post(
        '/api/v1/auth/signin',
        data=json.dumps({
            'email': email,
            'password': password,
            'expected_role': 'patient',
        }),
        content_type='application/json',
        # Werkzeug forwards this as the actual ``Host:`` header on the
        # synthetic WSGI request → request.host.
        headers={'Host': host},
    )


class TestTrustedHostResolution:
    """``request.host`` resolves to the right tenant, no header
    needed."""

    def test_signin_succeeds_via_request_host_alone(
        self, app, client, tenant_world,
    ):
        """Phase 3: tenant A's user signs in from tenant A's host
        WITHOUT sending X-Tenant-Host — backend resolves via
        request.host."""
        a = tenant_world['tenant_a']
        _user, email, _phone, password = a['patient']
        # Mark the user ACTIVE (helper does this; documenting the
        # invariant) and just hit signin without any X-Tenant-* header.
        r = _signin_with_host(
            client,
            host=a['tenant'].domain,
            email=email,
            password=password,
        )
        assert r.status_code == 200, r.get_json()
        body = r.get_json().get('data', {})
        assert body.get('access_token'), 'expected JWT in response body'

    def test_signin_rejected_via_request_host_alone(
        self, app, client, tenant_world,
    ):
        """Phase 3: tenant A's user signing in from tenant B's host
        (via request.host, no override header) → 401, not a
        cross-tenant leak."""
        a = tenant_world['tenant_a']
        b = tenant_world['tenant_b']
        _user, email, _phone, password = a['patient']
        r = _signin_with_host(
            client,
            host=b['tenant'].domain,
            email=email,
            password=password,
        )
        assert r.status_code == 401, r.get_json()
        assert 'access_token' not in (r.get_json() or {}).get('data', {})

    def test_unknown_request_host_rejects_with_404(
        self, app, client, tenant_world,
    ):
        """Phase 3: a host that doesn't match any tenant on a strict
        path returns 404 — same as the X-Tenant-Host case."""
        a = tenant_world['tenant_a']
        _user, email, _phone, password = a['patient']
        r = _signin_with_host(
            client,
            host='no-such-tenant-' + uuid.uuid4().hex[:6] + '.example.com',
            email=email,
            password=password,
        )
        assert r.status_code == 404, r.get_json()


class TestTenantHostHeaderTrustToggle:
    """When ``BACKEND_TRUST_TENANT_HOST_HEADER`` is OFF, the legacy
    header is ignored — only ``request.host`` resolves."""

    def test_x_tenant_host_ignored_when_flag_off(
        self, app, client, tenant_world,
    ):
        """Tenant A's user, with X-Tenant-Host set to A but
        request.host pointing at B, should get the SAME outcome as if
        no header were sent (i.e. routed by request.host = B → 401).
        Pre-Phase-3 this would have routed by X-Tenant-Host = A and
        succeeded — exactly the trust-the-client bug we're closing.
        """
        a = tenant_world['tenant_a']
        b = tenant_world['tenant_b']
        _user, email, _phone, password = a['patient']
        # Flip the trust flag off for this test only.
        prior = app.config.get('BACKEND_TRUST_TENANT_HOST_HEADER', True)
        app.config['BACKEND_TRUST_TENANT_HOST_HEADER'] = False
        try:
            r = client.post(
                '/api/v1/auth/signin',
                data=json.dumps({
                    'email': email,
                    'password': password,
                    'expected_role': 'patient',
                }),
                content_type='application/json',
                # request.host = B's domain
                headers={
                    'Host': b['tenant'].domain,
                    # Legacy header trying to override → must be ignored.
                    'X-Tenant-Host': a['tenant'].domain,
                },
            )
        finally:
            app.config['BACKEND_TRUST_TENANT_HOST_HEADER'] = prior

        assert r.status_code == 401, r.get_json()


class TestForwardedHostSpoofGuard:
    """Pin TRUSTED_PROXY_IPS spoof rejection. Skipped when the trust
    flag is off (the guard is a no-op then)."""

    def test_xforwarded_host_from_untrusted_source_rejected(
        self, app, client, tenant_world,
    ):
        a = tenant_world['tenant_a']
        # Enable the trust flag + pin a fake allowlist that won't match
        # the test client's source IP (Werkzeug uses 127.0.0.1).
        prior_trust = app.config.get('BACKEND_TRUST_X_FORWARDED_HOST')
        prior_ips = app.config.get('TRUSTED_PROXY_IPS')
        app.config['BACKEND_TRUST_X_FORWARDED_HOST'] = True
        app.config['TRUSTED_PROXY_IPS'] = ('10.99.99.99',)  # not 127.x
        try:
            r = client.get(
                '/api/v1/landing/public',
                headers={
                    'Host': 'attacker.example.com',
                    'X-Forwarded-Host': a['tenant'].domain,  # spoof attempt
                },
            )
        finally:
            app.config['BACKEND_TRUST_X_FORWARDED_HOST'] = prior_trust
            app.config['TRUSTED_PROXY_IPS'] = prior_ips

        # 400 ``untrusted_proxy`` — operator visibility, not 403/401.
        assert r.status_code == 400, r.get_json()
        body = r.get_json() or {}
        assert body.get('code') == 'untrusted_proxy'
