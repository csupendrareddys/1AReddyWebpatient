"""Platform-owned landing-page models.

Mirrors :mod:`app.models.landing_page_config` (which is per-tenant, RLS-
scoped, and renders each clinic's portal at ``<slug>.larazen.in``) but
serves **everything the platform owner edits directly**:

  * ``marketing`` scope — the apex marketing site (``larazen.in``).
  * ``default_template`` scope — the seed copied into every new tenant's
    own ``landing_*`` rows on signup. Editing this template later does
    NOT touch existing tenants — it only changes what the next
    fresh tenant will start from.

Why one set of tables with a ``scope`` discriminator (vs duplicating
the schema again):

  * Both editors are feature-identical from the operator's perspective
    (Editor / Recognitions / Videos / Preview / History) — having one
    set of tables means one CRUD surface, one editor component, one
    set of validators. Adding a third scope later is one enum value.
  * No data overlap between scopes; each LIVE row is unambiguous.

Architectural notes:

* **No** ``TenantMixin`` and **no** RLS — these tables are platform-
  owner-private. Tenants never read or write them.
* Schema mirrors the tenant counterpart 1:1 (hero, theme, modules,
  features, snapshots, recognitions, videos) so the muscle memory is
  identical for the operator.
* ``page_config_assets`` is reused as-is for image / video uploads.

Tables:
    platform_landing_configs            — root config (per scope)
    platform_landing_modules            — top-nav modules
    platform_landing_features           — feature pages under a module
    platform_feature_doctors            — care team pinned to a feature
    platform_landing_config_snapshots   — publish-time tree audit
    platform_landing_recognitions       — certificates / awards carousel
    platform_landing_videos             — video gallery
"""
import enum
import uuid

from sqlalchemy.dialects.postgresql import UUID, JSON, JSONB
from app.extensions import db
from app.models._base import TimestampMixin, utcnow
from app.models._enums import ConfigStatus
from app.models.care_team import CareTeamMemberMixin


class PlatformLandingScope(enum.Enum):
    """Which landing surface a platform-landing row drives.

    ``MARKETING`` rows render at the apex (``larazen.in``).
    ``DEFAULT_TEMPLATE`` rows are copied into a new tenant's
    ``landing_*`` tables on first provision (seed-only — see
    :func:`app.api.platform.service.PlatformTenantService.create_tenant`).
    """
    MARKETING = 'marketing'
    DEFAULT_TEMPLATE = 'default_template'


# --------------------------------------------------------------------------- #
# LEVEL 1: PlatformLandingConfig (root)
# --------------------------------------------------------------------------- #

class PlatformLandingConfig(db.Model):
    """Root marketing-landing config. At most one row per ``status``
    (DRAFT / PREVIEW / LIVE / ARCHIVED) — there's no ``tenant_id``
    discriminator because the platform marketing site is singular.
    """
    __tablename__ = 'platform_landing_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='config_id')
    # NOTE: ``index=True`` deliberately omitted — the explicit named index
    # below is the one ``db.create_all()`` and the Alembic migration both
    # produce. Adding ``index=True`` would emit a second CREATE INDEX with
    # the same auto-generated name (``ix_<table>_<column>``) and trip
    # PG with "relation already exists" on bootstrap.
    status = db.Column(
        db.Enum(ConfigStatus), default=ConfigStatus.DRAFT,
        nullable=False,
    )
    # Which platform-edited landing surface this row drives. The same
    # editor component renders both scopes — query layer filters by it.
    scope = db.Column(
        db.Enum(PlatformLandingScope, name='platformlandingscope'),
        nullable=False, default=PlatformLandingScope.MARKETING,
    )
    version = db.Column(db.Integer, default=1, nullable=False)

    # ── Hero ───────────────────────────────────────────────────────
    hero_title = db.Column(db.String(200), nullable=True)
    hero_subtitle = db.Column(db.String(500), nullable=True)
    hero_cta_label = db.Column(db.String(100), nullable=True)
    hero_cta_href = db.Column(db.String(500), nullable=True)
    hero_image_asset_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
        nullable=True,
    )

    # Apex twin of ``LandingConfig.nav_hierarchy`` — 'two_level' or
    # 'three_level'. See that column for what each means and why the shape is
    # a setting rather than something inferred from the data.
    nav_hierarchy = db.Column(
        db.String(20), default='three_level',
        server_default=db.text("'three_level'"), nullable=False,
    )

    # ── Theme ──────────────────────────────────────────────────────
    theme_preset = db.Column(db.String(40), default='ocean')
    primary_color = db.Column(db.String(20), default='#1976d2')
    secondary_color = db.Column(db.String(20), default='#dc004e')
    accent_color = db.Column(db.String(20), default='#26a69a')
    background_color = db.Column(db.String(20), default='#ffffff')
    hero_style = db.Column(db.String(40), default='gradient')

    # ── Marketing copy ─────────────────────────────────────────────
    marketing_tagline = db.Column(db.String(500), nullable=True)
    footer_text = db.Column(db.Text, nullable=True)
    meta = db.Column(JSON, nullable=True)

    # Brand + contact — surfaced in the navbar, footer, and utility
    # strip across every page rendered by ``PublicLandingLayout``.
    # Same shape as the per-tenant LandingConfig; kept distinct rather
    # than shared because the apex's brand can be edited independently
    # of any tenant clone-template.
    brand_name = db.Column(db.String(120), nullable=True)
    brand_logo_url = db.Column(db.String(500), nullable=True)
    brand_sub_tagline = db.Column(db.String(200), nullable=True)
    support_email = db.Column(db.String(254), nullable=True)

    # Hero-zone trust badge (e.g. "Trusted by 10,000+ Patients").
    trust_badge_text = db.Column(db.String(200), nullable=True)

    # Hero body copy + search bar — see LandingConfig for docs.
    hero_body_text = db.Column(db.Text, nullable=True)
    hero_search_placeholder = db.Column(db.String(200), nullable=True)

    # "Are you a doctor?" CTA band near the bottom. Clearing the title
    # hides the section. Defaults at the frontend route to /join/doctor.
    cta_band_title = db.Column(db.String(200), nullable=True)
    cta_band_subtitle = db.Column(db.String(500), nullable=True)
    cta_band_label = db.Column(db.String(120), nullable=True)
    cta_band_href = db.Column(db.String(500), nullable=True)

    # Section headings + JSON-array repeats — see LandingConfig for
    # the full docstrings. Keeping the schema symmetric between apex
    # and per-tenant so editing flows feel identical.
    why_section_title = db.Column(db.String(200), nullable=True)
    why_section_subtitle = db.Column(db.String(500), nullable=True)
    testimonials_section_title = db.Column(db.String(200), nullable=True)
    testimonials_section_subtitle = db.Column(db.String(500), nullable=True)
    # Same as LandingConfig — see that model for docstrings. Schema
    # kept symmetric so editing flows feel identical apex vs tenant.
    services_section_title = db.Column(db.String(200), nullable=True)
    services_section_subtitle = db.Column(db.String(500), nullable=True)
    categories_section_title = db.Column(db.String(200), nullable=True)
    categories_section_subtitle = db.Column(db.String(500), nullable=True)
    ready_cta_title = db.Column(db.String(200), nullable=True)
    ready_cta_subtitle = db.Column(db.String(500), nullable=True)
    ready_cta_label = db.Column(db.String(120), nullable=True)
    ready_cta_href = db.Column(db.String(500), nullable=True)
    faq_section_title = db.Column(db.String(200), nullable=True)
    faq_section_subtitle = db.Column(db.String(500), nullable=True)
    stats = db.Column(JSON, nullable=True)
    testimonials = db.Column(JSON, nullable=True)
    hero_partners = db.Column(JSON, nullable=True)
    why_features = db.Column(JSON, nullable=True)
    faqs = db.Column(JSON, nullable=True)
    # See LandingConfig.section_visibility for docs.
    section_visibility = db.Column(JSON, nullable=True)

    # ── i18n ───────────────────────────────────────────────────────
    translations = db.Column(JSON, nullable=True, default=dict)
    published_languages = db.Column(JSON, nullable=True, default=lambda: ['en'])

    # ── Lifecycle ──────────────────────────────────────────────────
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False,
    )
    published_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_by_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )

    hero_image_asset = db.relationship('PageConfigAsset', foreign_keys=[hero_image_asset_id])
    created_by = db.relationship('User', foreign_keys=[created_by_id])

    modules = db.relationship(
        'PlatformLandingModule',
        backref='config',
        cascade='all, delete-orphan',
        order_by='PlatformLandingModule.display_order',
    )
    # Recognitions and videos now live UNDER a config row (instead of
    # being scope-keyed) so they ride the DRAFT → PREVIEW → LIVE flow
    # exactly like modules. Cascade-delete the children when the parent
    # config is removed.
    recognitions = db.relationship(
        'PlatformLandingRecognition',
        backref='config',
        cascade='all, delete-orphan',
        order_by='PlatformLandingRecognition.display_order',
        foreign_keys='PlatformLandingRecognition.landing_config_id',
    )
    videos = db.relationship(
        'PlatformLandingVideo',
        backref='config',
        cascade='all, delete-orphan',
        order_by='PlatformLandingVideo.display_order',
        foreign_keys='PlatformLandingVideo.landing_config_id',
    )

    __table_args__ = (
        db.Index('ix_platform_landing_configs_status', 'status'),
    )

    def to_dict(self, include_modules=False, include_asset_urls=False,
                include_collections=False):
        data = {
            'id': str(self.id),
            'status': self.status.value,
            'scope': self.scope.value,
            'version': self.version,
            'hero_title': self.hero_title,
            'hero_subtitle': self.hero_subtitle,
            'hero_cta_label': self.hero_cta_label,
            'hero_cta_href': self.hero_cta_href,
            'hero_image_asset_id': str(self.hero_image_asset_id) if self.hero_image_asset_id else None,
            'nav_hierarchy': self.nav_hierarchy or 'three_level',
            'theme_preset': self.theme_preset or 'ocean',
            'primary_color': self.primary_color,
            'secondary_color': self.secondary_color,
            'accent_color': self.accent_color,
            'background_color': self.background_color,
            'hero_style': self.hero_style or 'gradient',
            'marketing_tagline': self.marketing_tagline,
            'brand_name': self.brand_name,
            'brand_logo_url': self.brand_logo_url,
            'brand_sub_tagline': self.brand_sub_tagline,
            'support_email': self.support_email,
            'trust_badge_text': self.trust_badge_text,
            'hero_body_text': self.hero_body_text,
            'hero_search_placeholder': self.hero_search_placeholder,
            'cta_band_title': self.cta_band_title,
            'cta_band_subtitle': self.cta_band_subtitle,
            'cta_band_label': self.cta_band_label,
            'cta_band_href': self.cta_band_href,
            'why_section_title': self.why_section_title,
            'why_section_subtitle': self.why_section_subtitle,
            'testimonials_section_title': self.testimonials_section_title,
            'testimonials_section_subtitle': self.testimonials_section_subtitle,
            'services_section_title': self.services_section_title,
            'services_section_subtitle': self.services_section_subtitle,
            'categories_section_title': self.categories_section_title,
            'categories_section_subtitle': self.categories_section_subtitle,
            'ready_cta_title': self.ready_cta_title,
            'ready_cta_subtitle': self.ready_cta_subtitle,
            'ready_cta_label': self.ready_cta_label,
            'ready_cta_href': self.ready_cta_href,
            'faq_section_title': self.faq_section_title,
            'faq_section_subtitle': self.faq_section_subtitle,
            'stats': self.stats or [],
            'testimonials': self.testimonials or [],
            'hero_partners': self.hero_partners or [],
            'why_features': self.why_features or [],
            'faqs': self.faqs or [],
            'section_visibility': self.section_visibility or {},
            'footer_text': self.footer_text,
            'meta': self.meta or {},
            'translations': self.translations or {},
            'published_languages': self.published_languages or ['en'],
            'published_at': self.published_at.isoformat() if self.published_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_asset_urls:
            data['hero_image_url'] = (
                self.hero_image_asset.get_presigned_url()
                if self.hero_image_asset else None
            )
        if include_modules:
            data['modules'] = [m.to_dict(include_features=True) for m in self.modules]
        if include_collections:
            # Recognitions + videos belong to this config row (not to
            # scope) since migration s9n0i1d2e3f4. Inlining them on the
            # summary lets the editor's preview iframe show DRAFT and
            # PREVIEW carousel state — the public endpoint stays
            # LIVE-only for anonymous traffic.
            data['recognitions'] = [
                r.to_dict() for r in sorted(
                    self.recognitions,
                    key=lambda x: (x.display_order or 0, x.created_at),
                )
            ]
            data['videos'] = [
                v.to_dict() for v in sorted(
                    self.videos,
                    key=lambda x: (x.display_order or 0, x.created_at),
                )
            ]
        return data

    def __repr__(self):
        return f"<PlatformLandingConfig v{self.version} [{self.status.value}]>"


# --------------------------------------------------------------------------- #
# LEVEL 2: PlatformLandingModule
# --------------------------------------------------------------------------- #

class PlatformLandingModule(db.Model):
    __tablename__ = 'platform_landing_modules'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='module_id')
    landing_config_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('platform_landing_configs.config_id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )

    slug = db.Column(db.String(120), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    icon_key = db.Column(db.String(100), nullable=True)
    description = db.Column(db.Text, nullable=True)

    logo_asset_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
        nullable=True,
    )

    display_order = db.Column(db.Integer, default=0, nullable=False)
    is_visible = db.Column(db.Boolean, default=True, nullable=False)
    is_additional = db.Column(db.Boolean, default=False, nullable=False)
    # Mirror of ``LandingModule.show_in_slider`` — feeds the public landing
    # "featured slider" (third sliding bar) on the apex marketing site.
    show_in_slider = db.Column(
        db.Boolean, default=False, server_default=db.text('false'),
        nullable=False,
    )

    faq_json = db.Column(JSON, nullable=True, default=list)
    vid_json = db.Column(JSONB, nullable=True)
    img_json = db.Column(JSONB, nullable=True)
    sections_enabled_json = db.Column(
        JSON, nullable=True,
        default=lambda: {'hero': True, 'features_grid': True, 'faq': True},
    )

    translations = db.Column(JSON, nullable=True, default=dict)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False,
    )

    logo_asset = db.relationship('PageConfigAsset', foreign_keys=[logo_asset_id])
    features = db.relationship(
        'PlatformLandingFeature',
        backref='module',
        cascade='all, delete-orphan',
        order_by='PlatformLandingFeature.display_order',
    )

    __table_args__ = (
        # No tenant in the unique key — slugs are globally unique per
        # platform-config row.
        db.UniqueConstraint(
            'landing_config_id', 'slug', name='uq_platform_landing_module_slug',
        ),
        db.Index('ix_platform_landing_modules_config', 'landing_config_id'),
    )

    def to_dict(self, include_features=False):
        data = {
            'id': str(self.id),
            'landing_config_id': str(self.landing_config_id),
            'slug': self.slug,
            'name': self.name,
            'icon_key': self.icon_key,
            'description': self.description,
            'logo_asset_id': str(self.logo_asset_id) if self.logo_asset_id else None,
            'logo_url': self.logo_asset.get_presigned_url() if self.logo_asset else None,
            'display_order': self.display_order,
            'is_visible': self.is_visible,
            'is_additional': self.is_additional,
            'show_in_slider': self.show_in_slider,
            'faq_json': self.faq_json or [],
            'vid_json': self.vid_json or [],
            'img_json': self.img_json or [],
            'sections_enabled_json': (
                self.sections_enabled_json or {'hero': True, 'features_grid': True, 'faq': True}
            ),
            'translations': self.translations or {},
        }
        if include_features:
            data['features'] = [f.to_dict() for f in self.features]
        return data

    def __repr__(self):
        return f"<PlatformLandingModule {self.slug} of config={self.landing_config_id}>"


# --------------------------------------------------------------------------- #
# LEVEL 3: PlatformLandingFeature
# --------------------------------------------------------------------------- #

class PlatformLandingFeature(db.Model):
    __tablename__ = 'platform_landing_features'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='feature_id')
    module_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('platform_landing_modules.module_id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )

    slug = db.Column(db.String(120), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)

    # Apex twin of ``LandingFeature.category`` — the middle level of the public
    # nav (module → category → feature). See that column for why it's a label
    # rather than a table, and how ordering falls out of ``display_order``.
    category = db.Column(db.String(120), nullable=True)

    logo_asset_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
        nullable=True,
    )

    starting_price = db.Column(db.String(50), nullable=True)
    timeline = db.Column(db.String(100), nullable=True)
    rating = db.Column(db.String(20), nullable=True)

    what_is = db.Column(db.Text, nullable=True)

    requirements = db.Column(JSON, nullable=True, default=list)
    documents = db.Column(JSON, nullable=True, default=list)
    benefits = db.Column(JSON, nullable=True, default=list)
    disadvantages = db.Column(JSON, nullable=True, default=list)
    process = db.Column(JSON, nullable=True, default=list)
    # Apex twins of ``LandingFeature.who_should_join`` / ``whats_included`` /
    # ``expected_outcomes`` — lists of {title, desc}, toggled from
    # sections_enabled_json.
    who_should_join = db.Column(JSON, nullable=True, default=list)
    whats_included = db.Column(JSON, nullable=True, default=list)
    expected_outcomes = db.Column(JSON, nullable=True, default=list)

    book_cta_label = db.Column(db.String(100), default='Book Now', nullable=True)

    sections_enabled_json = db.Column(
        JSON, nullable=True,
        default=lambda: {
            'what_is': True, 'eligibility': True,
            'who_should_join': True, 'whats_included': True,
            'benefits': True, 'disadvantages': True, 'expected_outcomes': True,
            'how_it_works': True, 'documents': True,
            'pricing': True, 'rating': True, 'book_now': True,
        },
    )
    vid_json = db.Column(JSONB, nullable=True)
    img_json = db.Column(JSONB, nullable=True)
    faq_json = db.Column(JSONB, nullable=True, default=list)

    # Back-office "product & provider linking" — routing/config data only,
    # NOT rendered on the public page (mirrors LandingFeature.product_links_json).
    product_links_json = db.Column(JSONB, nullable=True, default=list)

    translations = db.Column(JSON, nullable=True, default=dict)

    display_order = db.Column(db.Integer, default=0, nullable=False)
    is_visible = db.Column(db.Boolean, default=True, nullable=False)
    is_popular = db.Column(db.Boolean, default=False, nullable=False)
    # Mirror of ``LandingFeature.show_in_slider`` — feeds the apex "featured
    # slider" (third sliding bar); each links to its /service/<slug> page.
    show_in_slider = db.Column(
        db.Boolean, default=False, server_default=db.text('false'),
        nullable=False,
    )

    # Optional link to a marketplace product (audio consultation, a service,
    # or a group offering). Drives the "Book Now" target and scopes the
    # care-team doctor picker to that product's providers. Apex twin of
    # ``LandingFeature.product_id``.
    product_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctor_products.product_id', ondelete='SET NULL',
                      name='platform_landing_features_product_id_fkey'),
        nullable=True,
    )

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False,
    )

    logo_asset = db.relationship('PageConfigAsset', foreign_keys=[logo_asset_id])

    # "Our care team" — doctors pinned to this apex feature page. Tenant twin
    # is ``LandingFeature.care_team``.
    care_team = db.relationship(
        'PlatformFeatureDoctor',
        backref='feature',
        cascade='all, delete-orphan',
        order_by='PlatformFeatureDoctor.display_order',
        lazy='selectin',
    )

    __table_args__ = (
        db.UniqueConstraint(
            'module_id', 'slug', name='uq_platform_landing_feature_slug',
        ),
        db.Index('ix_platform_landing_features_module', 'module_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'module_id': str(self.module_id),
            'slug': self.slug,
            'title': self.title,
            'description': self.description,
            'category': self.category,
            'logo_asset_id': str(self.logo_asset_id) if self.logo_asset_id else None,
            'logo_url': self.logo_asset.get_presigned_url() if self.logo_asset else None,
            'starting_price': self.starting_price,
            'timeline': self.timeline,
            'rating': self.rating,
            'what_is': self.what_is,
            'requirements': self.requirements or [],
            'documents': self.documents or [],
            'benefits': self.benefits or [],
            'disadvantages': self.disadvantages or [],
            'process': self.process or [],
            'who_should_join': self.who_should_join or [],
            'whats_included': self.whats_included or [],
            'expected_outcomes': self.expected_outcomes or [],
            'book_cta_label': self.book_cta_label,
            'sections_enabled_json': (
                self.sections_enabled_json or {
                    'what_is': True, 'eligibility': True,
                    'who_should_join': True, 'whats_included': True,
                    'benefits': True, 'disadvantages': True, 'expected_outcomes': True,
                    'how_it_works': True, 'documents': True,
                    'pricing': True, 'rating': True, 'book_now': True,
                }
            ),
            'vid_json': self.vid_json or {},
            'img_json': self.img_json or {},
            'faq_json': self.faq_json or [],
            'translations': self.translations or {},
            'display_order': self.display_order,
            'is_visible': self.is_visible,
            'is_popular': self.is_popular,
            'show_in_slider': self.show_in_slider,
            'product_id': str(self.product_id) if self.product_id else None,
            'care_team': [d.to_dict() for d in self.care_team],
            # Back-office routing data — never rendered on the public page.
            'product_links_json': self.product_links_json or [],
        }

    def __repr__(self):
        return f"<PlatformLandingFeature {self.slug} of module={self.module_id}>"


# --------------------------------------------------------------------------- #
# PlatformFeatureDoctor — the "care team" strip on an apex feature page
# --------------------------------------------------------------------------- #

class PlatformFeatureDoctor(CareTeamMemberMixin, db.Model):
    """Apex twin of :class:`~app.models.landing_page_config.FeatureDoctor`.

    Same columns and same live-resolution behaviour, minus ``tenant_id``:
    like every other ``platform_landing_*`` table this one is platform-owner
    private and carries no RLS.

    The doctors it points at *are* tenant-scoped, though. The picker and the
    write-path validation both scope candidates to the SaaS vendor's own
    tenant (``Tenant.is_platform`` — see ``vendor_tenant_id()`` in
    ``app/api/platform_landing/service.py``), so this table can never become
    a way to surface another clinic's doctors on the vendor's site.

    That scoping used to key on ``is_default``, which named the same row
    while the vendor was the apex tenant. After the vendor/customer split it
    does not: ``is_default`` is just the anonymous-request fallback and may
    point at an ordinary customer, so keying on it would have turned this
    table into exactly the leak the paragraph above forbids.

    The vendor owns no product data, so in practice the pool is empty and no
    care team renders on the marketing site. That is the intended outcome,
    not a misconfiguration.
    """
    __tablename__ = 'platform_feature_doctors'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    feature_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('platform_landing_features.feature_id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    # Nullable now that a care-team row can pin a whole TEAM instead of a single
    # doctor (group offerings). Exactly one of ``doctor_id`` / ``team_id`` is set.
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True,
        index=True,
    )
    team_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('marketplace_service_groups.group_id', ondelete='CASCADE'),
        nullable=True,
        index=True,
    )

    # Field visibility toggles — the on/off switches in the admin editor.
    photo = db.Column(db.Boolean, default=False, server_default=db.text('false'), nullable=False)
    experience = db.Column(db.Boolean, default=False, server_default=db.text('false'), nullable=False)
    languages = db.Column(db.Boolean, default=False, server_default=db.text('false'), nullable=False)
    location = db.Column(db.Boolean, default=False, server_default=db.text('false'), nullable=False)
    work_qualification = db.Column(
        db.Boolean, default=False, server_default=db.text('false'), nullable=False,
    )

    description = db.Column(db.Text, nullable=True)
    display_order = db.Column(db.Integer, default=0, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False,
    )

    doctor = db.relationship('Doctor', foreign_keys=[doctor_id], lazy='selectin')
    team = db.relationship('MarketplaceServiceGroup', foreign_keys=[team_id], lazy='selectin')
    about = db.relationship(
        'ProfileAbout',
        primaryjoin='foreign(ProfileAbout.doctor_id) == PlatformFeatureDoctor.doctor_id',
        viewonly=True, uselist=False, lazy='selectin',
    )

    __table_args__ = (
        db.UniqueConstraint('feature_id', 'doctor_id', name='uq_platform_feature_doctor'),
        db.UniqueConstraint('feature_id', 'team_id', name='uq_platform_feature_team'),
    )

    def __repr__(self):
        return f"<PlatformFeatureDoctor feature={self.feature_id} doctor={self.doctor_id}>"


# --------------------------------------------------------------------------- #
# Snapshot (version history)
# --------------------------------------------------------------------------- #

class PlatformLandingConfigSnapshot(db.Model):
    """Immutable frozen copy of the full platform-landing tree at one
    publish — written exactly once when ``publish`` fires. Mirrors
    :class:`LandingConfigSnapshot`.
    """
    __tablename__ = 'platform_landing_config_snapshots'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='snapshot_id')
    landing_config_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('platform_landing_configs.config_id', ondelete='SET NULL'),
        nullable=True,
    )
    version = db.Column(db.Integer, nullable=False)

    tree_json = db.Column(JSON, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    created_by_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )
    note = db.Column(db.Text, nullable=True)

    __table_args__ = (
        db.Index('ix_platform_landing_snapshots_version', 'version'),
    )

    def to_dict(self, include_tree=False):
        data = {
            'id': str(self.id),
            'version': self.version,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'created_by_id': str(self.created_by_id) if self.created_by_id else None,
            'note': self.note,
        }
        if include_tree:
            data['tree_json'] = self.tree_json
        return data


# --------------------------------------------------------------------------- #
# Recognitions / certificates carousel
# --------------------------------------------------------------------------- #

class PlatformLandingRecognition(db.Model):
    """Mirrors :class:`LandingRecognition` for platform-owned scopes.

    Each row carries a ``scope`` so the same table backs the apex
    marketing carousel and the default-template carousel that seeds new
    tenants. No ``tenant_id`` (and no RLS) — these rows are platform-
    owner-private.
    """
    __tablename__ = 'platform_landing_recognitions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='recognition_id')
    # Owning config row — written by migration s9n0i1d2e3f4. Mutations
    # are gated to DRAFT-status configs only; promote/publish carry
    # these rows along with their parent, same way modules/features do.
    landing_config_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('platform_landing_configs.config_id', ondelete='CASCADE'),
        nullable=True,  # nullable for back-compat during rollout; new
                        # rows always get a config_id.
    )
    scope = db.Column(
        db.Enum(PlatformLandingScope, name='platformlandingscope'),
        nullable=False, default=PlatformLandingScope.MARKETING,
    )
    title = db.Column(db.String(200), nullable=False)
    subtitle = db.Column(db.String(300), nullable=True)
    description = db.Column(db.Text, nullable=True)
    logo_asset_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
        nullable=True,
    )
    display_order = db.Column(db.Integer, default=0, nullable=False)
    is_visible = db.Column(db.Boolean, default=True, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False,
    )

    logo_asset = db.relationship('PageConfigAsset', foreign_keys=[logo_asset_id])

    __table_args__ = (
        db.Index('ix_platform_landing_recognitions_scope', 'scope'),
        db.Index('ix_platform_landing_recognitions_config', 'landing_config_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'landing_config_id': str(self.landing_config_id) if self.landing_config_id else None,
            'scope': self.scope.value,
            'title': self.title,
            'subtitle': self.subtitle,
            'description': self.description,
            'logo_asset_id': str(self.logo_asset_id) if self.logo_asset_id else None,
            'logo_url': self.logo_asset.get_presigned_url() if self.logo_asset else None,
            'display_order': self.display_order,
            'is_visible': self.is_visible,
        }


# --------------------------------------------------------------------------- #
# Video gallery
# --------------------------------------------------------------------------- #

class PlatformLandingVideo(db.Model):
    """Mirrors :class:`LandingVideo` for platform-owned scopes."""
    __tablename__ = 'platform_landing_videos'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='video_id')
    # Owning config row — parallel to recognitions. Lives under DRAFT /
    # PREVIEW / LIVE and travels with promote/publish.
    landing_config_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('platform_landing_configs.config_id', ondelete='CASCADE'),
        nullable=True,
    )
    scope = db.Column(
        db.Enum(PlatformLandingScope, name='platformlandingscope'),
        nullable=False, default=PlatformLandingScope.MARKETING,
    )
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    video_url = db.Column(db.String(1000), nullable=True)
    video_asset_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
        nullable=True,
    )
    thumbnail_asset_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
        nullable=True,
    )
    category = db.Column(db.String(120), nullable=True)
    display_order = db.Column(db.Integer, default=0, nullable=False)
    is_visible = db.Column(db.Boolean, default=True, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False,
    )

    video_asset = db.relationship('PageConfigAsset', foreign_keys=[video_asset_id])
    thumbnail_asset = db.relationship('PageConfigAsset', foreign_keys=[thumbnail_asset_id])

    __table_args__ = (
        db.Index('ix_platform_landing_videos_scope_cat', 'scope', 'category'),
        db.Index('ix_platform_landing_videos_config', 'landing_config_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'landing_config_id': str(self.landing_config_id) if self.landing_config_id else None,
            'scope': self.scope.value,
            'title': self.title,
            'description': self.description,
            'video_url': self.video_url,
            'video_asset_id': str(self.video_asset_id) if self.video_asset_id else None,
            'video_asset_url': (
                self.video_asset.get_presigned_url() if self.video_asset else None
            ),
            'thumbnail_asset_id': (
                str(self.thumbnail_asset_id) if self.thumbnail_asset_id else None
            ),
            'thumbnail_url': (
                self.thumbnail_asset.get_presigned_url() if self.thumbnail_asset else None
            ),
            'category': self.category,
            'display_order': self.display_order,
            'is_visible': self.is_visible,
        }
