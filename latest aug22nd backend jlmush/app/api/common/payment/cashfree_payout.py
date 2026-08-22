"""Cashfree Payouts V2 client — tenant → doctor disbursal + beneficiary mgmt.

COLLECTION (patient → tenant) stays on Razorpay; this module is ONLY the
payout (tenant → doctor) side.

Creds are the CURRENT TENANT's own Cashfree Payouts account, read from
:class:`TenantPaymentConfig` (money out comes from the same account the
tenant's collections land in — there is deliberately NO platform-env
fallback, mirroring the collection rail). When a tenant hasn't configured
Cashfree, :func:`is_configured` returns ``False`` and every caller falls
back to the existing manual-settle behaviour.

The tenant is resolved from the request context (``g.tenant_id``), which is
also how the payout webhook works: the tenant configures
``https://<their-host>/api/payment/cashfree/payout-webhook`` in their
Cashfree dashboard, and the host resolves the tenant whose secret verifies
the signature.

API reference: Cashfree Payouts V2, x-api-version 2024-01-01.
"""
import hmac
import base64
import hashlib
import logging

import requests

logger = logging.getLogger(__name__)

_TIMEOUT = 30
_API_VERSION = '2024-01-01'


def _config():
    """The current tenant's active payment config row, or None."""
    try:
        from app.common.tenant_context import current_tenant_id
        from app.models import TenantPaymentConfig
        return TenantPaymentConfig.for_tenant(current_tenant_id())
    except Exception:  # pragma: no cover — outside request/tenant context
        return None


def _env():
    config = _config()
    return ((config.cashfree_env if config else None) or 'sandbox').strip().lower()


def _base_url():
    return ('https://api.cashfree.com'
            if _env() in ('production', 'prod', 'live')
            else 'https://sandbox.cashfree.com')


def is_configured():
    """True when the CURRENT TENANT has Cashfree payout creds configured."""
    config = _config()
    return bool(config and config.payout_ready)


class CashfreePayoutError(Exception):
    def __init__(self, message, *, status=None, code=None, payload=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.payload = payload or {}


def _headers():
    config = _config()
    return {
        'x-client-id': (config.cashfree_client_id if config else '') or '',
        'x-client-secret': (config.cashfree_client_secret if config else '') or '',
        'x-api-version': _API_VERSION,
        'Content-Type': 'application/json',
    }


def _request(method, path, *, params=None, json=None):
    if not is_configured():
        raise CashfreePayoutError('Cashfree payouts is not configured')
    url = _base_url() + path
    try:
        resp = requests.request(
            method, url, headers=_headers(), params=params, json=json, timeout=_TIMEOUT,
        )
    except requests.RequestException as e:  # network / timeout
        raise CashfreePayoutError(f'Cashfree request failed: {e}')
    try:
        data = resp.json()
    except ValueError:
        data = {}
    if resp.status_code >= 400:
        msg = data.get('message') or data.get('error') or f'HTTP {resp.status_code}'
        logger.warning('[CASHFREE] %s %s -> %s %s', method, path, resp.status_code, msg)
        raise CashfreePayoutError(
            msg, status=resp.status_code, code=data.get('code'), payload=data,
        )
    return data


# ── Beneficiary ──────────────────────────────────────────────────────────
def create_beneficiary(*, beneficiary_id, name, account_number, ifsc,
                       phone=None, email=None):
    """Register a beneficiary. Returns the Cashfree response dict."""
    body = {
        'beneficiary_id': beneficiary_id,
        'beneficiary_name': name,
        'beneficiary_instrument_details': {
            'bank_account_number': account_number,
            'bank_ifsc': ifsc,
        },
    }
    contact = {}
    if phone:
        contact['beneficiary_phone'] = str(phone)[-10:]
        contact['beneficiary_country_code'] = '+91'
    if email:
        contact['beneficiary_email'] = email
    if contact:
        body['beneficiary_contact_details'] = contact
    return _request('POST', '/payout/beneficiary', json=body)


def get_beneficiary(beneficiary_id):
    """Fetch a beneficiary, or None if it doesn't exist."""
    try:
        return _request('GET', '/payout/beneficiary',
                        params={'beneficiary_id': beneficiary_id})
    except CashfreePayoutError as e:
        if e.status == 404:
            return None
        raise


def remove_beneficiary(beneficiary_id):
    """Delete a beneficiary. Idempotent — a 404 is treated as already-removed."""
    try:
        return _request('DELETE', '/payout/beneficiary',
                        params={'beneficiary_id': beneficiary_id})
    except CashfreePayoutError as e:
        if e.status == 404:
            return {'beneficiary_id': beneficiary_id, 'status': 'ALREADY_REMOVED'}
        raise


# ── Transfers ────────────────────────────────────────────────────────────
def standard_transfer(*, transfer_id, amount, beneficiary_id, remarks=None,
                      mode='banktransfer'):
    """Initiate a payout to a registered beneficiary. Async — final state
    arrives via webhook / get_transfer_status."""
    body = {
        'transfer_id': transfer_id,
        'transfer_amount': round(float(amount), 2),
        'transfer_mode': mode,
        'beneficiary_details': {'beneficiary_id': beneficiary_id},
    }
    if remarks:
        body['remarks'] = str(remarks)[:70]
    return _request('POST', '/payout/transfers', json=body)


def get_transfer_status(transfer_id):
    return _request('GET', '/payout/transfers', params={'transfer_id': transfer_id})


# ── Webhook signature ────────────────────────────────────────────────────
def verify_webhook_signature(raw_body, signature, timestamp):
    """Cashfree webhook auth: base64(HMAC-SHA256(timestamp + raw_body, secret))
    compared to the x-webhook-signature header. raw_body must be the exact,
    unparsed request body. The secret is the CURRENT TENANT's client secret
    — the tenant points their Cashfree webhook at their own host, so the
    request's Host header resolves which tenant's secret applies."""
    config = _config()
    secret = (config.cashfree_client_secret if config else None) or ''
    if not (secret and signature and timestamp):
        return False
    if isinstance(raw_body, bytes):
        raw_body = raw_body.decode('utf-8', 'replace')
    msg = (str(timestamp) + raw_body).encode('utf-8')
    digest = hmac.new(secret.encode('utf-8'), msg, hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode('utf-8')
    return hmac.compare_digest(expected, signature)


# Cashfree transfer status → our internal disposition.
SUCCESS_STATES = {'SUCCESS', 'COMPLETED'}
FAILED_STATES = {'FAILED', 'REJECTED', 'ERROR', 'CANCELLED'}
REVERSED_STATES = {'REVERSED'}
PENDING_STATES = {'RECEIVED', 'PENDING', 'QUEUED', 'APPROVAL_PENDING',
                  'VALIDATION_PENDING', 'INITIATED'}
