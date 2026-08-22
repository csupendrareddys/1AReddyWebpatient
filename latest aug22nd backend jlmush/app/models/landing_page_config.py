"""Landing-page configuration models (per-tenant, dynamic 3-level).

Structure
---------
The landing page is a tree:

    LandingConfig (root — per tenant, per status)
      └── LandingModule (dynamic; top-nav items like Startup / MCA / Compliance)
            └── LandingFeature (per-feature detail page — what-is, benefits,
                                 disadvantages, how-it-works, documents, pricing)

Lifecycle
---------
Only the ROOT (:class:`LandingConfig`) carries a ``status`` (DRAFT / PREVIEW /
LIVE / ARCHIVED) and a ``version``. Modules and features always mutate in place
on the DRAFT subtree — there is no per-sub-resource status.

**Publish is atomic at the landing level.** When an admin publishes, the whole
tree is snapshotted into :class:`LandingConfigSnapshot` as a single JSON blob
keyed by ``(tenant, version)``. History (and restore) at the module or feature
level is derived by extracting the relevant subtree from a snapshot — no extra
archived rows pile up per edit.

All rows are tenant-scoped via :class:`~app.models._base.TenantMixin` so the
existing PostgreSQL RLS policies isolate per-tenant data.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID, JSON, JSONB

from app.extensions import db
from app.models._base import TenantMixin, utcnow
from app.models._enums import ConfigStatus
from app.models.care_team import CareTeamMemberMixin


# --------------------------------------------------------------------------- #
# ROOT: LandingConfig
# --------------------------------------------------------------------------- #

class LandingConfig(TenantMixin, db.Model):
    """Root landing config — hero + theme + lifecycle.

    There are at most one row per (tenant, status) for DRAFT/PREVIEW/LIVE.
    Archived rows may accumulate but the snapshot table is the preferred audit
    trail; archived roots are mostly a paranoia copy of the root's own columns.
    """
    __tablename__ = 'landing_configs'

    # Named explicitly (rather than inherited unnamed from TenantMixin) so the
    # constraint can be dropped by name in a migration downgrade.
    tenant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey(
            'tenants.id', ondelete='CASCADE', name='landing_configs_tenant_id_fkey'
        ),
        nullable=False,
        index=True,
    )

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='config_id')
    status = db.Column(db.Enum(ConfigStatus), default=ConfigStatus.DRAFT, nullable=False, index=True)
    version = db.Column(db.Integer, default=1, nullable=False)

    # Hero block — shown at the top of the public landing page. Translatable
    # via ``translations`` below.
    hero_title = db.Column(db.String(200), nullable=True)
    hero_subtitle = db.Column(db.String(500), nullable=True)
    hero_cta_label = db.Column(db.String(100), nullable=True)
    hero_cta_href = db.Column(db.String(500), nullable=True)
    hero_image_asset_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
        nullable=True,
    )

    # Theme. ``theme_preset`` is a free-form key the frontend looks up in its
    # presets table (ocean / emerald / royal / sunset / midnight / custom). When
    # set to anything but 'custom' the frontend ignores the per-color fields
    # and uses the preset; 'custom' falls back to primary/secondary/accent.
    # How deep the public top-nav dropdown goes.
    #
    #   'three_level' — module → category → feature. Each module's features
    #                   are grouped by their ``LandingFeature.category`` into
    #                   a rail the visitor picks from.
    #   'two_level'   — module → feature. One flat list; categories are still
    #                   stored, just not used to navigate.
    #
    # Not derived from whether categories exist, which is what the nav did
    # before this column: an operator part-way through categorising a large
    # module would have had the menu change shape under them the moment the
    # first category was saved. This makes the shape a decision they make and
    # categorising a preparation for it.
    #
    # 'three_level' is the default because it degrades on its own — a module
    # with nothing categorised renders flat regardless, so the setting costs
    # an untouched tenant nothing and starts working when they categorise.
    nav_hierarchy = db.Column(
        db.String(20), default='three_level',
        server_default=db.text("'three_level'"), nullable=False,
    )

    theme_preset = db.Column(db.String(40), default='ocean')
    primary_color = db.Column(db.String(20), default='#1976d2')
    secondary_color = db.Column(db.String(20), default='#dc004e')
    accent_color = db.Column(db.String(20), default='#26a69a')
    background_color = db.Column(db.String(20), default='#ffffff')
    # Hero visual style — 'gradient' | 'solid' | 'pattern'. Cosmetic only.
    hero_style = db.Column(db.String(40), default='gradient')

    # Marketing copy
    marketing_tagline = db.Column(db.String(500), nullable=True)
    footer_text = db.Column(db.Text, nullable=True)
    meta = db.Column(JSON, nullable=True)

    # Brand + contact — surfaced in the navbar, footer, and utility
    # strip across every page rendered by ``PublicLandingLayout``.
    # Frontend falls back to a generic default when these are null
    # so existing tenants don't see broken UI before the admin
    # picks values.
    brand_name = db.Column(db.String(120), nullable=True)
    # Logo URL — rendered to the LEFT of the brand name in the navbar
    # and footer. URL rather than an asset_id reference so admins can
    # paste any CDN / S3 link without first uploading through an asset
    # picker that doesn't exist yet on the landing editor. A future
    # round can introduce a proper upload widget without a schema
    # change.
    brand_logo_url = db.Column(db.String(500), nullable=True)
    # Optional one-liner shown BELOW the brand name in the navbar /
    # footer. Empty → just the brand name renders.
    brand_sub_tagline = db.Column(db.String(200), nullable=True)
    support_email = db.Column(db.String(254), nullable=True)

    # Hero-zone trust badge (e.g. "Trusted by 10,000+ Patients"). Single
    # line — kept as a column rather than buried in ``meta`` because
    # it's prominently positioned and admins reach for it first.
    trust_badge_text = db.Column(db.String(200), nullable=True)

    # Hero body copy + search bar — the two-line block between
    # ``hero_title``/``hero_subtitle`` and the recognitions strip.
    # Admins typically reword these per-tenant ("Book your next
    # consultation" / "Search for a specialist…") so each clinic's
    # landing reads in their voice.
    hero_body_text = db.Column(db.Text, nullable=True)
    hero_search_placeholder = db.Column(db.String(200), nullable=True)

    # "Are you a doctor?" call-to-action band rendered near the end of
    # the page. Configurable copy + link; clearing the title hides the
    # whole section. ``cta_band_href`` defaults to ``/join/doctor`` on
    # the apex; tenants can point it anywhere (or leave blank to hide).
    cta_band_title = db.Column(db.String(200), nullable=True)
    cta_band_subtitle = db.Column(db.String(500), nullable=True)
    cta_band_label = db.Column(db.String(120), nullable=True)
    cta_band_href = db.Column(db.String(500), nullable=True)

    # ── Section headings (admin-editable, with frontend fallbacks) ──
    # "Why <brand>?" features section.
    why_section_title = db.Column(db.String(200), nullable=True)
    why_section_subtitle = db.Column(db.String(500), nullable=True)
    # "What Our Patients Say" testimonials carousel.
    testimonials_section_title = db.Column(db.String(200), nullable=True)
    testimonials_section_subtitle = db.Column(db.String(500), nullable=True)

    # "Popular Services" + "Browse by Category" carousel headings.
    services_section_title = db.Column(db.String(200), nullable=True)
    services_section_subtitle = db.Column(db.String(500), nullable=True)
    categories_section_title = db.Column(db.String(200), nullable=True)
    categories_section_subtitle = db.Column(db.String(500), nullable=True)

    # "Ready to start?" small CTA inside the Why-us stats panel. Same
    # hide-on-empty-title pattern as ``cta_band_*``.
    ready_cta_title = db.Column(db.String(200), nullable=True)
    ready_cta_subtitle = db.Column(db.String(500), nullable=True)
    ready_cta_label = db.Column(db.String(120), nullable=True)
    ready_cta_href = db.Column(db.String(500), nullable=True)

    # FAQ section headings + items.
    faq_section_title = db.Column(db.String(200), nullable=True)
    faq_section_subtitle = db.Column(db.String(500), nullable=True)

    # ── Repeating-row JSON arrays ───────────────────────────────────
    # Each is an editable list with no fixed schema enforcement at
    # the DB layer — the frontend renders defensively and ignores
    # rows missing required fields. Authoring is a JSON-text-area in
    # Round 1 of the editor; a row-based editor lands in a follow-up.
    #
    # ``stats``       — [{value: "10,000+", label: "Happy Patients"}, …]
    # ``testimonials``— [{quote: "…", name: "…", role: "Patient"}, …]
    # ``hero_partners`` — partner-logos band under the hero search.
    #                     [{name: "Apollo"}, {name: "AIIMS"}, …]
    # ``why_features`` — the 4-bullet "Why us" panel beside the stats.
    #                     [{title: "Certified Doctors", description: "…"}, …]
    # ``faqs``         — accordion items.
    #                     [{question: "…", answer: "…"}, …]
    stats = db.Column(JSON, nullable=True)
    testimonials = db.Column(JSON, nullable=True)
    hero_partners = db.Column(JSON, nullable=True)
    why_features = db.Column(JSON, nullable=True)
    faqs = db.Column(JSON, nullable=True)

    # ── Section visibility map ──────────────────────────────────────
    # Single JSON column keyed by stable section slug → bool. Missing
    # keys default to ``true`` (visible). Admin's Section Toggles UI
    # writes this object wholesale on every save. Recognised keys:
    #   * hero_partners, categories, services, why_us, ready_cta,
    #     videos, testimonials, faq, cta_band, doctors, reviews,
    #     brands, recognitions
    # See ``Frontend/src/pages/LandingPage/sectionVisibility.js`` for
    # the canonical list + helper.
    section_visibility = db.Column(JSON, nullable=True)

    # Section titles for the standalone collections rendered above the
    # footer. Admin-editable so each tenant can rename "Meet Our Doctors"
    # → "Meet Our Team" / "Trusted by Global Brands" → "Our Partners",
    # etc. Stored on the root config rather than per-row because the
    # title is a property of the SECTION, not of each item.
    doctors_section_title = db.Column(db.String(200), nullable=True)
    reviews_section_title = db.Column(db.String(200), nullable=True)
    brands_section_title = db.Column(db.String(200), nullable=True)

    # i18n — same shape as page_config. ``translations[field][lang] = value``.
    translations = db.Column(JSON, nullable=True, default=dict)
    published_languages = db.Column(JSON, nullable=True, default=lambda: ['en'])

    # Lifecycle timestamps
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    published_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_by_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True,
    )

    hero_image_asset = db.relationship('PageConfigAsset', foreign_keys=[hero_image_asset_id])
    created_by = db.relationship('User', foreign_keys=[created_by_id])

    modules = db.relationship(
        'LandingModule',
        backref='config',
        cascade='all, delete-orphan',
        order_by='LandingModule.display_order',
    )

    __table_args__ = (
        db.Index('ix_landing_configs_tenant_status', 'tenant_id', 'status'),
    )

    def to_dict(self, include_modules=False, include_asset_urls=False):
        data = {
            'id': str(self.id),
            'status': self.status.value,
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
            'footer_text': self.footer_text,
            'meta': self.meta or {},
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
            'doctors_section_title': self.doctors_section_title,
            'reviews_section_title': self.reviews_section_title,
            'brands_section_title': self.brands_section_title,
            'translations': self.translations or {},
            'published_languages': self.published_languages or ['en'],
            'published_at': self.published_at.isoformat() if self.published_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_asset_urls:
            data['hero_image_url'] = (
                self.hero_image_asset.get_presigned_url() if self.hero_image_asset else None
            )
        if include_modules:
            data['modules'] = [m.to_dict(include_features=True) for m in self.modules]
        return data

    def __repr__(self):
        return f"<LandingConfig v{self.version} [{self.status.value}]>"


# --------------------------------------------------------------------------- #
# LEVEL 2: LandingModule
# --------------------------------------------------------------------------- #

class LandingModule(TenantMixin, db.Model):
    """A dynamic top-nav module (Startup / MCA / Compliance / etc).

    Visible in the public landing header, each one groups a list of features.
    The module page itself is a card grid + FAQ; the card grid renders the
    module's features.
    """
    __tablename__ = 'landing_modules'

    tenant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey(
            'tenants.id', ondelete='CASCADE', name='landing_modules_tenant_id_fkey'
        ),
        nullable=False,
        index=True,
    )

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='module_id')
    landing_config_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('landing_configs.config_id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )

    slug = db.Column(db.String(120), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    icon_key = db.Column(db.String(100), nullable=True)
    description = db.Column(db.Text, nullable=True)

    # Optional uploaded logo. Reuses the existing ``page_config_assets`` table
    # so admins use the same upload flow they already know for hero images.
    # The public ``to_dict`` exposes a presigned URL under ``logo_url`` so
    # callers don't need to know about asset IDs.
    logo_asset_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
        nullable=True,
    )

    display_order = db.Column(db.Integer, default=0, nullable=False)
    is_visible = db.Column(db.Boolean, default=True, nullable=False)
    is_additional = db.Column(db.Boolean, default=False, nullable=False)
    # Show this module in the public landing "featured slider" (the third
    # sliding bar). Admin-toggled from the landing config; each slide links
    # to the module's own page. Independent of is_visible / is_additional.
    show_in_slider = db.Column(
        db.Boolean, default=False, server_default=db.text('false'),
        nullable=False,
    )


    # ``faq`` = [{question, answer}]. Shape kept JSON so admins can reorder
    # without DDL churn; q/a values are translatable.
    faq_json = db.Column(JSON, nullable=True, default=list)
    vid_json = db.Column(JSONB, nullable=True)
    img_json = db.Column(JSONB, nullable=True)


    # Which sections of the module-page layout to render. Mirrors the feature
    # level pattern so admins can hide, say, the FAQ strip on a specific module.
    sections_enabled_json = db.Column(
        JSON, nullable=True,
        default=lambda: {'hero': True, 'features_grid': True, 'faq': True},
    )

    translations = db.Column(JSON, nullable=True, default=dict)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    logo_asset = db.relationship('PageConfigAsset', foreign_keys=[logo_asset_id])

    features = db.relationship(
        'LandingFeature',
        backref='module',
        cascade='all, delete-orphan',
        order_by='LandingFeature.display_order',
    )

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'landing_config_id', 'slug', name='uq_landing_module_tenant_slug'),
        db.Index('ix_landing_modules_tenant_config', 'tenant_id', 'landing_config_id'),
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
            'vid_json': self.vid_json or {},
            'img_json': self.img_json or {},
            'sections_enabled_json': (
                self.sections_enabled_json or {'hero': True, 'features_grid': True, 'faq': True}
            ),
            'translations': self.translations or {},
        }
        if include_features:
            data['features'] = [f.to_dict() for f in self.features]
        return data

    def __repr__(self):
        return f"<LandingModule {self.slug} of config={self.landing_config_id}>"


# --------------------------------------------------------------------------- #
# LEVEL 3: LandingFeature
# --------------------------------------------------------------------------- #

class LandingFeature(TenantMixin, db.Model):
    """One feature (e.g. "Proprietorship Registration") under a module.

    Fixed page structure — admin toggles sections on/off via
    :attr:`sections_enabled_json` but cannot change the layout. All text fields
    are translatable via :attr:`translations`.
    """
    __tablename__ = 'landing_features'

    tenant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey(
            'tenants.id', ondelete='CASCADE', name='landing_features_tenant_id_fkey'
        ),
        nullable=False,
        index=True,
    )

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='feature_id')
    module_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('landing_modules.module_id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )

    slug = db.Column(db.String(120), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)

    # The grouping this feature sits in WITHIN its module — the middle level of
    # the public nav's three (module → category → feature). A plain label, not
    # a row in a table of its own: a category has no page, no slug and no
    # settings, it exists only to break a module's feature list into readable
    # columns, and an admin creates one by naming it on a feature.
    #
    # Ordering falls out of ``display_order``: categories appear in the order
    # their first feature does, so the one control an admin already uses to
    # order features also orders the groups. Blank is fine and common — the
    # nav renders a module with no categorised features exactly as it did
    # before, as one flat list.
    category = db.Column(db.String(120), nullable=True)

    # Optional uploaded logo for this feature, mirroring LandingModule.
    logo_asset_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
        nullable=True,
    )

    # Pricing + timeline + rating
    starting_price = db.Column(db.String(50), nullable=True)
    timeline = db.Column(db.String(100), nullable=True)
    rating = db.Column(db.String(20), nullable=True)  # e.g. "4.8/5" — free-form to match existing UI

    # Long-form content
    what_is = db.Column(db.Text, nullable=True)

    # List-of-strings
    requirements = db.Column(JSON, nullable=True, default=list)
    documents = db.Column(JSON, nullable=True, default=list)
    benefits = db.Column(JSON, nullable=True, default=list)       # was ``pros`` in v1
    disadvantages = db.Column(JSON, nullable=True, default=list)  # was ``cons`` in v1

    # List-of-{title, desc}
    process = db.Column(JSON, nullable=True, default=list)
    # "Who Should Join the Program" personas, "What's Included" deliverables
    # and "Expected Outcome" results. Same {title, desc} shape as ``process``;
    # each toggles via its own sections_enabled_json key.
    who_should_join = db.Column(JSON, nullable=True, default=list)
    whats_included = db.Column(JSON, nullable=True, default=list)
    expected_outcomes = db.Column(JSON, nullable=True, default=list)

    # Book CTA label — the page always has a "Book Now" button; toggle via
    # sections_enabled_json['book_now'].
    book_cta_label = db.Column(db.String(100), default='Book Now', nullable=True)

    # The bookable product this landing feature markets. When set, the feature's
    # "Book Now" redirects to this service/product (and its care_team doctors are
    # the team that fulfils it). Nullable — a feature can be purely informational.
    product_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctor_products.product_id', ondelete='SET NULL',
                      name='landing_features_product_id_fkey'),
        nullable=True, index=True,
    )

    # Section on/off toggles. Default is everything ON. Admin-driven.
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
    faq_json = db.Column(JSONB, nullable=True, default=list)
    vid_json = db.Column(JSONB, nullable=True)
    img_json = db.Column(JSONB, nullable=True)

    # Back-office "product & provider linking" — records which offering
    # (a consultation type / service / group offering), which product, and
    # which teams/doctors this feature routes to. This is NOT rendered on the
    # public page (unlike ``care_team``); it is routing/config data only.
    # Row shape: [{offering, product_id, provider_name, doctor_id|team_id,
    #             team_members[], display_order}].
    product_links_json = db.Column(JSONB, nullable=True, default=list)


    translations = db.Column(JSON, nullable=True, default=dict)

    display_order = db.Column(db.Integer, default=0, nullable=False)
    is_visible = db.Column(db.Boolean, default=True, nullable=False)
    # Show this service/feature in the public landing "featured slider" (the
    # third sliding bar). Admin-toggled from the landing config; each slide
    # links to the feature's own /service/<slug> page.
    show_in_slider = db.Column(
        db.Boolean, default=False, server_default=db.text('false'),
        nullable=False,
    )

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    logo_asset = db.relationship('PageConfigAsset', foreign_keys=[logo_asset_id])
    # The bookable product this feature links to (for the "Book Now" redirect).
    product = db.relationship('DoctorProduct', foreign_keys=[product_id])

    # "Our care team" — admin-picked doctors shown on this feature page.
    care_team = db.relationship(
        'FeatureDoctor',
        backref='feature',
        cascade='all, delete-orphan',
        order_by='FeatureDoctor.display_order',
        lazy='selectin',
    )

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'module_id', 'slug', name='uq_landing_feature_tenant_slug'),
        db.Index('ix_landing_features_tenant_module', 'tenant_id', 'module_id'),
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
            # Linked bookable product (for the Book Now redirect + linking UIs).
            'product_id': str(self.product_id) if self.product_id else None,
            'product_name': self.product.name if self.product else None,
            'product_min_price': str(self.product.min_price) if self.product else None,
            'product_max_price': str(self.product.max_price) if self.product else None,
            'sections_enabled_json': (
                self.sections_enabled_json or {
                    'what_is': True, 'eligibility': True,
                    'who_should_join': True, 'whats_included': True,
                    'benefits': True, 'disadvantages': True, 'expected_outcomes': True,
                    'how_it_works': True, 'documents': True,
                    'pricing': True, 'rating': True, 'book_now': True,
                }
            ),
            'faq_json': self.faq_json or [],
            'vid_json': self.vid_json or {},
            'img_json': self.img_json or {},
            'translations': self.translations or {},
            'display_order': self.display_order,
            'is_visible': self.is_visible,
            'show_in_slider': self.show_in_slider,
            'care_team': [d.to_dict() for d in self.care_team],
            # Back-office routing data — never rendered on the public page.
            'product_links_json': self.product_links_json or [],
        }

    def __repr__(self):
        return f"<LandingFeature {self.slug} of module={self.module_id}>"


# --------------------------------------------------------------------------- #
# FeatureDoctor — the "care team" strip on a feature page
# --------------------------------------------------------------------------- #

class FeatureDoctor(CareTeamMemberMixin, TenantMixin, db.Model):
    """One doctor pinned to a feature page's "Our care team" section.

    A link row, not a copy: the doctor's name / photo / experience / languages
    / city / work qualification are always read live from ``doctors`` (and its
    satellites) at serialization time, so editing a doctor profile is
    immediately reflected on every feature page they appear on. The only thing
    stored here is *what the admin chose to reveal* — one boolean per field —
    plus a per-feature ``description`` blurb the admin writes by hand.

    Booleans default to False (opt-in): adding a doctor to the team shows just
    their name until the admin flips the fields they want on.
    """
    __tablename__ = 'feature_doctors'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    feature_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('landing_features.feature_id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    # A real FK — one row per (feature, doctor), so "multiple doctors" is
    # expressed as multiple rows rather than an array column. That keeps the
    # per-doctor toggles/description addressable and lets the DB cascade the
    # link away when a doctor is deleted.
    # Nullable now that a care-team row can pin a whole TEAM instead of a single
    # doctor (group offerings are delivered by a team). Exactly one of
    # ``doctor_id`` / ``team_id`` is set per row.
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True,
        index=True,
    )
    # A team pinned as a unit (group offering). Mutually exclusive with
    # ``doctor_id``; the team's members are read live at serialization time.
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

    # Hand-written blurb for this doctor on this feature page.
    description = db.Column(db.Text, nullable=True)

    display_order = db.Column(db.Integer, default=0, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    doctor = db.relationship('Doctor', foreign_keys=[doctor_id], lazy='selectin')
    team = db.relationship('MarketplaceServiceGroup', foreign_keys=[team_id], lazy='selectin')
    # ProfileAbout hangs off doctor_id but Doctor has no relationship to it,
    # so join it here directly (read-only) to get work_qualification without a
    # per-row query.
    about = db.relationship(
        'ProfileAbout',
        primaryjoin='foreign(ProfileAbout.doctor_id) == FeatureDoctor.doctor_id',
        viewonly=True, uselist=False, lazy='selectin',
    )

    __table_args__ = (
        db.UniqueConstraint('feature_id', 'doctor_id', name='uq_feature_doctor'),
        db.UniqueConstraint('feature_id', 'team_id', name='uq_feature_team'),
        db.Index('ix_feature_doctors_tenant_feature', 'tenant_id', 'feature_id'),
    )

    def __repr__(self):
        return f"<FeatureDoctor feature={self.feature_id} doctor={self.doctor_id}>"


# --------------------------------------------------------------------------- #
# LandingConfigSnapshot (version history)
# --------------------------------------------------------------------------- #

class LandingConfigSnapshot(TenantMixin, db.Model):
    """Immutable frozen copy of the full landing tree at one publish.

    Written exactly once — when ``LandingConfigService.publish`` fires. Used
    for:
      * the History tab at landing / module / feature levels (extract subtree
        by module id or feature slug from ``tree_json``),
      * ``restore`` actions that copy a subtree back into the current DRAFT.
    """
    __tablename__ = 'landing_config_snapshots'

    tenant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey(
            'tenants.id', ondelete='CASCADE', name='landing_config_snapshots_tenant_id_fkey'
        ),
        nullable=False,
        index=True,
    )

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='snapshot_id')
    landing_config_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('landing_configs.config_id', ondelete='SET NULL'),
        nullable=True,
    )
    version = db.Column(db.Integer, nullable=False)

    # Whole tree as JSON: root fields + modules (each with features embedded).
    tree_json = db.Column(JSON, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    created_by_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True,
    )
    note = db.Column(db.Text, nullable=True)

    __table_args__ = (
        db.Index('ix_landing_snapshots_tenant_version', 'tenant_id', 'version'),
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
# LandingRecognition — accreditations / certifications carousel
# --------------------------------------------------------------------------- #
#
# Standalone tenant-scoped collection (NOT under the LandingConfig draft /
# preview / live lifecycle). Admins edit and changes go live immediately —
# this is the lighter-weight pattern requested for the carousel; the heavier
# lifecycle is reserved for hero + modules + features which roll up into
# atomic publish / snapshot.

class LandingRecognition(TenantMixin, db.Model):
    """A single recognition / certification item rendered in the landing-page
    carousel directly below the hero.

    ``logo_asset_id`` reuses the existing ``page_config_assets`` upload flow
    so admins use the same UX they already know for hero images and module
    logos. ``description`` is short marketing copy shown under the title.
    """
    __tablename__ = 'landing_recognitions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='recognition_id')
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
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    logo_asset = db.relationship('PageConfigAsset', foreign_keys=[logo_asset_id])

    # Indexing on ``tenant_id`` alone is already provided by ``TenantMixin``
    # (declares ``index=True`` on the column → SQLAlchemy auto-creates
    # ``ix_landing_recognitions_tenant_id``). No additional ``__table_args__``
    # indexes are needed here.

    def to_dict(self):
        return {
            'id': str(self.id),
            'title': self.title,
            'subtitle': self.subtitle,
            'description': self.description,
            'logo_asset_id': str(self.logo_asset_id) if self.logo_asset_id else None,
            'logo_url': self.logo_asset.get_presigned_url() if self.logo_asset else None,
            'display_order': self.display_order,
            'is_visible': self.is_visible,
        }


# --------------------------------------------------------------------------- #
# LandingVideo — video gallery (homepage strip + dedicated /gallery/videos)
# --------------------------------------------------------------------------- #
#
# Each video can be sourced from EITHER an external URL (YouTube / Vimeo /
# direct mp4) OR an uploaded asset. The frontend resolves whichever is
# present, preferring the uploaded asset when both are set so the admin can
# replace an external embed with a self-hosted file without editing the URL.

class LandingVideo(TenantMixin, db.Model):
    """A single video in the landing-page gallery.

    The landing page renders the first ``N`` visible videos (default 3) and
    shows a "More" CTA when ``count > N`` linking to ``/gallery/videos`` —
    the dedicated public gallery page where every visible video is grouped
    by ``category`` (when set).
    """
    __tablename__ = 'landing_videos'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='video_id')
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    # External URL (YouTube / Vimeo / direct mp4). Either this OR
    # ``video_asset_id`` should be set; the frontend prefers the asset when
    # both exist.
    video_url = db.Column(db.String(1000), nullable=True)
    video_asset_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
        nullable=True,
    )
    # Optional poster image. Falls back to a video-frame extraction or a
    # generic thumbnail on the frontend when null.
    thumbnail_asset_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
        nullable=True,
    )
    # Optional grouping for the dedicated gallery page. When set, the gallery
    # renders one section per distinct category. Empty / null means
    # "uncategorised" and goes into a single default group.
    category = db.Column(db.String(120), nullable=True)
    display_order = db.Column(db.Integer, default=0, nullable=False)
    is_visible = db.Column(db.Boolean, default=True, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    video_asset = db.relationship('PageConfigAsset', foreign_keys=[video_asset_id])
    thumbnail_asset = db.relationship('PageConfigAsset', foreign_keys=[thumbnail_asset_id])

    # ``tenant_id`` alone is already indexed by ``TenantMixin`` (auto
    # ``ix_landing_videos_tenant_id``). The composite below is the
    # gallery-page lookup path (group videos by category within one
    # tenant) and is genuinely useful.
    __table_args__ = (
        db.Index('ix_landing_videos_tenant_category', 'tenant_id', 'category'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'title': self.title,
            'description': self.description,
            'video_url': self.video_url,
            'video_asset_id': str(self.video_asset_id) if self.video_asset_id else None,
            'video_asset_url': self.video_asset.get_presigned_url() if self.video_asset else None,
            'thumbnail_asset_id': str(self.thumbnail_asset_id) if self.thumbnail_asset_id else None,
            'thumbnail_url': self.thumbnail_asset.get_presigned_url() if self.thumbnail_asset else None,
            'category': self.category,
            'display_order': self.display_order,
            'is_visible': self.is_visible,
        }


# --------------------------------------------------------------------------- #
# LandingDoctor — "Meet our doctors" carousel
# --------------------------------------------------------------------------- #
#
# Standalone tenant-scoped collection rendered as a slow carousel above the
# Reviews section on the public landing page. Edits go live immediately —
# same lightweight lifecycle as Recognitions / Videos.

class LandingDoctor(TenantMixin, db.Model):
    __tablename__ = 'landing_doctors'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='doctor_id')
    name = db.Column(db.String(200), nullable=False)
    specialty = db.Column(db.String(200), nullable=True)
    qualifications = db.Column(db.String(300), nullable=True)
    bio = db.Column(db.Text, nullable=True)
    photo_asset_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
        nullable=True,
    )
    display_order = db.Column(db.Integer, default=0, nullable=False)
    is_visible = db.Column(db.Boolean, default=True, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    photo_asset = db.relationship('PageConfigAsset', foreign_keys=[photo_asset_id])

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'specialty': self.specialty,
            'qualifications': self.qualifications,
            'bio': self.bio,
            'photo_asset_id': str(self.photo_asset_id) if self.photo_asset_id else None,
            'photo_url': self.photo_asset.get_presigned_url() if self.photo_asset else None,
            'display_order': self.display_order,
            'is_visible': self.is_visible,
        }


# --------------------------------------------------------------------------- #
# LandingReview — "What our clients say" reviews carousel (Play-Store style)
# --------------------------------------------------------------------------- #
#
# Each review is one card in a revolving carousel above the brands strip.

class LandingReview(TenantMixin, db.Model):
    __tablename__ = 'landing_reviews'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='review_id')
    reviewer_name = db.Column(db.String(200), nullable=False)
    reviewer_role = db.Column(db.String(200), nullable=True)
    rating = db.Column(db.Integer, nullable=True)  # 1–5; null means "no star rating"
    content = db.Column(db.Text, nullable=False)
    avatar_asset_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
        nullable=True,
    )
    display_order = db.Column(db.Integer, default=0, nullable=False)
    is_visible = db.Column(db.Boolean, default=True, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    avatar_asset = db.relationship('PageConfigAsset', foreign_keys=[avatar_asset_id])

    def to_dict(self):
        return {
            'id': str(self.id),
            'reviewer_name': self.reviewer_name,
            'reviewer_role': self.reviewer_role,
            'rating': self.rating,
            'content': self.content,
            'avatar_asset_id': str(self.avatar_asset_id) if self.avatar_asset_id else None,
            'avatar_url': self.avatar_asset.get_presigned_url() if self.avatar_asset else None,
            'display_order': self.display_order,
            'is_visible': self.is_visible,
        }


# --------------------------------------------------------------------------- #
# LandingTrustedBrand — "Trusted by Global Brands" logo carousel
# --------------------------------------------------------------------------- #
#
# Logo-only sliding strip immediately above the footer. Each row is a
# brand logo + an optional click-through URL.

class LandingTrustedBrand(TenantMixin, db.Model):
    __tablename__ = 'landing_trusted_brands'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='brand_id')
    name = db.Column(db.String(200), nullable=False)  # alt text + admin-side label
    logo_asset_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
        nullable=True,
    )
    link_url = db.Column(db.String(1000), nullable=True)
    display_order = db.Column(db.Integer, default=0, nullable=False)
    is_visible = db.Column(db.Boolean, default=True, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    logo_asset = db.relationship('PageConfigAsset', foreign_keys=[logo_asset_id])

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'logo_asset_id': str(self.logo_asset_id) if self.logo_asset_id else None,
            'logo_url': self.logo_asset.get_presigned_url() if self.logo_asset else None,
            'link_url': self.link_url,
            'display_order': self.display_order,
            'is_visible': self.is_visible,
        }


# --------------------------------------------------------------------------- #
# TenantPermissionAllocation — preserved (platform-owner gating UI still uses it)
# --------------------------------------------------------------------------- #

class TenantPermissionAllocation(TenantMixin, db.Model):
    """Which landing-related modules (and which actions) the PLATFORM_OWNER
    has allocated to a given tenant's super-admin. Platform-owner UI toggles
    rows here; backend decorators consult the table as a gate-before-gate
    alongside the standard RBAC check.
    """
    __tablename__ = 'tenant_permission_allocations'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    module = db.Column(db.String(100), nullable=False)  # PermissionModule.value
    action = db.Column(db.String(50), nullable=False)   # PermissionAction.value
    allowed = db.Column(db.Boolean, default=True, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    allocated_by_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True,
    )

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'module', 'action', name='uq_tenant_perm_alloc'),
        db.Index('ix_tenant_perm_alloc_tenant', 'tenant_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'tenant_id': str(self.tenant_id),
            'module': self.module,
            'action': self.action,
            'allowed': self.allowed,
            'allocated_by_id': str(self.allocated_by_id) if self.allocated_by_id else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
