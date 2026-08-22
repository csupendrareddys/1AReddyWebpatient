"""
Super-admin tenant settings — provider directory visibility.

Lets a SUPER_ADMIN turn the Discover directory on/off per provider type
(doctors / hospitals / clinics) so doctors can grow their care network at the
start and lock it down later. Stored in ``Tenant.settings['provider_visibility']``
(JSON, no dedicated table) using an immutable dict-merge so sibling settings
(e.g. 'plan') are preserved and SQLAlchemy detects the change.

  GET /api/admin/tenant-settings/provider-visibility
  PUT /api/admin/tenant-settings/provider-visibility   { doctors?, hospitals?, clinics? }
"""
from flask import request, Blueprint
from flask_jwt_extended import jwt_required

from app.common.decorators import role_required
from app.common.responses import success_response, error_response
from app.common.tenant_context import current_tenant_id_strict
from app.models import UserRole, Tenant
from app.extensions import db

tenant_settings_bp = Blueprint('tenant_settings_admin', __name__)

_KEYS = ('doctors', 'hospitals', 'clinics')


def _read_visibility(tenant):
    vis = (tenant.settings or {}).get('provider_visibility', {}) if tenant else {}
    return {k: bool(vis.get(k, False)) for k in _KEYS}


@tenant_settings_bp.route('/provider-visibility', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def get_provider_visibility():
    tenant = Tenant.query.get(current_tenant_id_strict())
    if not tenant:
        return error_response('Tenant not found', status_code=404)
    return success_response(data={'visibility': _read_visibility(tenant)})


@tenant_settings_bp.route('/provider-visibility', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def update_provider_visibility():
    tenant = Tenant.query.get(current_tenant_id_strict())
    if not tenant:
        return error_response('Tenant not found', status_code=404)

    data = request.get_json() or {}
    current = _read_visibility(tenant)
    for k in _KEYS:
        if k in data:
            current[k] = bool(data[k])

    # Immutable merge so SQLAlchemy sees the JSON change and 'plan' etc. survive.
    new_settings = dict(tenant.settings or {})
    new_settings['provider_visibility'] = current
    tenant.settings = new_settings
    db.session.commit()

    return success_response(message='Provider visibility updated', data={'visibility': current})


# ── Tenant-global appointment types (the "Appointments" master switch) ────────
# Which consultation types (+ marketplace) are enabled across the whole tenant.
# A doctor can only offer a type that is enabled here (see the doctor
# appointment-settings ceiling). Default: all enabled, so unset = on.
_APPT_KEYS = ('video', 'audio', 'chat', 'complete', 'home_visit', 'camp', 'marketplace')


def read_appointment_types(tenant):
    at = (tenant.settings or {}).get('appointment_types', {}) if tenant else {}
    return {k: bool(at.get(k, True)) for k in _APPT_KEYS}


def tenant_enabled_appointment_types(tenant_id):
    """Set of consultation-type values enabled tenant-wide (helper for gating)."""
    tenant = Tenant.query.get(tenant_id)
    at = read_appointment_types(tenant)
    return {k for k, v in at.items() if v}


@tenant_settings_bp.route('/appointment-types', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def get_appointment_types():
    tenant = Tenant.query.get(current_tenant_id_strict())
    if not tenant:
        return error_response('Tenant not found', status_code=404)
    return success_response(data={'appointment_types': read_appointment_types(tenant), 'keys': list(_APPT_KEYS)})


@tenant_settings_bp.route('/appointment-types', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def update_appointment_types():
    tenant = Tenant.query.get(current_tenant_id_strict())
    if not tenant:
        return error_response('Tenant not found', status_code=404)

    data = request.get_json() or {}
    current = read_appointment_types(tenant)
    for k in _APPT_KEYS:
        if k in data:
            current[k] = bool(data[k])

    new_settings = dict(tenant.settings or {})
    new_settings['appointment_types'] = current
    tenant.settings = new_settings
    db.session.commit()
    return success_response(message='Tenant appointment types updated', data={'appointment_types': current})
