"""
Doctor Profile Configuration API Routes
Public endpoints for live config and Admin endpoints for CRUD operations.
"""
from flask import request, jsonify, current_app
from flask_jwt_extended import jwt_required, current_user

from app.api.doctor_profile_config import doctor_profile_config_bp
from app.api.doctor_profile_config.service import (
    DoctorProfileConfigService, MasterDataService
)
from app.common.decorators import role_required
from app.common.tenant_context import current_tenant_id_strict
from app.models import UserRole


def _log_and_surface(operation):
    """
    Log full traceback for an unexpected exception in a doctor_profile_config
    handler, then return a 500 whose body carries the exception type + message
    so the failing endpoint is debuggable from the client without grepping logs.
    Caller passes the operation name (e.g. 'get_draft') for log context.
    Must be invoked from inside an `except` block (uses sys.exc_info()).
    """
    import sys
    exc = sys.exc_info()[1]
    current_app.logger.exception(
        "doctor_profile_config.%s failed (path=%s, args=%s, user=%s)",
        operation,
        request.path,
        dict(request.args),
        getattr(current_user, 'id', None),
    )
    return error_response(
        f"{type(exc).__name__}: {exc}",
        status_code=500,
        error_type='Internal Server Error',
    )


def success_response(data, message=None, status_code=200):
    """Standard success response."""
    response = {'success': True, 'data': data}
    if message:
        response['message'] = message
    return jsonify(response), status_code


def error_response(message, status_code=400, error_type='Bad Request'):
    """Standard error response."""
    return jsonify({
        'success': False,
        'error': error_type,
        'message': message
    }), status_code


# ============== PUBLIC ENDPOINTS ==============

@doctor_profile_config_bp.route('/public/doctor_profile', methods=['GET'])
def get_public_config():
    """
    Get the LIVE doctor profile page configuration for public display.
    No authentication required.

    Query params:
        lang: Language code (e.g., 'te', 'hi'). Defaults to 'en'.
        user_type: User type for RBAC filtering (e.g., 'doctor', 'admin').
    """
    lang = request.args.get('lang', 'en')
    user_type = request.args.get('user_type')

    merged = DoctorProfileConfigService.get_merged_config(lang=lang, user_type=user_type)
    return success_response(merged)


# ============== ADMIN ENDPOINTS ==============

@doctor_profile_config_bp.route('/admin/doctor_profile', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def admin_get_configs():
    """Get all configs (draft, preview, live) for doctor profile. Super Admin only."""
    configs = DoctorProfileConfigService.get_all_configs()

    # Include field configs for each
    for key in ['draft', 'preview', 'live']:
        if configs[key]:
            config_id = configs[key]['id']
            fields = DoctorProfileConfigService.get_field_configs(config_id)
            configs[key]['field_configs'] = [f.to_dict() for f in fields]

    return success_response(configs)


@doctor_profile_config_bp.route('/admin/doctor_profile/draft', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_draft():
    """
    Get or create draft configuration.
    Query params:
        section: Optional TAB_GROUP key (e.g., 'analytics', 'attendance_activity').
                 When provided, only returns field_configs and sections for that group.
    """
    try:
        from app.api.doctor_profile_config.service import SECTION_GROUPS

        user_id = str(current_user.id) if current_user else None
        section_group = request.args.get('section')

        draft = DoctorProfileConfigService.get_or_create_draft(user_id)
        result = draft.to_dict(include_asset_urls=True)

        fields = DoctorProfileConfigService.get_field_configs(draft.id, section_group=section_group)
        result['field_configs'] = [f.to_dict() for f in fields]

        # Filter sections JSON to only include the targeted group's sections
        if section_group and section_group not in ('page_settings', 'master_data'):
            section_keys = SECTION_GROUPS.get(section_group, [])
            if section_keys and isinstance(result.get('fields'), dict):
                all_sections = result['fields'].get('sections', [])
                result['fields']['sections'] = [
                    s for s in all_sections if s.get('key') in section_keys
                ]

        # Resolve data sources for field configs
        from app.api.doctor_profile_config.data_resolver import resolve_data_source
        data_sources = {}
        for fc in fields:
            ds = fc.data_source
            if ds and ds not in data_sources:
                data_sources[ds] = resolve_data_source(ds)
        result['data_sources'] = data_sources

        return success_response(result)
    except ValueError as e:
        return error_response(str(e))
    except Exception:
        return _log_and_surface('get_draft')


@doctor_profile_config_bp.route('/admin/doctor_profile/draft', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_draft():
    """
    Update draft page-level configuration.
    Request body can contain page-level fields (colors, title, translations, sections).
    """
    data = request.get_json()
    if not data:
        return error_response("Request body required")

    try:
        user_id = str(current_user.id) if current_user else None
        draft = DoctorProfileConfigService.update_draft(data, user_id)
        result = draft.to_dict(include_asset_urls=True)
        fields = DoctorProfileConfigService.get_field_configs(draft.id)
        result['field_configs'] = [f.to_dict() for f in fields]
        return success_response(result, message="Draft updated successfully")
    except ValueError as e:
        return error_response(str(e))
    except Exception:
        return _log_and_surface('update_draft')


@doctor_profile_config_bp.route('/admin/doctor_profile/draft/fields', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_draft_fields():
    """
    Update individual field configurations within the draft.

    Request body:
    {
        "fields": [
            {"id": "uuid", "label": "New Label", "is_present": false, ...},
            ...
        ]
    }
    """
    data = request.get_json()
    if not data or 'fields' not in data:
        return error_response("Request body must contain 'fields' array")

    try:
        user_id = str(current_user.id) if current_user else None
        updated = DoctorProfileConfigService.update_field_configs(data['fields'], user_id)
        return success_response(updated, message="Field configs updated successfully")
    except ValueError as e:
        return error_response(str(e))
    except Exception:
        return _log_and_surface('update_draft_fields')


@doctor_profile_config_bp.route('/admin/doctor_profile/preview', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def promote_to_preview():
    """Promote draft to preview status."""
    try:
        user_id = str(current_user.id) if current_user else None
        preview = DoctorProfileConfigService.promote_to_preview(user_id)
        return success_response(
            preview.to_dict(include_asset_urls=True),
            message="Draft promoted to preview"
        )
    except ValueError as e:
        return error_response(str(e))
    except Exception:
        return _log_and_surface('promote_to_preview')


@doctor_profile_config_bp.route('/admin/doctor_profile/preview', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_preview():
    """Get preview configuration."""
    preview = DoctorProfileConfigService.get_preview_config()
    if not preview:
        return error_response("No preview config found for doctor_profile", status_code=404)
    result = preview.to_dict(include_asset_urls=True)
    fields = DoctorProfileConfigService.get_field_configs(preview.id)
    result['field_configs'] = [f.to_dict() for f in fields]
    return success_response(result)


@doctor_profile_config_bp.route('/admin/doctor_profile/publish', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def publish_config():
    """Publish preview to live.

    Optional body: ``{"note": "<short description of what changed>"}``.
    Stored in the audit log against the PUBLISH event so the history
    tab can show why each version went out. Matches the landing-page
    publish flow's note semantics.
    """
    try:
        body = request.get_json(silent=True) or {}
        note = (body.get('note') or '').strip() or None
        user_id = str(current_user.id) if current_user else None
        live = DoctorProfileConfigService.publish(user_id, note=note)
        return success_response(
            live.to_dict(include_asset_urls=True),
            message="Configuration published successfully"
        )
    except ValueError as e:
        return error_response(str(e))
    except Exception:
        return _log_and_surface('publish_config')


@doctor_profile_config_bp.route('/admin/doctor_profile/history', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_version_history():
    """Get version history for doctor profile, each row enriched
    with its latest PUBLISH note (set via the publish dialog)."""
    limit = request.args.get('limit', 10, type=int)
    versions = DoctorProfileConfigService.get_version_history(limit)
    out = []
    for v in versions:
        row = v.to_dict()
        # ``_publish_note`` is the transient attribute the service
        # attaches when looking up the matching audit-log row.
        row['publish_note'] = getattr(v, '_publish_note', None)
        out.append(row)
    return success_response(out)


@doctor_profile_config_bp.route('/admin/doctor_profile/restore/<version_id>', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def restore_version(version_id):
    """Restore a specific version to a new draft."""
    try:
        user_id = str(current_user.id) if current_user else None
        draft = DoctorProfileConfigService.restore_version(version_id, user_id)
        result = draft.to_dict(include_asset_urls=True)
        fields = DoctorProfileConfigService.get_field_configs(draft.id)
        result['field_configs'] = [f.to_dict() for f in fields]
        return success_response(result, message="Version restored to draft successfully")
    except ValueError as e:
        return error_response(str(e))
    except Exception:
        return _log_and_surface('restore_version')


@doctor_profile_config_bp.route('/admin/doctor_profile/draft/fields/<field_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def delete_field_config(field_id):
    """Delete a non-default admin-added field from the doctor profile draft."""
    try:
        DoctorProfileConfigService.delete_field(field_id, user_id=current_user.id)
        return success_response({}, message='Field deleted')
    except ValueError as e:
        return error_response(str(e))
    except Exception:
        return _log_and_surface('delete_field_config')


@doctor_profile_config_bp.route('/admin/doctor_profile/audit-logs', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_audit_logs():
    """Get audit logs for doctor profile config."""
    limit = request.args.get('limit', 50, type=int)
    logs = DoctorProfileConfigService.get_audit_logs(limit)
    return success_response([log.to_dict() for log in logs])


# ============== MASTER DATA ENDPOINTS ==============

# --- Colleges ---

@doctor_profile_config_bp.route('/admin/master/colleges', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def list_colleges():
    """List all colleges."""
    active_only = request.args.get('active_only', 'true').lower() == 'true'
    colleges = MasterDataService.get_colleges(active_only)
    return success_response([c.to_dict() for c in colleges])


@doctor_profile_config_bp.route('/admin/master/colleges', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def create_college():
    """Create a new college."""
    data = request.get_json()
    if not data or not data.get('name'):
        return error_response("'name' is required")
    try:
        user_id = str(current_user.id) if current_user else None
        college = MasterDataService.create_college(data['name'], user_id)
        return success_response(college.to_dict(), message="College created successfully", status_code=201)
    except ValueError as e:
        return error_response(str(e))


@doctor_profile_config_bp.route('/admin/master/colleges/<college_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_college(college_id):
    """Update a college."""
    data = request.get_json()
    if not data:
        return error_response("Request body required")
    try:
        college = MasterDataService.update_college(college_id, data)
        return success_response(college.to_dict(), message="College updated successfully")
    except ValueError as e:
        return error_response(str(e))


@doctor_profile_config_bp.route('/admin/master/colleges/<college_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def delete_college(college_id):
    """Soft-delete a college."""
    try:
        college = MasterDataService.delete_college(college_id)
        return success_response(college.to_dict(), message="College deactivated successfully")
    except ValueError as e:
        return error_response(str(e))


# --- Specializations ---

@doctor_profile_config_bp.route('/admin/master/specializations', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def list_specializations():
    """List all specializations."""
    active_only = request.args.get('active_only', 'true').lower() == 'true'
    specs = MasterDataService.get_specializations(active_only)
    return success_response([s.to_dict() for s in specs])


@doctor_profile_config_bp.route('/admin/master/specializations', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def create_specialization():
    """Create a new specialization."""
    data = request.get_json()
    if not data or not data.get('name'):
        return error_response("'name' is required")
    try:
        spec = MasterDataService.create_specialization(
            data['name'], data.get('description')
        )
        return success_response(spec.to_dict(), message="Specialization created successfully", status_code=201)
    except ValueError as e:
        return error_response(str(e))


@doctor_profile_config_bp.route('/admin/master/specializations/<spec_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_specialization(spec_id):
    """Update a specialization."""
    data = request.get_json()
    if not data:
        return error_response("Request body required")
    try:
        spec = MasterDataService.update_specialization(spec_id, data)
        return success_response(spec.to_dict(), message="Specialization updated successfully")
    except ValueError as e:
        return error_response(str(e))


@doctor_profile_config_bp.route('/admin/master/specializations/<spec_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def delete_specialization(spec_id):
    """Soft-delete a specialization."""
    try:
        spec = MasterDataService.delete_specialization(spec_id)
        return success_response(spec.to_dict(), message="Specialization deactivated successfully")
    except ValueError as e:
        return error_response(str(e))


# --- Symptoms (Master Data) ---

@doctor_profile_config_bp.route('/admin/master/symptoms', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def list_symptoms():
    """List all symptoms with optional category filter."""
    from app.extensions import db
    from app.models import Symptom

    tid = current_tenant_id_strict()
    active_only = request.args.get('active_only', 'true').lower() == 'true'
    category = request.args.get('category')

    query = Symptom.query.filter_by(tenant_id=tid)
    if active_only:
        query = query.filter_by(is_active=True)
    if category:
        query = query.filter_by(category=category)

    symptoms = query.order_by(Symptom.category, Symptom.name).all()
    categories = (
        db.session.query(Symptom.category)
        .filter_by(tenant_id=tid)
        .distinct()
        .order_by(Symptom.category)
        .all()
    )

    return success_response(data={
        'symptoms': [s.to_dict() for s in symptoms],
        'categories': [c[0] for c in categories if c[0]],
    })


@doctor_profile_config_bp.route('/admin/master/symptoms', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def create_symptom():
    """Create a new symptom."""
    from app.extensions import db
    from app.models import Symptom

    tid = current_tenant_id_strict()
    data = request.get_json()
    name = data.get('name', '').strip()
    if not name:
        return error_response('Name is required')

    existing = Symptom.query.filter(
        Symptom.tenant_id == tid,
        db.func.lower(Symptom.name) == name.lower(),
    ).first()
    if existing:
        return error_response(f"Symptom '{name}' already exists", status_code=409)

    symptom = Symptom(
        tenant_id=tid,
        name=name,
        description=data.get('description', '').strip() or None,
        category=data.get('category', '').strip() or 'General',
    )
    db.session.add(symptom)
    db.session.commit()
    return success_response(symptom.to_dict(), message="Symptom created successfully", status_code=201)


@doctor_profile_config_bp.route('/admin/master/symptoms/<symptom_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_symptom(symptom_id):
    """Update a symptom."""
    from app.extensions import db
    from app.models import Symptom

    data = request.get_json()
    symptom = Symptom.query.filter_by(
        tenant_id=current_tenant_id_strict(), id=symptom_id,
    ).first()
    if not symptom:
        return error_response("Symptom not found", status_code=404)

    if 'name' in data:
        symptom.name = data['name'].strip()
    if 'description' in data:
        symptom.description = data['description'].strip() or None
    if 'category' in data:
        symptom.category = data['category'].strip() or 'General'
    if 'is_active' in data:
        symptom.is_active = data['is_active']

    db.session.commit()
    return success_response(symptom.to_dict(), message="Symptom updated successfully")


@doctor_profile_config_bp.route('/admin/master/symptoms/<symptom_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def delete_symptom(symptom_id):
    """Soft-delete (deactivate) a symptom."""
    from app.extensions import db
    from app.models import Symptom

    symptom = Symptom.query.filter_by(
        tenant_id=current_tenant_id_strict(), id=symptom_id,
    ).first()
    if not symptom:
        return error_response("Symptom not found", status_code=404)

    symptom.is_active = False
    db.session.commit()
    return success_response(symptom.to_dict(), message="Symptom deactivated successfully")


# ============== DECLARATION CONFIG ENDPOINTS ==============

@doctor_profile_config_bp.route('/admin/declaration-config', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def list_declaration_configs():
    """Get all declaration configs (questions + document types)."""
    from app.models import DeclarationConfig

    active_only = request.args.get('active_only', 'true').lower() == 'true'
    query = DeclarationConfig.query.filter_by(tenant_id=current_tenant_id_strict())
    if active_only:
        query = query.filter_by(is_active=True)

    configs = query.order_by(DeclarationConfig.config_type, DeclarationConfig.display_order).all()

    questions = [c.to_response_dict() for c in configs if c.config_type == 'question']
    document_types = [c.to_response_dict() for c in configs if c.config_type == 'document']

    return success_response({'questions': questions, 'documentTypes': document_types})


@doctor_profile_config_bp.route('/admin/declaration-config', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def create_declaration_config():
    """Create a new declaration question or document type."""
    from app.models import DeclarationConfig
    from app.extensions import db

    data = request.get_json()
    if not data or not data.get('label'):
        return error_response("'label' is required")

    config_type = data.get('configType', 'question')
    if config_type not in ('question', 'document'):
        return error_response("configType must be 'question' or 'document'")

    config = DeclarationConfig(
        tenant_id=current_tenant_id_strict(),
        config_type=config_type,
        label=data['label'],
        description=data.get('description', ''),
        is_required=data.get('isRequired', False),
        is_active=True,
        display_order=data.get('displayOrder', 0),
        has_explanation=data.get('hasExplanation', True),
        has_attachment=data.get('hasAttachment', True),
        created_by=current_user.id if current_user else None,
    )
    db.session.add(config)
    db.session.commit()

    return success_response(
        config.to_response_dict(),
        message=f"Declaration {config_type} created successfully",
        status_code=201
    )


@doctor_profile_config_bp.route('/admin/declaration-config/<config_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_declaration_config(config_id):
    """Update an existing declaration config."""
    from app.models import DeclarationConfig
    from app.extensions import db

    data = request.get_json()
    if not data:
        return error_response("Request body required")

    config = DeclarationConfig.query.filter_by(
        tenant_id=current_tenant_id_strict(), id=config_id,
    ).first()
    if not config:
        return error_response("Declaration config not found", status_code=404)

    if 'label' in data:
        config.label = data['label']
    if 'description' in data:
        config.description = data['description']
    if 'isRequired' in data:
        config.is_required = data['isRequired']
    if 'displayOrder' in data:
        config.display_order = data['displayOrder']
    if 'hasExplanation' in data:
        config.has_explanation = data['hasExplanation']
    if 'hasAttachment' in data:
        config.has_attachment = data['hasAttachment']
    if 'isActive' in data:
        config.is_active = data['isActive']

    db.session.commit()
    return success_response(config.to_response_dict(), message="Declaration config updated successfully")


@doctor_profile_config_bp.route('/admin/declaration-config/<config_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def delete_declaration_config(config_id):
    """Soft-delete a declaration config (set is_active=False)."""
    from app.models import DeclarationConfig
    from app.extensions import db

    config = DeclarationConfig.query.filter_by(
        tenant_id=current_tenant_id_strict(), id=config_id,
    ).first()
    if not config:
        return error_response("Declaration config not found", status_code=404)

    config.is_active = False
    db.session.commit()
    return success_response(config.to_response_dict(), message="Declaration config deactivated successfully")


# ============== PER-MODULE ENDPOINTS (Round 9, Phase 3) ==============
#
# These mirror the page-wide endpoints above but key on a specific
# ``module`` identifier (one of MODULE_KEYS from
# doctor_profile_config/modules.py). Each module carries its own
# DRAFT / PREVIEW / LIVE lifecycle stored on the ``module_configs``
# table — so an operator can publish ``education`` without touching
# ``personal_professional``.
#
# Back-compat: the page-wide endpoints above still work. PageFieldConfig
# rows carry both ``config_id`` and ``module_config_id`` during the
# cutover window (Phase 5 will drop ``config_id`` once the cutover
# is complete).
#
# Routes are registered via the shared ``register_module_routes``
# helper so all five page_type blueprints share one implementation —
# see ``app/common/module_routes.py`` for the route bodies.

from app.api.doctor_profile_config.module_service import (
    for_module as _dp_for_module,
    list_modules as _dp_list_modules,
)
from app.api.doctor_profile_config.data_resolver import resolve_data_source as _dp_resolve_ds
from app.common.module_routes import register_module_routes as _register_module_routes


_register_module_routes(
    blueprint=doctor_profile_config_bp,
    url_prefix='admin/doctor_profile',
    for_module=_dp_for_module,
    list_modules=_dp_list_modules,
    resolve_data_source=_dp_resolve_ds,
)
