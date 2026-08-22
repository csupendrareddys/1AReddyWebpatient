"""Platform marketing landing — schema separation from per-tenant landing.

Background
----------
Until now, the platform's marketing landing (rendered at the apex
``larazen.in``) and each tenant's clinic-portal landing (rendered at
``<slug>.larazen.in``) shared the same ``landing_*`` tables, distinguished
only by ``tenant_id``. Conceptually they're different products: tenants
edit a clinic-facing site; the platform owner edits a marketing site.

This migration physically separates them:

  * Creates ``platform_landing_configs`` / ``_modules`` / ``_features`` /
    ``_config_snapshots`` — same column shape as their tenant
    counterparts, but **without** ``tenant_id`` (no TenantMixin, no RLS).
  * Copies every ``landing_*`` row owned by the default (``platform``)
    tenant into the new tables, preserving primary keys so the editor
    can keep using existing IDs.
  * Leaves the ``landing_*`` rows for the platform tenant in place
    (idempotent rollback / safety net). A future cleanup migration can
    delete them once the new editor is in production.

Revision ID: f3a4b5c6d7e8
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSON, UUID


revision = 'f3a4b5c6d7e8'
down_revision = 'e1f2a3b4c5d6'
branch_labels = None
depends_on = None


def _create_table(name, *cols, **kwargs):
    """Helper that swallows the ``configstatus`` enum (already created by an
    earlier migration) — we just reference it without recreating."""
    op.create_table(name, *cols, **kwargs)


def upgrade():
    # Reuse the existing ``configstatus`` enum that the per-tenant landing
    # tables already use — declared with ``create_type=False`` so SQLAlchemy
    # doesn't try to recreate it. ``postgresql.ENUM`` (dialect-specific) is
    # the form Alembic respects on ``create_table``; the generic ``sa.Enum``
    # path bypasses ``create_type=False`` in some older SQLAlchemy versions.
    config_status_enum = postgresql.ENUM(
        'DRAFT', 'PREVIEW', 'LIVE', 'ARCHIVED',
        name='configstatus', create_type=False,
    )

    # ── platform_landing_configs ────────────────────────────────────
    op.create_table(
        'platform_landing_configs',
        sa.Column('config_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('status', config_status_enum, nullable=False, server_default='DRAFT'),
        sa.Column('version', sa.Integer, nullable=False, server_default='1'),
        # Hero
        sa.Column('hero_title', sa.String(200), nullable=True),
        sa.Column('hero_subtitle', sa.String(500), nullable=True),
        sa.Column('hero_cta_label', sa.String(100), nullable=True),
        sa.Column('hero_cta_href', sa.String(500), nullable=True),
        sa.Column(
            'hero_image_asset_id', UUID(as_uuid=True),
            sa.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
            nullable=True,
        ),
        # Theme
        sa.Column('theme_preset', sa.String(40), server_default='ocean'),
        sa.Column('primary_color', sa.String(20), server_default='#1976d2'),
        sa.Column('secondary_color', sa.String(20), server_default='#dc004e'),
        sa.Column('accent_color', sa.String(20), server_default='#26a69a'),
        sa.Column('background_color', sa.String(20), server_default='#ffffff'),
        sa.Column('hero_style', sa.String(40), server_default='gradient'),
        # Copy
        sa.Column('marketing_tagline', sa.String(500), nullable=True),
        sa.Column('footer_text', sa.Text, nullable=True),
        sa.Column('meta', JSON, nullable=True),
        # i18n
        sa.Column('translations', JSON, nullable=True),
        sa.Column('published_languages', JSON, nullable=True),
        # Lifecycle
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'),
                  nullable=True),
    )
    op.create_index(
        'ix_platform_landing_configs_status',
        'platform_landing_configs', ['status'],
    )

    # ── platform_landing_modules ────────────────────────────────────
    op.create_table(
        'platform_landing_modules',
        sa.Column('module_id', UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'landing_config_id', UUID(as_uuid=True),
            sa.ForeignKey('platform_landing_configs.config_id', ondelete='CASCADE'),
            nullable=False, index=True,
        ),
        sa.Column('slug', sa.String(120), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('icon_key', sa.String(100), nullable=True),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column(
            'logo_asset_id', UUID(as_uuid=True),
            sa.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('display_order', sa.Integer, nullable=False, server_default='0'),
        sa.Column('is_visible', sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column('faq_json', JSON, nullable=True),
        sa.Column('sections_enabled_json', JSON, nullable=True),
        sa.Column('translations', JSON, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint(
            'landing_config_id', 'slug',
            name='uq_platform_landing_module_slug',
        ),
    )
    op.create_index(
        'ix_platform_landing_modules_config',
        'platform_landing_modules', ['landing_config_id'],
    )

    # ── platform_landing_features ───────────────────────────────────
    op.create_table(
        'platform_landing_features',
        sa.Column('feature_id', UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'module_id', UUID(as_uuid=True),
            sa.ForeignKey('platform_landing_modules.module_id', ondelete='CASCADE'),
            nullable=False, index=True,
        ),
        sa.Column('slug', sa.String(120), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column(
            'logo_asset_id', UUID(as_uuid=True),
            sa.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('starting_price', sa.String(50), nullable=True),
        sa.Column('timeline', sa.String(100), nullable=True),
        sa.Column('rating', sa.String(20), nullable=True),
        sa.Column('what_is', sa.Text, nullable=True),
        sa.Column('requirements', JSON, nullable=True),
        sa.Column('documents', JSON, nullable=True),
        sa.Column('benefits', JSON, nullable=True),
        sa.Column('disadvantages', JSON, nullable=True),
        sa.Column('process', JSON, nullable=True),
        sa.Column('book_cta_label', sa.String(100), server_default='Book Now'),
        sa.Column('sections_enabled_json', JSON, nullable=True),
        sa.Column('translations', JSON, nullable=True),
        sa.Column('display_order', sa.Integer, nullable=False, server_default='0'),
        sa.Column('is_visible', sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint(
            'module_id', 'slug',
            name='uq_platform_landing_feature_slug',
        ),
    )
    op.create_index(
        'ix_platform_landing_features_module',
        'platform_landing_features', ['module_id'],
    )

    # ── platform_landing_config_snapshots ───────────────────────────
    op.create_table(
        'platform_landing_config_snapshots',
        sa.Column('snapshot_id', UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'landing_config_id', UUID(as_uuid=True),
            sa.ForeignKey('platform_landing_configs.config_id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('version', sa.Integer, nullable=False),
        sa.Column('tree_json', JSON, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('created_by_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('note', sa.Text, nullable=True),
    )
    op.create_index(
        'ix_platform_landing_snapshots_version',
        'platform_landing_config_snapshots', ['version'],
    )

    # ── Data migration: copy platform-tenant rows into the new tables ──
    # Preserves primary keys so any downstream reference (e.g. a manually
    # cached config_id in a deploy script) keeps working.
    conn = op.get_bind()

    conn.execute(sa.text("""
        INSERT INTO platform_landing_configs (
            config_id, status, version,
            hero_title, hero_subtitle, hero_cta_label, hero_cta_href,
            hero_image_asset_id,
            theme_preset, primary_color, secondary_color, accent_color,
            background_color, hero_style,
            marketing_tagline, footer_text, meta,
            translations, published_languages,
            created_at, updated_at, published_at, created_by_id
        )
        SELECT
            lc.config_id, lc.status, lc.version,
            lc.hero_title, lc.hero_subtitle, lc.hero_cta_label, lc.hero_cta_href,
            lc.hero_image_asset_id,
            lc.theme_preset, lc.primary_color, lc.secondary_color, lc.accent_color,
            lc.background_color, lc.hero_style,
            lc.marketing_tagline, lc.footer_text, lc.meta,
            lc.translations, lc.published_languages,
            lc.created_at, lc.updated_at, lc.published_at, lc.created_by_id
        FROM landing_configs lc
        JOIN tenants t ON t.id = lc.tenant_id
        WHERE t.is_default = true
        ON CONFLICT (config_id) DO NOTHING
    """))

    conn.execute(sa.text("""
        INSERT INTO platform_landing_modules (
            module_id, landing_config_id, slug, name, icon_key, description,
            logo_asset_id, display_order, is_visible,
            faq_json, sections_enabled_json, translations,
            created_at, updated_at
        )
        SELECT
            lm.module_id, lm.landing_config_id, lm.slug, lm.name,
            lm.icon_key, lm.description,
            lm.logo_asset_id, lm.display_order, lm.is_visible,
            lm.faq_json, lm.sections_enabled_json, lm.translations,
            lm.created_at, lm.updated_at
        FROM landing_modules lm
        JOIN tenants t ON t.id = lm.tenant_id
        WHERE t.is_default = true
        ON CONFLICT (module_id) DO NOTHING
    """))

    conn.execute(sa.text("""
        INSERT INTO platform_landing_features (
            feature_id, module_id, slug, title, description,
            logo_asset_id,
            starting_price, timeline, rating, what_is,
            requirements, documents, benefits, disadvantages, process,
            book_cta_label, sections_enabled_json, translations,
            display_order, is_visible,
            created_at, updated_at
        )
        SELECT
            lf.feature_id, lf.module_id, lf.slug, lf.title, lf.description,
            lf.logo_asset_id,
            lf.starting_price, lf.timeline, lf.rating, lf.what_is,
            lf.requirements, lf.documents, lf.benefits, lf.disadvantages, lf.process,
            lf.book_cta_label, lf.sections_enabled_json, lf.translations,
            lf.display_order, lf.is_visible,
            lf.created_at, lf.updated_at
        FROM landing_features lf
        JOIN landing_modules lm ON lm.module_id = lf.module_id
        JOIN tenants t ON t.id = lm.tenant_id
        WHERE t.is_default = true
        ON CONFLICT (feature_id) DO NOTHING
    """))

    # Snapshots are bulky and only used for the audit-trail UI; copy them
    # so the platform owner sees their existing publish history in the
    # new editor's History tab.
    conn.execute(sa.text("""
        INSERT INTO platform_landing_config_snapshots (
            snapshot_id, landing_config_id, version, tree_json,
            created_at, created_by_id, note
        )
        SELECT
            lcs.snapshot_id, lcs.landing_config_id, lcs.version, lcs.tree_json,
            lcs.created_at, lcs.created_by_id, lcs.note
        FROM landing_config_snapshots lcs
        JOIN tenants t ON t.id = lcs.tenant_id
        WHERE t.is_default = true
        ON CONFLICT (snapshot_id) DO NOTHING
    """))


def downgrade():
    op.drop_index('ix_platform_landing_snapshots_version',
                  table_name='platform_landing_config_snapshots')
    op.drop_table('platform_landing_config_snapshots')
    op.drop_index('ix_platform_landing_features_module',
                  table_name='platform_landing_features')
    op.drop_table('platform_landing_features')
    op.drop_index('ix_platform_landing_modules_config',
                  table_name='platform_landing_modules')
    op.drop_table('platform_landing_modules')
    op.drop_index('ix_platform_landing_configs_status',
                  table_name='platform_landing_configs')
    op.drop_table('platform_landing_configs')
