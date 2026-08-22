"""Platform marketing landing routes.

Mirrors the per-tenant landing surface (and the page-config editor)
end-to-end: same ConfigStatus DRAFT → PREVIEW → LIVE → ARCHIVED flow,
same Save Draft / Preview / Publish button semantics, same Version
History tab. The platform-side rows are scope-keyed instead of
tenant-keyed; everything else lines up.

Public read:
    GET  /api/public/platform-landing            — current LIVE config

Admin (PLATFORM_OWNER only):
    GET    /admin/summary?scope=                 — {draft, preview, live}
    GET    /admin/draft?scope=                   — get or create draft
    PUT    /admin/draft?scope=                   — update draft fields
    POST   /admin/draft/preview?scope=           — promote draft → preview
    POST   /admin/publish?scope=                 — publish preview → live
    GET    /admin/history?scope=                 — version rows (any status)
    GET    /admin/snapshots?scope=               — immutable JSON snapshots

    GET    /admin/<config_id>                    — single row by id (history)

    POST   /admin/<config_id>/modules            — create module on DRAFT
    GET    /admin/<config_id>/modules            — list modules of a config
    GET    /admin/modules/<module_id>            — single module
    PUT    /admin/modules/<module_id>            — update (DRAFT only)
    DELETE /admin/modules/<module_id>            — delete (DRAFT only)

    POST   /admin/modules/<module_id>/features   — create feature (DRAFT only)
    GET    /admin/modules/<module_id>/features   — list features
    GET    /admin/modules/<module_id>/features/<slug>
    PUT    /admin/modules/<module_id>/features/<slug>  — update (DRAFT only)
    PUT    /admin/features/<feature_id>          — update (DRAFT only)
    DELETE /admin/features/<feature_id>          — delete (DRAFT only)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from flask import request
from flask_jwt_extended import current_user, jwt_required

from app.api.platform_landing import platform_landing_bp
from app.api.platform_landing.service import (
    PlatformLandingService, vendor_tenant_id,
)
from app.common.care_team import sync_care_team, list_care_team_candidates
from app.common.decorators import role_required
from app.common.responses import (
    created_response, error_response, no_content_response,
    not_found_response, success_response, validation_error_response,
)
from app.extensions import db
from app.models import (
    ConfigStatus, PlatformFeatureDoctor, PlatformLandingConfig,
    PlatformLandingFeature, PlatformLandingModule,
    PlatformLandingRecognition, PlatformLandingScope, PlatformLandingVideo,
    UserRole,
)


def _resolve_scope():
    """Read the ``?scope=`` query param and parse to enum.

    Defaults to ``MARKETING`` so existing callers (and the apex public
    endpoint) keep working without changes. Returns ``(enum, str)`` so
    the caller can short-circuit on bad input.
    """
    raw = (request.args.get('scope') or 'marketing').lower()
    try:
        return PlatformLandingScope(raw), None
    except ValueError:
        return None, raw


def _utcnow():
    return datetime.now(timezone.utc)


def _require_draft(cfg):
    """Refuse a mutation if ``cfg`` isn't the DRAFT.

    The editor only ever mutates DRAFT rows; LIVE / PREVIEW / ARCHIVED
    are read-only by design (live serves traffic; preview is the
    promote-target; archived is history). Returning a 409 makes the
    rare bug-introduced caller fail loudly instead of silently
    corrupting the live tree.
    """
    if not cfg or cfg.status != ConfigStatus.DRAFT:
        return error_response(
            'Modules and features can only be edited on the DRAFT config. '
            'Create or load the DRAFT via GET /admin/draft first.',
            status_code=409,
        )
    return None


def _resolve_draft_for_mutation(cfg):
    """Pick the right config row for a child-table mutation.

    Editor URLs include the ``config_id`` of whatever the editor was
    showing — which is the DRAFT when one exists, and LIVE when the
    editor is showing live content as a placeholder. Translate LIVE
    transparently to its sibling DRAFT (creating it if needed) so the
    user doesn't have to manually click Save Draft on the root config
    before adding their first module. Mutations on PREVIEW / ARCHIVED
    rows still refuse — those are user-visible immutable states.

    Returns ``(draft_cfg, error_response_or_None)``. The draft is the
    config the caller should write under; the error short-circuits
    when the input row is PREVIEW or ARCHIVED.
    """
    if not cfg:
        return None, not_found_response('Platform landing config')
    if cfg.status == ConfigStatus.DRAFT:
        return cfg, None
    if cfg.status == ConfigStatus.LIVE:
        # Get the existing DRAFT for this scope or clone one from LIVE.
        draft = PlatformLandingService.get_or_create_draft(cfg.scope, _user_id())
        return draft, None
    # PREVIEW or ARCHIVED — too far along the lifecycle to mutate.
    return None, error_response(
        f'Cannot edit a {cfg.status.value.lower()} config. '
        'Roll back to draft first.',
        status_code=409,
    )


def _resolve_module_to_draft(module):
    """Return the DRAFT-side clone of ``module`` (creating the DRAFT
    on first call).

    Modules live under a config row, and the editor's list shows LIVE
    modules as a placeholder before any DRAFT exists. A toggle / edit
    on one of those should not refuse — instead we auto-clone LIVE →
    DRAFT (which copies every module + feature with new ids) and route
    the mutation onto the matching DRAFT module identified by ``slug``.

    Returns ``(draft_module, error_or_None)``. The module is the row
    the caller should mutate; the error short-circuits when the source
    module is under a PREVIEW / ARCHIVED config.
    """
    parent = module.config
    if not parent:
        return None, not_found_response('Platform landing config (parent of module)')
    if parent.status == ConfigStatus.DRAFT:
        return module, None
    if parent.status != ConfigStatus.LIVE:
        return None, error_response(
            f'Cannot edit a module under a {parent.status.value.lower()} config. '
            'Open the draft first.',
            status_code=409,
        )
    draft_cfg = PlatformLandingService.get_or_create_draft(parent.scope, _user_id())
    draft_module = (
        PlatformLandingModule.query
        .filter_by(landing_config_id=draft_cfg.id, slug=module.slug)
        .first()
    )
    if not draft_module:
        return None, not_found_response(
            f'DRAFT clone of module "{module.slug}" not found',
        )
    return draft_module, None


def _resolve_feature_to_draft(feature):
    """Same as :func:`_resolve_module_to_draft` for features — keyed
    by parent-module slug + feature slug."""
    module = feature.module
    if not module:
        return None, not_found_response('Parent module')
    parent = module.config
    if not parent:
        return None, not_found_response('Platform landing config (parent of feature)')
    if parent.status == ConfigStatus.DRAFT:
        return feature, None
    if parent.status != ConfigStatus.LIVE:
        return None, error_response(
            f'Cannot edit a feature under a {parent.status.value.lower()} config.',
            status_code=409,
        )
    draft_cfg = PlatformLandingService.get_or_create_draft(parent.scope, _user_id())
    draft_module = (
        PlatformLandingModule.query
        .filter_by(landing_config_id=draft_cfg.id, slug=module.slug)
        .first()
    )
    if not draft_module:
        return None, not_found_response(
            f'DRAFT clone of parent module "{module.slug}" not found',
        )
    draft_feature = (
        PlatformLandingFeature.query
        .filter_by(module_id=draft_module.id, slug=feature.slug)
        .first()
    )
    if not draft_feature:
        return None, not_found_response(
            f'DRAFT clone of feature "{feature.slug}" not found',
        )
    return draft_feature, None


def _resolve_recognition_to_draft(row):
    """Find the DRAFT clone of ``row`` (recognition). Clones preserve
    ``display_order`` + ``title``; we match on the pair which is
    sufficient because the clone happens in one shot per scope."""
    parent = row.config
    if not parent:
        return None, not_found_response('Parent config')
    if parent.status == ConfigStatus.DRAFT:
        return row, None
    if parent.status != ConfigStatus.LIVE:
        return None, error_response(
            f'Cannot edit a recognition under a {parent.status.value.lower()} config.',
            status_code=409,
        )
    draft_cfg = PlatformLandingService.get_or_create_draft(parent.scope, _user_id())
    clone = (
        PlatformLandingRecognition.query
        .filter_by(
            landing_config_id=draft_cfg.id,
            display_order=row.display_order,
            title=row.title,
        )
        .first()
    )
    if not clone:
        return None, not_found_response('DRAFT clone of recognition not found')
    return clone, None


def _resolve_video_to_draft(row):
    """Same as :func:`_resolve_recognition_to_draft` for videos."""
    parent = row.config
    if not parent:
        return None, not_found_response('Parent config')
    if parent.status == ConfigStatus.DRAFT:
        return row, None
    if parent.status != ConfigStatus.LIVE:
        return None, error_response(
            f'Cannot edit a video under a {parent.status.value.lower()} config.',
            status_code=409,
        )
    draft_cfg = PlatformLandingService.get_or_create_draft(parent.scope, _user_id())
    clone = (
        PlatformLandingVideo.query
        .filter_by(
            landing_config_id=draft_cfg.id,
            display_order=row.display_order,
            title=row.title,
        )
        .first()
    )
    if not clone:
        return None, not_found_response('DRAFT clone of video not found')
    return clone, None


# --------------------------------------------------------------------------- #
# Admin: root config — draft / preview / live (mirrors tenant landing)
# --------------------------------------------------------------------------- #

def _user_id():
    return current_user.id if current_user else None


def _resolve_scope_or_400():
    """Common ``?scope=`` parser used by every admin endpoint below.
    Returns either ``(scope, None)`` or ``(None, error_response)`` so
    callers can early-return without nesting validations."""
    scope, raw = _resolve_scope()
    if scope is None:
        return None, error_response(f'Unknown scope "{raw}"', status_code=400)
    return scope, None


@platform_landing_bp.route('/admin/summary', methods=['GET'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_summary():
    """Three current rows ({draft, preview, live}) for ``?scope=``.

    Mirrors the tenant ``GET /api/landing/admin/summary`` shape so the
    shared LandingConfigEditor renders three status chips and gates
    Promote/Publish buttons identically in both modes.
    """
    scope, err = _resolve_scope_or_400()
    if err:
        return err
    summary = PlatformLandingService.get_summary(scope)
    # ``include_collections=True`` so the editor's preview iframe can
    # render DRAFT / PREVIEW recognitions + videos without an extra
    # round-trip (they don't have public endpoints scoped to those
    # statuses; the public ``/api/public/platform-landing/...``
    # endpoints intentionally only serve LIVE for anonymous traffic).
    return success_response({
        'draft': summary['draft'].to_dict(include_modules=True, include_asset_urls=True, include_collections=True) if summary['draft'] else None,
        'preview': summary['preview'].to_dict(include_modules=True, include_asset_urls=True, include_collections=True) if summary['preview'] else None,
        'live': summary['live'].to_dict(include_modules=True, include_asset_urls=True, include_collections=True) if summary['live'] else None,
    })


@platform_landing_bp.route('/admin/draft', methods=['GET'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_get_draft():
    """Get-or-create the DRAFT for ``?scope=``. First call after a
    publish clones LIVE (config + modules + features) into a brand-new
    DRAFT so the editor has something to mutate without touching live.
    """
    scope, err = _resolve_scope_or_400()
    if err:
        return err
    draft = PlatformLandingService.get_or_create_draft(scope, _user_id())
    return success_response(draft.to_dict(include_modules=True, include_asset_urls=True))


@platform_landing_bp.route('/admin/draft', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_update_draft():
    """Patch root fields on the DRAFT for ``?scope=``. Auto-creates the
    draft if it doesn't exist yet (cloning from LIVE)."""
    scope, err = _resolve_scope_or_400()
    if err:
        return err
    data = request.get_json() or {}
    draft = PlatformLandingService.update_draft(scope, data, _user_id())
    return success_response(draft.to_dict(include_modules=True, include_asset_urls=True))


@platform_landing_bp.route('/admin/draft/preview', methods=['POST'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_promote_to_preview():
    """Flip DRAFT → PREVIEW for ``?scope=``. Archives any prior PREVIEW
    for the same scope so there's only ever one preview row at a time."""
    scope, err = _resolve_scope_or_400()
    if err:
        return err
    try:
        preview = PlatformLandingService.promote_to_preview(scope, _user_id())
    except ValueError as exc:
        return error_response(str(exc), status_code=400)
    return success_response(preview.to_dict(include_modules=True, include_asset_urls=True))


@platform_landing_bp.route('/admin/publish', methods=['POST'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_publish_preview():
    """Flip PREVIEW → LIVE for ``?scope=``. Archives prior LIVE and
    snapshots the new LIVE tree for forward-compatible restore."""
    scope, err = _resolve_scope_or_400()
    if err:
        return err
    note = (request.get_json() or {}).get('note')
    try:
        new_live, snapshot = PlatformLandingService.publish(scope, _user_id(), note)
    except ValueError as exc:
        return error_response(str(exc), status_code=400)
    return success_response({
        'config': new_live.to_dict(include_modules=True, include_asset_urls=True),
        'snapshot': snapshot.to_dict(),
    })


@platform_landing_bp.route('/admin/history', methods=['GET'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_history_versions():
    """List every config row for ``?scope=`` (any status) in version-
    desc order. Each row carries its own status enum so the History
    tab can paint DRAFT / PREVIEW / LIVE / ARCHIVED badges directly.

    Each row is enriched with the matching publish ``snapshot_id`` +
    ``note`` (joined on version), so the History tab can display the
    note the platform_owner typed when publishing — and the snapshot
    id is what Restore POSTs to.
    """
    from app.models import PlatformLandingConfigSnapshot

    scope, err = _resolve_scope_or_400()
    if err:
        return err
    rows = PlatformLandingService.list_versions(scope)
    # Pull all snapshots that share a version with one of these rows,
    # keyed by (landing_config_id, version). Single query rather than
    # N+1.
    config_ids = [r.id for r in rows]
    snap_map = {}
    if config_ids:
        snaps = (
            PlatformLandingConfigSnapshot.query
            .filter(PlatformLandingConfigSnapshot.landing_config_id.in_(config_ids))
            .all()
        )
        for s in snaps:
            snap_map[(s.landing_config_id, s.version)] = s
    items = []
    for r in rows:
        item = r.to_dict(include_modules=False)
        snap = snap_map.get((r.id, r.version))
        item['snapshot_id'] = str(snap.id) if snap else None
        item['note'] = snap.note if snap else None
        items.append(item)
    return success_response(items)


@platform_landing_bp.route('/admin/restore/<snapshot_id>', methods=['POST'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_restore_snapshot(snapshot_id):
    """Copy a snapshot's tree into the current DRAFT for ``?scope=``.

    Mirrors the tenant ``restore_snapshot`` endpoint. After restore the
    user sees the snapshot's content in the editor; they then click
    Promote + Publish to make it live (no auto-publish — keeps Restore
    safe to click).
    """
    scope, err = _resolve_scope_or_400()
    if err:
        return err
    try:
        draft = PlatformLandingService.restore_snapshot(scope, snapshot_id, _user_id())
    except ValueError as exc:
        return error_response(str(exc), status_code=404)
    return success_response(draft.to_dict(include_modules=True, include_asset_urls=True))


@platform_landing_bp.route('/admin/snapshots', methods=['GET'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_history_snapshots():
    """Immutable JSON snapshots for ``?scope=``. Separate from
    ``/admin/history`` (which lists raw config rows) so the History tab
    can offer both: row-level rollback and snapshot diff."""
    scope, err = _resolve_scope_or_400()
    if err:
        return err
    rows = PlatformLandingService.list_snapshots(scope)
    return success_response([r.to_dict() for r in rows])


@platform_landing_bp.route('/admin/<config_id>', methods=['GET'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_get_config_by_id(config_id):
    """Single row by id — used by the History tab to inspect ARCHIVED
    versions. Mutations don't go through this endpoint (DRAFT-only via
    /admin/draft and module/feature endpoints below)."""
    cfg = PlatformLandingConfig.query.get(config_id)
    if not cfg:
        return not_found_response('Platform landing config')
    return success_response(cfg.to_dict(include_modules=True, include_asset_urls=True))


# Back-compat shim — the old editor called ``GET /admin?scope=`` and
# expected the LIVE row. Redirect callers to the new draft flow without
# breaking any in-flight clients during the rollover. Marked deprecated
# in comments only; remove after the frontend is fully on /admin/draft.
@platform_landing_bp.route('/admin', methods=['GET'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_get_live_config_legacy():
    scope, err = _resolve_scope_or_400()
    if err:
        return err
    draft = PlatformLandingService.get_or_create_draft(scope, _user_id())
    return success_response(draft.to_dict(include_modules=True, include_asset_urls=True))


# --------------------------------------------------------------------------- #
# Admin: modules
# --------------------------------------------------------------------------- #

@platform_landing_bp.route('/admin/<config_id>/modules', methods=['GET'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_list_modules(config_id):
    rows = (
        PlatformLandingModule.query
        .filter_by(landing_config_id=config_id)
        .order_by(PlatformLandingModule.display_order.asc(),
                  PlatformLandingModule.created_at.asc())
        .all()
    )
    return success_response([m.to_dict(include_features=True) for m in rows])


@platform_landing_bp.route('/admin/<config_id>/modules', methods=['POST'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_create_module(config_id):
    data = request.get_json() or {}
    if not (data.get('slug') and data.get('name')):
        return validation_error_response({'missing': ['slug', 'name']})
    cfg = PlatformLandingConfig.query.get(config_id)
    # Resolve to DRAFT — if the caller pointed at LIVE (which the
    # editor does when no draft has been created yet) we transparently
    # create/load the DRAFT and write the module there. PREVIEW /
    # ARCHIVED still 409 because those are user-visible immutable
    # states with their own modules attached.
    draft, err = _resolve_draft_for_mutation(cfg)
    if err:
        return err
    if PlatformLandingModule.query.filter_by(
        landing_config_id=draft.id, slug=data['slug'],
    ).first():
        return error_response(
            f'Module with slug "{data["slug"]}" already exists',
            status_code=409,
        )
    module = PlatformLandingModule(
        id=uuid.uuid4(),
        landing_config_id=draft.id,
        slug=data['slug'],
        name=data['name'],
        icon_key=data.get('icon_key'),
        description=data.get('description'),
        logo_asset_id=data.get('logo_asset_id'),
        display_order=data.get('display_order', 0),
        is_visible=data.get('is_visible', True),
        is_additional=data.get('is_additional', False),
        faq_json=data.get('faq_json') or [],
        sections_enabled_json=data.get('sections_enabled_json'),
        translations=data.get('translations') or {},
    )
    db.session.add(module)
    draft.updated_at = _utcnow()
    db.session.commit()
    return created_response(module.to_dict(include_features=True))


@platform_landing_bp.route('/admin/modules/<module_id>', methods=['GET'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_get_module(module_id):
    """Single module fetch by id with features inlined.

    The editor's "Modules" list falls back to LIVE modules when no
    DRAFT exists yet, so the URL the user arrives at can carry a
    LIVE module id. Once a DRAFT exists (e.g. after the first Save
    Draft), the matching DRAFT clone is what they're actually
    editing. Returning the LIVE row in that state would make every
    subsequent re-fetch wipe the user's just-saved edits.

    Lenient resolution: if the row is LIVE and a DRAFT exists for the
    scope, return the DRAFT clone (matched by slug). If the row is
    DRAFT or no DRAFT exists, return as-is.
    """
    module = PlatformLandingModule.query.get(module_id)
    if not module:
        return not_found_response('Platform landing module')
    parent = module.config
    if parent and parent.status == ConfigStatus.LIVE:
        draft_cfg = PlatformLandingService.get_draft(parent.scope)
        if draft_cfg:
            draft_module = (
                PlatformLandingModule.query
                .filter_by(landing_config_id=draft_cfg.id, slug=module.slug)
                .first()
            )
            if draft_module:
                return success_response(draft_module.to_dict(include_features=True))
    return success_response(module.to_dict(include_features=True))


@platform_landing_bp.route('/admin/modules/<module_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_update_module(module_id):
    src = PlatformLandingModule.query.get(module_id)
    if not src:
        return not_found_response('Platform landing module')
    # Lenient resolver — if the caller hit a LIVE module's id (because
    # the editor list was falling back to LIVE content before any
    # DRAFT existed), auto-clone LIVE → DRAFT and route the mutation
    # to the DRAFT-side clone. Slug-matched so the user's "toggle
    # visibility" lands on the right module.
    module, err = _resolve_module_to_draft(src)
    if err:
        return err
    data = request.get_json() or {}
    for field in ('slug', 'name', 'icon_key', 'description',
                  'logo_asset_id', 'display_order', 'is_visible', 'is_additional',
                  'show_in_slider',
                  'faq_json', 'sections_enabled_json', 'translations', 'vid_json', 'img_json'):
        if field in data:
            setattr(module, field, data[field])
    module.updated_at = _utcnow()
    module.config.updated_at = _utcnow()
    db.session.commit()
    return success_response(module.to_dict(include_features=True))


@platform_landing_bp.route('/admin/modules/<module_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_delete_module(module_id):
    src = PlatformLandingModule.query.get(module_id)
    if not src:
        return not_found_response('Platform landing module')
    module, err = _resolve_module_to_draft(src)
    if err:
        return err
    parent = module.config
    db.session.delete(module)
    if parent:
        parent.updated_at = _utcnow()
    db.session.commit()
    return no_content_response()


# --------------------------------------------------------------------------- #
# Admin: features
# --------------------------------------------------------------------------- #

@platform_landing_bp.route('/admin/care-team/doctors', methods=['GET'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_list_care_team_candidates():
    """Doctor picker for an apex feature page's "Our care team" section.

    Draws from the SaaS vendor's own tenant, since ``platform_landing_*``
    rows aren't tenant-scoped but doctors are. The vendor owns no product
    data, so this is empty by design — it must never offer a customer's
    clinicians for the vendor's marketing site.
    """
    doctors = list_care_team_candidates(
        vendor_tenant_id(),
        search=(request.args.get('search') or '').strip() or None,
    )
    return success_response(data=doctors)


@platform_landing_bp.route('/admin/modules/<module_id>/features', methods=['GET'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_list_features(module_id):
    # Same LIVE → DRAFT lenient redirect as admin_get_module. The
    # caller arrived with the LIVE module's id when no DRAFT existed
    # yet; once they save anything we want subsequent feature lists to
    # reflect their DRAFT-clone's features, not the LIVE originals.
    target_module_id = module_id
    src_module = PlatformLandingModule.query.get(module_id)
    if src_module:
        src_cfg = src_module.config
        if src_cfg and src_cfg.status == ConfigStatus.LIVE:
            draft_cfg = PlatformLandingService.get_draft(src_cfg.scope)
            if draft_cfg:
                draft_module = (
                    PlatformLandingModule.query
                    .filter_by(landing_config_id=draft_cfg.id, slug=src_module.slug)
                    .first()
                )
                if draft_module:
                    target_module_id = draft_module.id
    rows = (
        PlatformLandingFeature.query
        .filter_by(module_id=target_module_id)
        .order_by(PlatformLandingFeature.display_order.asc(),
                  PlatformLandingFeature.created_at.asc())
        .all()
    )
    return success_response([f.to_dict() for f in rows])


@platform_landing_bp.route('/admin/modules/<module_id>/features', methods=['POST'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_create_feature(module_id):
    data = request.get_json() or {}
    if not (data.get('slug') and data.get('title')):
        return validation_error_response({'missing': ['slug', 'title']})
    src_module = PlatformLandingModule.query.get(module_id)
    if not src_module:
        return not_found_response('Platform landing module')
    # Lenient — if the caller hit a LIVE module's id, resolve to the
    # matching DRAFT clone (creating the DRAFT if needed). Features
    # then attach to the DRAFT module so the apex doesn't pick them up
    # until publish.
    module, err = _resolve_module_to_draft(src_module)
    if err:
        return err
    if PlatformLandingFeature.query.filter_by(
        module_id=module.id, slug=data['slug'],
    ).first():
        return error_response(
            f'Feature with slug "{data["slug"]}" already exists',
            status_code=409,
        )
    feature = PlatformLandingFeature(
        id=uuid.uuid4(),
        # ``module.id``, not the raw URL param: the comment above promises the
        # feature attaches to the DRAFT clone, but passing ``module_id`` wrote
        # it straight onto the LIVE module whenever the caller hit a LIVE id.
        module_id=module.id,
        slug=data['slug'],
        title=data['title'],
        description=data.get('description'),
        category=data.get('category'),
        logo_asset_id=data.get('logo_asset_id'),
        starting_price=data.get('starting_price'),
        timeline=data.get('timeline'),
        rating=data.get('rating'),
        what_is=data.get('what_is'),
        requirements=data.get('requirements') or [],
        documents=data.get('documents') or [],
        benefits=data.get('benefits') or [],
        disadvantages=data.get('disadvantages') or [],
        process=data.get('process') or [],
        who_should_join=data.get('who_should_join') or [],
        whats_included=data.get('whats_included') or [],
        expected_outcomes=data.get('expected_outcomes') or [],
        book_cta_label=data.get('book_cta_label', 'Book Now'),
        sections_enabled_json=data.get('sections_enabled_json'),
        translations=data.get('translations') or {},
        vid_json = data.get('vid_json') or [],
        img_json = data.get('img_json') or [],
        display_order=data.get('display_order', 0),
        is_visible=data.get('is_visible', True),
        is_popular=data.get('is_popular', False),
    )
    db.session.add(feature)
    # Flush so the care-team rows get a real feature_id to hang off.
    db.session.flush()
    try:
        sync_care_team(
            feature, data.get('care_team'), PlatformFeatureDoctor,
            vendor_tenant_id(), store_tenant_id=False,
        )
    except LookupError as e:
        db.session.rollback()
        return not_found_response(str(e))
    module.config.updated_at = _utcnow()
    db.session.commit()
    return created_response(feature.to_dict())


@platform_landing_bp.route('/admin/modules/<module_id>/features/<slug>', methods=['GET'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_get_feature_by_slug(module_id, slug):
    """Single feature fetch by parent module id + slug.

    Same LIVE → DRAFT lenient resolution as :func:`admin_get_module`:
    if the parent module is LIVE and a DRAFT exists for the scope,
    return the DRAFT clone's feature (matched by module slug +
    feature slug). Otherwise the editor would refresh into the LIVE
    feature after every Save Draft and wipe the user's edits.
    """
    row = (
        PlatformLandingFeature.query
        .filter_by(module_id=module_id, slug=slug)
        .first()
    )
    if not row:
        return not_found_response('Platform landing feature')
    parent_module = row.module
    parent_cfg = parent_module.config if parent_module else None
    if parent_cfg and parent_cfg.status == ConfigStatus.LIVE:
        draft_cfg = PlatformLandingService.get_draft(parent_cfg.scope)
        if draft_cfg:
            draft_module = (
                PlatformLandingModule.query
                .filter_by(landing_config_id=draft_cfg.id, slug=parent_module.slug)
                .first()
            )
            if draft_module:
                draft_feature = (
                    PlatformLandingFeature.query
                    .filter_by(module_id=draft_module.id, slug=slug)
                    .first()
                )
                if draft_feature:
                    return success_response(draft_feature.to_dict())
    return success_response(row.to_dict())


@platform_landing_bp.route('/admin/modules/<module_id>/features/<slug>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_update_feature_by_slug(module_id, slug):
    """Update a feature addressed by module_id+slug (mirrors tenant editor)."""
    src = (
        PlatformLandingFeature.query
        .filter_by(module_id=module_id, slug=slug)
        .first()
    )
    if not src:
        return not_found_response('Platform landing feature')
    feature, err = _resolve_feature_to_draft(src)
    if err:
        return err
    data = request.get_json() or {}
    if 'product_id' in data and not data['product_id']:
        data['product_id'] = None  # empty picker → clear the linked product
    for f in ('slug', 'title', 'description', 'category', 'logo_asset_id',
              'starting_price', 'timeline', 'rating', 'what_is',
              'requirements', 'documents', 'benefits', 'disadvantages',
              'process',
              'who_should_join', 'whats_included', 'expected_outcomes',
              'book_cta_label', 'sections_enabled_json',
              'translations', 'display_order', 'is_visible', 'vid_json', 'img_json', 'is_popular',
              'show_in_slider', 'product_id', 'product_links_json'):
        if f in data:
            setattr(feature, f, data[f])
    # ``care_team`` is a relationship, not a column — it can't go through the
    # setattr loop. An absent key means "leave the team alone"; an explicit []
    # clears it.
    if 'care_team' in data:
        try:
            sync_care_team(
                feature, data.get('care_team'), PlatformFeatureDoctor,
                vendor_tenant_id(), store_tenant_id=False,
            )
        except LookupError as e:
            db.session.rollback()
            return not_found_response(str(e))
    feature.updated_at = _utcnow()
    feature.module.config.updated_at = _utcnow()
    db.session.commit()
    return success_response(feature.to_dict())


@platform_landing_bp.route('/admin/features/<feature_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_update_feature(feature_id):
    src = PlatformLandingFeature.query.get(feature_id)
    if not src:
        return not_found_response('Platform landing feature')
    feature, err = _resolve_feature_to_draft(src)
    if err:
        return err
    data = request.get_json() or {}
    if 'product_id' in data and not data['product_id']:
        data['product_id'] = None  # empty picker → clear the linked product
    for f in ('slug', 'title', 'description', 'category', 'logo_asset_id',
              'starting_price', 'timeline', 'rating', 'what_is',
              'requirements', 'documents', 'benefits', 'disadvantages',
              'process',
              'who_should_join', 'whats_included', 'expected_outcomes',
              'book_cta_label', 'sections_enabled_json',
              'translations', 'display_order', 'is_visible', 'is_popular',
              'show_in_slider', 'product_id', 'product_links_json'):
        if f in data:
            setattr(feature, f, data[f])
    # ``care_team`` is a relationship, not a column — it can't go through the
    # setattr loop. An absent key means "leave the team alone"; an explicit []
    # clears it.
    if 'care_team' in data:
        try:
            sync_care_team(
                feature, data.get('care_team'), PlatformFeatureDoctor,
                vendor_tenant_id(), store_tenant_id=False,
            )
        except LookupError as e:
            db.session.rollback()
            return not_found_response(str(e))
    feature.updated_at = _utcnow()
    feature.module.config.updated_at = _utcnow()
    db.session.commit()
    return success_response(feature.to_dict())


@platform_landing_bp.route('/admin/features/<feature_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_delete_feature(feature_id):
    src = PlatformLandingFeature.query.get(feature_id)
    if not src:
        return not_found_response('Platform landing feature')
    feature, err = _resolve_feature_to_draft(src)
    if err:
        return err
    parent_cfg = feature.module.config if feature.module else None
    db.session.delete(feature)
    if parent_cfg:
        parent_cfg.updated_at = _utcnow()
    db.session.commit()
    return no_content_response()


# Per-config publish + history endpoints were retired with the move to
# the draft → preview → live flow: publish lives at ``POST /admin/publish?
# scope=`` and operates on the PREVIEW row for the scope; history lives
# at ``GET /admin/history?scope=`` (raw rows) and ``GET /admin/snapshots?
# scope=`` (immutable JSON). See admin_publish_preview / admin_history_
# versions above.


# --------------------------------------------------------------------------- #
# Admin: recognitions (certificates carousel)
# --------------------------------------------------------------------------- #

@platform_landing_bp.route('/admin/recognitions', methods=['GET'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_list_recognitions():
    scope, err = _resolve_scope_or_400()
    if err:
        return err
    # Editor reads the DRAFT's recognitions if a draft exists, else the
    # LIVE's. Same UX as modules: the editor always shows the user's
    # "working copy" of the carousel.
    target = (
        PlatformLandingService.get_draft(scope)
        or PlatformLandingService.get_live(scope)
    )
    if not target:
        return success_response([])
    rows = sorted(target.recognitions, key=lambda r: (r.display_order or 0, r.created_at))
    return success_response([r.to_dict() for r in rows])


@platform_landing_bp.route('/admin/recognitions', methods=['POST'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_create_recognition():
    scope, err = _resolve_scope_or_400()
    if err:
        return err
    data = request.get_json() or {}
    if not data.get('title'):
        return validation_error_response({'missing': ['title']})
    # Always write to the DRAFT — create one if it doesn't exist yet so
    # the user doesn't have to click Save Draft on the root config
    # before adding their first recognition.
    draft = PlatformLandingService.get_or_create_draft(scope, _user_id())
    row = PlatformLandingRecognition(
        id=uuid.uuid4(),
        landing_config_id=draft.id,
        scope=scope,
        title=data['title'],
        subtitle=data.get('subtitle'),
        description=data.get('description'),
        logo_asset_id=data.get('logo_asset_id'),
        display_order=data.get('display_order', 0),
        is_visible=data.get('is_visible', True),
    )
    db.session.add(row)
    draft.updated_at = _utcnow()
    db.session.commit()
    return created_response(row.to_dict())


@platform_landing_bp.route('/admin/recognitions/<recognition_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_update_recognition(recognition_id):
    src = PlatformLandingRecognition.query.get(recognition_id)
    if not src:
        return not_found_response('Recognition')
    row, err = _resolve_recognition_to_draft(src)
    if err:
        return err
    data = request.get_json() or {}
    for f in ('title', 'subtitle', 'description', 'logo_asset_id',
              'display_order', 'is_visible'):
        if f in data:
            setattr(row, f, data[f])
    row.updated_at = _utcnow()
    row.config.updated_at = _utcnow()
    db.session.commit()
    return success_response(row.to_dict())


@platform_landing_bp.route('/admin/recognitions/<recognition_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_delete_recognition(recognition_id):
    src = PlatformLandingRecognition.query.get(recognition_id)
    if not src:
        return not_found_response('Recognition')
    row, err = _resolve_recognition_to_draft(src)
    if err:
        return err
    parent = row.config
    db.session.delete(row)
    if parent:
        parent.updated_at = _utcnow()
    db.session.commit()
    return no_content_response()


# --------------------------------------------------------------------------- #
# Admin: asset upload (image / video → hosted URL)
# --------------------------------------------------------------------------- #

@platform_landing_bp.route('/admin/upload-asset', methods=['POST'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_upload_platform_landing_asset():
    """Platform-owner twin of ``POST /api/landing/admin/upload-asset``.

    The tenant upload route is gated on SUPER_ADMIN/SUB_ADMIN + landing
    RBAC, so the platform-owner landing editor (module / feature image +
    video galleries) can't reuse it. This exposes the identical upload
    under PLATFORM_OWNER gating; the S3 plumbing lives once in
    :func:`app.common.landing_upload.handle_landing_asset_upload`. Post
    ``multipart/form-data`` with an ``image`` file + optional ``kind``
    (``image`` / ``video`` so the per-type validation applies); returns
    ``{ url, s3_key, content_type, file_size_bytes }``.
    """
    from app.common.landing_upload import handle_landing_asset_upload
    return handle_landing_asset_upload()


# --------------------------------------------------------------------------- #
# Admin: videos (gallery)
# --------------------------------------------------------------------------- #

@platform_landing_bp.route('/admin/videos', methods=['GET'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_list_videos():
    scope, err = _resolve_scope_or_400()
    if err:
        return err
    target = (
        PlatformLandingService.get_draft(scope)
        or PlatformLandingService.get_live(scope)
    )
    if not target:
        return success_response([])
    rows = sorted(target.videos, key=lambda v: (v.display_order or 0, v.created_at))
    return success_response([v.to_dict() for v in rows])


@platform_landing_bp.route('/admin/videos', methods=['POST'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_create_video():
    scope, err = _resolve_scope_or_400()
    if err:
        return err
    data = request.get_json() or {}
    if not data.get('title'):
        return validation_error_response({'missing': ['title']})
    draft = PlatformLandingService.get_or_create_draft(scope, _user_id())
    row = PlatformLandingVideo(
        id=uuid.uuid4(),
        landing_config_id=draft.id,
        scope=scope,
        title=data['title'],
        description=data.get('description'),
        video_url=data.get('video_url'),
        video_asset_id=data.get('video_asset_id'),
        thumbnail_asset_id=data.get('thumbnail_asset_id'),
        category=data.get('category'),
        display_order=data.get('display_order', 0),
        is_visible=data.get('is_visible', True),
    )
    db.session.add(row)
    draft.updated_at = _utcnow()
    db.session.commit()
    return created_response(row.to_dict())


@platform_landing_bp.route('/admin/videos/<video_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_update_video(video_id):
    src = PlatformLandingVideo.query.get(video_id)
    if not src:
        return not_found_response('Video')
    row, err = _resolve_video_to_draft(src)
    if err:
        return err
    data = request.get_json() or {}
    for f in ('title', 'description', 'video_url', 'video_asset_id',
              'thumbnail_asset_id', 'category', 'display_order',
              'is_visible'):
        if f in data:
            setattr(row, f, data[f])
    row.updated_at = _utcnow()
    row.config.updated_at = _utcnow()
    db.session.commit()
    return success_response(row.to_dict())


@platform_landing_bp.route('/admin/videos/<video_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.PLATFORM_OWNER)
def admin_delete_video(video_id):
    src = PlatformLandingVideo.query.get(video_id)
    if not src:
        return not_found_response('Video')
    row, err = _resolve_video_to_draft(src)
    if err:
        return err
    parent = row.config
    db.session.delete(row)
    if parent:
        parent.updated_at = _utcnow()
    db.session.commit()
    return no_content_response()
