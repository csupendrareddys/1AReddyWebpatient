"""
Patient Profile Configuration API Routes
Public endpoints for live config and Admin endpoints for CRUD operations.
"""
from flask import request, jsonify
from flask_jwt_extended import jwt_required, current_user

from app.api.patient_profile_config import patient_profile_config_bp
from app.api.patient_profile_config.service import PatientProfileConfigService
from app.api.patient_profile_config.data_resolver import resolve_data_source
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


# ============== PUBLIC ENDPOINTS ==============

@patient_profile_config_bp.route('/public/patient_profile', methods=['GET'])
def get_public_config():
    """
    Get the LIVE patient profile page configuration for public display.
    No authentication required.

    Query params:
        lang: Language code (e.g., 'te', 'hi'). Defaults to 'en'.
        user_type: User type for RBAC filtering.
    """
    lang = request.args.get('lang', 'en')
    user_type = request.args.get('user_type')

    merged = PatientProfileConfigService.get_merged_config(lang=lang, user_type=user_type)
    return success_response(merged)


@patient_profile_config_bp.route('/public/data-source/<source>', methods=['GET'])
def get_data_source(source):
    """Get resolved data source options (languages, blood groups, etc.)."""
    options = resolve_data_source(source)
    return success_response({'options': options, 'source': source})


# ============== ADMIN ENDPOINTS ==============

@patient_profile_config_bp.route('/admin/patient_profile', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def admin_get_configs():
    """Get all configs (draft, preview, live) for patient profile."""
    configs = PatientProfileConfigService.get_all_configs()

    for key in ['draft', 'preview', 'live']:
        if configs[key]:
            config_id = configs[key]['id']
            fields = PatientProfileConfigService.get_field_configs(config_id)
            configs[key]['field_configs'] = [f.to_dict() for f in fields]

    return success_response(configs)


@patient_profile_config_bp.route('/admin/patient_profile/draft', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_draft():
    """
    Get or create draft configuration.
    Query params:
        section: Optional TAB_GROUP key for filtering.
    """
    section_group = request.args.get('section')

    draft = PatientProfileConfigService.get_or_create_draft(user_id=current_user.id)
    draft_dict = draft.to_dict(include_asset_urls=True)

    field_configs = PatientProfileConfigService.get_field_configs(
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


@patient_profile_config_bp.route('/admin/patient_profile/draft', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_draft():
    """Update draft page-level config."""
    data = request.get_json()
    if not data:
        return error_response('Request body required')

    draft = PatientProfileConfigService.update_draft(data, user_id=current_user.id)
    return success_response(draft.to_dict(include_asset_urls=True), message='Draft updated')


@patient_profile_config_bp.route('/admin/patient_profile/draft/fields', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_field_configs():
    """Update individual field configs."""
    data = request.get_json()
    if not data or 'fields' not in data:
        return error_response('Request body must contain "fields" array')

    updated = PatientProfileConfigService.update_field_configs(
        data['fields'], user_id=current_user.id
    )
    return success_response({'updated_fields': updated}, message=f'{len(updated)} fields updated')


@patient_profile_config_bp.route('/admin/patient_profile/preview', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def promote_to_preview():
    """Promote draft to preview."""
    try:
        preview = PatientProfileConfigService.promote_to_preview(user_id=current_user.id)
        return success_response(preview.to_dict(), message='Promoted to preview')
    except ValueError as e:
        return error_response(str(e))


@patient_profile_config_bp.route('/admin/patient_profile/preview', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_preview():
    """Get preview config."""
    preview = PatientProfileConfigService.get_preview_config()
    if not preview:
        return error_response('No preview config found', status_code=404)

    preview_dict = preview.to_dict(include_asset_urls=True)
    field_configs = PatientProfileConfigService.get_field_configs(preview.id)
    preview_dict['field_configs'] = [f.to_dict() for f in field_configs]
    return success_response(preview_dict)


@patient_profile_config_bp.route('/admin/patient_profile/publish', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def publish():
    """Publish preview to live."""
    try:
        live = PatientProfileConfigService.publish(user_id=current_user.id)
        return success_response(live.to_dict(), message='Published successfully')
    except ValueError as e:
        return error_response(str(e))


@patient_profile_config_bp.route('/admin/patient_profile/history', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_version_history():
    """Get version history."""
    limit = request.args.get('limit', 20, type=int)
    versions = PatientProfileConfigService.get_version_history(limit=limit)
    return success_response({
        'versions': [v.to_dict() for v in versions]
    })


@patient_profile_config_bp.route('/admin/patient_profile/restore/<version_id>', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def restore_version(version_id):
    """Restore a specific version to draft."""
    try:
        draft = PatientProfileConfigService.restore_version(version_id, user_id=current_user.id)
        return success_response(draft.to_dict(), message='Version restored to draft')
    except ValueError as e:
        return error_response(str(e))


@patient_profile_config_bp.route('/admin/patient_profile/draft/fields/<field_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def delete_field_config(field_id):
    """Delete a non-default admin-added field from the draft."""
    try:
        PatientProfileConfigService.delete_field(field_id, user_id=current_user.id)
        return success_response({}, message='Field deleted')
    except ValueError as e:
        return error_response(str(e))


@patient_profile_config_bp.route('/admin/patient_profile/audit-logs', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_audit_logs():
    """Get audit logs."""
    limit = request.args.get('limit', 50, type=int)
    logs = PatientProfileConfigService.get_audit_logs(limit=limit)
    return success_response({
        'logs': [log.to_dict() for log in logs]
    })


# ============== PER-MODULE ENDPOINTS (Round 9, Phase 3) ==============
# See app/common/module_routes.py for the shared route bodies.

from app.api.patient_profile_config.module_service import (
    for_module as _pp_for_module,
    list_modules as _pp_list_modules,
)
from app.common.module_routes import register_module_routes as _register_module_routes


_register_module_routes(
    blueprint=patient_profile_config_bp,
    url_prefix='admin/patient_profile',
    for_module=_pp_for_module,
    list_modules=_pp_list_modules,
    resolve_data_source=resolve_data_source,
)
