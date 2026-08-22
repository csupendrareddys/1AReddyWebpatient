"""Client identification + per-request context + JSON access log.

Web, mobile and desktop clients hit the same ``/api/v1`` surface; the only
way to tell them apart — and the only way a support thread about "the app
is broken" becomes a findable log line — is for the client to say who it
is. Three request headers, all optional (an absent header reads as the
legacy web client):

  * ``X-Client``          — ``web`` | ``mobile`` | ``desktop``
  * ``X-Client-Version``  — the build's semver-ish version string
  * ``X-Device-Id``       — a persistent per-installation id

The tenant, by contrast, already travels on ``X-Tenant-Host`` (or the Host
header for browsers) — client kind and tenant identity are deliberately
separate axes.

Every request also gets a ``request_id`` (echoed back as ``X-Request-Id``)
so one bug report can name one request and its log line.

**Min-version gate.** ``CLIENT_MIN_VERSIONS`` (env, JSON — e.g.
``{"mobile": "1.2.0"}``) refuses older builds with **426** and code
``client_update_required``. This is the kill-switch that lets the backend
move once app-store clients pin versions. Enforced only when BOTH the env
names the client kind AND the request declares a version; ``web`` should
never be listed (it ships from the server).

**Access log.** One JSON line per request into ``LOG_DIR`` (default
``/tmp/jlmush-logs``): ts, request id, client kind/version/device, tenant,
user id + role, method, path, status, duration, ip. Identifiers only —
never request bodies, never PHI (paths carry at most opaque uuids). Files
are per-process (``access-<pid>-<boot>.jsonl``) because rotating one file
from many gunicorn workers races; the S3 shipper (``log_shipper.py``)
uploads idle files and caps local disk.

``X-Device-Id`` is logged and will key per-device sessions, but is NEVER
part of a rate-limit key for unauthenticated traffic — it is
client-supplied, so an attacker rotating it would mint fresh buckets and
walk straight past brute-force limits (see ``rate_limit_key`` below).
"""
import json
import logging
import os
import time
import uuid

from flask import g, request

logger = logging.getLogger(__name__)

CLIENT_KINDS = ('web', 'mobile', 'desktop')

_access_logger = None
_min_versions = None


# ── version handling ─────────────────────────────────────────────────────────

def _parse_version(text):
    """``'1.2.3'`` → ``(1, 2, 3)``; junk → None (never gate on garbage)."""
    if not text:
        return None
    parts = []
    for chunk in str(text).strip().split('.')[:4]:
        digits = ''.join(ch for ch in chunk if ch.isdigit())
        if digits == '':
            return None
        parts.append(int(digits))
    return tuple(parts) if parts else None


def _load_min_versions():
    global _min_versions
    if _min_versions is None:
        raw = os.environ.get('CLIENT_MIN_VERSIONS', '')
        table = {}
        if raw:
            try:
                for kind, ver in (json.loads(raw) or {}).items():
                    parsed = _parse_version(ver)
                    if kind in CLIENT_KINDS and parsed:
                        table[kind] = (parsed, str(ver))
            except (ValueError, AttributeError):
                logger.error('[CLIENT] CLIENT_MIN_VERSIONS is not valid JSON: %r', raw)
        _min_versions = table
    return _min_versions


def check_min_version(kind, version_header):
    """(refused, required_str) — refused only when the env gates this kind
    AND the client declared a parseable, older version."""
    gate = _load_min_versions().get(kind)
    if not gate:
        return False, None
    required, required_str = gate
    declared = _parse_version(version_header)
    if declared is None:
        # No/garbled version from a gated kind: let it through but make it
        # loud — gating here would brick clients over a header typo.
        logger.warning('[CLIENT] %s client sent no parseable version (gate=%s)',
                       kind, required_str)
        return False, None
    return declared < required, required_str


# ── access log plumbing ──────────────────────────────────────────────────────

def _get_access_logger():
    """Per-process JSONL file logger, created lazily on first request."""
    global _access_logger
    if _access_logger is None:
        log = logging.getLogger('jlmush.access')
        log.setLevel(logging.INFO)
        log.propagate = False  # never duplicate into the console handler
        log_dir = os.environ.get('LOG_DIR', '/tmp/jlmush-logs')
        try:
            os.makedirs(log_dir, exist_ok=True)
            path = os.path.join(
                log_dir, f'access-{os.getpid()}-{int(time.time())}.jsonl')
            handler = logging.FileHandler(path, encoding='utf-8')
            handler.setFormatter(logging.Formatter('%(message)s'))
            log.addHandler(handler)
        except OSError:
            # Un-writable LOG_DIR must never take the API down.
            logger.exception('[CLIENT] cannot open access log in %s', log_dir)
            log.addHandler(logging.NullHandler())
        _access_logger = log
    return _access_logger


def audit_event(event, **fields):
    """Log a critical-point event into the same shipped stream as access
    lines. Callers pass identifiers only — never bodies, never PHI.

    Used at: auth outcomes, payment/webhook decisions, act-as dispatches,
    account deletion, retention purge, push failures.
    """
    try:
        row = {
            'ts': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
            'kind': 'audit',
            'event': event,
            'request_id': getattr(g, 'request_id', None),
            'tenant': str(getattr(g, 'tenant_id', '') or '') or None,
        }
        row.update(fields)
        _get_access_logger().info(json.dumps(row, default=str))
    except Exception:  # noqa: BLE001 — logging must never break the request
        logger.exception('[CLIENT] audit_event failed event=%s', event)


# ── request hooks ────────────────────────────────────────────────────────────

def register_client_context(app):
    from app.common.responses import error_response

    @app.before_request
    def _client_context():
        g.request_id = uuid.uuid4().hex
        kind = (request.headers.get('X-Client') or '').strip().lower()
        g.client_kind = kind if kind in CLIENT_KINDS else ('web' if not kind else 'unknown')
        g.client_version = (request.headers.get('X-Client-Version') or '')[:32] or None
        g.client_device = (request.headers.get('X-Device-Id') or '')[:64] or None

        if request.method == 'OPTIONS':
            return None  # preflights carry no client headers worth gating

        refused, required = check_min_version(g.client_kind, g.client_version)
        if refused:
            return error_response(
                'This version of the app is no longer supported. '
                'Please update to continue.',
                status_code=426, code='client_update_required',
                data={'min_version': required, 'client': g.client_kind},
            )
        return None

    @app.after_request
    def _client_response(response):
        response.headers['X-Request-Id'] = getattr(g, 'request_id', '')
        if request.path in ('/health', '/internal/auth-health') or request.method == 'OPTIONS':
            return response
        try:
            duration_ms = None
            if hasattr(g, 'request_start_time'):
                duration_ms = round((time.time() - g.request_start_time) * 1000)
            user_id = role = None
            try:
                from flask_jwt_extended import get_jwt
                claims = get_jwt()  # only populated when a hook verified it
                user_id = claims.get('sub')
                role = claims.get('role')
            except Exception:  # noqa: BLE001 — anonymous request
                pass
            _get_access_logger().info(json.dumps({
                'ts': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
                'kind': 'access',
                'request_id': g.request_id,
                'client': g.client_kind,
                'client_version': g.client_version,
                'device': g.client_device,
                'tenant': str(getattr(g, 'tenant_id', '') or '') or None,
                'user': user_id,
                'role': role,
                'method': request.method,
                'path': request.path,
                'status': response.status_code,
                'ms': duration_ms,
                'ip': request.remote_addr,
            }, default=str))
        except Exception:  # noqa: BLE001
            logger.exception('[CLIENT] access log write failed')
        return response
