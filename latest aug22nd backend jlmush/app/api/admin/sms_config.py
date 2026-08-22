"""Tenant self-serve DLT / SMS configuration.

By default a tenant's SMS goes out on the VENDOR's DLT registration (the
common ``notification_templates`` registry). A tenant whose plan grants
``communication.custom_sms`` may switch to their OWN DLT account: their
sender header, their Combirds API key, and their own approved template
ids/bodies per purpose. Purposes they don't override keep using the common
rail.

  GET    /api/admin/sms-config   -> config + plan gate + common purposes
  PUT    /api/admin/sms-config   -> upsert (api key write-only)
  DELETE /api/admin/sms-config   -> back to the common rail

Tenant id always from ``current_tenant_id_strict()``.
"""
import logging

from flask import Blueprint, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.common.decorators import role_required
from app.common.responses import success_response, error_response
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import NotificationTemplate, TenantSmsConfig, UserRole

logger = logging.getLogger(__name__)

sms_config_bp = Blueprint('sms_config_admin', __name__)

FEATURE_PATH = 'communication.custom_sms'


def _own_dlt_allowed(tenant_id) -> bool:
    from app.api.pricing.service import FeatureGate
    return FeatureGate.is_enabled(tenant_id, FEATURE_PATH)


def _common_purposes():
    """The common registry's SMS rows — the reference list the template
    editor renders (which purposes exist, their variables, the vendor's
    wording as a starting point)."""
    rows = (
        NotificationTemplate.query
        .filter_by(channel='sms', is_active=True)
        .order_by(NotificationTemplate.purpose)
        .all()
    )
    return [{
        'purpose': r.purpose,
        'name': r.name,
        'variable_names': r.variable_names or [],
        'common_body': r.body_template,
    } for r in rows]


def _serialize(row, tenant_id):
    payload = row.to_dict() if row is not None else {
        'id': None, 'is_active': False, 'use_own_dlt': False,
        'sender_id': None, 'has_api_key': False, 'combirds_sms_url': None,
        'templates': {}, 'ready': False, 'updated_at': None,
    }
    payload['own_dlt_allowed'] = _own_dlt_allowed(tenant_id)
    payload['common_purposes'] = _common_purposes()
    return payload


@sms_config_bp.route('', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_sms_config():
    tenant_id = current_tenant_id_strict()
    row = TenantSmsConfig.for_tenant(tenant_id)
    return success_response(_serialize(row, tenant_id))


@sms_config_bp.route('', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def save_sms_config():
    """Upsert. ``api_key`` is write-only (send to rotate, omit to keep,
    '' to clear). ``templates`` merges per purpose — send a purpose with a
    body to add/replace it, or ``null`` to remove it."""
    tenant_id = current_tenant_id_strict()
    data = request.get_json() or {}

    use_own_dlt = data.get('use_own_dlt')
    if use_own_dlt and not _own_dlt_allowed(tenant_id):
        return error_response(
            'Your plan uses the shared SMS templates. Upgrade to send from '
            'your own DLT account.', status_code=403, code='feature_disabled')

    row = TenantSmsConfig.for_tenant(tenant_id)
    if row is None:
        row = TenantSmsConfig(tenant_id=tenant_id)
        db.session.add(row)
    actor = get_jwt_identity()
    if row.created_by_id is None:
        row.created_by_id = actor
    row.updated_by_id = actor

    if use_own_dlt is not None:
        row.use_own_dlt = bool(use_own_dlt)
    if 'sender_id' in data:
        sender = (data.get('sender_id') or '').strip()
        if sender and not (3 <= len(sender) <= 20):
            return error_response('sender_id must be 3–20 characters.', status_code=400)
        row.sender_id = sender or None
    if 'api_key' in data:
        row.combirds_api_key = (data.get('api_key') or '').strip() or None
    if 'combirds_sms_url' in data:
        row.combirds_sms_url = (data.get('combirds_sms_url') or '').strip() or None

    templates_patch = data.get('templates')
    if templates_patch is not None:
        if not isinstance(templates_patch, dict):
            return error_response('templates must be an object.', status_code=400)
        merged = dict(row.templates or {})
        for purpose, entry in templates_patch.items():
            if entry is None:
                merged.pop(purpose, None)
                continue
            if not isinstance(entry, dict) or not entry.get('template_id') \
                    or not entry.get('body_template'):
                return error_response(
                    f"templates['{purpose}'] needs template_id and "
                    f"body_template.", status_code=400)
            merged[purpose] = {
                'template_id': str(entry['template_id']).strip(),
                'body_template': entry['body_template'],
                'variable_names': entry.get('variable_names') or [],
            }
        row.templates = merged

    row.is_active = True
    db.session.commit()
    logger.info('[SMS-CONFIG] tenant=%s saved by user=%s (own_dlt=%s)',
                tenant_id, actor, row.use_own_dlt)
    return success_response(_serialize(row, tenant_id),
                            message='SMS settings saved.')


@sms_config_bp.route('', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def disable_sms_config():
    """Return to the common (vendor) rail. Keys and templates stay stored
    so re-enabling is one toggle."""
    tenant_id = current_tenant_id_strict()
    row = TenantSmsConfig.for_tenant(tenant_id)
    if row is None:
        return error_response('No SMS configuration saved yet.', status_code=404)
    row.use_own_dlt = False
    row.updated_by_id = get_jwt_identity()
    db.session.commit()
    return success_response(_serialize(row, tenant_id),
                            message='Switched back to shared SMS templates.')
