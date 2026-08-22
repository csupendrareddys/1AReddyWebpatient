"""Tenant self-serve payment gateway configuration.

The tenant's own money rails, entered by the tenant's own SUPER_ADMIN:

  * **Razorpay** (collection) — patient payments settle into the TENANT's
    Razorpay account. There is NO platform-key fallback: until these keys
    are saved, every marketplace checkout on this tenant answers 409
    ``gateway_not_configured``.
  * **Cashfree Payouts** (disbursal) — doctor payouts leave from the
    tenant's Cashfree account. Unconfigured → manual settlement only.

  GET    /api/v1/admin/payment-gateway        -> masked config + webhook URLs
  PUT    /api/v1/admin/payment-gateway        -> upsert keys (secrets write-only)
  POST   /api/v1/admin/payment-gateway/test   -> live credential probe per rail
  DELETE /api/v1/admin/payment-gateway        -> deactivate (stops collections)

The tenant id always comes from ``current_tenant_id_strict()`` — never from
the URL or body. Secrets are encrypted at rest and never echoed back;
responses carry only masks and ``has_*`` booleans.
"""
import logging

from flask import Blueprint, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.common.decorators import role_required
from app.common.responses import success_response, error_response
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import Tenant, TenantPaymentConfig, UserRole

logger = logging.getLogger(__name__)

payment_gateway_bp = Blueprint('payment_gateway_admin', __name__)


def _public_host():
    """The host the tenant's users (and gateway webhooks) reach us on —
    the same host the admin is browsing right now."""
    host = (request.headers.get('X-Tenant-Host') or request.host or '').strip()
    return host


def _webhook_urls():
    host = _public_host()
    if not host:
        return {}
    return {
        'razorpay': f'https://{host}/api/v1/payment/webhook',
        'cashfree': f'https://{host}/api/v1/payment/cashfree/payout-webhook',
    }


def _config_row(tenant_id, *, create=False):
    """The tenant's config row (active or not — the admin page must show a
    deactivated config so it can be re-enabled)."""
    row = TenantPaymentConfig.query.filter_by(
        tenant_id=tenant_id, is_deleted=False,
    ).first()
    if row is None and create:
        row = TenantPaymentConfig(tenant_id=tenant_id)
        db.session.add(row)
    return row


def _vendor_guard(tenant_id):
    """The vendor tenant's gateway is env-configured; this page is for
    customer tenants only."""
    tenant = Tenant.query.get(tenant_id)
    if tenant is not None and getattr(tenant, 'is_platform', False):
        return error_response(
            'The vendor tenant uses environment credentials — there is '
            'nothing to configure here.', status_code=400)
    return None


def _serialize(row):
    payload = row.to_dict() if row is not None else {
        'id': None,
        'is_active': False,
        'razorpay': {'key_id': None, 'key_secret_masked': None,
                     'has_key_secret': False, 'has_webhook_secret': False,
                     'ready': False, 'verified_at': None},
        'cashfree': {'env': 'sandbox', 'client_id': None,
                     'has_client_secret': False, 'ready': False,
                     'verified_at': None},
        'updated_at': None,
    }
    payload['webhook_urls'] = _webhook_urls()
    return payload


@payment_gateway_bp.route('', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_gateway_config():
    tenant_id = current_tenant_id_strict()
    guard = _vendor_guard(tenant_id)
    if guard:
        return guard
    return success_response(_serialize(_config_row(tenant_id)))


@payment_gateway_bp.route('', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def save_gateway_config():
    """Upsert. Only the fields present in the body change; secrets are
    write-only (send a value to rotate, omit to keep, send '' to clear)."""
    tenant_id = current_tenant_id_strict()
    guard = _vendor_guard(tenant_id)
    if guard:
        return guard

    data = request.get_json() or {}
    razorpay = data.get('razorpay') or {}
    cashfree = data.get('cashfree') or {}

    key_id = razorpay.get('key_id')
    if key_id is not None and key_id != '' and not str(key_id).startswith('rzp_'):
        return error_response(
            "That doesn't look like a Razorpay key id (expected rzp_…).", status_code=400)

    env = cashfree.get('env')
    if env is not None and env not in ('sandbox', 'production'):
        return error_response(
            "cashfree.env must be 'sandbox' or 'production'.", status_code=400)

    row = _config_row(tenant_id, create=True)
    actor = get_jwt_identity()
    if row.created_by_id is None:
        row.created_by_id = actor
    row.updated_by_id = actor

    def _apply(obj, attr, value, *, secret=False):
        if value is None:
            return False  # absent → keep
        value = str(value).strip()
        setattr(obj, attr, value or None)
        return True

    changed_collection = False
    changed_collection |= _apply(row, 'razorpay_key_id', key_id)
    changed_collection |= _apply(row, 'razorpay_key_secret',
                                 razorpay.get('key_secret'), secret=True)
    _apply(row, 'razorpay_webhook_secret',
           razorpay.get('webhook_secret'), secret=True)

    changed_payout = False
    if env is not None:
        row.cashfree_env = env
        changed_payout = True
    changed_payout |= _apply(row, 'cashfree_client_id',
                             cashfree.get('client_id'))
    changed_payout |= _apply(row, 'cashfree_client_secret',
                             cashfree.get('client_secret'), secret=True)

    # Any save re-activates: "disable" is an explicit DELETE, and a tenant
    # re-entering keys clearly intends to switch collections back on.
    row.is_active = True
    # A credential change invalidates the last successful probe.
    if changed_collection:
        row.collection_verified_at = None
    if changed_payout:
        row.payout_verified_at = None

    db.session.commit()
    logger.info('[GATEWAY] tenant=%s config saved by user=%s', tenant_id, actor)
    return success_response(_serialize(row), message='Gateway settings saved.')


@payment_gateway_bp.route('/test', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def test_gateway_config():
    """Live probe of one rail: ``{"rail": "razorpay" | "cashfree"}``.

    Uses harmless read-only calls (order list / beneficiary lookup) so a
    successful probe proves the credentials without moving money.
    """
    from app.models._base import utcnow

    tenant_id = current_tenant_id_strict()
    guard = _vendor_guard(tenant_id)
    if guard:
        return guard

    rail = (request.get_json() or {}).get('rail')
    row = _config_row(tenant_id)
    if row is None:
        return error_response('No gateway configuration saved yet.', status_code=404)

    if rail == 'razorpay':
        if not row.collection_ready:
            return error_response('Enter your Razorpay key id and secret first.', status_code=400)
        try:
            import razorpay
            client = razorpay.Client(
                auth=(row.razorpay_key_id, row.razorpay_key_secret))
            client.order.all({'count': 1})
        except Exception as e:  # noqa: BLE001 — surface as a clean failure
            logger.info('[GATEWAY] razorpay probe failed tenant=%s: %s',
                        tenant_id, e)
            return error_response(
                'Razorpay rejected these credentials. Double-check the key '
                'id and secret.', status_code=400)
        row.collection_verified_at = utcnow()
        db.session.commit()
        return success_response(_serialize(row),
                                message='Razorpay credentials verified.')

    if rail == 'cashfree':
        if not row.payout_ready:
            return error_response('Enter your Cashfree client id and secret first.', status_code=400)
        from app.api.common.payment import cashfree_payout as cf
        try:
            # 404 on a nonsense beneficiary id still proves the auth headers
            # were accepted; an auth failure raises with status 401/403.
            cf.get_beneficiary('connectivity-probe')
        except cf.CashfreePayoutError as e:
            logger.info('[GATEWAY] cashfree probe failed tenant=%s: %s',
                        tenant_id, e)
            return error_response(
                'Cashfree rejected these credentials. Double-check the '
                'client id, secret, and environment.', status_code=400)
        row.payout_verified_at = utcnow()
        db.session.commit()
        return success_response(_serialize(row),
                                message='Cashfree credentials verified.')

    return error_response("rail must be 'razorpay' or 'cashfree'.", status_code=400)


@payment_gateway_bp.route('', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def deactivate_gateway_config():
    """Switch the tenant's gateway off. Collections stop immediately
    (checkouts answer 409); payouts fall back to manual settlement. The
    keys stay stored (encrypted) so re-enabling is a single save."""
    tenant_id = current_tenant_id_strict()
    guard = _vendor_guard(tenant_id)
    if guard:
        return guard

    row = _config_row(tenant_id)
    if row is None:
        return error_response('No gateway configuration saved yet.', status_code=404)
    row.is_active = False
    row.updated_by_id = get_jwt_identity()
    db.session.commit()
    logger.info('[GATEWAY] tenant=%s config deactivated', tenant_id)
    return success_response(_serialize(row), message='Gateway disabled.')
