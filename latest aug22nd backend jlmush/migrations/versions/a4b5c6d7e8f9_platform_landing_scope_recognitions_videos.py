"""Platform landing v2 — scope discriminator + recognitions + videos.

Builds on ``f3a4b5c6d7e8`` to make the platform-owner-edited landing
system feature-identical to the per-tenant landing editor. Adds:

  * ``scope`` enum column on ``platform_landing_configs`` —
    ``marketing`` (apex / larazen.in) or ``default_template`` (seed
    copied to new tenants on signup). Existing rows are backfilled to
    ``marketing``.
  * ``platform_landing_recognitions`` — certificates / awards carousel.
  * ``platform_landing_videos`` — video gallery.
  * One empty ``default_template`` config row so the editor opens
    cleanly the first time the platform owner clicks "Tenants Landing
    Page Configuration".

Revision ID: a4b5c6d7e8f9
"""
from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSON, UUID


revision = 'a4b5c6d7e8f9'
down_revision = 'f3a4b5c6d7e8'
branch_labels = None
depends_on = None


def upgrade():
    # ── 1. Create the new ``platformlandingscope`` PG enum (idempotent) ──
    op.execute(
        "DO $$ BEGIN "
        "IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platformlandingscope') THEN "
        "CREATE TYPE platformlandingscope AS ENUM ('MARKETING', 'DEFAULT_TEMPLATE'); "
        "END IF; END $$;"
    )

    scope_col = postgresql.ENUM(
        'MARKETING', 'DEFAULT_TEMPLATE',
        name='platformlandingscope', create_type=False,
    )

    # ── 2. Add ``scope`` to platform_landing_configs ────────────────
    op.add_column(
        'platform_landing_configs',
        sa.Column(
            'scope', scope_col,
            nullable=False, server_default='MARKETING',
        ),
    )
    # Existing rows (migrated from the platform tenant's per-tenant
    # landing) are the apex marketing site by definition — no UPDATE
    # needed because the server_default covers them.

    # ── 3. New table: platform_landing_recognitions ─────────────────
    op.create_table(
        'platform_landing_recognitions',
        sa.Column('recognition_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('scope', scope_col, nullable=False, server_default='MARKETING'),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('subtitle', sa.String(300), nullable=True),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column(
            'logo_asset_id', UUID(as_uuid=True),
            sa.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('display_order', sa.Integer, nullable=False, server_default='0'),
        sa.Column('is_visible', sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index(
        'ix_platform_landing_recognitions_scope',
        'platform_landing_recognitions', ['scope'],
    )

    # ── 4. New table: platform_landing_videos ───────────────────────
    op.create_table(
        'platform_landing_videos',
        sa.Column('video_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('scope', scope_col, nullable=False, server_default='MARKETING'),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('video_url', sa.String(1000), nullable=True),
        sa.Column(
            'video_asset_id', UUID(as_uuid=True),
            sa.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column(
            'thumbnail_asset_id', UUID(as_uuid=True),
            sa.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('category', sa.String(120), nullable=True),
        sa.Column('display_order', sa.Integer, nullable=False, server_default='0'),
        sa.Column('is_visible', sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.create_index(
        'ix_platform_landing_videos_scope_cat',
        'platform_landing_videos', ['scope', 'category'],
    )

    # ── 5. Seed an empty ``default_template`` row ───────────────────
    # Only insert if no row of that scope already exists (idempotent
    # in case this migration is replayed against a partially-applied DB).
    conn = op.get_bind()
    existing = conn.execute(sa.text(
        "SELECT 1 FROM platform_landing_configs "
        "WHERE scope = 'DEFAULT_TEMPLATE' LIMIT 1"
    )).first()
    if not existing:
        conn.execute(sa.text("""
            INSERT INTO platform_landing_configs (
                config_id, status, scope, version,
                hero_title, hero_subtitle, marketing_tagline, footer_text,
                theme_preset, primary_color, secondary_color, accent_color,
                background_color, hero_style,
                created_at, updated_at
            ) VALUES (
                :id, 'LIVE', 'DEFAULT_TEMPLATE', 1,
                :hero_title, :hero_subtitle, :tagline, :footer,
                'ocean', '#1976d2', '#dc004e', '#26a69a',
                '#ffffff', 'gradient',
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
        """), {
            'id': str(uuid.uuid4()),
            'hero_title': 'Welcome to your clinic',
            'hero_subtitle': (
                'Book appointments, manage records, and connect with '
                'your providers — all in one place.'
            ),
            'tagline': 'Healthcare that fits your life.',
            'footer': 'Powered by JLMush.',
        })


def downgrade():
    op.drop_index(
        'ix_platform_landing_videos_scope_cat',
        table_name='platform_landing_videos',
    )
    op.drop_table('platform_landing_videos')

    op.drop_index(
        'ix_platform_landing_recognitions_scope',
        table_name='platform_landing_recognitions',
    )
    op.drop_table('platform_landing_recognitions')

    # Strip the seeded default_template row before dropping the column.
    op.execute(
        "DELETE FROM platform_landing_configs WHERE scope = 'DEFAULT_TEMPLATE'"
    )
    op.drop_column('platform_landing_configs', 'scope')

    # Don't drop the enum type — keeping it lets a forward roll re-use it
    # without recreating; cheap.
