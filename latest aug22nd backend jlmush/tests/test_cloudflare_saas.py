"""Cloudflare Pages Custom Domains service tests.

Pins the behaviour added to :mod:`app.services.cloudflare_saas`:

  * ``_config()`` reads ``CLOUDFLARE_API_TOKEN`` /
    ``CLOUDFLARE_ACCOUNT_ID`` / ``CLOUDFLARE_PAGES_PROJECT_NAME``
    and raises ``CloudflareNotConfigured`` cleanly when any are
    missing.
  * ``create_or_update(tenant)`` POSTs to
    ``/accounts/{id}/pages/projects/{name}/domains`` and persists
    ``id`` / ``status`` / verification fields onto the tenant row.
  * On code 8000035 ("Domain is already part of this project") the
    service falls through to a ``GET .../{domain}`` for idempotency.
  * ``refresh_cloudflare_state(tenant)`` re-populates the same columns
    from a ``GET .../{domain}``, and treats 404 as "binding deleted
    upstream" (clears state, surfaces an error, doesn't blow up).
  * ``delete(tenant)`` issues ``DELETE .../{domain}`` and treats 404
    as success (idempotent).
  * ``pick_app_with_free_slot()`` returns the configured project name.

Each test patches ``cloudflare_saas._client`` so no real Cloudflare
API call is made.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.extensions import db


# ────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────


def _configure_cf(app):
    """Set the three required env vars on the Flask app config."""
    app.config['CLOUDFLARE_API_TOKEN'] = 'test-token'
    app.config['CLOUDFLARE_ACCOUNT_ID'] = 'acct-abc123'
    app.config['CLOUDFLARE_PAGES_PROJECT_NAME'] = 'jlmushfrontend'
    app.config['CLOUDFLARE_PAGES_TARGET'] = ''  # exercise the default


def _unconfigure_cf(app):
    for k in (
        'CLOUDFLARE_API_TOKEN',
        'CLOUDFLARE_ACCOUNT_ID',
        'CLOUDFLARE_PAGES_PROJECT_NAME',
        'CLOUDFLARE_PAGES_TARGET',
    ):
        app.config[k] = ''


def _mock_response(status_code=200, body=None):
    body = body if body is not None else {'success': True, 'result': {}}
    r = MagicMock()
    r.status_code = status_code
    r.ok = 200 <= status_code < 300
    r.json.return_value = body
    return r


_DEFAULT = object()


def _make_tenant(app, *, domain=_DEFAULT, cf_hostname_id=None):
    """Insert a Tenant row scoped for the CF tests.

    ``domain`` is randomized per-call so the ``tenants_domain_key``
    UNIQUE constraint doesn't collide across tests (the helper commits
    outside the ``db_session`` rollback envelope, so hard-coded values
    leak between cases). Pass ``domain=None`` explicitly to create a
    tenant with no custom domain set.
    """
    from app.models import Tenant, TenantStatus
    import uuid
    if domain is _DEFAULT:
        domain = f'cf-{uuid.uuid4().hex[:10]}.example.com'
    t = Tenant(
        name='CF Test Tenant',
        slug=f't{uuid.uuid4().hex[:8]}',
        domain=domain,
        status=TenantStatus.ACTIVE,
        is_default=False,
        cf_hostname_id=cf_hostname_id,
    )
    db.session.add(t)
    db.session.commit()
    return t


# Sample Pages Custom Domain response payload (representative).
_FAKE_DOMAIN_PAYLOAD = {
    'name': 'clinic.example.com',
    'domain_id': 'pages-domain-uuid-1',
    'status': 'pending',
    'verification_data': {
        'status': 'pending',
        'reason': 'CNAME record not detected',
    },
    'validation_data': None,
    'certificate_authority': 'lets_encrypt',
    'created_on': '2026-05-14T12:00:00Z',
}


# ────────────────────────────────────────────────────────────────────
# _config + is_configured
# ────────────────────────────────────────────────────────────────────


class TestConfig:
    def test_is_configured_true_when_all_set(self, app):
        with app.app_context():
            _configure_cf(app)
            from app.services.cloudflare_saas import is_configured
            assert is_configured() is True

    def test_is_configured_false_when_token_missing(self, app):
        with app.app_context():
            _configure_cf(app)
            app.config['CLOUDFLARE_API_TOKEN'] = ''
            from app.services.cloudflare_saas import is_configured
            assert is_configured() is False

    def test_is_configured_false_when_account_missing(self, app):
        with app.app_context():
            _configure_cf(app)
            app.config['CLOUDFLARE_ACCOUNT_ID'] = ''
            from app.services.cloudflare_saas import is_configured
            assert is_configured() is False

    def test_is_configured_false_when_project_missing(self, app):
        with app.app_context():
            _configure_cf(app)
            app.config['CLOUDFLARE_PAGES_PROJECT_NAME'] = ''
            from app.services.cloudflare_saas import is_configured
            assert is_configured() is False

    def test_config_pages_target_defaults_to_project_pages_dev(self, app):
        with app.app_context():
            _configure_cf(app)
            from app.services.cloudflare_saas import _config
            _, _, project, target = _config()
            assert project == 'jlmushfrontend'
            assert target == 'jlmushfrontend.pages.dev'

    def test_config_pages_target_override(self, app):
        """When ``CLOUDFLARE_PAGES_TARGET`` is set, it wins over the
        ``<project>.pages.dev`` default — lets ops point tenants at an
        in-zone hostname bound to Pages."""
        with app.app_context():
            _configure_cf(app)
            app.config['CLOUDFLARE_PAGES_TARGET'] = 'www.larazen.in'
            from app.services.cloudflare_saas import _config
            _, _, _, target = _config()
            assert target == 'www.larazen.in'

    def test_config_raises_when_unconfigured(self, app):
        with app.app_context():
            _unconfigure_cf(app)
            from app.services.cloudflare_saas import (
                _config, CloudflareNotConfigured,
            )
            with pytest.raises(CloudflareNotConfigured):
                _config()


# ────────────────────────────────────────────────────────────────────
# pick_app_with_free_slot — returns project name
# ────────────────────────────────────────────────────────────────────


class TestPickAppStub:
    def test_returns_project_name(self, app):
        with app.app_context():
            _configure_cf(app)
            from app.services.cloudflare_saas import CloudflareSaasService
            assert CloudflareSaasService.pick_app_with_free_slot() == 'jlmushfrontend'


# ────────────────────────────────────────────────────────────────────
# create_or_update
# ────────────────────────────────────────────────────────────────────


class TestCreateOrUpdate:
    def test_happy_path_persists_columns(self, app):
        """Successful POST → cf_* columns + cf_synced_at populated."""
        with app.app_context():
            _configure_cf(app)
            tenant = _make_tenant(app)

            mock_session = MagicMock()
            mock_session.post.return_value = _mock_response(
                200, {'success': True, 'result': _FAKE_DOMAIN_PAYLOAD},
            )

            from app.services.cloudflare_saas import CloudflareSaasService
            with patch(
                'app.services.cloudflare_saas._client',
                return_value=mock_session,
            ):
                CloudflareSaasService.create_or_update(tenant)

            db.session.refresh(tenant)
            assert tenant.cf_hostname_id == 'pages-domain-uuid-1'
            assert tenant.cf_hostname_status == 'pending'
            # SSL status synthesized from overall status (Pages doesn't
            # expose a separate ssl field).
            assert tenant.cf_ssl_status == 'pending'
            assert tenant.cf_ownership_verification == {
                'status': 'pending',
                'reason': 'CNAME record not detected',
            }
            assert tenant.cf_synced_at is not None
            assert tenant.cf_error is None

    def test_active_status_synthesizes_ssl_active(self, app):
        """When Pages reports ``status: active``, the synthesized
        ``cf_ssl_status`` is also ``active`` (mirrors the previous
        Custom Hostnames ssl.status field for UI parity)."""
        with app.app_context():
            _configure_cf(app)
            tenant = _make_tenant(app)

            active_payload = dict(_FAKE_DOMAIN_PAYLOAD)
            active_payload['status'] = 'active'
            mock_session = MagicMock()
            mock_session.post.return_value = _mock_response(
                200, {'success': True, 'result': active_payload},
            )

            from app.services.cloudflare_saas import CloudflareSaasService
            with patch(
                'app.services.cloudflare_saas._client',
                return_value=mock_session,
            ):
                CloudflareSaasService.create_or_update(tenant)

            db.session.refresh(tenant)
            assert tenant.cf_hostname_status == 'active'
            assert tenant.cf_ssl_status == 'active'

    def test_already_exists_falls_through_to_get(self, app):
        """POST returns 8000035 → service GETs by domain name. End
        state identical to a fresh create."""
        with app.app_context():
            _configure_cf(app)
            tenant = _make_tenant(app)

            conflict = _mock_response(400, {
                'success': False,
                'errors': [{
                    'code': 8000035,
                    'message': 'Domain is already part of this project',
                }],
            })
            get_resp = _mock_response(200, {
                'success': True, 'result': _FAKE_DOMAIN_PAYLOAD,
            })
            mock_session = MagicMock()
            mock_session.post.return_value = conflict
            mock_session.get.return_value = get_resp

            from app.services.cloudflare_saas import CloudflareSaasService
            with patch(
                'app.services.cloudflare_saas._client',
                return_value=mock_session,
            ):
                CloudflareSaasService.create_or_update(tenant)

            db.session.refresh(tenant)
            assert tenant.cf_hostname_id == 'pages-domain-uuid-1'
            assert tenant.cf_hostname_status == 'pending'
            assert mock_session.post.call_count == 1
            assert mock_session.get.call_count == 1

    def test_skips_when_tenant_has_no_domain(self, app):
        """No-op + error message when the tenant row has no custom domain."""
        with app.app_context():
            _configure_cf(app)
            tenant = _make_tenant(app, domain=None)

            from app.services.cloudflare_saas import CloudflareSaasService
            with patch(
                'app.services.cloudflare_saas._client',
            ) as mock_client:
                CloudflareSaasService.create_or_update(tenant)
                mock_client.assert_not_called()

            db.session.refresh(tenant)
            assert tenant.cf_hostname_id is None
            assert 'No domain' in (tenant.cf_error or '')


# ────────────────────────────────────────────────────────────────────
# refresh
# ────────────────────────────────────────────────────────────────────


class TestRefresh:
    def test_refresh_updates_status_transition(self, app):
        """Pages status pending → active. SSL status follows."""
        with app.app_context():
            _configure_cf(app)
            tenant = _make_tenant(app, cf_hostname_id='pages-domain-uuid-1')
            tenant.cf_hostname_status = 'pending'
            tenant.cf_ssl_status = 'pending'
            db.session.commit()

            active_payload = dict(_FAKE_DOMAIN_PAYLOAD)
            active_payload['status'] = 'active'

            mock_session = MagicMock()
            mock_session.get.return_value = _mock_response(
                200, {'success': True, 'result': active_payload},
            )

            from app.services.cloudflare_saas import CloudflareSaasService
            with patch(
                'app.services.cloudflare_saas._client',
                return_value=mock_session,
            ):
                CloudflareSaasService.refresh_cloudflare_state(tenant)

            db.session.refresh(tenant)
            assert tenant.cf_hostname_status == 'active'
            assert tenant.cf_ssl_status == 'active'

    def test_refresh_404_clears_state(self, app):
        """Upstream 404 → service clears cf_hostname_id and surfaces
        the error instead of crashing."""
        with app.app_context():
            _configure_cf(app)
            tenant = _make_tenant(app, cf_hostname_id='pages-domain-uuid-1')

            mock_session = MagicMock()
            mock_session.get.return_value = _mock_response(404, {
                'success': False,
                'errors': [{'code': 8000031, 'message': 'not found'}],
            })

            from app.services.cloudflare_saas import CloudflareSaasService
            with patch(
                'app.services.cloudflare_saas._client',
                return_value=mock_session,
            ):
                CloudflareSaasService.refresh_cloudflare_state(tenant)

            db.session.refresh(tenant)
            assert tenant.cf_hostname_id is None
            assert tenant.cf_hostname_status is None
            assert 'not found' in (tenant.cf_error or '')

    def test_refresh_no_domain_is_noop(self, app):
        """A tenant with no custom domain → no upstream call, no error."""
        with app.app_context():
            _configure_cf(app)
            tenant = _make_tenant(app, domain=None)

            from app.services.cloudflare_saas import CloudflareSaasService
            with patch(
                'app.services.cloudflare_saas._client',
            ) as mock_client:
                CloudflareSaasService.refresh_cloudflare_state(tenant)
                mock_client.assert_not_called()

            db.session.refresh(tenant)
            assert tenant.cf_synced_at is not None


# ────────────────────────────────────────────────────────────────────
# delete
# ────────────────────────────────────────────────────────────────────


class TestDelete:
    def test_delete_clears_columns(self, app):
        """DELETE 200 → state cleared on tenant row."""
        with app.app_context():
            _configure_cf(app)
            tenant = _make_tenant(app, cf_hostname_id='pages-domain-uuid-1')
            tenant.cf_hostname_status = 'active'
            db.session.commit()

            mock_session = MagicMock()
            mock_session.delete.return_value = _mock_response(
                200, {'success': True, 'result': {'name': tenant.domain}},
            )

            from app.services.cloudflare_saas import CloudflareSaasService
            with patch(
                'app.services.cloudflare_saas._client',
                return_value=mock_session,
            ):
                CloudflareSaasService.delete(tenant)

            db.session.refresh(tenant)
            assert tenant.cf_hostname_id is None
            assert tenant.cf_hostname_status is None
            assert tenant.cf_error is None

    def test_delete_404_is_success(self, app):
        """DELETE 404 → idempotent success (the row was already gone)."""
        with app.app_context():
            _configure_cf(app)
            tenant = _make_tenant(app, cf_hostname_id='pages-domain-uuid-1')

            mock_session = MagicMock()
            mock_session.delete.return_value = _mock_response(404, {
                'success': False,
                'errors': [{'code': 8000031, 'message': 'not found'}],
            })

            from app.services.cloudflare_saas import CloudflareSaasService
            with patch(
                'app.services.cloudflare_saas._client',
                return_value=mock_session,
            ):
                CloudflareSaasService.delete(tenant)

            db.session.refresh(tenant)
            assert tenant.cf_hostname_id is None
            assert tenant.cf_error is None


# ────────────────────────────────────────────────────────────────────
# Audit trail
# ────────────────────────────────────────────────────────────────────


class TestAuditTrail:
    def test_create_or_update_writes_audit_row(self, app):
        with app.app_context():
            _configure_cf(app)
            tenant = _make_tenant(app)

            mock_session = MagicMock()
            mock_session.post.return_value = _mock_response(
                200, {'success': True, 'result': _FAKE_DOMAIN_PAYLOAD},
            )

            from app.services.cloudflare_saas import CloudflareSaasService
            from app.models import TenantDomainMigrationAudit
            before = TenantDomainMigrationAudit.query.filter_by(
                tenant_id=tenant.id,
            ).count()

            with patch(
                'app.services.cloudflare_saas._client',
                return_value=mock_session,
            ):
                CloudflareSaasService.create_or_update(tenant)

            after = TenantDomainMigrationAudit.query.filter_by(
                tenant_id=tenant.id,
            ).count()
            assert after == before + 1
            row = TenantDomainMigrationAudit.query.filter_by(
                tenant_id=tenant.id,
            ).order_by(TenantDomainMigrationAudit.created_at.desc()).first()
            assert row.operation == 'create_or_update'
            assert row.status == 'success'
            assert row.provider == 'cloudflare'

    def test_failure_writes_failure_audit_row(self, app):
        with app.app_context():
            _configure_cf(app)
            tenant = _make_tenant(app)

            mock_session = MagicMock()
            mock_session.post.return_value = _mock_response(500, {
                'success': False,
                'errors': [{'code': 9999, 'message': 'transient'}],
            })

            from app.services.cloudflare_saas import (
                CloudflareSaasService, CloudflareSaasError,
            )
            from app.models import TenantDomainMigrationAudit

            with patch(
                'app.services.cloudflare_saas._client',
                return_value=mock_session,
            ):
                with pytest.raises(CloudflareSaasError):
                    CloudflareSaasService.create_or_update(tenant)

            row = TenantDomainMigrationAudit.query.filter_by(
                tenant_id=tenant.id,
            ).order_by(TenantDomainMigrationAudit.created_at.desc()).first()
            assert row.status == 'failure'
            assert row.operation == 'create_or_update'
