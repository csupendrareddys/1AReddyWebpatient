"""Landing configuration services (v2 — 3-level hierarchy).

Implements the draft → preview → live lifecycle at the root
(:class:`LandingConfig`), with in-place CRUD on child modules and features
on the DRAFT subtree. Publish is atomic: snapshots the whole tree into
:class:`LandingConfigSnapshot` then flips PREVIEW → LIVE.

All queries rely on ``g.tenant_id`` via :func:`_current_tenant_id` so the
existing Postgres RLS policies keep data isolated; the code also filters
explicitly so it's correct when RLS is disabled in dev.
"""
import logging
from datetime import datetime, timezone

from flask import g

from app.extensions import db
from app.models import (
    LandingConfig, LandingModule, LandingFeature, FeatureDoctor,
    LandingConfigSnapshot,
    LandingRecognition, LandingVideo,
    LandingDoctor, LandingReview, LandingTrustedBrand,
    ConfigStatus, AuditAction, ConfigAuditLog, Tenant, Doctor,
)
from app.common.i18n import apply_translations
from app.common.care_team import (
    sync_care_team, clone_care_team, list_care_team_candidates,
)
from app.api.landing_page_config.default_fields import (
    get_default_hero, get_default_modules,
)

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Tenant context + audit helpers
# --------------------------------------------------------------------------- #

def _current_tenant_id():
    """Resolve tenant for this request; fall back to the default tenant for
    unauthenticated public endpoints."""
    tid = getattr(g, 'tenant_id', None)
    if tid:
        return tid
    default_tenant = Tenant.query.filter_by(is_default=True).first()
    if not default_tenant:
        raise ValueError('No tenant context and no default tenant configured.')
    return default_tenant.id


def _audit(config_id, action, user_id, new_values=None, previous_values=None):
    try:
        log = ConfigAuditLog(
            tenant_id=_current_tenant_id(),
            config_id=config_id,
            page_type='landing',
            action=action,
            user_id=user_id,
            new_values=new_values or {},
            previous_values=previous_values or {},
        )
        db.session.add(log)
    except Exception as exc:  # pragma: no cover — audit is best-effort
        logger.warning(f'[LANDING] audit log failed: {exc}')


# --------------------------------------------------------------------------- #
# Root lifecycle
# --------------------------------------------------------------------------- #

class LandingConfigService:
    """Hero + theme + landing-level lifecycle."""

    # -- helpers ------------------------------------------------------------ #

    @staticmethod
    def _get_by_status(status):
        return LandingConfig.query.filter_by(
            tenant_id=_current_tenant_id(), status=status,
        ).first()

    @staticmethod
    def _next_version():
        """Next version = max(version) + 1 across all statuses for this tenant.
        Matches :class:`PageConfigService` ordering so history reads sort cleanly.
        """
        max_row = LandingConfig.query.filter_by(
            tenant_id=_current_tenant_id(),
        ).order_by(LandingConfig.version.desc()).first()
        return (max_row.version + 1) if max_row else 1

    # -- queries ------------------------------------------------------------ #

    @staticmethod
    def get_summary():
        return {
            'draft': LandingConfigService._get_by_status(ConfigStatus.DRAFT),
            'preview': LandingConfigService._get_by_status(ConfigStatus.PREVIEW),
            'live': LandingConfigService._get_by_status(ConfigStatus.LIVE),
        }

    @staticmethod
    def get_live():
        return LandingConfigService._get_by_status(ConfigStatus.LIVE)

    @staticmethod
    def get_draft():
        return LandingConfigService._get_by_status(ConfigStatus.DRAFT)

    # -- draft creation ----------------------------------------------------- #

    @staticmethod
    def get_or_create_draft(user_id=None):
        """Return the current DRAFT, cloning from LIVE (or from seed defaults
        when this tenant has never published) if a DRAFT doesn't exist yet.
        """
        existing = LandingConfigService._get_by_status(ConfigStatus.DRAFT)
        if existing:
            return existing

        live = LandingConfigService._get_by_status(ConfigStatus.LIVE)
        draft = LandingConfig(
            tenant_id=_current_tenant_id(),
            status=ConfigStatus.DRAFT,
            version=LandingConfigService._next_version(),
            created_by_id=user_id,
        )

        if live:
            # Clone hero + theme + ALL editable scalar columns.
            # This list MUST stay in sync with update_draft() — any
            # column that update_draft can write must also be cloned
            # here, otherwise publishing and then editing again will
            # silently lose the un-cloned fields (they'd revert to
            # the model-level default on the newly created DRAFT).
            for col in (
                'hero_title', 'hero_subtitle', 'hero_cta_label', 'hero_cta_href',
                'hero_image_asset_id', 'theme_preset', 'primary_color',
                'secondary_color', 'accent_color', 'background_color',
                'hero_style', 'nav_hierarchy', 'marketing_tagline', 'footer_text',
                'brand_name', 'brand_logo_url', 'brand_sub_tagline',
                'support_email', 'trust_badge_text',
                'hero_body_text', 'hero_search_placeholder',
                'cta_band_title', 'cta_band_subtitle',
                'cta_band_label', 'cta_band_href',
                'why_section_title', 'why_section_subtitle',
                'testimonials_section_title', 'testimonials_section_subtitle',
                'services_section_title', 'services_section_subtitle',
                'categories_section_title', 'categories_section_subtitle',
                'ready_cta_title', 'ready_cta_subtitle',
                'ready_cta_label', 'ready_cta_href',
                'faq_section_title', 'faq_section_subtitle',
                'doctors_section_title', 'reviews_section_title',
                'brands_section_title',
            ):
                setattr(draft, col, getattr(live, col))
            # Deep-copy mutable structures so edits don't mutate LIVE.
            draft.stats = list(live.stats or [])
            draft.testimonials = list(live.testimonials or [])
            draft.hero_partners = list(live.hero_partners or [])
            draft.why_features = list(live.why_features or [])
            draft.faqs = list(live.faqs or [])
            draft.section_visibility = dict(live.section_visibility or {})
            draft.meta = dict(live.meta or {})
            draft.translations = dict(live.translations or {})
            draft.published_languages = list(live.published_languages or ['en'])
            db.session.add(draft)
            db.session.flush()
            # Clone modules + features
            for mod in live.modules:
                cloned_mod = _clone_module(mod, draft.id)
                db.session.add(cloned_mod)
        else:
            # Seed from defaults on first-ever access
            hero = get_default_hero()
            for k, v in hero.items():
                if hasattr(draft, k):
                    setattr(draft, k, v)
            draft.translations = {}
            draft.published_languages = ['en']
            db.session.add(draft)
            db.session.flush()
            for mod_seed in get_default_modules():
                features = mod_seed.pop('features', [])
                module_row = LandingModule(
                    tenant_id=_current_tenant_id(),
                    landing_config_id=draft.id,
                    **mod_seed,
                )
                db.session.add(module_row)
                db.session.flush()
                for feat_seed in features:
                    feat = LandingFeature(
                        tenant_id=_current_tenant_id(),
                        module_id=module_row.id,
                        **feat_seed,
                    )
                    db.session.add(feat)

        _audit(draft.id, AuditAction.CREATE, user_id, new_values={'version': draft.version})
        db.session.commit()
        return draft

    # -- draft mutation ----------------------------------------------------- #

    @staticmethod
    def update_draft(data, user_id=None):
        draft = LandingConfigService.get_or_create_draft(user_id)
        before = draft.to_dict()
        for col in (
            'hero_title', 'hero_subtitle', 'hero_cta_label', 'hero_cta_href',
            'hero_image_asset_id', 'theme_preset', 'primary_color',
            'secondary_color', 'accent_color', 'background_color',
            'hero_style', 'nav_hierarchy', 'marketing_tagline', 'footer_text',
            'brand_name', 'brand_logo_url', 'brand_sub_tagline',
            'support_email', 'trust_badge_text',
            'hero_body_text', 'hero_search_placeholder',
            'cta_band_title', 'cta_band_subtitle',
            'cta_band_label', 'cta_band_href',
            'why_section_title', 'why_section_subtitle',
            'testimonials_section_title', 'testimonials_section_subtitle',
            'services_section_title', 'services_section_subtitle',
            'categories_section_title', 'categories_section_subtitle',
            'ready_cta_title', 'ready_cta_subtitle',
            'ready_cta_label', 'ready_cta_href',
            'faq_section_title', 'faq_section_subtitle',
            'stats', 'testimonials', 'hero_partners',
            'why_features', 'faqs',
            'section_visibility',
            'doctors_section_title', 'reviews_section_title',
            'brands_section_title',
            'meta', 'translations', 'published_languages',
        ):
            if col in data:
                setattr(draft, col, data[col])
        draft.updated_at = datetime.now(timezone.utc)
        _audit(draft.id, AuditAction.UPDATE, user_id,
               previous_values=before, new_values=draft.to_dict())
        db.session.commit()
        return draft

    # -- promote / publish -------------------------------------------------- #

    @staticmethod
    def promote_to_preview(user_id=None):
        draft = LandingConfigService._get_by_status(ConfigStatus.DRAFT)
        if not draft:
            raise ValueError('No draft to promote.')

        prior_preview = LandingConfigService._get_by_status(ConfigStatus.PREVIEW)
        if prior_preview:
            prior_preview.status = ConfigStatus.ARCHIVED

        draft.status = ConfigStatus.PREVIEW
        _audit(draft.id, AuditAction.PREVIEW, user_id)
        db.session.commit()
        return draft

    @staticmethod
    def publish(user_id=None, note=None):
        preview = LandingConfigService._get_by_status(ConfigStatus.PREVIEW)
        if not preview:
            raise ValueError('No preview to publish.')

        prior_live = LandingConfigService._get_by_status(ConfigStatus.LIVE)
        # Snapshot the outgoing live tree BEFORE flipping status so we can
        # diff its gallery assets against the new live tree below.
        prior_tree = (
            prior_live.to_dict(include_modules=True, include_asset_urls=False)
            if prior_live else None
        )
        if prior_live:
            prior_live.status = ConfigStatus.ARCHIVED

        preview.status = ConfigStatus.LIVE
        preview.published_at = datetime.now(timezone.utc)

        # Immutable snapshot of the whole tree — single source of truth for
        # cross-level history/restore.
        tree = preview.to_dict(include_modules=True, include_asset_urls=False)

        # Orphan reconciliation — hard-delete gallery S3 objects that were on
        # the outgoing live tree but are NOT on the new one. Runs only at
        # publish so a live page never points at a just-deleted object; the
        # only trade-off is that restoring a much older snapshot may show a
        # since-deleted image (best-effort media history). Non-fatal: an S3
        # hiccup must never block a publish.
        try:
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
                logger.info(
                    '[LANDING_PUBLISH] deleted %d orphaned gallery asset(s)',
                    len(orphaned),
                )
        except Exception as exc:  # noqa: BLE001 — cleanup must not fail publish
            logger.warning(
                '[LANDING_PUBLISH] gallery orphan reconciliation failed '
                '(non-fatal): %s', exc,
            )
        snapshot = LandingConfigSnapshot(
            tenant_id=_current_tenant_id(),
            landing_config_id=preview.id,
            version=preview.version,
            tree_json=tree,
            created_by_id=user_id,
            note=note,
        )
        db.session.add(snapshot)

        _audit(preview.id, AuditAction.PUBLISH, user_id,
               new_values={'version': preview.version, 'snapshot_id': str(snapshot.id)})
        db.session.commit()
        return preview, snapshot

    # -- history ------------------------------------------------------------ #

    @staticmethod
    def list_snapshots(limit=20):
        return LandingConfigSnapshot.query.filter_by(
            tenant_id=_current_tenant_id(),
        ).order_by(LandingConfigSnapshot.version.desc()).limit(limit).all()

    @staticmethod
    def get_snapshot(snapshot_id):
        return LandingConfigSnapshot.query.filter_by(
            tenant_id=_current_tenant_id(), id=snapshot_id,
        ).first()

    @staticmethod
    def restore_snapshot(snapshot_id, user_id=None):
        """Restore the entire landing tree from a snapshot into the current
        draft. Wipes current draft modules/features and rebuilds them from
        ``tree_json``.
        """
        snap = LandingConfigService.get_snapshot(snapshot_id)
        if not snap:
            raise ValueError('Snapshot not found.')

        draft = LandingConfigService.get_or_create_draft(user_id)
        _rebuild_draft_from_tree(draft, snap.tree_json)
        _audit(draft.id, AuditAction.UPDATE, user_id,
               new_values={'restored_from_version': snap.version})
        db.session.commit()
        return draft


# --------------------------------------------------------------------------- #
# Module CRUD (on DRAFT only)
# --------------------------------------------------------------------------- #

class ModuleService:

    @staticmethod
    def list_modules():
        draft = LandingConfigService.get_draft()
        if not draft:
            return []
        return list(draft.modules)

    @staticmethod
    def get_module(module_id):
        return LandingModule.query.filter_by(
            tenant_id=_current_tenant_id(), id=module_id,
        ).first()

    @staticmethod
    def create_module(data, user_id=None):
        draft = LandingConfigService.get_or_create_draft(user_id)
        module = LandingModule(
            tenant_id=_current_tenant_id(),
            landing_config_id=draft.id,
            **data,
        )
        db.session.add(module)
        _audit(draft.id, AuditAction.CREATE, user_id,
               new_values={'module_slug': data.get('slug')})
        db.session.commit()
        return module

    @staticmethod
    def update_module(module_id, data, user_id=None):
        module = ModuleService.get_module(module_id)
        if not module:
            raise LookupError('Module not found.')
        before = module.to_dict()
        for col, val in data.items():
            if hasattr(module, col) and col != 'id':
                setattr(module, col, val)
        module.updated_at = datetime.now(timezone.utc)
        _audit(module.landing_config_id, AuditAction.UPDATE, user_id,
               previous_values=before, new_values=module.to_dict())
        db.session.commit()
        return module

    @staticmethod
    def delete_module(module_id, user_id=None):
        module = ModuleService.get_module(module_id)
        if not module:
            raise LookupError('Module not found.')
        cfg_id = module.landing_config_id
        db.session.delete(module)
        _audit(cfg_id, AuditAction.UPDATE, user_id,
               previous_values={'deleted_module_id': str(module_id)})
        db.session.commit()

    @staticmethod
    def reorder_modules(items, user_id=None):
        """``items`` = [{id, display_order}]."""
        for it in items:
            ModuleService.update_module(it['id'], {'display_order': it['display_order']}, user_id)

    @staticmethod
    def restore_from_snapshot(module_id, snapshot_id, user_id=None):
        """Find this module inside ``snapshot.tree_json`` (by module_id) and
        overwrite the current draft module with the snapshot's version.
        """
        snap = LandingConfigService.get_snapshot(snapshot_id)
        if not snap:
            raise ValueError('Snapshot not found.')
        snapshot_module = _find_module_in_tree(snap.tree_json, module_id)
        if not snapshot_module:
            raise ValueError('Module not present in that snapshot.')
        module = ModuleService.get_module(module_id)
        if not module:
            raise LookupError('Module not found in current draft.')
        _apply_module_dict_to_row(module, snapshot_module, replace_features=True)
        db.session.commit()
        return module


# --------------------------------------------------------------------------- #
# Feature CRUD
# --------------------------------------------------------------------------- #

def _sync_care_team(feature, entries, strict=True):
    """Tenant-stack wrapper around the shared reconcile."""
    sync_care_team(
        feature, entries, FeatureDoctor, _current_tenant_id(), strict=strict,
    )


class FeatureService:

    @staticmethod
    def list_features(module_id):
        return LandingFeature.query.filter_by(
            tenant_id=_current_tenant_id(), module_id=module_id,
        ).order_by(LandingFeature.display_order).all()

    @staticmethod
    def get_feature(module_id, slug):
        return LandingFeature.query.filter_by(
            tenant_id=_current_tenant_id(), module_id=module_id, slug=slug,
        ).first()

    @staticmethod
    def list_care_team_candidates(search=None):
        return list_care_team_candidates(_current_tenant_id(), search=search)

    @staticmethod
    def create_feature(module_id, data, user_id=None):
        module = ModuleService.get_module(module_id)
        if not module:
            raise LookupError('Module not found.')
        data = dict(data)
        care_team = data.pop('care_team', None)
        if 'product_id' in data and not data['product_id']:
            data['product_id'] = None  # empty picker → no linked product
        feature = LandingFeature(
            tenant_id=_current_tenant_id(),
            module_id=module.id,
            **data,
        )
        db.session.add(feature)
        # Flush so the care-team rows get a real feature_id to hang off.
        db.session.flush()
        _sync_care_team(feature, care_team)
        _audit(module.landing_config_id, AuditAction.CREATE, user_id,
               new_values={'feature_slug': data.get('slug')})
        db.session.commit()
        return feature

    @staticmethod
    def update_feature(module_id, slug, data, user_id=None):
        feature = FeatureService.get_feature(module_id, slug)
        if not feature:
            raise LookupError('Feature not found.')
        before = feature.to_dict()
        data = dict(data)
        # An absent key means "leave the team alone"; an explicit [] clears it.
        has_care_team = 'care_team' in data
        care_team = data.pop('care_team', None)
        if 'product_id' in data and not data['product_id']:
            data['product_id'] = None  # empty picker → clear the linked product
        for col, val in data.items():
            if col == 'slug':
                continue  # slug is immutable
            if hasattr(feature, col) and col != 'id':
                setattr(feature, col, val)
        if has_care_team:
            _sync_care_team(feature, care_team)
        feature.updated_at = datetime.now(timezone.utc)
        _audit(feature.module.landing_config_id, AuditAction.UPDATE, user_id,
               previous_values=before, new_values=feature.to_dict())
        db.session.commit()
        return feature

    @staticmethod
    def delete_feature(module_id, slug, user_id=None):
        feature = FeatureService.get_feature(module_id, slug)
        if not feature:
            raise LookupError('Feature not found.')
        cfg_id = feature.module.landing_config_id
        db.session.delete(feature)
        _audit(cfg_id, AuditAction.UPDATE, user_id,
               previous_values={'deleted_feature_slug': slug})
        db.session.commit()

    @staticmethod
    def restore_from_snapshot(module_id, slug, snapshot_id, user_id=None):
        snap = LandingConfigService.get_snapshot(snapshot_id)
        if not snap:
            raise ValueError('Snapshot not found.')
        snapshot_module = _find_module_in_tree(snap.tree_json, module_id)
        if not snapshot_module:
            raise ValueError('Module not present in snapshot.')
        snapshot_feature = next(
            (f for f in (snapshot_module.get('features') or []) if f.get('slug') == slug),
            None,
        )
        if not snapshot_feature:
            raise ValueError('Feature not present in that snapshot.')

        feature = FeatureService.get_feature(module_id, slug)
        if not feature:
            raise LookupError('Feature not found in current draft.')
        _apply_feature_dict_to_row(feature, snapshot_feature)
        db.session.commit()
        return feature


# --------------------------------------------------------------------------- #
# Recognition CRUD (standalone, no draft/preview/live lifecycle)
# --------------------------------------------------------------------------- #

class RecognitionService:
    """CRUD for the recognitions / accreditations carousel.

    Edits go LIVE immediately — no draft / preview / live wrapper. The
    landing-page draft lifecycle exists for hero + modules + features which
    publish atomically; recognitions are an editable side-collection.
    """

    @staticmethod
    def list_all(visible_only=False):
        q = LandingRecognition.query.filter_by(tenant_id=_current_tenant_id())
        if visible_only:
            q = q.filter_by(is_visible=True)
        return q.order_by(LandingRecognition.display_order, LandingRecognition.created_at).all()

    @staticmethod
    def get(recognition_id):
        return LandingRecognition.query.filter_by(
            tenant_id=_current_tenant_id(), id=recognition_id,
        ).first()

    @staticmethod
    def create(data, user_id=None):
        item = LandingRecognition(
            tenant_id=_current_tenant_id(),
            **data,
        )
        db.session.add(item)
        db.session.commit()
        return item

    @staticmethod
    def update(recognition_id, data, user_id=None):
        item = RecognitionService.get(recognition_id)
        if not item:
            raise LookupError('Recognition not found.')
        for col, val in data.items():
            if col == 'id':
                continue
            if hasattr(item, col):
                setattr(item, col, val)
        item.updated_at = datetime.now(timezone.utc)
        db.session.commit()
        return item

    @staticmethod
    def delete(recognition_id, user_id=None):
        item = RecognitionService.get(recognition_id)
        if not item:
            raise LookupError('Recognition not found.')
        db.session.delete(item)
        db.session.commit()

    @staticmethod
    def reorder(items, user_id=None):
        """``items`` = [{id, display_order}]. Idempotent — only writes the
        ``display_order`` column so concurrent renames / edits aren't lost.
        """
        for it in items:
            row = RecognitionService.get(str(it['id']))
            if row:
                row.display_order = int(it['display_order'])
        db.session.commit()


# --------------------------------------------------------------------------- #
# Video CRUD (standalone, no lifecycle) + public gallery reads
# --------------------------------------------------------------------------- #

class VideoService:

    @staticmethod
    def list_all(visible_only=False, limit=None):
        q = LandingVideo.query.filter_by(tenant_id=_current_tenant_id())
        if visible_only:
            q = q.filter_by(is_visible=True)
        q = q.order_by(LandingVideo.display_order, LandingVideo.created_at)
        if limit is not None:
            q = q.limit(limit)
        return q.all()

    @staticmethod
    def count_visible():
        """Used by the public landing endpoint so the frontend knows whether
        to show the "More" CTA without a second round-trip."""
        return LandingVideo.query.filter_by(
            tenant_id=_current_tenant_id(), is_visible=True,
        ).count()

    @staticmethod
    def get(video_id):
        return LandingVideo.query.filter_by(
            tenant_id=_current_tenant_id(), id=video_id,
        ).first()

    @staticmethod
    def create(data, user_id=None):
        item = LandingVideo(
            tenant_id=_current_tenant_id(),
            **data,
        )
        db.session.add(item)
        db.session.commit()
        return item

    @staticmethod
    def update(video_id, data, user_id=None):
        item = VideoService.get(video_id)
        if not item:
            raise LookupError('Video not found.')
        for col, val in data.items():
            if col == 'id':
                continue
            if hasattr(item, col):
                setattr(item, col, val)
        item.updated_at = datetime.now(timezone.utc)
        db.session.commit()
        return item

    @staticmethod
    def delete(video_id, user_id=None):
        item = VideoService.get(video_id)
        if not item:
            raise LookupError('Video not found.')
        db.session.delete(item)
        db.session.commit()

    @staticmethod
    def reorder(items, user_id=None):
        for it in items:
            row = VideoService.get(str(it['id']))
            if row:
                row.display_order = int(it['display_order'])
        db.session.commit()


# --------------------------------------------------------------------------- #
# Doctor / Review / TrustedBrand CRUD — same lightweight pattern as
# RecognitionService / VideoService (no draft/preview/live wrapper).
# --------------------------------------------------------------------------- #
#
# Factored as one helper since the three services are structurally
# identical — a model class + an ordering rule. Eliminates ~150 lines of
# duplicated CRUD boilerplate.

def _make_collection_service(model_cls, label):
    """Return a class with the standard list/get/create/update/delete/reorder
    methods bound to ``model_cls``. ``label`` is used in error messages.
    """

    class _CollectionService:

        @staticmethod
        def list_all(visible_only=False, limit=None):
            q = model_cls.query.filter_by(tenant_id=_current_tenant_id())
            if visible_only:
                q = q.filter_by(is_visible=True)
            q = q.order_by(model_cls.display_order, model_cls.created_at)
            if limit is not None:
                q = q.limit(limit)
            return q.all()

        @staticmethod
        def count_visible():
            return model_cls.query.filter_by(
                tenant_id=_current_tenant_id(), is_visible=True,
            ).count()

        @staticmethod
        def get(item_id):
            return model_cls.query.filter_by(
                tenant_id=_current_tenant_id(), id=item_id,
            ).first()

        @staticmethod
        def create(data, user_id=None):
            item = model_cls(tenant_id=_current_tenant_id(), **data)
            db.session.add(item)
            db.session.commit()
            return item

        @staticmethod
        def update(item_id, data, user_id=None):
            item = _CollectionService.get(item_id)
            if not item:
                raise LookupError(f'{label} not found.')
            for col, val in data.items():
                if col == 'id':
                    continue
                if hasattr(item, col):
                    setattr(item, col, val)
            item.updated_at = datetime.now(timezone.utc)
            db.session.commit()
            return item

        @staticmethod
        def delete(item_id, user_id=None):
            item = _CollectionService.get(item_id)
            if not item:
                raise LookupError(f'{label} not found.')
            db.session.delete(item)
            db.session.commit()

        @staticmethod
        def reorder(items, user_id=None):
            for it in items:
                row = _CollectionService.get(str(it['id']))
                if row:
                    row.display_order = int(it['display_order'])
            db.session.commit()

    _CollectionService.__name__ = f'{label}Service'
    return _CollectionService


DoctorService = _make_collection_service(LandingDoctor, 'Doctor')
ReviewService = _make_collection_service(LandingReview, 'Review')
TrustedBrandService = _make_collection_service(LandingTrustedBrand, 'TrustedBrand')


# --------------------------------------------------------------------------- #
# Public (unauthenticated) read
# --------------------------------------------------------------------------- #

class PublicLandingService:
    """Public read-only tree access, with admin previews.

    ``mode='live'`` (default) is the unauthenticated public path — it serves
    the LIVE row for the current tenant.

    ``mode='preview'`` falls back to DRAFT when no promoted PREVIEW exists.
    ``mode='draft'`` returns the DRAFT tree.

    Admin-only modes (draft/preview) require tenant context on the request —
    the route decorates itself with ``@jwt_required(optional=True)`` so callers
    that omit a JWT get an empty response for those modes rather than default-
    tenant data leaking across tenants.
    """

    @staticmethod
    def _resolve_root(mode):
        if mode == 'draft':
            return LandingConfigService.get_draft()
        if mode == 'preview':
            preview = LandingConfigService._get_by_status(ConfigStatus.PREVIEW)
            return preview or LandingConfigService.get_draft()
        return LandingConfigService.get_live()

    @staticmethod
    def _translate(tree, lang):
        if not tree or lang == 'en':
            return tree
        apply_translations(tree, lang=lang)
        for module in tree.get('modules', []):
            apply_translations(module, lang=lang)
            for feat in module.get('features', []):
                apply_translations(feat, lang=lang)
        return tree

    @staticmethod
    def get_tree(lang='en', mode='live'):
        root = PublicLandingService._resolve_root(mode)
        if not root:
            return None
        tree = root.to_dict(include_modules=True, include_asset_urls=True)
        return PublicLandingService._translate(tree, lang)

    # Backward-compat alias used elsewhere in the codebase.
    @staticmethod
    def get_live_tree(lang='en'):
        return PublicLandingService.get_tree(lang=lang, mode='live')

    @staticmethod
    def get_public_module(slug, lang='en', mode='live'):
        """Single module — returned with its features embedded so a Module page
        can render in one round-trip.
        """
        tree = PublicLandingService.get_tree(lang=lang, mode=mode)
        if not tree:
            return None
        for module in tree.get('modules', []):
            # In preview/draft mode, is_visible=False modules should still be
            # previewable by the admin; only filter on the public LIVE path.
            if module.get('slug') == slug and (mode != 'live' or module.get('is_visible')):
                return module
        return None

    @staticmethod
    def get_public_feature(slug, lang='en', mode='live'):
        """Single feature by global slug. Live tree is small enough that a
        linear scan is fine and avoids a per-module route in the public API.
        """
        tree = PublicLandingService.get_tree(lang=lang, mode=mode)
        if not tree:
            return None
        for module in tree.get('modules', []):
            for feat in (module.get('features') or []):
                if feat.get('slug') == slug and (mode != 'live' or feat.get('is_visible')):
                    # Inline the parent module reference so consumers can show
                    # a breadcrumb without a second fetch.
                    return {**feat, 'module_slug': module.get('slug'), 'module_name': module.get('name')}
        return None


# --------------------------------------------------------------------------- #
# Internal helpers
# --------------------------------------------------------------------------- #

def _collect_gallery_s3_keys(tree):
    """Collect every gallery ``s3_key`` referenced by a landing tree dict.

    Walks each module + feature's ``img_json.images`` / ``vid_json.videos``
    and gathers the non-null ``s3_key`` values. External links (YouTube/CDN)
    carry no ``s3_key``, so they're never returned (and never deleted).
    Used by :meth:`LandingConfigService.publish` to diff old-vs-new live.
    """
    keys = set()
    if not tree:
        return keys

    def _scan(node):
        for media_key, items_key in (('img_json', 'images'), ('vid_json', 'videos')):
            for item in ((node.get(media_key) or {}).get(items_key) or []):
                k = item.get('s3_key')
                if k:
                    keys.add(k)

    for module in (tree.get('modules') or []):
        _scan(module)
        for feature in (module.get('features') or []):
            _scan(feature)
    return keys


def _clone_module(source, new_config_id):
    """Clone a LandingModule (and its features) into a new LandingConfig."""
    new_module = LandingModule(
        tenant_id=_current_tenant_id(),
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


def _clone_care_team(source, target):
    clone_care_team(source, target, FeatureDoctor, tenant_id=_current_tenant_id())


def _clone_feature(source):
    clone = LandingFeature(
        tenant_id=_current_tenant_id(),
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
    )
    _clone_care_team(source, clone)
    return clone


def _find_module_in_tree(tree, module_id):
    for m in (tree or {}).get('modules', []):
        if m.get('id') == str(module_id):
            return m
    return None


def _apply_module_dict_to_row(module, src, replace_features=False):
    """Overwrite ``module``'s mutable columns from a snapshot-shaped dict."""
    for col in (
        'name', 'icon_key', 'description', 'logo_asset_id', 'display_order',
        'is_visible', 'faq_json', 'sections_enabled_json', 'translations',
        'vid_json', 'img_json',
    ):
        if col in src:
            setattr(module, col, src[col])
    if replace_features:
        for old in list(module.features):
            db.session.delete(old)
        for f_src in src.get('features', []):
            new_feat = LandingFeature(
                tenant_id=_current_tenant_id(),
                module_id=module.id,
                slug=f_src['slug'],
                title=f_src.get('title') or f_src['slug'],
            )
            _apply_feature_dict_to_row(new_feat, f_src)
            db.session.add(new_feat)


def _apply_feature_dict_to_row(feature, src):
    for col in (
        'title', 'description', 'category', 'logo_asset_id',
        'starting_price', 'timeline',
        'rating', 'what_is', 'requirements', 'documents', 'benefits',
        'disadvantages', 'process',
        'who_should_join', 'whats_included', 'expected_outcomes',
        'book_cta_label', 'sections_enabled_json',
        'translations', 'vid_json', 'img_json', 'display_order', 'is_visible',
    ):
        if col in src:
            setattr(feature, col, src[col])
    if 'care_team' in src:
        # Snapshot entries carry the raw toggles plus a resolved ``doctor``
        # block; only the former is restorable — doctor data is always read
        # live, never rehydrated from the snapshot.
        _sync_care_team(feature, src.get('care_team') or [], strict=False)


def _rebuild_draft_from_tree(draft, tree):
    """Replace every non-primary-key attribute on ``draft`` (and its modules /
    features) from ``tree``. Used by ``restore_snapshot``.
    """
    for col in (
        'hero_title', 'hero_subtitle', 'hero_cta_label', 'hero_cta_href',
        'theme_preset', 'primary_color', 'secondary_color', 'accent_color',
        'background_color', 'hero_style', 'nav_hierarchy',
        'marketing_tagline', 'footer_text',
        'brand_name', 'brand_logo_url', 'brand_sub_tagline',
        'support_email', 'trust_badge_text',
        'hero_body_text', 'hero_search_placeholder',
        'cta_band_title', 'cta_band_subtitle',
        'cta_band_label', 'cta_band_href',
        'why_section_title', 'why_section_subtitle',
        'testimonials_section_title', 'testimonials_section_subtitle',
        'services_section_title', 'services_section_subtitle',
        'categories_section_title', 'categories_section_subtitle',
        'ready_cta_title', 'ready_cta_subtitle',
        'ready_cta_label', 'ready_cta_href',
        'faq_section_title', 'faq_section_subtitle',
        'stats', 'testimonials', 'hero_partners',
        'why_features', 'faqs',
        'section_visibility',
        'doctors_section_title', 'reviews_section_title', 'brands_section_title',
        'meta', 'translations', 'published_languages',
    ):
        if col in tree:
            setattr(draft, col, tree[col])
    for old in list(draft.modules):
        db.session.delete(old)
    db.session.flush()
    for m_src in tree.get('modules', []):
        new_mod = LandingModule(
            tenant_id=_current_tenant_id(),
            landing_config_id=draft.id,
            slug=m_src['slug'],
            name=m_src.get('name') or m_src['slug'],
        )
        _apply_module_dict_to_row(new_mod, m_src, replace_features=False)
        db.session.add(new_mod)
        db.session.flush()
        for f_src in m_src.get('features', []):
            new_feat = LandingFeature(
                tenant_id=_current_tenant_id(),
                module_id=new_mod.id,
                slug=f_src['slug'],
                title=f_src.get('title') or f_src['slug'],
            )
            _apply_feature_dict_to_row(new_feat, f_src)
            db.session.add(new_feat)
