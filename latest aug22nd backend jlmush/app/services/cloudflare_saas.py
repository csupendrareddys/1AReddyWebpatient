"""Cloudflare Pages Custom Domains for per-tenant custom hostnames.

Replaces the AWS Amplify ``CreateDomainAssociation`` flow with the
Cloudflare Pages equivalent: when a tenant verifies their custom
domain (via the platform's TXT challenge), the backend calls the
Cloudflare Pages API to add the tenant's hostname to our Pages
project. Pages then provisions a TLS cert + binds the hostname for
routing — same conceptual role as Amplify's domain association.

Why Pages Custom Domains (not Custom Hostnames / SSL for SaaS):

  * Custom Hostnames (SSL for SaaS) work fine for stand-alone origins
    but loop back to themselves on the Free plan when the
    ``custom_origin_server`` is also a Cloudflare-hosted hostname.
    Confirmed by Worker observability: SaaS-forwarded traffic never
    invokes the Worker; CF returns 522 from the SaaS edge directly.
  * Pages Custom Domains route by ``Host`` header at the Pages
    project level. After the binding lands, Pages serves the SPA
    directly for that exact Host without any SaaS forwarding layer.
    No loopback because there's only one routing surface.
  * Same admin UX as the previous Amplify integration — the
    operator clicks "Verify TXT" and the backend handles the rest
    via API; no per-tenant dashboard work.

Module name kept as ``cloudflare_saas`` to minimize churn in the
admin UI / route handlers / tests that already import from here.
The class name ``CloudflareSaasService`` likewise stays but its
implementation now calls the Pages API.

Env contract:
  * ``CLOUDFLARE_API_TOKEN`` — scope: ``Account → Cloudflare Pages → Edit``.
  * ``CLOUDFLARE_ACCOUNT_ID`` — the account hosting the Pages project.
  * ``CLOUDFLARE_PAGES_PROJECT_NAME`` — e.g. ``jlmushfrontend``.
  * ``CLOUDFLARE_PAGES_TARGET`` (optional) — what tenants are told to
    CNAME to, e.g. ``jlmushfrontend.pages.dev``. Defaults to
    ``<project>.pages.dev`` when unset.

The ``cf_*`` columns on ``Tenant`` are reused without rename:
  * ``cf_hostname_id``               ← the domain name itself (Pages uses
    the hostname as its key; no separate id)
  * ``cf_hostname_status``           ← Pages ``status`` (``initializing``,
    ``pending``, ``active``, ``deactivated``, ``blocked``)
  * ``cf_ssl_status``                ← Pages ``certificate_authority``
    state (``active``/``pending``)
  * ``cf_ownership_verification``    ← Pages ``verification_data`` (DCV /
    pre-validation records, when CF can't auto-verify via CNAME chain)
  * ``cf_ssl_validation_records``    ← empty list (Pages handles cert
    DCV internally for its native flow)
  * ``cf_synced_at`` / ``cf_error``  ← unchanged
"""
from __future__ import annotations

import functools
import logging
import time
from datetime import datetime, timezone
from typing import Optional, Tuple

import requests
from flask import current_app, has_request_context
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.extensions import db

logger = logging.getLogger(__name__)


# Pages Custom Domain status values (verbatim from CF API).
STATUS_INITIALIZING = 'initializing'
STATUS_PENDING = 'pending'
STATUS_ACTIVE = 'active'
STATUS_DEACTIVATED = 'deactivated'
STATUS_BLOCKED = 'blocked'

# Pages cert ``certificate_authority`` placeholder states. Kept for
# UI parity with the prior Custom Hostnames flow which had a separate
# ``ssl.status`` field; Pages doesn't surface a separate ssl status so
# we synthesize ``active`` once the domain itself is ``active``.
SSL_ACTIVE = 'active'
SSL_PENDING = 'pending'

# CF API error codes we branch on.
CF_ERR_DOMAIN_EXISTS = 8000035  # "Domain is already part of this project"
CF_ERR_DOMAIN_NOT_FOUND = 8000031


class CloudflareNotConfigured(Exception):
    """Raised when one of the required env vars is empty. Treated as a
    *skip* by callers, not a hard error — mirrors the old
    ``AmplifyNotConfigured`` posture so mixed-mode / unconfigured-CF
    deployments don't blow up at request time."""


class CloudflareSaasError(Exception):
    """A non-2xx response from the Cloudflare Pages API.

    Attributes:
        message: human-readable message lifted from CF's ``errors[].message``.
        code:    CF's numeric error code from ``errors[].code`` (e.g.
                 ``8000035`` "Domain already part of this project").
        status_code: HTTP status from the response.
    """

    def __init__(self, message: str, code: Optional[int] = None,
                 status_code: Optional[int] = None) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def _clean_env(raw: str) -> str:
    """Strip whitespace, surrounding quotes, and trailing
    ``# comment`` from an env var value — operators paste sloppy
    values into .env files; defending against it here saves a debug
    session on every fresh deploy."""
    if not raw:
        return ''
    s = raw.strip()
    if s.startswith(('"', "'")) and s.endswith(s[0]):
        return s[1:-1]
    if '#' in s:
        s = s.split('#', 1)[0].rstrip()
    return s


def _config() -> Tuple[str, str, str, str]:
    """Read env at call time so token rotations / project renames take
    effect without a restart.

    Returns ``(api_token, account_id, project_name, pages_target)``.

    Raises :class:`CloudflareNotConfigured` if any of the first three
    are empty. ``pages_target`` falls back to ``<project>.pages.dev``
    when ``CLOUDFLARE_PAGES_TARGET`` is unset.
    """
    cfg = current_app.config
    api_token = _clean_env(cfg.get('CLOUDFLARE_API_TOKEN') or '')
    account_id = _clean_env(cfg.get('CLOUDFLARE_ACCOUNT_ID') or '')
    project_name = _clean_env(cfg.get('CLOUDFLARE_PAGES_PROJECT_NAME') or '')
    pages_target = (
        _clean_env(cfg.get('CLOUDFLARE_PAGES_TARGET') or '')
        or (f'{project_name}.pages.dev' if project_name else '')
    )
    if not (api_token and account_id and project_name):
        raise CloudflareNotConfigured(
            'Cloudflare Pages integration not configured. Required env: '
            'CLOUDFLARE_API_TOKEN (scope: Pages:Edit), '
            'CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_PAGES_PROJECT_NAME.'
        )
    return api_token, account_id, project_name, pages_target


def _project_for_tenant(tenant, default_project: str) -> str:
    """The Cloudflare Pages project that serves THIS tenant.

    A tenant can be pinned to a *dedicated* Pages project — e.g. a client
    running a customized frontend build deployed from its own branch — by
    setting ``Tenant.settings['cf_pages_project']`` to that project's name.
    Every other tenant falls back to the shared
    ``CLOUDFLARE_PAGES_PROJECT_NAME`` (passed in as ``default_project``).

    This is the single seam that routes a client's verified custom domain to
    its own Pages deployment instead of the shared one, while keeping the
    normal "add domain via API → verify → auto-bind" flow untouched. Purely
    additive: reads an optional settings key, never mutates the tenant.
    """
    settings = getattr(tenant, 'settings', None)
    if isinstance(settings, dict):
        override = (settings.get('cf_pages_project') or '').strip()
        if override:
            return override
    return default_project


def is_configured() -> bool:
    """Cheap predicate so callers can short-circuit when the Pages
    integration isn't wired up (e.g. local dev). The admin UI uses
    this to render a "CF Pages not configured" warning instead of
    failing every domain operation."""
    cfg = current_app.config
    return bool(
        (cfg.get('CLOUDFLARE_API_TOKEN') or '').strip()
        and (cfg.get('CLOUDFLARE_ACCOUNT_ID') or '').strip()
        and (cfg.get('CLOUDFLARE_PAGES_PROJECT_NAME') or '').strip()
    )


def _is_apex_domain(hostname: str) -> bool:
    """``True`` when ``hostname`` looks like an apex (one-dot bare
    domain like ``ishazen.com``), ``False`` when it's a subdomain
    (``www.example.com``, ``clinic.example.com``).

    Heuristic: split on ``.`` and count parts. Two parts → apex,
    more → subdomain. Multi-part TLDs like ``bbc.co.uk`` get
    misclassified; swap for the Public Suffix List if a tenant
    onboards on one. Hostnames already starting with ``www.`` are
    treated as subdomains so we don't recurse on www-of-www.

    Kept here (not just frontend-side) so future server-side guidance
    can branch on apex-vs-subdomain (e.g. validation rules, redirect
    rule auto-creation).
    """
    h = (hostname or '').strip('.').lower()
    if not h or h.startswith('www.'):
        return False
    return h.count('.') == 1


# ────────────────────────────────────────────────────────────────────
# Audit decorator
# ────────────────────────────────────────────────────────────────────


def _audit(operation: str):
    """Wrap a ``CloudflareSaasService`` method so it writes one
    ``TenantDomainMigrationAudit`` row per call (success or failure).

    The first positional arg after ``cls``/``self`` must be the
    tenant — same contract as before. We keep the audit table for
    operational visibility into Pages API ops, even though the
    Amplify-to-CF migration phase machine that originally defined it
    has been removed.
    """
    def deco(fn):
        @functools.wraps(fn)
        def wrapped(cls_or_self, tenant, *args, **kwargs):
            started = time.monotonic()
            error: Optional[Exception] = None
            try:
                return fn(cls_or_self, tenant, *args, **kwargs)
            except Exception as exc:  # noqa: BLE001 — capture, re-raise
                error = exc
                raise
            finally:
                try:
                    _write_audit_row(tenant, operation, started, error)
                except Exception:  # noqa: BLE001 — never let audit
                    # surface an exception that masks the real one.
                    logger.exception('[CF_PAGES] failed to write audit row')
        return wrapped
    return deco


def _write_audit_row(tenant, operation: str, started_at: float,
                     error: Optional[Exception]) -> None:
    """Best-effort audit insert. Failures are swallowed."""
    from app.models import TenantDomainMigrationAudit

    actor_id = None
    if has_request_context():
        try:
            from flask_jwt_extended import current_user
            if current_user is not None and getattr(current_user, 'id', None):
                actor_id = current_user.id
        except Exception:   # noqa: BLE001
            pass

    duration_ms = int((time.monotonic() - started_at) * 1000)
    row = TenantDomainMigrationAudit(
        tenant_id=getattr(tenant, 'id', None),
        provider='cloudflare',
        phase=None,
        operation=operation,
        status='failure' if error else 'success',
        duration_ms=duration_ms,
        error=(repr(error) if error else None)[:65000] if error else None,
        actor_user_id=actor_id,
    )
    db.session.add(row)
    db.session.commit()

    logger.info(
        '[CF_PAGES] tenant=%s op=%s status=%s duration_ms=%d',
        getattr(tenant, 'id', None), operation,
        row.status, duration_ms,
    )


# ────────────────────────────────────────────────────────────────────
# HTTP client
# ────────────────────────────────────────────────────────────────────


_API_BASE = 'https://api.cloudflare.com/client/v4'


def _client():
    """``requests.Session`` with retry + auth pre-configured.

    Pages API quotas are generous; retries mostly soak up transient
    edge issues, not steady-state throttling. 5 attempts, 0.5s
    backoff, honors ``Retry-After``.
    """
    api_token, _, _, _ = _config()
    session = requests.Session()
    retry = Retry(
        total=5,
        backoff_factor=0.5,
        status_forcelist=(429, 502, 503, 504),
        allowed_methods=('GET', 'POST', 'PATCH', 'DELETE'),
        respect_retry_after_header=True,
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount('https://', adapter)
    session.headers.update({
        'Authorization': f'Bearer {api_token}',
        'Content-Type': 'application/json',
    })
    return session


def _raise_for_cf(response: requests.Response, *, on_404_ok: bool = False):
    """Translate a CF API response into a :class:`CloudflareSaasError`
    on failure. ``on_404_ok=True`` returns silently on 404 (idempotent
    delete flow)."""
    if on_404_ok and response.status_code == 404:
        return
    try:
        body = response.json()
    except ValueError:
        body = {}
    if response.ok and body.get('success', True):
        return
    errors = body.get('errors') or []
    first = errors[0] if errors else {}
    raise CloudflareSaasError(
        message=first.get('message') or f'HTTP {response.status_code}',
        code=first.get('code'),
        status_code=response.status_code,
    )


# ────────────────────────────────────────────────────────────────────
# Service
# ────────────────────────────────────────────────────────────────────


class CloudflareSaasService:
    """Static helpers wrapping the Cloudflare Pages Custom Domains
    API surface. Method signatures match the prior
    ``AmplifyDomainService`` so the platform service / routes layer
    didn't need a refactor when we swapped providers.

    Each method commits its own state changes to the tenant row so
    callers don't need to flush. Failures are captured on
    :attr:`Tenant.cf_error` for the admin UI to surface.
    """

    # ----- Pool-parity stub -----

    @staticmethod
    def pick_app_with_free_slot():
        """No-op for signature parity with the removed Amplify pool
        picker. Returns the project name. Cloudflare Pages has no
        per-app domain cap that's relevant at our scale (free-tier
        cap is 100 custom domains per project; upgrade unlocks more).
        """
        _, _, project_name, _ = _config()
        return project_name

    # ----- Public surface -----

    @classmethod
    @_audit('create_or_update')
    def create_or_update(cls, tenant) -> dict:
        """Add the tenant's domain to the Pages project, or fetch the
        existing binding if it's already there (idempotent).

        Mirrors :meth:`AmplifyDomainService.create_or_update` — same
        contract: POST first, fall through to GET on the "already
        exists" error code, persist response onto cf_* columns.
        """
        if not tenant.domain:
            tenant.cf_error = 'No domain set on tenant'
            tenant.cf_synced_at = datetime.now(timezone.utc)
            db.session.commit()
            return cls._state_snapshot(tenant)

        _, account_id, project_name, _ = _config()
        project_name = _project_for_tenant(tenant, project_name)
        session = _client()
        post_url = (
            f'{_API_BASE}/accounts/{account_id}/pages/'
            f'projects/{project_name}/domains'
        )
        body = {'name': tenant.domain}
        resp = session.post(post_url, json=body, timeout=20)

        try:
            _raise_for_cf(resp)
            payload = resp.json().get('result') or {}
        except CloudflareSaasError as e:
            # 8000035 = "Domain is already part of this project."
            # Treat as idempotent success — fetch the existing row.
            if e.code != CF_ERR_DOMAIN_EXISTS:
                cls._persist_error(tenant, e)
                raise
            payload = cls._fetch_by_name(session, account_id, project_name,
                                          tenant.domain)
            if payload is None:
                # Race: CF said "exists" but GET 404s. Surface the
                # original error.
                cls._persist_error(tenant, e)
                raise

        cls._persist_payload(tenant, payload)
        return cls._state_snapshot(tenant)

    @classmethod
    @_audit('refresh')
    def refresh_cloudflare_state(cls, tenant) -> dict:
        """Re-poll Pages for the current binding state. Updates the
        cf_* columns with whatever CF reports — status transitions
        from ``pending`` → ``active`` show up here once the cert
        finishes provisioning and the CNAME chain validates.
        """
        if not tenant.domain:
            tenant.cf_synced_at = datetime.now(timezone.utc)
            db.session.commit()
            return cls._state_snapshot(tenant)

        _, account_id, project_name, _ = _config()
        project_name = _project_for_tenant(tenant, project_name)
        session = _client()
        url = (
            f'{_API_BASE}/accounts/{account_id}/pages/'
            f'projects/{project_name}/domains/{tenant.domain}'
        )
        resp = session.get(url, timeout=20)

        if resp.status_code == 404:
            # Domain no longer bound (operator removed via dashboard,
            # or never created). Clear our state so the next
            # create_or_update fresh-provisions.
            tenant.cf_hostname_id = None
            tenant.cf_hostname_status = None
            tenant.cf_ssl_status = None
            tenant.cf_ownership_verification = None
            tenant.cf_ssl_validation_records = None
            tenant.cf_error = 'domain binding not found upstream (404)'
            tenant.cf_synced_at = datetime.now(timezone.utc)
            db.session.commit()
            return cls._state_snapshot(tenant)

        try:
            _raise_for_cf(resp)
        except CloudflareSaasError as e:
            cls._persist_error(tenant, e)
            raise

        payload = resp.json().get('result') or {}
        cls._persist_payload(tenant, payload)
        return cls._state_snapshot(tenant)

    # Back-compat alias — admin routes call ``refresh()`` directly.
    @classmethod
    def refresh(cls, tenant) -> dict:
        return cls.refresh_cloudflare_state(tenant)

    @classmethod
    @_audit('reset_and_retry')
    def reset_and_retry(cls, tenant) -> dict:
        """Delete the Pages binding then re-add. The documented
        unstick for a domain stuck in ``initializing`` or ``blocked``.
        """
        cls.delete(tenant)
        return cls.create_or_update(tenant)

    @classmethod
    @_audit('delete')
    def delete(cls, tenant) -> dict:
        """Remove the tenant's domain from the Pages project. 404 =
        success (idempotent — already gone counts as gone).
        """
        if not tenant.domain:
            tenant.cf_error = None
            tenant.cf_synced_at = datetime.now(timezone.utc)
            db.session.commit()
            return cls._state_snapshot(tenant)

        _, account_id, project_name, _ = _config()
        project_name = _project_for_tenant(tenant, project_name)
        session = _client()
        url = (
            f'{_API_BASE}/accounts/{account_id}/pages/'
            f'projects/{project_name}/domains/{tenant.domain}'
        )
        resp = session.delete(url, timeout=20)
        try:
            _raise_for_cf(resp, on_404_ok=True)
        except CloudflareSaasError as e:
            cls._persist_error(tenant, e)
            raise

        tenant.cf_hostname_id = None
        tenant.cf_hostname_status = None
        tenant.cf_ssl_status = None
        tenant.cf_ownership_verification = None
        tenant.cf_ssl_validation_records = None
        tenant.cf_error = None
        tenant.cf_synced_at = datetime.now(timezone.utc)
        db.session.commit()
        return cls._state_snapshot(tenant)

    # ----- Internal helpers -----

    @staticmethod
    def _fetch_by_name(session: requests.Session, account_id: str,
                        project_name: str,
                        domain: str) -> Optional[dict]:
        """Resolve a Pages Custom Domain row by exact name. Used by
        the idempotency path in :meth:`create_or_update`."""
        url = (
            f'{_API_BASE}/accounts/{account_id}/pages/'
            f'projects/{project_name}/domains/{domain}'
        )
        resp = session.get(url, timeout=20)
        if resp.status_code == 404:
            return None
        _raise_for_cf(resp)
        return resp.json().get('result') or None

    @staticmethod
    def _persist_payload(tenant, payload: dict) -> None:
        """Map a Pages Custom Domain response onto the tenant's cf_*
        columns.

        Pages response shape (representative):
        ::
            {
                "name": "www.ishazen.com",
                "status": "pending" | "active" | "initializing" | ...,
                "verification_data": {...} | null,
                "validation_data": {...} | null,
                "certificate_authority": "...",
                "created_on": "2026-05-14T...",
                "domain_id": "..."
            }
        """
        status = payload.get('status') or STATUS_PENDING
        tenant.cf_hostname_id = (
            payload.get('domain_id') or payload.get('name') or tenant.domain
        )
        tenant.cf_hostname_status = status
        # Pages doesn't expose a separate SSL status field — synthesize
        # it from the overall domain status so the UI's "SSL: active"
        # signal still works.
        tenant.cf_ssl_status = SSL_ACTIVE if status == STATUS_ACTIVE else SSL_PENDING
        # ``verification_data`` shows up when Pages needs the tenant
        # to publish a TXT record to prove ownership of an
        # already-claimed-elsewhere domain. ``validation_data`` is the
        # cert DCV record. Surface whichever is present.
        tenant.cf_ownership_verification = (
            payload.get('verification_data') or payload.get('validation_data')
        )
        tenant.cf_ssl_validation_records = []
        tenant.cf_error = None
        tenant.cf_synced_at = datetime.now(timezone.utc)
        db.session.commit()

    @staticmethod
    def _persist_error(tenant, exc: CloudflareSaasError) -> None:
        """Stash the last CF API error on the tenant row + commit."""
        tenant.cf_error = (
            f'[{exc.status_code}] code={exc.code} {exc}'
        )[:65000]
        tenant.cf_synced_at = datetime.now(timezone.utc)
        db.session.commit()

    @staticmethod
    def _state_snapshot(tenant) -> dict:
        """Small dict the routes layer echoes back to the admin UI."""
        return {
            'cf_hostname_id': tenant.cf_hostname_id,
            'cf_hostname_status': tenant.cf_hostname_status,
            'cf_ssl_status': tenant.cf_ssl_status,
            'cf_ownership_verification': tenant.cf_ownership_verification,
            'cf_ssl_validation_records': tenant.cf_ssl_validation_records or [],
            'cf_synced_at': (
                tenant.cf_synced_at.isoformat() if tenant.cf_synced_at else None
            ),
            'cf_error': tenant.cf_error,
        }
