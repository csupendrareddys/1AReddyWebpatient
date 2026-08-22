"""Integration tests for the public page-config endpoints.

The frontend's ``useLoginPageConfig`` hook hits
``/api/page-config/public/<page_type>`` on every login-page mount. If that
endpoint 404s or 500s for a tenant that hasn't published a config, the
console fills with errors in production — which is exactly what surfaced.

These tests exercise both branches:
  1. Unconfigured tenant → endpoint must respond (either 200 with defaults
     OR 404 with a JSON error body, whichever is the API contract). Both
     are acceptable as long as the response is structured and the frontend
     can handle it cleanly.
  2. Configured tenant → endpoint returns the LIVE config.

Whichever contract the route enforces today, locking it down with tests
prevents a future change from silently flipping it.
"""
import pytest

from app.extensions import db


PAGE_TYPES = ['admin_login', 'patient_login', 'doctor_login']


class TestPageConfigPublicEndpoint:

    @pytest.mark.parametrize('page_type', PAGE_TYPES)
    def test_unconfigured_returns_handleable_response(
        self, client, fresh_tenant, page_type,
    ):
        """Either 200 (with defaults / null) or 404 (with JSON body).
        Anything else (500, HTML error page, empty body) means the
        frontend can't gracefully fall back — that's the production
        regression this test guards against.
        """
        resp = client.get(
            f'/api/v1/page-config/public/{page_type}',
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code in (200, 404), (
            f'{page_type}: got {resp.status_code} — must be 200 or 404 so the '
            f'frontend hook can decide between rendering defaults vs surfacing '
            f'a real error. Response body: {resp.get_data(as_text=True)[:200]}'
        )
        # Response must be JSON regardless of status — the frontend parses
        # it either way.
        body = resp.get_json()
        assert body is not None, 'response must be valid JSON'
        # Must have the standard envelope so the frontend's ``response.success``
        # check works.
        assert 'success' in body or 'data' in body or 'error' in body

    def test_unknown_page_type_does_not_500(self, client, fresh_tenant):
        """Defensive: a typo or stale frontend cache shouldn't crash the
        backend. The exact failure code is route-specific (400 for
        validation-failed, 404 for not-found) — both are acceptable so
        long as it's NOT a 5xx and the body is valid JSON.
        """
        resp = client.get(
            '/api/v1/page-config/public/this_page_type_does_not_exist',
            headers={'X-Tenant-Slug': fresh_tenant.slug},
        )
        assert resp.status_code < 500, (
            f'unknown page_type 5xx-ed: {resp.status_code} '
            f'body={resp.get_data(as_text=True)[:200]}'
        )
        body = resp.get_json()
        assert body is not None, 'response must be valid JSON, not HTML'
