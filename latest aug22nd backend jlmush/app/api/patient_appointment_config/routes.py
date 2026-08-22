"""
Patient Appointment Configuration API Routes
Public endpoints for live config and Admin endpoints for CRUD operations.
Supports two page types: patient_appointment_filter and patient_appointment_symptoms.
"""
from flask import request, jsonify
from flask_jwt_extended import jwt_required, current_user

from app.api.patient_appointment_config import patient_appointment_config_bp
from app.api.patient_appointment_config.service import (
    PatientAppointmentConfigService, VALID_PAGE_TYPES,
)
from app.api.patient_appointment_config.data_resolver import resolve_data_source
from app.common.decorators import role_required
from app.models import UserRole


def success_response(data, message=None, status_code=200):
    response = {'success': True, 'data': data}
    if message:
        response['message'] = message
    return jsonify(response), status_code


def error_response(message, status_code=400, error_type='Bad Request'):
    return jsonify({
        'success': False,
        'error': error_type,
        'message': message
    }), status_code


def _validate_page_type(page_type):
    """Validate the page_type URL parameter."""
    if page_type not in VALID_PAGE_TYPES:
        return False
    return True


# ============== PUBLIC ENDPOINTS ==============

@patient_appointment_config_bp.route('/public/<page_type>', methods=['GET'])
def get_public_config(page_type):
    """
    Get the LIVE patient appointment page configuration for public display.
    No authentication required.

    URL params:
        page_type: 'patient_appointment_filter' or 'patient_appointment_symptoms'

    Query params:
        lang: Language code (e.g., 'te', 'hi'). Defaults to 'en'.
        user_type: User type for RBAC filtering.
    """
    if not _validate_page_type(page_type):
        return error_response(
            f'Invalid page_type. Must be one of: {", ".join(VALID_PAGE_TYPES)}',
            status_code=400
        )

    lang = request.args.get('lang', 'en')
    user_type = request.args.get('user_type')

    merged = PatientAppointmentConfigService.get_merged_config(
        page_type, lang=lang, user_type=user_type
    )
    return success_response(merged)


@patient_appointment_config_bp.route('/public/data-source/<source>', methods=['GET'])
def get_data_source(source):
    """Get resolved data source options (languages, symptoms, etc.)."""
    options = resolve_data_source(source)
    return success_response({'options': options, 'source': source})


# ============== ADMIN ENDPOINTS ==============

@patient_appointment_config_bp.route('/admin/<page_type>', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def admin_get_configs(page_type):
    """Get all configs (draft, preview, live) for a patient appointment page type."""
    if not _validate_page_type(page_type):
        return error_response(
            f'Invalid page_type. Must be one of: {", ".join(VALID_PAGE_TYPES)}',
            status_code=400
        )

    configs = PatientAppointmentConfigService.get_all_configs(page_type)

    for key in ['draft', 'preview', 'live']:
        if configs[key]:
            config_id = configs[key]['id']
            fields = PatientAppointmentConfigService.get_field_configs(config_id)
            configs[key]['field_configs'] = [f.to_dict() for f in fields]

    return success_response(configs)


@patient_appointment_config_bp.route('/admin/<page_type>/draft', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_draft(page_type):
    """
    Get or create draft configuration.
    Query params:
        section: Optional TAB_GROUP key for filtering.
    """
    if not _validate_page_type(page_type):
        return error_response(
            f'Invalid page_type. Must be one of: {", ".join(VALID_PAGE_TYPES)}',
            status_code=400
        )

    section_group = request.args.get('section')

    draft = PatientAppointmentConfigService.get_or_create_draft(
        page_type, user_id=current_user.id
    )
    draft_dict = draft.to_dict(include_asset_urls=True)

    field_configs = PatientAppointmentConfigService.get_field_configs(
        draft.id, section_group=section_group
    )
    draft_dict['field_configs'] = [f.to_dict() for f in field_configs]

    # Resolve data sources for field configs
    data_sources = {}
    for fc in field_configs:
        ds = fc.data_source
        if ds and ds not in data_sources:
            data_sources[ds] = resolve_data_source(ds)
    draft_dict['data_sources'] = data_sources

    return success_response(draft_dict)


@patient_appointment_config_bp.route('/admin/<page_type>/draft', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_draft(page_type):
    """Update draft page-level config."""
    if not _validate_page_type(page_type):
        return error_response(
            f'Invalid page_type. Must be one of: {", ".join(VALID_PAGE_TYPES)}',
            status_code=400
        )

    data = request.get_json()
    if not data:
        return error_response('Request body required')

    draft = PatientAppointmentConfigService.update_draft(
        page_type, data, user_id=current_user.id
    )
    return success_response(draft.to_dict(include_asset_urls=True), message='Draft updated')


@patient_appointment_config_bp.route('/admin/<page_type>/draft/fields', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_field_configs(page_type):
    """Update individual field configs."""
    if not _validate_page_type(page_type):
        return error_response(
            f'Invalid page_type. Must be one of: {", ".join(VALID_PAGE_TYPES)}',
            status_code=400
        )

    data = request.get_json()
    if not data or 'fields' not in data:
        return error_response('Request body must contain "fields" array')

    updated = PatientAppointmentConfigService.update_field_configs(
        page_type, data['fields'], user_id=current_user.id
    )
    return success_response({'updated_fields': updated}, message=f'{len(updated)} fields updated')


@patient_appointment_config_bp.route('/admin/<page_type>/draft/fields/<field_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def delete_field_config(page_type, field_id):
    """Delete a non-default admin-added field from the draft."""
    if not _validate_page_type(page_type):
        return error_response(
            f'Invalid page_type. Must be one of: {", ".join(VALID_PAGE_TYPES)}',
            status_code=400
        )

    try:
        PatientAppointmentConfigService.delete_field(
            page_type, field_id, user_id=current_user.id
        )
        return success_response({}, message='Field deleted')
    except ValueError as e:
        return error_response(str(e))


@patient_appointment_config_bp.route('/admin/<page_type>/preview', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def promote_to_preview(page_type):
    """Promote draft to preview."""
    if not _validate_page_type(page_type):
        return error_response(
            f'Invalid page_type. Must be one of: {", ".join(VALID_PAGE_TYPES)}',
            status_code=400
        )

    try:
        preview = PatientAppointmentConfigService.promote_to_preview(
            page_type, user_id=current_user.id
        )
        return success_response(preview.to_dict(), message='Promoted to preview')
    except ValueError as e:
        return error_response(str(e))


@patient_appointment_config_bp.route('/admin/<page_type>/publish', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def publish(page_type):
    """Publish preview to live."""
    if not _validate_page_type(page_type):
        return error_response(
            f'Invalid page_type. Must be one of: {", ".join(VALID_PAGE_TYPES)}',
            status_code=400
        )

    try:
        live = PatientAppointmentConfigService.publish(
            page_type, user_id=current_user.id
        )
        return success_response(live.to_dict(), message='Published successfully')
    except ValueError as e:
        return error_response(str(e))


@patient_appointment_config_bp.route('/admin/<page_type>/history', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_version_history(page_type):
    """Get version history."""
    if not _validate_page_type(page_type):
        return error_response(
            f'Invalid page_type. Must be one of: {", ".join(VALID_PAGE_TYPES)}',
            status_code=400
        )

    limit = request.args.get('limit', 20, type=int)
    versions = PatientAppointmentConfigService.get_version_history(
        page_type, limit=limit
    )
    return success_response({
        'versions': [v.to_dict() for v in versions]
    })


@patient_appointment_config_bp.route('/admin/<page_type>/restore/<version_id>', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def restore_version(page_type, version_id):
    """Restore a specific version to draft."""
    if not _validate_page_type(page_type):
        return error_response(
            f'Invalid page_type. Must be one of: {", ".join(VALID_PAGE_TYPES)}',
            status_code=400
        )

    try:
        draft = PatientAppointmentConfigService.restore_version(
            page_type, version_id, user_id=current_user.id
        )
        return success_response(draft.to_dict(), message='Version restored to draft')
    except ValueError as e:
        return error_response(str(e))


@patient_appointment_config_bp.route('/admin/<page_type>/audit-logs', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_audit_logs(page_type):
    """Get audit logs."""
    if not _validate_page_type(page_type):
        return error_response(
            f'Invalid page_type. Must be one of: {", ".join(VALID_PAGE_TYPES)}',
            status_code=400
        )

    limit = request.args.get('limit', 50, type=int)
    logs = PatientAppointmentConfigService.get_audit_logs(
        page_type, limit=limit
    )
    return success_response({
        'logs': [log.to_dict() for log in logs]
    })


# ============== PER-MODULE ENDPOINTS (Round 9, Phase 3) ==============
# Patient appointment splits into TWO PageType enum values that share
# this blueprint — PATIENT_APPOINTMENT_FILTER and PATIENT_APPOINTMENT_SYMPTOMS.
# Each lives at its own URL prefix so the per-module surface stays
# symmetric with the other four page_types. ``handler_prefix`` keeps
# Flask endpoint names unique across the two registrations.
# See app/common/module_routes.py for the shared route bodies.

from app.api.patient_appointment_config.module_service import (
    for_module as _pa_for_module,
    list_modules as _pa_list_modules,
)
from app.common.module_routes import register_module_routes as _register_module_routes


_register_module_routes(
    blueprint=patient_appointment_config_bp,
    url_prefix='admin/patient_appointment_filter',
    for_module=lambda m: _pa_for_module('patient_appointment_filter', m),
    list_modules=lambda: _pa_list_modules('patient_appointment_filter'),
    resolve_data_source=resolve_data_source,
    handler_prefix='filter_',
)


_register_module_routes(
    blueprint=patient_appointment_config_bp,
    url_prefix='admin/patient_appointment_symptoms',
    for_module=lambda m: _pa_for_module('patient_appointment_symptoms', m),
    list_modules=lambda: _pa_list_modules('patient_appointment_symptoms'),
    resolve_data_source=resolve_data_source,
    handler_prefix='symptoms_',
)
