"""Platform landing service — draft / preview / live lifecycle.

Mirrors :class:`app.api.landing_page_config.service.LandingConfigService`
on every detail that matters; the only structural difference is that
platform configs are keyed by ``scope`` (MARKETING vs DEFAULT_TEMPLATE)
instead of by ``tenant_id``. The point of this file is to align the
platform-marketing surface with the canonical Page Config / Tenant
Landing pattern so the editor exposes the same Save Draft / Preview /
Publish flow everywhere this concept exists.

State machine — same enum (``ConfigStatus``) as the other two:

    DRAFT --(promote)--> PREVIEW --(publish)--> LIVE
                                   \\               \\
                                    \\----- archive prior PREVIEW
                                                    \\---- archive prior LIVE

Only one row at a time per ``scope`` for each of DRAFT / PREVIEW / LIVE.
ARCHIVED rows accumulate as history and surface in the Version History
tab. Snapshots are still written on publish (immutable JSON copy of the
tree) so a future restore-from-snapshot path stays available.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.extensions import db
from app.models import (
    ConfigStatus, PlatformFeatureDoctor, PlatformLandingConfig,
    PlatformLandingConfigSnapshot,
    PlatformLandingFeature, PlatformLandingModule,
    PlatformLandingRecognition, PlatformLandingScope, PlatformLandingVideo,
    Tenant,
)
from app.common.care_team import sync_care_team, clone_care_team


def _utcnow():
    return datetime.now(timezone.utc)


def vendor_tenant_id():
    """Tenant whose doctors the vendor's marketing site may feature.

    ``platform_landing_*`` rows are not tenant-scoped, but doctors are, so
    the picker and the write-path validation both need a pool to scope
    candidates to.

    That pool is the SaaS vendor's own tenant (``is_platform``). It used to
    be selected by ``is_default``, which named the same row back when the
    vendor was the apex tenant. The two came apart in the vendor/customer
    split: ``is_default`` now means only "where an unresolved anonymous
    request lands", carries no privileges, and is explicitly allowed to
    point at an ordinary customer. Selecting the pool that way would put
    that customer's clinicians on the vendor's marketing site -- precisely
    what :class:`PlatformFeatureDoctor` says must never happen.

    The vendor owns no product data, so this pool is legitimately empty:
    the picker offers nothing rather than offering someone else's doctors.
    """
    tenant = Tenant.query.filter_by(
        is_platform=True, is_deleted=False,
    ).first()
    if not tenant:
        raise ValueError('No vendor (is_platform) tenant configured.')
    return tenant.id


# --------------------------------------------------------------------------- #
# Internal helpers
# --------------------------------------------------------------------------- #

# Root-config columns that get copied on draft-clone and on snapshot
# restore. Kept in one place so adding a new field is a single edit
# (add it to the model + add it here).
_ROOT_COLS = (
    'hero_title', 'hero_subtitle', 'hero_cta_label', 'hero_cta_href',
    'hero_image_asset_id', 'theme_preset', 'primary_color',
    'secondary_color', 'accent_color', 'background_color',
    'hero_style', 'nav_hierarchy', 'marketing_tagline', 'footer_text',
    # Brand + contact + trust-badge + CTA-band fields surfaced in
    # PublicLandingLayout. See ``x4s5t6u7v8w9`` migration.
    'brand_name', 'support_email', 'trust_badge_text',
    'cta_band_title', 'cta_band_subtitle',
    'cta_band_label', 'cta_band_href',
    # Logo + sub-tagline + section headings + repeating JSON arrays.
    # See ``y5t6u7v8w9x0`` migration.
    'brand_logo_url', 'brand_sub_tagline',
    'hero_body_text', 'hero_search_placeholder',
    'why_section_title', 'why_section_subtitle',
    'testimonials_section_title', 'testimonials_section_subtitle',
    'stats', 'testimonials', 'hero_partners',
    # Section copy for the remaining hardcoded blocks — see
    # ``z6u7v8w9x0y1`` migration.
    'services_section_title', 'services_section_subtitle',
    'categories_section_title', 'categories_section_subtitle',
    'ready_cta_title', 'ready_cta_subtitle',
    'ready_cta_label', 'ready_cta_href',
    'faq_section_title', 'faq_section_subtitle',
    'why_features', 'faqs',
    'section_visibility',
)


def _next_version(scope: PlatformLandingScope) -> int:
    """One global version sequence per scope so DRAFT / PREVIEW / LIVE /
    ARCHIVED rows of the same scope can be ordered linearly in the
    History tab."""
    last = (
        PlatformLandingConfig.query
        .filter_by(scope=scope)
        .order_by(PlatformLandingConfig.version.desc())
        .first()
    )
    return (last.version + 1) if (last and last.version) else 1


def _clone_feature(source):
    clone = PlatformLandingFeature(
        id=uuid.uuid4(),
        slug=source.slug,
        title=source.title,
        description=source.description,
        category=source.category,
        logo_asset_id=source.logo_asset_id,
        starting_price=source.starting_price,
        timeline=source.timeline,
        rating=source.rating,
        what_is=source.what_is,
        requirements=list(source.requirements or []),
        documents=list(source.documents or []),
        benefits=list(source.benefits or []),
        disadvantages=list(source.disadvantages or []),
        process=list(source.process or []),
        who_should_join=list(source.who_should_join or []),
        whats_included=list(source.whats_included or []),
        expected_outcomes=list(source.expected_outcomes or []),
        book_cta_label=source.book_cta_label,
        sections_enabled_json=dict(source.sections_enabled_json or {}),
        translations=dict(source.translations or {}),
        vid_json=dict(source.vid_json or {}),
        img_json=dict(source.img_json or {}),
        display_order=source.display_order,
        is_visible=source.is_visible,
        product_id=source.product_id,
    )
    clone_care_team(
        source, clone, PlatformFeatureDoctor, store_tenant_id=False,
    )
    return clone


def _clone_module(source, new_config_id):
    new_module = PlatformLandingModule(
        id=uuid.uuid4(),
        landing_config_id=new_config_id,
        slug=source.slug,
        name=source.name,
        icon_key=source.icon_key,
        description=source.description,
        logo_asset_id=source.logo_asset_id,
        display_order=source.display_order,
        is_visible=source.is_visible,
        faq_json=list(source.faq_json or []),
        sections_enabled_json=dict(source.sections_enabled_json or {}),
        translations=dict(source.translations or {}),
        vid_json=dict(source.vid_json or {}),
        img_json=dict(source.img_json or {}),
    )
    for feat in source.features:
        new_module.features.append(_clone_feature(feat))
    return new_module


def _clone_recognition(source, new_config_id):
    """Clone a PlatformLandingRecognition into a different config row.

    Keeps scope so the row still matches its parent's scope after
    promote/publish (config.scope and recognition.scope stay aligned by
    construction). Asset FKs are reused directly — the same uploaded
    image powers every snapshot of the carousel.
    """
    return PlatformLandingRecognition(
        id=uuid.uuid4(),
        landing_config_id=new_config_id,
        scope=source.scope,
        title=source.title,
        subtitle=source.subtitle,
        description=source.description,
        logo_asset_id=source.logo_asset_id,
        display_order=source.display_order,
        is_visible=source.is_visible,
    )


def _clone_video(source, new_config_id):
    """Clone a PlatformLandingVideo into a different config row."""
    return PlatformLandingVideo(
        id=uuid.uuid4(),
        landing_config_id=new_config_id,
        scope=source.scope,
        title=source.title,
        description=source.description,
        video_url=source.video_url,
        video_asset_id=source.video_asset_id,
        thumbnail_asset_id=source.thumbnail_asset_id,
        category=source.category,
        display_order=source.display_order,
        is_visible=source.is_visible,
    )


# --------------------------------------------------------------------------- #
# Service
# --------------------------------------------------------------------------- #

class PlatformLandingService:
    """Static methods only — same shape as ``LandingConfigService`` so
    the routes layer can call them without instantiating anything."""

    @staticmethod
    def _get_by_status(scope: PlatformLandingScope, status: ConfigStatus):
        return (
            PlatformLandingConfig.query
            .filter_by(scope=scope, status=status)
            .first()
        )

    # -- summary / readers ---------------------------------------------- #

    @staticmethod
    def get_summary(scope: PlatformLandingScope):
        """Mirrors ``LandingConfigService.get_summary`` — returns one
        dict with the three current rows so the editor can render the
        three status chips and gate the Promote/Publish buttons."""
        return {
            'draft': PlatformLandingService._get_by_status(scope, ConfigStatus.DRAFT),
            'preview': PlatformLandingService._get_by_status(scope, ConfigStatus.PREVIEW),
            'live': PlatformLandingService._get_by_status(scope, ConfigStatus.LIVE),
        }

    @staticmethod
    def get_live(scope: PlatformLandingScope):
        return PlatformLandingService._get_by_status(scope, ConfigStatus.LIVE)

    @staticmethod
    def get_draft(scope: PlatformLandingScope):
        return PlatformLandingService._get_by_status(scope, ConfigStatus.DRAFT)

    # -- draft creation -------------------------------------------------- #

    @staticmethod
    def get_or_create_draft(scope: PlatformLandingScope, user_id=None):
        """Return the current DRAFT for ``scope``, cloning from LIVE (or
        from a small set of defaults if no LIVE exists) when no DRAFT
        is in flight yet. First call after a publish always lands here."""
        existing = PlatformLandingService.get_draft(scope)
        if existing:
            return existing

        live = PlatformLandingService.get_live(scope)
        draft = PlatformLandingConfig(
            id=uuid.uuid4(),
            scope=scope,
            status=ConfigStatus.DRAFT,
            version=_next_version(scope),
            created_by_id=user_id,
        )

        if live:
            for col in _ROOT_COLS:
                setattr(draft, col, getattr(live, col))
            draft.meta = dict(live.meta or {})
            draft.translations = dict(live.translations or {})
            draft.published_languages = list(live.published_languages or ['en'])
            db.session.add(draft)
            db.session.flush()
            for mod in live.modules:
                db.session.add(_clone_module(mod, draft.id))
            # Recognitions + videos belong to the config row now, so
            # they get cloned alongside modules. Each child has its own
            # display_order so the cloned set preserves the carousel
            # order the user already arranged on LIVE.
            for r in live.recognitions:
                db.session.add(_clone_recognition(r, draft.id))
            for v in live.videos:
                db.session.add(_clone_video(v, draft.id))
        else:
            # No LIVE yet — first-ever access in this scope. Seed minimal
            # defaults so the editor doesn't render with empty fields.
            draft.hero_title = (
                'Welcome to your clinic'
                if scope == PlatformLandingScope.DEFAULT_TEMPLATE
                else 'Healthcare for the modern clinic'
            )
            draft.hero_subtitle = (
                'Book appointments, manage records, and connect with your providers.'
                if scope == PlatformLandingScope.DEFAULT_TEMPLATE
                else 'All-in-one workspace for clinics, providers and patients.'
            )
            draft.marketing_tagline = 'Built for clinics. Loved by patients.'
            draft.theme_preset = 'ocean'
            draft.translations = {}
            draft.published_languages = ['en']
            db.session.add(draft)
            db.session.flush()

        db.session.commit()
        return draft

    # -- draft mutation -------------------------------------------------- #

    @staticmethod
    def update_draft(scope: PlatformLandingScope, data: dict, user_id=None):
        draft = PlatformLandingService.get_or_create_draft(scope, user_id)
        for col in _ROOT_COLS + ('meta', 'translations', 'published_languages'):
            if col in data:
                setattr(draft, col, data[col])
        draft.updated_at = _utcnow()
        db.session.commit()
        return draft

    # -- promote / publish ---------------------------------------------- #

    @staticmethod
    def promote_to_preview(scope: PlatformLandingScope, user_id=None):
        """DRAFT → PREVIEW. Any existing PREVIEW for this scope gets
        flipped to ARCHIVED so there's only ever one PREVIEW per scope.
        """
        draft = PlatformLandingService.get_draft(scope)
        if not draft:
            raise ValueError('No draft to promote.')

        prior_preview = PlatformLandingService._get_by_status(scope, ConfigStatus.PREVIEW)
        if prior_preview:
            prior_preview.status = ConfigStatus.ARCHIVED

        draft.status = ConfigStatus.PREVIEW
        db.session.commit()
        return draft

    @staticmethod
    def publish(scope: PlatformLandingScope, user_id=None, note=None):
        """PREVIEW → LIVE. Any existing LIVE for this scope gets flipped
        to ARCHIVED. Also writes an immutable JSON snapshot of the full
        published tree for forward-compatible restore."""
        preview = PlatformLandingService._get_by_status(scope, ConfigStatus.PREVIEW)
        if not preview:
            raise ValueError('No preview to publish.')

        prior_live = PlatformLandingService.get_live(scope)
        # Snapshot the outgoing live tree BEFORE flipping status so we can
        # diff its gallery assets against the new live tree below.
        prior_tree = (
            prior_live.to_dict(include_modules=True, include_asset_urls=False)
            if prior_live else None
        )
        if prior_live:
            prior_live.status = ConfigStatus.ARCHIVED

        preview.status = ConfigStatus.LIVE
        now = _utcnow()
        preview.published_at = now
        # Keep updated_at aligned with published_at right after publish so
        # any pending-publish UI gate (updated_at > published_at) reads as
        # "nothing pending" immediately, instead of staying truthy due to
        # ``onupdate=utcnow`` ticking a few microseconds later.
        preview.updated_at = now

        tree = preview.to_dict(include_modules=True, include_asset_urls=False)

        # Orphan reconciliation — hard-delete gallery S3 objects dropped
        # between the outgoing and new live tree. Mirrors the tenant publish;
        # reuses the same surface-agnostic key collector. Non-fatal.
        try:
            from app.api.landing_page_config.service import _collect_gallery_s3_keys
            orphaned = (
                _collect_gallery_s3_keys(prior_tree)
                - _collect_gallery_s3_keys(tree)
            )
            if orphaned:
                from flask import current_app
                from app.services.s3_service import S3Service
                bucket = current_app.config.get('AWS_S3_PUBLIC_BUCKET')
                for key in orphaned:
                    S3Service.delete_file(bucket, key)
                current_app.logger.info(
                    '[PLATFORM_LANDING_PUBLISH] deleted %d orphaned gallery asset(s)',
                    len(orphaned),
                )
        except Exception as exc:  # noqa: BLE001 — cleanup must not fail publish
            from flask import current_app
            current_app.logger.warning(
                '[PLATFORM_LANDING_PUBLISH] gallery orphan reconciliation '
                'failed (non-fatal): %s', exc,
            )

        # Also capture the carousel collections so a future restore can
        # rebuild them. Older snapshots don't have these keys; the
        # restore path treats them as optional.
        tree['recognitions'] = [r.to_dict() for r in sorted(
            preview.recognitions, key=lambda x: (x.display_order or 0, x.created_at),
        )]
        tree['videos'] = [v.to_dict() for v in sorted(
            preview.videos, key=lambda x: (x.display_order or 0, x.created_at),
        )]
        snapshot = PlatformLandingConfigSnapshot(
            id=uuid.uuid4(),
            landing_config_id=preview.id,
            version=preview.version,
            tree_json=tree,
            created_by_id=user_id,
            note=note,
        )
        db.session.add(snapshot)
        db.session.commit()
        return preview, snapshot

    # -- history --------------------------------------------------------- #

    @staticmethod
    def list_snapshots(scope: PlatformLandingScope, limit=20):
        """Snapshots are written per-config; filter to the configs that
        belong to the requested scope."""
        config_ids = [
            c.id for c in PlatformLandingConfig.query.filter_by(scope=scope).all()
        ]
        if not config_ids:
            return []
        return (
            PlatformLandingConfigSnapshot.query
            .filter(PlatformLandingConfigSnapshot.landing_config_id.in_(config_ids))
            .order_by(PlatformLandingConfigSnapshot.version.desc())
            .limit(limit)
            .all()
        )

    @staticmethod
    def list_versions(scope: PlatformLandingScope, limit=40):
        """Raw config rows (any status) in version-desc order. Powers
        the editor's Version History tab where each row gets a
        DRAFT / PREVIEW / LIVE / ARCHIVED badge."""
        return (
            PlatformLandingConfig.query
            .filter_by(scope=scope)
            .order_by(PlatformLandingConfig.version.desc())
            .limit(limit)
            .all()
        )

    # -- restore from snapshot ----------------------------------------- #

    @staticmethod
    def get_snapshot(snapshot_id):
        return PlatformLandingConfigSnapshot.query.get(snapshot_id)

    @staticmethod
    def restore_snapshot(scope: PlatformLandingScope, snapshot_id, user_id=None):
        """Copy a snapshot's tree into the current DRAFT (creating one
        if needed). Mirrors tenant ``LandingConfigService.restore_snapshot``:
        wipes the draft's modules + features + recognitions + videos
        and rebuilds them from ``snapshot.tree_json``. Root config
        fields (hero/theme/etc.) get overwritten too.
        """
        snap = PlatformLandingService.get_snapshot(snapshot_id)
        if not snap:
            raise ValueError('Snapshot not found.')
        draft = PlatformLandingService.get_or_create_draft(scope, user_id)
        tree = snap.tree_json or {}

        # Root fields
        for col in _ROOT_COLS:
            if col in tree:
                setattr(draft, col, tree[col])
        if 'meta' in tree:
            draft.meta = dict(tree.get('meta') or {})
        if 'translations' in tree:
            draft.translations = dict(tree.get('translations') or {})
        if 'published_languages' in tree:
            draft.published_languages = list(tree.get('published_languages') or ['en'])

        # Modules + features — wipe and rebuild from the frozen tree so
        # the draft mirrors the snapshot exactly. Children are CASCADE
        # so deleting modules also clears their features.
        for old in list(draft.modules):
            db.session.delete(old)
        for old in list(draft.recognitions):
            db.session.delete(old)
        for old in list(draft.videos):
            db.session.delete(old)
        db.session.flush()
        for m in tree.get('modules', []) or []:
            new_mod = PlatformLandingModule(
                id=uuid.uuid4(),
                landing_config_id=draft.id,
                slug=m.get('slug'),
                name=m.get('name') or m.get('slug'),
                icon_key=m.get('icon_key'),
                description=m.get('description'),
                logo_asset_id=m.get('logo_asset_id'),
                display_order=m.get('display_order', 0),
                is_visible=m.get('is_visible', True),
                faq_json=list(m.get('faq_json') or []),
                sections_enabled_json=dict(m.get('sections_enabled_json') or {}),
                translations=dict(m.get('translations') or {}),
            )
            db.session.add(new_mod)
            db.session.flush()
            for f in m.get('features', []) or []:
                new_feat = PlatformLandingFeature(
                    id=uuid.uuid4(),
                    module_id=new_mod.id,
                    slug=f.get('slug'),
                    title=f.get('title') or f.get('slug'),
                    description=f.get('description'),
                    category=f.get('category'),
                    logo_asset_id=f.get('logo_asset_id'),
                    starting_price=f.get('starting_price'),
                    timeline=f.get('timeline'),
                    rating=f.get('rating'),
                    what_is=f.get('what_is'),
                    requirements=list(f.get('requirements') or []),
                    documents=list(f.get('documents') or []),
                    benefits=list(f.get('benefits') or []),
                    disadvantages=list(f.get('disadvantages') or []),
                    process=list(f.get('process') or []),
                    who_should_join=list(f.get('who_should_join') or []),
                    whats_included=list(f.get('whats_included') or []),
                    expected_outcomes=list(f.get('expected_outcomes') or []),
                    book_cta_label=f.get('book_cta_label', 'Book Now'),
                    sections_enabled_json=dict(f.get('sections_enabled_json') or {}),
                    translations=dict(f.get('translations') or {}),
                    display_order=f.get('display_order', 0),
                    is_visible=f.get('is_visible', True),
                    product_id=f.get('product_id'),
                )
                db.session.add(new_feat)
                if f.get('care_team'):
                    # Snapshot entries carry the raw toggles plus a resolved
                    # ``doctor`` block; only the former is restorable — doctor
                    # data is always read live. Non-strict so a doctor deleted
                    # since the snapshot doesn't fail the restore.
                    sync_care_team(
                        new_feat, f.get('care_team'), PlatformFeatureDoctor,
                        vendor_tenant_id(), store_tenant_id=False, strict=False,
                    )
        # Recognitions / videos may or may not be in the snapshot
        # depending on when it was written — older snapshots only
        # captured modules. Restore what's there; missing collections
        # leave the draft's cloned-from-live state intact for that
        # collection.
        for r in tree.get('recognitions', []) or []:
            db.session.add(PlatformLandingRecognition(
                id=uuid.uuid4(),
                landing_config_id=draft.id,
                scope=scope,
                title=r.get('title'),
                subtitle=r.get('subtitle'),
                description=r.get('description'),
                logo_asset_id=r.get('logo_asset_id'),
                display_order=r.get('display_order', 0),
                is_visible=r.get('is_visible', True),
            ))
        for v in tree.get('videos', []) or []:
            db.session.add(PlatformLandingVideo(
                id=uuid.uuid4(),
                landing_config_id=draft.id,
                scope=scope,
                title=v.get('title'),
                description=v.get('description'),
                video_url=v.get('video_url'),
                video_asset_id=v.get('video_asset_id'),
                thumbnail_asset_id=v.get('thumbnail_asset_id'),
                category=v.get('category'),
                display_order=v.get('display_order', 0),
                is_visible=v.get('is_visible', True),
            ))
        draft.updated_at = _utcnow()
        db.session.commit()
        return draft
