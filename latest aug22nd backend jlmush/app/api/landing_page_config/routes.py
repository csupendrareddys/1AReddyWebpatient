"""Landing API routes (v2 — 3-level hierarchy).

Public
  * GET  /api/landing/public?lang=...                 → live tree

Admin (JWT + RBAC via ``landing_config`` / ``landing_module``)
  * GET  /api/landing/admin/summary                   → {draft, preview, live}
  * GET  /api/landing/admin/draft                     → get-or-create draft
  * PUT  /api/landing/admin/draft                     → update hero + translations
  * POST /api/landing/admin/preview                   → promote draft → preview
  * POST /api/landing/admin/publish                   → preview → live (atomic)
  * GET  /api/landing/admin/history                   → list snapshots
  * POST /api/landing/admin/restore/<snapshot_id>     → restore whole tree
  * GET  /api/landing/admin/modules                   → list modules (on draft)
  * POST /api/landing/admin/modules                   → create module
  * GET  /api/landing/admin/modules/<module_id>       → get one module
  * PUT  /api/landing/admin/modules/<module_id>       → update module
  * DELETE /api/landing/admin/modules/<module_id>     → delete module
  * POST /api/landing/admin/modules/reorder           → bulk reorder
  * POST /api/landing/admin/modules/<module_id>/restore/<snapshot_id>
  * GET  /api/landing/admin/care-team/doctors         → doctor picker options
  * GET  /api/landing/admin/modules/<module_id>/features
  * POST /api/landing/admin/modules/<module_id>/features
  * GET  /api/landing/admin/modules/<module_id>/features/<slug>
  * PUT  /api/landing/admin/modules/<module_id>/features/<slug>
  * DELETE /api/landing/admin/modules/<module_id>/features/<slug>
  * POST /api/landing/admin/modules/<module_id>/features/<slug>/restore/<snapshot_id>

Module write endpoints pass ``module_id`` to the RBAC check as ``resource_id``,
so a sub-admin can be scoped to edit one module but not others.
"""
import logging

from flask import request
from flask_jwt_extended import jwt_required, current_user, verify_jwt_in_request
from marshmallow import ValidationError

from app.api.landing_page_config import landing_page_config_bp
from app.api.landing_page_config.service import (
    LandingConfigService, ModuleService, FeatureService, PublicLandingService,
    RecognitionService, VideoService,
    DoctorService, ReviewService, TrustedBrandService,
)
from app.api.landing_page_config.validators import (
    HeroDraftSchema, ModuleCreateSchema, ModuleUpdateSchema,
    FeatureCreateSchema, FeatureUpdateSchema, ReorderSchema,
    RecognitionCreateSchema, RecognitionUpdateSchema,
    VideoCreateSchema, VideoUpdateSchema,
    DoctorCreateSchema, DoctorUpdateSchema,
    ReviewCreateSchema, ReviewUpdateSchema,
    TrustedBrandCreateSchema, TrustedBrandUpdateSchema,
)
from app.common.decorators import role_required, rbac_required, feature_required
from app.common.responses import (
    success_response, created_response, error_response,
    not_found_response, validation_error_response, no_content_response,
)
from app.models import UserRole, PermissionModule, PermissionAction

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _load(schema_cls, partial=False):
    try:
        return schema_cls().load(request.get_json() or {}, partial=partial), None
    except ValidationError as err:
        return None, validation_error_response(err.messages)


def _user_id():
    return getattr(current_user, 'id', None)


def _resolve_public_mode():
    """Return the requested ``?mode=`` and, for admin-only modes (draft /
    preview), ensure a JWT was presented so tenant context is set before the
    service layer reads ``g.tenant_id``. Raises 401 via flask-jwt-extended when
    a draft/preview is requested anonymously — keeps cross-tenant draft data
    from leaking through the public path.
    """
    mode = (request.args.get('mode') or 'live').lower()
    if mode not in ('live', 'draft', 'preview'):
        mode = 'live'
    if mode != 'live':
        verify_jwt_in_request()
    return mode


# --------------------------------------------------------------------------- #
# Public
# --------------------------------------------------------------------------- #

@landing_page_config_bp.route('/public', methods=['GET'])
def public_tree():
    """Return the landing tree, optionally translated and optionally in
    draft/preview mode for authenticated admins."""
    lang = request.args.get('lang', 'en')
    mode = _resolve_public_mode()
    tree = PublicLandingService.get_tree(lang=lang, mode=mode)
    if not tree:
        return success_response(data={'modules': [], 'hero_title': None})
    return success_response(data=tree)


@landing_page_config_bp.route('/public/modules/<slug>', methods=['GET'])
def public_module(slug):
    """Return one public module (with its features) by slug."""
    lang = request.args.get('lang', 'en')
    mode = _resolve_public_mode()
    module = PublicLandingService.get_public_module(slug, lang=lang, mode=mode)
    if not module:
        return not_found_response('Module not found or not visible.')
    return success_response(data=module)


@landing_page_config_bp.route('/public/features/<slug>', methods=['GET'])
def public_feature(slug):
    """Return one public feature by slug (scans live tree)."""
    lang = request.args.get('lang', 'en')
    mode = _resolve_public_mode()
    feature = PublicLandingService.get_public_feature(slug, lang=lang, mode=mode)
    if not feature:
        return not_found_response('Feature not found or not visible.')
    return success_response(data=feature)


# --------------------------------------------------------------------------- #
# Admin: landing root
# --------------------------------------------------------------------------- #

@landing_page_config_bp.route('/admin/upload-asset', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.EDIT)
def admin_upload_landing_asset():
    """Upload an image (logo / hero image / partner logo / etc.) to S3
    and return the public URL.

    Round-1 surface used by the landing editor's logo-upload widget.
    The admin posts ``multipart/form-data`` with an ``image`` file
    field plus optional ``kind`` (defaults to ``logo`` for telemetry
    + S3 folder shape). The endpoint:

      * authorises via the existing landing-builder gating,
      * uploads to the public S3 bucket via :class:`S3Service`,
      * returns ``{ url: 'https://…' }`` for the client to drop into
        ``brand_logo_url`` (or any other URL field).

    No DB writes here — saving the resulting URL onto the LandingConfig
    happens via the normal ``PUT /admin/draft`` flow once the editor
    persists. This keeps the upload step idempotent and lets the user
    pick a different image before saving without leaving orphaned
    DB references behind.

    Body shared with the platform-owner twin
    (``/api/platform-landing/admin/upload-asset``) via
    :func:`app.common.landing_upload.handle_landing_asset_upload` — the
    two routes differ only in auth gating. Passing ``kind=video`` /
    ``kind=image`` from the gallery editors routes the file through the
    matching ``S3Service`` per-type validation.
    """
    from app.common.landing_upload import handle_landing_asset_upload
    return handle_landing_asset_upload()


@landing_page_config_bp.route('/admin/summary', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.VIEW)
def admin_summary():
    s = LandingConfigService.get_summary()
    return success_response(data={
        'draft': s['draft'].to_dict(include_asset_urls=True) if s['draft'] else None,
        'preview': s['preview'].to_dict(include_asset_urls=True) if s['preview'] else None,
        'live': s['live'].to_dict(include_asset_urls=True) if s['live'] else None,
    })


@landing_page_config_bp.route('/admin/draft', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.EDIT)
def admin_get_draft():
    draft = LandingConfigService.get_or_create_draft(user_id=_user_id())
    return success_response(data=draft.to_dict(include_modules=True, include_asset_urls=True))


@landing_page_config_bp.route('/admin/draft', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.EDIT)
def admin_update_draft():
    data, err = _load(HeroDraftSchema, partial=True)
    if err:
        return err
    draft = LandingConfigService.update_draft(data, user_id=_user_id())
    return success_response(data=draft.to_dict(include_asset_urls=True))


@landing_page_config_bp.route('/admin/preview', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.EDIT)
def admin_promote_preview():
    try:
        preview = LandingConfigService.promote_to_preview(user_id=_user_id())
    except ValueError as e:
        return error_response(str(e), status_code=400)
    return success_response(data=preview.to_dict(include_modules=True, include_asset_urls=True))


@landing_page_config_bp.route('/admin/publish', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.EDIT)
def admin_publish():
    note = (request.get_json() or {}).get('note')
    try:
        live, snapshot = LandingConfigService.publish(user_id=_user_id(), note=note)
    except ValueError as e:
        return error_response(str(e), status_code=400)
    return success_response(data={
        'live': live.to_dict(include_modules=True, include_asset_urls=True),
        'snapshot': snapshot.to_dict(),
    })


@landing_page_config_bp.route('/admin/history', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.VIEW)
def admin_history():
    limit = int(request.args.get('limit', 20))
    snaps = LandingConfigService.list_snapshots(limit=limit)
    return success_response(data=[s.to_dict() for s in snaps])


@landing_page_config_bp.route('/admin/snapshots/<snapshot_id>', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.VIEW)
def admin_get_snapshot(snapshot_id):
    snap = LandingConfigService.get_snapshot(snapshot_id)
    if not snap:
        return not_found_response('Snapshot not found.')
    return success_response(data=snap.to_dict(include_tree=True))


@landing_page_config_bp.route('/admin/restore/<snapshot_id>', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.EDIT)
def admin_restore(snapshot_id):
    try:
        draft = LandingConfigService.restore_snapshot(snapshot_id, user_id=_user_id())
    except ValueError as e:
        return error_response(str(e), status_code=400)
    return success_response(data=draft.to_dict(include_modules=True, include_asset_urls=True))


# --------------------------------------------------------------------------- #
# Admin: modules
# --------------------------------------------------------------------------- #

@landing_page_config_bp.route('/admin/modules', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.VIEW)
def admin_list_modules():
    modules = ModuleService.list_modules()
    return success_response(data=[m.to_dict() for m in modules])


@landing_page_config_bp.route('/admin/modules', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.CREATE)
def admin_create_module():
    data, err = _load(ModuleCreateSchema)
    if err:
        return err
    module = ModuleService.create_module(data, user_id=_user_id())
    return created_response(data=module.to_dict())


@landing_page_config_bp.route('/admin/modules/reorder', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.EDIT)
def admin_reorder_modules():
    data, err = _load(ReorderSchema)
    if err:
        return err
    # ReorderSchema returns UUIDs as uuid.UUID objects — stringify for service use.
    items = [{'id': str(it['id']), 'display_order': it['display_order']}
             for it in data['items']]
    ModuleService.reorder_modules(items, user_id=_user_id())
    return no_content_response()


@landing_page_config_bp.route('/admin/modules/<module_id>', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_MODULE, PermissionAction.VIEW, resource_id_kwarg='module_id')
def admin_get_module(module_id):
    module = ModuleService.get_module(module_id)
    if not module:
        return not_found_response('Module not found.')
    return success_response(data=module.to_dict(include_features=True))


@landing_page_config_bp.route('/admin/modules/<module_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_MODULE, PermissionAction.EDIT, resource_id_kwarg='module_id')
def admin_update_module(module_id):
    data, err = _load(ModuleUpdateSchema, partial=True)
    if err:
        return err
    try:
        module = ModuleService.update_module(module_id, data, user_id=_user_id())
    except LookupError as e:
        return not_found_response(str(e))
    return success_response(data=module.to_dict())


@landing_page_config_bp.route('/admin/modules/<module_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_MODULE, PermissionAction.DELETE, resource_id_kwarg='module_id')
def admin_delete_module(module_id):
    try:
        ModuleService.delete_module(module_id, user_id=_user_id())
    except LookupError as e:
        return not_found_response(str(e))
    return no_content_response()


@landing_page_config_bp.route('/admin/modules/<module_id>/restore/<snapshot_id>', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_MODULE, PermissionAction.EDIT, resource_id_kwarg='module_id')
def admin_restore_module(module_id, snapshot_id):
    try:
        module = ModuleService.restore_from_snapshot(module_id, snapshot_id, user_id=_user_id())
    except LookupError as e:
        return not_found_response(str(e))
    except ValueError as e:
        return error_response(str(e), status_code=400)
    return success_response(data=module.to_dict(include_features=True))


# --------------------------------------------------------------------------- #
# Admin: features (nested under modules)
# --------------------------------------------------------------------------- #

@landing_page_config_bp.route('/admin/care-team/doctors', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
def admin_list_care_team_candidates():
    """Doctor picker for a feature page's "Our care team" section."""
    doctors = FeatureService.list_care_team_candidates(
        search=(request.args.get('search') or '').strip() or None,
    )
    return success_response(data=doctors)


@landing_page_config_bp.route('/admin/modules/<module_id>/features', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_MODULE, PermissionAction.VIEW, resource_id_kwarg='module_id')
def admin_list_features(module_id):
    features = FeatureService.list_features(module_id)
    return success_response(data=[f.to_dict() for f in features])


@landing_page_config_bp.route('/admin/modules/<module_id>/features', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_MODULE, PermissionAction.CREATE, resource_id_kwarg='module_id')
def admin_create_feature(module_id):
    data, err = _load(FeatureCreateSchema)
    if err:
        return err
    try:
        feature = FeatureService.create_feature(module_id, data, user_id=_user_id())
    except LookupError as e:
        return not_found_response(str(e))
    return created_response(data=feature.to_dict())


@landing_page_config_bp.route('/admin/modules/<module_id>/features/<slug>', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_MODULE, PermissionAction.VIEW, resource_id_kwarg='module_id')
def admin_get_feature(module_id, slug):
    feature = FeatureService.get_feature(module_id, slug)
    if not feature:
        return not_found_response('Feature not found.')
    return success_response(data=feature.to_dict())


@landing_page_config_bp.route('/admin/modules/<module_id>/features/<slug>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_MODULE, PermissionAction.EDIT, resource_id_kwarg='module_id')
def admin_update_feature(module_id, slug):
    data, err = _load(FeatureUpdateSchema, partial=True)
    if err:
        return err
    try:
        feature = FeatureService.update_feature(module_id, slug, data, user_id=_user_id())
    except LookupError as e:
        return not_found_response(str(e))
    return success_response(data=feature.to_dict())


@landing_page_config_bp.route('/admin/modules/<module_id>/features/<slug>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_MODULE, PermissionAction.DELETE, resource_id_kwarg='module_id')
def admin_delete_feature(module_id, slug):
    try:
        FeatureService.delete_feature(module_id, slug, user_id=_user_id())
    except LookupError as e:
        return not_found_response(str(e))
    return no_content_response()


@landing_page_config_bp.route(
    '/admin/modules/<module_id>/features/<slug>/restore/<snapshot_id>',
    methods=['POST'],
)
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_MODULE, PermissionAction.EDIT, resource_id_kwarg='module_id')
def admin_restore_feature(module_id, slug, snapshot_id):
    try:
        feature = FeatureService.restore_from_snapshot(module_id, slug, snapshot_id, user_id=_user_id())
    except LookupError as e:
        return not_found_response(str(e))
    except ValueError as e:
        return error_response(str(e), status_code=400)
    return success_response(data=feature.to_dict())


# --------------------------------------------------------------------------- #
# Public + Admin: Recognitions (accreditations carousel)
# --------------------------------------------------------------------------- #
#
# Reuses ``LANDING_CONFIG`` permission scope — recognitions are a sibling
# resource of the landing page tree, not a separate top-level module worth
# its own RBAC enum value. Admins who can edit landing-config can edit
# recognitions; viewers can read them.

@landing_page_config_bp.route('/public/recognitions', methods=['GET'])
def public_recognitions():
    """Anonymous list of visible recognitions, ordered."""
    items = RecognitionService.list_all(visible_only=True)
    return success_response(data=[r.to_dict() for r in items])


@landing_page_config_bp.route('/admin/recognitions', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.VIEW)
def admin_list_recognitions():
    items = RecognitionService.list_all(visible_only=False)
    return success_response(data=[r.to_dict() for r in items])


@landing_page_config_bp.route('/admin/recognitions', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.CREATE)
def admin_create_recognition():
    data, err = _load(RecognitionCreateSchema)
    if err:
        return err
    item = RecognitionService.create(data, user_id=_user_id())
    return created_response(data=item.to_dict())


@landing_page_config_bp.route('/admin/recognitions/reorder', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.EDIT)
def admin_reorder_recognitions():
    data, err = _load(ReorderSchema)
    if err:
        return err
    items = [{'id': str(it['id']), 'display_order': it['display_order']}
             for it in data['items']]
    RecognitionService.reorder(items, user_id=_user_id())
    return no_content_response()


@landing_page_config_bp.route('/admin/recognitions/<recognition_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.EDIT)
def admin_update_recognition(recognition_id):
    data, err = _load(RecognitionUpdateSchema, partial=True)
    if err:
        return err
    try:
        item = RecognitionService.update(recognition_id, data, user_id=_user_id())
    except LookupError as e:
        return not_found_response(str(e))
    return success_response(data=item.to_dict())


@landing_page_config_bp.route('/admin/recognitions/<recognition_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.DELETE)
def admin_delete_recognition(recognition_id):
    try:
        RecognitionService.delete(recognition_id, user_id=_user_id())
    except LookupError as e:
        return not_found_response(str(e))
    return no_content_response()


# --------------------------------------------------------------------------- #
# Public + Admin: Videos (homepage strip + dedicated /gallery/videos page)
# --------------------------------------------------------------------------- #

@landing_page_config_bp.route('/public/videos', methods=['GET'])
def public_videos():
    """Anonymous list of visible videos.

    Accepts ``?limit=N`` to cap the response (the landing page asks for 3,
    the gallery page omits the limit to get them all). Always returns
    ``total_count`` so the frontend can decide whether to render the "More"
    CTA without a second round-trip.
    """
    limit_raw = request.args.get('limit')
    try:
        limit = int(limit_raw) if limit_raw is not None else None
        if limit is not None and limit < 0:
            limit = None
    except (TypeError, ValueError):
        limit = None

    total = VideoService.count_visible()
    items = VideoService.list_all(visible_only=True, limit=limit)
    return success_response(data={
        'videos': [v.to_dict() for v in items],
        'total_count': total,
    })


@landing_page_config_bp.route('/admin/videos', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.VIEW)
def admin_list_videos():
    items = VideoService.list_all(visible_only=False)
    return success_response(data=[v.to_dict() for v in items])


@landing_page_config_bp.route('/admin/videos', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.CREATE)
def admin_create_video():
    data, err = _load(VideoCreateSchema)
    if err:
        return err
    item = VideoService.create(data, user_id=_user_id())
    return created_response(data=item.to_dict())


@landing_page_config_bp.route('/admin/videos/reorder', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.EDIT)
def admin_reorder_videos():
    data, err = _load(ReorderSchema)
    if err:
        return err
    items = [{'id': str(it['id']), 'display_order': it['display_order']}
             for it in data['items']]
    VideoService.reorder(items, user_id=_user_id())
    return no_content_response()


@landing_page_config_bp.route('/admin/videos/<video_id>', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.EDIT)
def admin_update_video(video_id):
    data, err = _load(VideoUpdateSchema, partial=True)
    if err:
        return err
    try:
        item = VideoService.update(video_id, data, user_id=_user_id())
    except LookupError as e:
        return not_found_response(str(e))
    return success_response(data=item.to_dict())


@landing_page_config_bp.route('/admin/videos/<video_id>', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@feature_required('admin.landing_builder')
@rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.DELETE)
def admin_delete_video(video_id):
    try:
        VideoService.delete(video_id, user_id=_user_id())
    except LookupError as e:
        return not_found_response(str(e))
    return no_content_response()


# --------------------------------------------------------------------------- #
# Doctors / Reviews / TrustedBrands — same shape as recognitions/videos
# --------------------------------------------------------------------------- #
#
# Each block exposes:
#   GET    /api/landing/public/<resource>            — anonymous list (visible)
#   GET    /api/landing/admin/<resource>             — admin list (all)
#   POST   /api/landing/admin/<resource>             — create
#   POST   /api/landing/admin/<resource>/reorder     — bulk reorder
#   PUT    /api/landing/admin/<resource>/<item_id>   — update
#   DELETE /api/landing/admin/<resource>/<item_id>   — delete
#
# Permissions all reuse ``LANDING_CONFIG`` since these are sub-resources of
# the landing page (same scope as recognitions / videos).


def _register_collection_routes(resource_path, service, create_schema, update_schema, item_kwarg):
    """Register the standard 6 endpoints for a landing-collection resource.

    ``resource_path`` is the URL segment (e.g. ``'doctors'``).
    ``item_kwarg``    is the route variable name (e.g. ``'doctor_id'``).
    """
    bp = landing_page_config_bp

    # Public list -------------------------------------------------------- #
    def _public_list():
        items = service.list_all(visible_only=True)
        return success_response(data=[i.to_dict() for i in items])
    _public_list.__name__ = f'public_list_{resource_path}'
    bp.add_url_rule(
        f'/public/{resource_path}',
        endpoint=_public_list.__name__,
        view_func=_public_list,
        methods=['GET'],
    )

    # Admin list --------------------------------------------------------- #
    @jwt_required()
    @role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
    @rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.VIEW)
    def _admin_list():
        items = service.list_all(visible_only=False)
        return success_response(data=[i.to_dict() for i in items])
    _admin_list.__name__ = f'admin_list_{resource_path}'
    bp.add_url_rule(
        f'/admin/{resource_path}',
        endpoint=_admin_list.__name__,
        view_func=_admin_list,
        methods=['GET'],
    )

    # Admin create ------------------------------------------------------- #
    @jwt_required()
    @role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
    @rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.CREATE)
    def _admin_create():
        data, err = _load(create_schema)
        if err:
            return err
        item = service.create(data, user_id=_user_id())
        return created_response(data=item.to_dict())
    _admin_create.__name__ = f'admin_create_{resource_path}'
    bp.add_url_rule(
        f'/admin/{resource_path}',
        endpoint=_admin_create.__name__,
        view_func=_admin_create,
        methods=['POST'],
    )

    # Admin reorder ------------------------------------------------------ #
    @jwt_required()
    @role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
    @rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.EDIT)
    def _admin_reorder():
        data, err = _load(ReorderSchema)
        if err:
            return err
        items = [{'id': str(it['id']), 'display_order': it['display_order']}
                 for it in data['items']]
        service.reorder(items, user_id=_user_id())
        return no_content_response()
    _admin_reorder.__name__ = f'admin_reorder_{resource_path}'
    bp.add_url_rule(
        f'/admin/{resource_path}/reorder',
        endpoint=_admin_reorder.__name__,
        view_func=_admin_reorder,
        methods=['POST'],
    )

    # Admin update ------------------------------------------------------- #
    @jwt_required()
    @role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
    @rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.EDIT)
    def _admin_update(**kwargs):
        item_id = kwargs[item_kwarg]
        data, err = _load(update_schema, partial=True)
        if err:
            return err
        try:
            item = service.update(item_id, data, user_id=_user_id())
        except LookupError as e:
            return not_found_response(str(e))
        return success_response(data=item.to_dict())
    _admin_update.__name__ = f'admin_update_{resource_path}'
    bp.add_url_rule(
        f'/admin/{resource_path}/<{item_kwarg}>',
        endpoint=_admin_update.__name__,
        view_func=_admin_update,
        methods=['PUT'],
    )

    # Admin delete ------------------------------------------------------- #
    @jwt_required()
    @role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
    @rbac_required(PermissionModule.LANDING_CONFIG, PermissionAction.DELETE)
    def _admin_delete(**kwargs):
        item_id = kwargs[item_kwarg]
        try:
            service.delete(item_id, user_id=_user_id())
        except LookupError as e:
            return not_found_response(str(e))
        return no_content_response()
    _admin_delete.__name__ = f'admin_delete_{resource_path}'
    bp.add_url_rule(
        f'/admin/{resource_path}/<{item_kwarg}>',
        endpoint=_admin_delete.__name__,
        view_func=_admin_delete,
        methods=['DELETE'],
    )


_register_collection_routes(
    'doctors', DoctorService, DoctorCreateSchema, DoctorUpdateSchema, 'doctor_id',
)
_register_collection_routes(
    'reviews', ReviewService, ReviewCreateSchema, ReviewUpdateSchema, 'review_id',
)
_register_collection_routes(
    'trusted-brands', TrustedBrandService,
    TrustedBrandCreateSchema, TrustedBrandUpdateSchema, 'brand_id',
)

