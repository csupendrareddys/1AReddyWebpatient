"""
Doctor Signup Configuration API Routes.

Public endpoint: GET /api/doctor-signup-config/public/doctor_signup
    → returns the live signup config (page-level + fields + resolved
      dropdown options) for the React signup page. Anonymous.

Admin endpoints (JWT, SUPER_ADMIN / PLATFORM_OWNER):
    GET    /admin/doctor_signup            — draft + preview + live
    GET    /admin/doctor_signup/draft      — full draft (with resolved sources)
    PUT    /admin/doctor_signup/draft      — page-level updates
    PUT    /admin/doctor_signup/draft/fields — bulk field updates
    DELETE /admin/doctor_signup/draft/fields/<id> — remove admin-added field
    POST   /admin/doctor_signup/preview    — promote draft → preview
    POST   /admin/doctor_signup/publish    — promote preview → live
    GET    /admin/doctor_signup/history    — version history
    POST   /admin/doctor_signup/restore/<id> — restore a version into draft
    GET    /admin/doctor_signup/audit-logs

Master-data endpoints (qualification-level scoped) for the new UG / PG /
SS lists are mounted under /admin/master/ here so the signup editor and
the profile editor share one CRUD surface.
"""
from flask import request, jsonify, current_app
from flask_jwt_extended import jwt_required, current_user

from app.api.doctor_signup_config import doctor_signup_config_bp
from app.api.doctor_signup_config.service import (
    DoctorSignupConfigService, PAGE_TYPE_ENUM,
)
from app.api.doctor_signup_config.default_fields import LOCKED_FIELD_KEYS
from app.common.decorators import role_required
from app.common.tenant_context import current_tenant_id_strict
from app.models import UserRole


# ----- response helpers (kept inline for parity with sibling modules) -----

def success_response(data, message=None, status_code=200):
    response = {'success': True, 'data': data}
    if message:
        response['message'] = message
    return jsonify(response), status_code


def error_response(message, status_code=400, error_type='Bad Request'):
    return jsonify({
        'success': False,
        'error': error_type,
        'message': message,
    }), status_code


def _log_and_surface(operation):
    """Wrap an unexpected exception with a traceback log + diagnostic body."""
    import sys
    exc = sys.exc_info()[1]
    current_app.logger.exception(
        "doctor_signup_config.%s failed (path=%s, args=%s, user=%s)",
        operation, request.path, dict(request.args),
        getattr(current_user, 'id', None),
    )
    return error_response(
        f"{type(exc).__name__}: {exc}",
        status_code=500, error_type='Internal Server Error',
    )


# ============== PUBLIC ENDPOINTS ==============

@doctor_signup_config_bp.route('/public/doctor_signup', methods=['GET'])
def get_public_config():
    """
    Get the LIVE signup config + resolved dropdown options for the
    React signup page. Anonymous.

    Query params:
        lang: 'te', 'hi', ... (defaults to 'en')
    """
    lang = request.args.get('lang', 'en')
    merged = DoctorSignupConfigService.get_merged_config(lang=lang)
    return success_response(merged)


# ============== ADMIN ENDPOINTS ==============

@doctor_signup_config_bp.route('/admin/doctor_signup', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def admin_get_configs():
    """Get draft / preview / live snapshots together."""
    configs = DoctorSignupConfigService.get_all_configs()
    for key in ('draft', 'preview', 'live'):
        if configs[key]:
            fields = DoctorSignupConfigService.get_field_configs(configs[key]['id'])
            configs[key]['field_configs'] = [f.to_dict() for f in fields]
    configs['locked_field_keys'] = sorted(LOCKED_FIELD_KEYS)
    return success_response(configs)


@doctor_signup_config_bp.route('/admin/doctor_signup/draft', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_draft():
    """
    Get (or seed) the draft config + field rows + resolved dropdowns.
    The editor consumes this to render the form.
    """
    try:
        from app.api.doctor_signup_config.data_resolver import resolve_data_source

        user_id = str(current_user.id) if current_user else None
        draft = DoctorSignupConfigService.get_or_create_draft(user_id)
        result = draft.to_dict(include_asset_urls=True)

        fields = DoctorSignupConfigService.get_field_configs(draft.id)
        result['field_configs'] = [f.to_dict() for f in fields]

        data_sources = {}
        for fc in fields:
            ds = fc.data_source
            if ds and ds not in data_sources:
                data_sources[ds] = resolve_data_source(ds)
        result['data_sources'] = data_sources
        result['locked_field_keys'] = sorted(LOCKED_FIELD_KEYS)
        return success_response(result)
    except ValueError as e:
        return error_response(str(e))
    except Exception:
        return _log_and_surface('get_draft')


@doctor_signup_config_bp.route('/admin/doctor_signup/draft', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_draft():
    """Update page-level draft fields (colors, copy, branding)."""
    data = request.get_json()
    if not data:
        return error_response('Request body required')

    try:
        user_id = str(current_user.id) if current_user else None
        draft = DoctorSignupConfigService.update_draft(data, user_id)
        result = draft.to_dict(include_asset_urls=True)
        result['field_configs'] = [
            f.to_dict()
            for f in DoctorSignupConfigService.get_field_configs(draft.id)
        ]
        return success_response(result, message='Draft updated successfully')
    except ValueError as e:
        return error_response(str(e))
    except Exception:
        return _log_and_surface('update_draft')


@doctor_signup_config_bp.route('/admin/doctor_signup/draft/fields', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_draft_fields():
    """
    Bulk-update individual PageFieldConfig rows.

    Request body:
    {
        "fields": [
            {"id": "<uuid>", "label": "New label", "placeholder": "..."},
            {"id": "new_<temp>", "section": "personal", "field_key": "alt_email", ...}
        ]
    }

    Locked field updates (phone_number / password / first_name / ...) are
    filtered to label / placeholder / helper_text / icon / display_order /
    translations only — see ``LOCKED_FIELD_KEYS`` in default_fields.py.
    """
    data = request.get_json()
    if not data or 'fields' not in data:
        return error_response("Request body must contain 'fields' array")

    try:
        user_id = str(current_user.id) if current_user else None
        result = DoctorSignupConfigService.update_field_configs(data['fields'], user_id)
        msg = 'Field configs updated successfully'
        if result.get('rejected_updates'):
            msg += f" ({len(result['rejected_updates'])} locked-field changes silently dropped)"
        return success_response(result, message=msg)
    except ValueError as e:
        return error_response(str(e))
    except Exception:
        return _log_and_surface('update_draft_fields')


@doctor_signup_config_bp.route(
    '/admin/doctor_signup/draft/fields/<field_id>', methods=['DELETE'],
)
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def delete_field_config(field_id):
    """Delete a non-default admin-added field."""
    try:
        DoctorSignupConfigService.delete_field(field_id, user_id=current_user.id)
        return success_response({}, message='Field deleted')
    except ValueError as e:
        return error_response(str(e))
    except Exception:
        return _log_and_surface('delete_field_config')


@doctor_signup_config_bp.route('/admin/doctor_signup/preview', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def promote_to_preview():
    """Promote draft → preview."""
    try:
        user_id = str(current_user.id) if current_user else None
        preview = DoctorSignupConfigService.promote_to_preview(user_id)
        return success_response(
            preview.to_dict(include_asset_urls=True),
            message='Draft promoted to preview',
        )
    except ValueError as e:
        return error_response(str(e))
    except Exception:
        return _log_and_surface('promote_to_preview')


@doctor_signup_config_bp.route('/admin/doctor_signup/preview', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_preview():
    """Get current preview config."""
    preview = DoctorSignupConfigService.get_preview_config()
    if not preview:
        return error_response('No preview config found for doctor_signup',
                              status_code=404)
    result = preview.to_dict(include_asset_urls=True)
    result['field_configs'] = [
        f.to_dict()
        for f in DoctorSignupConfigService.get_field_configs(preview.id)
    ]
    return success_response(result)


@doctor_signup_config_bp.route('/admin/doctor_signup/publish', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def publish_config():
    """Publish preview → live."""
    try:
        user_id = str(current_user.id) if current_user else None
        live = DoctorSignupConfigService.publish(user_id)
        return success_response(
            live.to_dict(include_asset_urls=True),
            message='Configuration published successfully',
        )
    except ValueError as e:
        return error_response(str(e))
    except Exception:
        return _log_and_surface('publish_config')


@doctor_signup_config_bp.route('/admin/doctor_signup/history', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_version_history():
    limit = request.args.get('limit', 10, type=int)
    versions = DoctorSignupConfigService.get_version_history(limit)
    return success_response([v.to_dict() for v in versions])


@doctor_signup_config_bp.route('/admin/doctor_signup/restore/<version_id>', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def restore_version(version_id):
    """Restore a historical version into the current draft."""
    try:
        user_id = str(current_user.id) if current_user else None
        draft = DoctorSignupConfigService.restore_version(version_id, user_id)
        result = draft.to_dict(include_asset_urls=True)
        result['field_configs'] = [
            f.to_dict()
            for f in DoctorSignupConfigService.get_field_configs(draft.id)
        ]
        return success_response(result, message='Version restored to draft successfully')
    except ValueError as e:
        return error_response(str(e))
    except Exception:
        return _log_and_surface('restore_version')


@doctor_signup_config_bp.route('/admin/doctor_signup/audit-logs', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def get_audit_logs():
    limit = request.args.get('limit', 50, type=int)
    logs = DoctorSignupConfigService.get_audit_logs(limit)
    return success_response([log.to_dict() for log in logs])


# ============== MASTER-DATA ENDPOINTS (level-scoped) ==============
#
# These live in the signup-config module because the signup form is what
# actually needs the qualification-level split — the profile editor's
# legacy /admin/master/colleges and /admin/master/specializations
# endpoints still work for non-scoped CRUD.

def _validate_level(level):
    """Reject anything we don't recognize (defensive — column is free-form)."""
    if level not in ('ug', 'pg', 'super_speciality'):
        raise ValueError(
            f"qualification_level must be 'ug', 'pg', or 'super_speciality'; got {level!r}"
        )


# ---- Colleges (per-level) ----

@doctor_signup_config_bp.route('/admin/master/colleges', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def list_colleges_by_level():
    """
    List colleges, optionally filtered by qualification_level.

    Query params:
        level: 'ug' | 'pg' | 'super_speciality'  (omit for all)
        active_only: 'true' (default) | 'false'
    """
    from app.models import MasterCollege

    tid = current_tenant_id_strict()
    level = request.args.get('level')
    active_only = request.args.get('active_only', 'true').lower() == 'true'

    query = MasterCollege.query.filter_by(tenant_id=tid)
    if active_only:
        query = query.filter_by(is_active=True)
    if level:
        query = query.filter_by(qualification_level=level)

    colleges = query.order_by(MasterCollege.name).all()
    return success_response([c.to_dict() for c in colleges])


@doctor_signup_config_bp.route('/admin/master/colleges', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def create_college_with_level():
    """
    Create a college tagged with a qualification level.

    Body: { "name": "...", "qualification_level": "ug|pg|super_speciality" }
    """
    from app.extensions import db
    from app.models import MasterCollege

    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    level = data.get('qualification_level')
    if not name:
        return error_response("'name' is required")
    try:
        _validate_level(level)
    except ValueError as e:
        return error_response(str(e))

    tid = current_tenant_id_strict()
    existing = MasterCollege.query.filter_by(tenant_id=tid, name=name).first()
    if existing:
        if existing.is_active:
            return error_response(
                f"College '{name}' already exists for this tenant",
                status_code=409,
            )
        # Reactivate a previously soft-deleted row. UNIQUE(tenant, name) blocks a
        # fresh insert, so without this a deactivated name could never be
        # re-added from the admin UI.
        existing.is_active = True
        if level is not None:
            existing.qualification_level = level
        db.session.commit()
        return success_response(
            existing.to_dict(), message='College reactivated successfully',
        )

    from datetime import datetime, timezone
    college = MasterCollege(
        tenant_id=tid,
        name=name,
        qualification_level=level,
        created_by_id=current_user.id if current_user else None,
        created_at=datetime.now(timezone.utc),
    )
    db.session.add(college)
    db.session.commit()
    return success_response(
        college.to_dict(), message='College created successfully', status_code=201,
    )


@doctor_signup_config_bp.route('/admin/master/colleges/<college_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_college_with_level(college_id):
    """Update a college (name / qualification_level / is_active)."""
    from app.extensions import db
    from app.models import MasterCollege

    data = request.get_json() or {}
    college = MasterCollege.query.filter_by(
        tenant_id=current_tenant_id_strict(), id=college_id,
    ).first()
    if not college:
        return error_response('College not found', status_code=404)

    if 'name' in data:
        college.name = data['name'].strip()
    if 'qualification_level' in data:
        new_level = data['qualification_level']
        if new_level is None:
            college.qualification_level = None
        else:
            try:
                _validate_level(new_level)
            except ValueError as e:
                return error_response(str(e))
            college.qualification_level = new_level
    if 'is_active' in data:
        college.is_active = bool(data['is_active'])

    db.session.commit()
    return success_response(college.to_dict(), message='College updated successfully')


@doctor_signup_config_bp.route('/admin/master/colleges/<college_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def delete_college_with_level(college_id):
    """Soft-delete a college."""
    from app.extensions import db
    from app.models import MasterCollege

    college = MasterCollege.query.filter_by(
        tenant_id=current_tenant_id_strict(), id=college_id,
    ).first()
    if not college:
        return error_response('College not found', status_code=404)
    college.is_active = False
    db.session.commit()
    return success_response(college.to_dict(), message='College deactivated successfully')


@doctor_signup_config_bp.route('/admin/master/colleges/bulk', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def bulk_create_colleges():
    """
    Bulk import of colleges at a given level. Useful for seeding the
    initial UG / PG / SS lists.

    Body:
        {
            "qualification_level": "ug",
            "names": ["AIIMS Delhi", "JIPMER", ...]
        }
    """
    from app.extensions import db
    from app.models import MasterCollege

    data = request.get_json() or {}
    level = data.get('qualification_level')
    names = data.get('names') or []
    try:
        _validate_level(level)
    except ValueError as e:
        return error_response(str(e))
    if not isinstance(names, list) or not names:
        return error_response("'names' must be a non-empty list")

    tid = current_tenant_id_strict()
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    creator_id = current_user.id if current_user else None

    existing_names = {
        c.name for c in MasterCollege.query.filter_by(tenant_id=tid).all()
    }
    created = []
    skipped = []
    for raw_name in names:
        name = (raw_name or '').strip()
        if not name:
            continue
        if name in existing_names:
            skipped.append(name)
            continue
        row = MasterCollege(
            tenant_id=tid,
            name=name,
            qualification_level=level,
            created_by_id=creator_id,
            created_at=now,
        )
        db.session.add(row)
        created.append(name)
        existing_names.add(name)

    db.session.commit()
    return success_response(
        {'created': created, 'skipped': skipped, 'qualification_level': level},
        message=f'Created {len(created)} colleges (skipped {len(skipped)} duplicates)',
        status_code=201,
    )


# ---- Specializations (per-level, via Category) ----

@doctor_signup_config_bp.route('/admin/master/specializations', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def list_specializations_by_level():
    """List specializations, optionally filtered by qualification_level."""
    from app.models import Category

    tid = current_tenant_id_strict()
    level = request.args.get('level')
    active_only = request.args.get('active_only', 'true').lower() == 'true'

    query = Category.query.filter_by(
        tenant_id=tid, category_type='specialization',
    )
    if active_only:
        query = query.filter_by(is_active=True)
    if level:
        query = query.filter_by(qualification_level=level)

    specs = query.order_by(Category.name).all()
    return success_response([s.to_dict() for s in specs])


@doctor_signup_config_bp.route('/admin/master/specializations', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def create_specialization_with_level():
    """Create a specialization tagged with a qualification level."""
    from app.extensions import db
    from app.models import Category

    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    level = data.get('qualification_level')
    description = data.get('description')
    if not name:
        return error_response("'name' is required")
    try:
        _validate_level(level)
    except ValueError as e:
        return error_response(str(e))

    tid = current_tenant_id_strict()
    existing = Category.query.filter_by(tenant_id=tid, name=name).first()
    if existing:
        if existing.is_active or existing.category_type != 'specialization':
            return error_response(
                f"Specialization '{name}' already exists for this tenant",
                status_code=409,
            )
        # Reactivate a previously soft-deleted specialization (UNIQUE(tenant,
        # name) blocks a fresh insert).
        existing.is_active = True
        if level is not None:
            existing.qualification_level = level
        if description is not None:
            existing.description = description
        db.session.commit()
        return success_response(
            existing.to_dict(), message='Specialization reactivated successfully',
        )

    spec = Category(
        tenant_id=tid,
        name=name,
        description=description,
        category_type='specialization',
        qualification_level=level,
    )
    db.session.add(spec)
    db.session.commit()
    return success_response(
        spec.to_dict(),
        message='Specialization created successfully',
        status_code=201,
    )


@doctor_signup_config_bp.route('/admin/master/specializations/<spec_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_specialization_with_level(spec_id):
    """Update a specialization (name / description / qualification_level / is_active)."""
    from app.extensions import db
    from app.models import Category

    data = request.get_json() or {}
    spec = Category.query.filter_by(
        tenant_id=current_tenant_id_strict(), id=spec_id,
    ).first()
    if not spec:
        return error_response('Specialization not found', status_code=404)

    if 'name' in data:
        spec.name = data['name'].strip()
    if 'description' in data:
        spec.description = data['description']
    if 'qualification_level' in data:
        new_level = data['qualification_level']
        if new_level is None:
            spec.qualification_level = None
        else:
            try:
                _validate_level(new_level)
            except ValueError as e:
                return error_response(str(e))
            spec.qualification_level = new_level
    if 'is_active' in data:
        spec.is_active = bool(data['is_active'])

    db.session.commit()
    return success_response(spec.to_dict(), message='Specialization updated successfully')


@doctor_signup_config_bp.route('/admin/master/specializations/<spec_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def delete_specialization_with_level(spec_id):
    """Soft-delete a specialization."""
    from app.extensions import db
    from app.models import Category

    spec = Category.query.filter_by(
        tenant_id=current_tenant_id_strict(), id=spec_id,
    ).first()
    if not spec:
        return error_response('Specialization not found', status_code=404)
    spec.is_active = False
    db.session.commit()
    return success_response(spec.to_dict(), message='Specialization deactivated successfully')


@doctor_signup_config_bp.route('/admin/master/specializations/bulk', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def bulk_create_specializations():
    """Bulk import of specializations at a given level."""
    from app.extensions import db
    from app.models import Category

    data = request.get_json() or {}
    level = data.get('qualification_level')
    names = data.get('names') or []
    try:
        _validate_level(level)
    except ValueError as e:
        return error_response(str(e))
    if not isinstance(names, list) or not names:
        return error_response("'names' must be a non-empty list")

    tid = current_tenant_id_strict()
    existing_names = {
        c.name for c in Category.query.filter_by(
            tenant_id=tid, category_type='specialization',
        ).all()
    }
    created = []
    skipped = []
    for raw_name in names:
        name = (raw_name or '').strip()
        if not name:
            continue
        if name in existing_names:
            skipped.append(name)
            continue
        db.session.add(Category(
            tenant_id=tid,
            name=name,
            category_type='specialization',
            qualification_level=level,
        ))
        created.append(name)
        existing_names.add(name)

    db.session.commit()
    return success_response(
        {'created': created, 'skipped': skipped, 'qualification_level': level},
        message=f'Created {len(created)} specializations (skipped {len(skipped)} duplicates)',
        status_code=201,
    )


# ---- Degrees (per-level, via Category — same pattern) ----

@doctor_signup_config_bp.route('/admin/master/degrees', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def list_degrees_by_level():
    """List degrees, optionally filtered by qualification_level."""
    from app.models import Category

    tid = current_tenant_id_strict()
    level = request.args.get('level')
    active_only = request.args.get('active_only', 'true').lower() == 'true'

    query = Category.query.filter_by(tenant_id=tid, category_type='degree')
    if active_only:
        query = query.filter_by(is_active=True)
    if level:
        query = query.filter_by(qualification_level=level)

    rows = query.order_by(Category.name).all()
    return success_response([r.to_dict() for r in rows])


@doctor_signup_config_bp.route('/admin/master/degrees', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def create_degree_with_level():
    """Create a degree (e.g. MBBS / MD / DM) at a qualification level."""
    from app.extensions import db
    from app.models import Category

    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    level = data.get('qualification_level')
    description = data.get('description')
    if not name:
        return error_response("'name' is required")
    try:
        _validate_level(level)
    except ValueError as e:
        return error_response(str(e))

    tid = current_tenant_id_strict()
    existing = Category.query.filter_by(tenant_id=tid, name=name).first()
    if existing:
        if existing.is_active or existing.category_type != 'degree':
            return error_response(
                f"Degree '{name}' already exists for this tenant", status_code=409,
            )
        # Reactivate a previously soft-deleted degree (UNIQUE(tenant, name)
        # blocks a fresh insert).
        existing.is_active = True
        if level is not None:
            existing.qualification_level = level
        if description is not None:
            existing.description = description
        db.session.commit()
        return success_response(
            existing.to_dict(), message='Degree reactivated successfully',
        )

    row = Category(
        tenant_id=tid,
        name=name,
        description=description,
        category_type='degree',
        qualification_level=level,
    )
    db.session.add(row)
    db.session.commit()
    return success_response(
        row.to_dict(), message='Degree created successfully', status_code=201,
    )


@doctor_signup_config_bp.route('/admin/master/degrees/<degree_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_degree_with_level(degree_id):
    """Update a degree."""
    from app.extensions import db
    from app.models import Category

    data = request.get_json() or {}
    row = Category.query.filter_by(
        tenant_id=current_tenant_id_strict(),
        id=degree_id, category_type='degree',
    ).first()
    if not row:
        return error_response('Degree not found', status_code=404)

    if 'name' in data:
        row.name = data['name'].strip()
    if 'description' in data:
        row.description = data['description']
    if 'qualification_level' in data:
        new_level = data['qualification_level']
        if new_level is None:
            row.qualification_level = None
        else:
            try:
                _validate_level(new_level)
            except ValueError as e:
                return error_response(str(e))
            row.qualification_level = new_level
    if 'is_active' in data:
        row.is_active = bool(data['is_active'])

    db.session.commit()
    return success_response(row.to_dict(), message='Degree updated successfully')


@doctor_signup_config_bp.route('/admin/master/degrees/<degree_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def delete_degree_with_level(degree_id):
    """Soft-delete a degree."""
    from app.extensions import db
    from app.models import Category

    row = Category.query.filter_by(
        tenant_id=current_tenant_id_strict(),
        id=degree_id, category_type='degree',
    ).first()
    if not row:
        return error_response('Degree not found', status_code=404)
    row.is_active = False
    db.session.commit()
    return success_response(row.to_dict(), message='Degree deactivated successfully')


@doctor_signup_config_bp.route('/admin/master/degrees/bulk', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def bulk_create_degrees():
    """Bulk import of degrees at a given level."""
    from app.extensions import db
    from app.models import Category

    data = request.get_json() or {}
    level = data.get('qualification_level')
    names = data.get('names') or []
    try:
        _validate_level(level)
    except ValueError as e:
        return error_response(str(e))
    if not isinstance(names, list) or not names:
        return error_response("'names' must be a non-empty list")

    tid = current_tenant_id_strict()
    existing_names = {
        c.name for c in Category.query.filter_by(
            tenant_id=tid, category_type='degree',
        ).all()
    }
    created = []
    skipped = []
    for raw_name in names:
        name = (raw_name or '').strip()
        if not name:
            continue
        if name in existing_names:
            skipped.append(name)
            continue
        db.session.add(Category(
            tenant_id=tid,
            name=name,
            category_type='degree',
            qualification_level=level,
        ))
        created.append(name)
        existing_names.add(name)

    db.session.commit()
    return success_response(
        {'created': created, 'skipped': skipped, 'qualification_level': level},
        message=f'Created {len(created)} degrees (skipped {len(skipped)} duplicates)',
        status_code=201,
    )


# ============== PER-MODULE ENDPOINTS (Round 9, Phase 3) ==============
# See app/common/module_routes.py for the shared route bodies.

from app.api.doctor_signup_config.module_service import (
    for_module as _ds_for_module,
    list_modules as _ds_list_modules,
)
from app.api.doctor_signup_config.data_resolver import resolve_data_source as _ds_resolve_ds
from app.common.module_routes import register_module_routes as _register_module_routes


_register_module_routes(
    blueprint=doctor_signup_config_bp,
    url_prefix='admin/doctor_signup',
    for_module=_ds_for_module,
    list_modules=_ds_list_modules,
    resolve_data_source=_ds_resolve_ds,
)
