"""Tenant self-serve email configuration — sender identity + templates.

The email twin of :mod:`app.api.admin.sms_config`. By default a tenant's mail
goes out on the VENDOR's identity using the common ``notification_templates``
registry (``channel='email'``). A tenant whose plan grants
``communication.custom_email`` may override the wording per purpose and send
from their own verified domain.

  GET    /api/admin/email-config   -> config + plan gate + common purposes
  PUT    /api/admin/email-config   -> upsert (templates merge per purpose)
  DELETE /api/admin/email-config   -> back to the vendor rail

Two things differ from the SMS twin, both on purpose:

* no credential is stored. SendClean sends from any verified domain on the
  same owner_id/token, so there is nothing per-tenant to hold in secret.
* ``domain_verified`` is set by the OPERATOR, not the tenant. A tenant can
  claim any from-address; only someone with the SendClean portal can confirm
  the domain actually passes Domain/DKIM/SPF, and sending from an unverified
  domain is rejected by the provider. So the tenant may edit templates
  freely, but flipping their sender live needs that confirmation — otherwise
  a cosmetic toggle would silently stop their mail being delivered.

Tenant id always from ``current_tenant_id_strict()``.
"""
import logging
import re

from flask import Blueprint, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.common.decorators import role_required
from app.common.responses import success_response, error_response
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import NotificationTemplate, TenantEmailConfig, UserRole

logger = logging.getLogger(__name__)

email_config_bp = Blueprint('email_config_admin', __name__)

FEATURE_PATH = 'communication.custom_email'

_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$')


def _custom_email_allowed(tenant_id) -> bool:
    from app.api.pricing.service import FeatureGate
    return FeatureGate.is_enabled(tenant_id, FEATURE_PATH)


def _common_purposes():
    """The common registry's EMAIL rows — the reference list the template
    editor renders (which purposes exist, their variables, and the vendor's
    wording as a starting point).

    Deliberately the same shape the SMS endpoint returns, so one editor
    component can render either channel; ``common_subject`` is the only
    extra field, since SMS has no subject.
    """
    rows = (
        NotificationTemplate.query
        .filter_by(channel='email', is_active=True)
        .order_by(NotificationTemplate.purpose)
        .all()
    )
    return [{
        'purpose': r.purpose,
        'name': r.name,
        'variable_names': r.variable_names or [],
        'common_subject': r.subject,
        'common_body': r.body_template,
    } for r in rows]


def _serialize(row, tenant_id):
    payload = row.to_dict() if row is not None else {
        'id': None, 'is_active': False, 'use_own_email': False,
        'from_email': None, 'from_name': None, 'reply_to': None,
        'domain_verified': False, 'templates': {}, 'ready': False,
        'updated_at': None,
    }
    payload['custom_email_allowed'] = _custom_email_allowed(tenant_id)
    payload['common_purposes'] = _common_purposes()
    return payload


@email_config_bp.route('', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_email_config():
    tenant_id = current_tenant_id_strict()
    row = TenantEmailConfig.for_tenant(tenant_id)
    return success_response(_serialize(row, tenant_id))


@email_config_bp.route('', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def save_email_config():
    """Upsert. ``templates`` merges per purpose — send a purpose with a
    subject + body to add/replace it, or ``null`` to remove it.

    ``domain_verified`` is NOT accepted here; it is an operator confirmation
    (see the module docstring). A tenant saving a new ``from_email`` clears
    it, because verification belongs to the address that was checked.
    """
    tenant_id = current_tenant_id_strict()
    data = request.get_json() or {}

    use_own_email = data.get('use_own_email')
    if use_own_email and not _custom_email_allowed(tenant_id):
        return error_response(
            'Your plan uses the shared email templates. Upgrade to send from '
            'your own domain.', status_code=403, code='feature_disabled')

    row = TenantEmailConfig.for_tenant(tenant_id)
    if row is None:
        row = TenantEmailConfig(tenant_id=tenant_id)
        db.session.add(row)
    actor = get_jwt_identity()
    if row.created_by_id is None:
        row.created_by_id = actor
    row.updated_by_id = actor

    if use_own_email is not None:
        row.use_own_email = bool(use_own_email)

    if 'from_email' in data:
        addr = (data.get('from_email') or '').strip().lower()
        if addr and not _EMAIL_RE.match(addr):
            return error_response('from_email is not a valid address.',
                                  status_code=400)
        # Changing the address invalidates the previous confirmation — the
        # new domain has not been checked yet.
        if addr != (row.from_email or ''):
            row.domain_verified = False
        row.from_email = addr or None
    if 'from_name' in data:
        row.from_name = (data.get('from_name') or '').strip() or None
    if 'reply_to' in data:
        rt = (data.get('reply_to') or '').strip().lower()
        if rt and not _EMAIL_RE.match(rt):
            return error_response('reply_to is not a valid address.',
                                  status_code=400)
        row.reply_to = rt or None

    templates_patch = data.get('templates')
    if templates_patch is not None:
        if not isinstance(templates_patch, dict):
            return error_response('templates must be an object.', status_code=400)
        merged = dict(row.templates or {})
        for purpose, entry in templates_patch.items():
            if entry is None:
                merged.pop(purpose, None)
                continue
            if not isinstance(entry, dict) or not entry.get('subject') \
                    or not entry.get('body_template'):
                return error_response(
                    f"templates['{purpose}'] needs subject and body_template.",
                    status_code=400)
            merged[purpose] = {
                'subject': str(entry['subject']).strip(),
                'body_template': entry['body_template'],
                'variable_names': entry.get('variable_names') or [],
            }
        row.templates = merged

    row.is_active = True
    db.session.commit()
    logger.info('[EMAIL-CONFIG] tenant=%s saved by user=%s '
                '(own_email=%s, ready=%s)',
                tenant_id, actor, row.use_own_email, row.own_sender_ready)
    return success_response(_serialize(row, tenant_id),
                            message='Email settings saved.')


@email_config_bp.route('', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def disable_email_config():
    """Return to the vendor rail. Templates and the address stay stored so
    re-enabling is one toggle."""
    tenant_id = current_tenant_id_strict()
    row = TenantEmailConfig.for_tenant(tenant_id)
    if row is None:
        return error_response('No email configuration saved yet.',
                              status_code=404)
    row.use_own_email = False
    row.updated_by_id = get_jwt_identity()
    db.session.commit()
    return success_response(_serialize(row, tenant_id),
                            message='Switched back to shared email templates.')
