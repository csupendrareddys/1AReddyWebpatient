"""Landing page: doctors / reviews / trusted-brands carousels.

Adds three more tenant-scoped collection tables that sit alongside the
existing recognitions / videos collections, and three optional section-
title columns on ``landing_configs`` so admins can rename each section's
heading per-tenant.

Tables
------
  * ``landing_doctors``        — "Meet our doctors" carousel.
  * ``landing_reviews``        — Play-Store-style review cards carousel.
  * ``landing_trusted_brands`` — Logo-only carousel above the footer.

Columns added on ``landing_configs``
------------------------------------
  * ``doctors_section_title``  — defaults to "Meet our doctors" if NULL.
  * ``reviews_section_title``  — defaults to "What our clients say".
  * ``brands_section_title``   — defaults to "Trusted by global brands".

Each row reuses the existing ``page_config_assets`` upload flow via
``photo_asset_id`` / ``avatar_asset_id`` / ``logo_asset_id`` FKs.

Revision ID: d0e1f2a3b4c5
Revises: a4b5c6d7e8f9
Create Date: 2026-04-28

Note on parentage: originally chained off ``c9d0e1f2a3b4`` (recognitions
/ videos). The pricing-addons-v2 → platform-landing-separation →
platform-landing-scope chain was added on a parallel branch with the
same down_revision, producing two heads. Re-parented to descend from
``a4b5c6d7e8f9`` (the latest leaf of the parallel chain) so the tree
stays linear. The tables created here (``landing_doctors``,
``landing_reviews``, ``landing_trusted_brands``) do not overlap with
anything in the parallel chain — they're new tenant-scoped
collections.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'd0e1f2a3b4c5'
down_revision = 'a4b5c6d7e8f9'
branch_labels = None
depends_on = None


def upgrade():
    # ── Section-title columns on landing_configs ──────────────────────
    # Nullable so existing rows don't need backfilling — the frontend
    # falls back to a sensible default when the value is null.
    op.add_column(
        'landing_configs',
        sa.Column('doctors_section_title', sa.String(length=200), nullable=True),
    )
    op.add_column(
        'landing_configs',
        sa.Column('reviews_section_title', sa.String(length=200), nullable=True),
    )
    op.add_column(
        'landing_configs',
        sa.Column('brands_section_title', sa.String(length=200), nullable=True),
    )

    # ── landing_doctors ───────────────────────────────────────────────
    op.create_table(
        'landing_doctors',
        sa.Column('doctor_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('specialty', sa.String(length=200), nullable=True),
        sa.Column('qualifications', sa.String(length=300), nullable=True),
        sa.Column('bio', sa.Text(), nullable=True),
        sa.Column('photo_asset_id', UUID(as_uuid=True), nullable=True),
        sa.Column('display_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_visible', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(
            ['tenant_id'], ['tenants.id'],
            ondelete='CASCADE', name='fk_landing_doctors_tenant',
        ),
        sa.ForeignKeyConstraint(
            ['photo_asset_id'], ['page_config_assets.asset_id'],
            ondelete='SET NULL', name='fk_landing_doctors_photo_asset',
        ),
    )

    # ── landing_reviews ───────────────────────────────────────────────
    op.create_table(
        'landing_reviews',
        sa.Column('review_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('reviewer_name', sa.String(length=200), nullable=False),
        sa.Column('reviewer_role', sa.String(length=200), nullable=True),
        # 1–5 inclusive when set; null means "no star rating displayed".
        sa.Column('rating', sa.Integer(), nullable=True),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('avatar_asset_id', UUID(as_uuid=True), nullable=True),
        sa.Column('display_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_visible', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.CheckConstraint(
            'rating IS NULL OR (rating BETWEEN 1 AND 5)',
            name='ck_landing_reviews_rating_range',
        ),
        sa.ForeignKeyConstraint(
            ['tenant_id'], ['tenants.id'],
            ondelete='CASCADE', name='fk_landing_reviews_tenant',
        ),
        sa.ForeignKeyConstraint(
            ['avatar_asset_id'], ['page_config_assets.asset_id'],
            ondelete='SET NULL', name='fk_landing_reviews_avatar_asset',
        ),
    )

    # ── landing_trusted_brands ────────────────────────────────────────
    op.create_table(
        'landing_trusted_brands',
        sa.Column('brand_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('logo_asset_id', UUID(as_uuid=True), nullable=True),
        sa.Column('link_url', sa.String(length=1000), nullable=True),
        sa.Column('display_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_visible', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(
            ['tenant_id'], ['tenants.id'],
            ondelete='CASCADE', name='fk_landing_trusted_brands_tenant',
        ),
        sa.ForeignKeyConstraint(
            ['logo_asset_id'], ['page_config_assets.asset_id'],
            ondelete='SET NULL', name='fk_landing_trusted_brands_logo_asset',
        ),
    )

    # ── RLS policies (canonical helper from app.models._base) ────────
    from app.models._base import generate_rls_sql

    for table in ('landing_doctors', 'landing_reviews', 'landing_trusted_brands'):
        for stmt in generate_rls_sql(table):
            op.execute(stmt)


def downgrade():
    for table in ('landing_trusted_brands', 'landing_reviews', 'landing_doctors'):
        op.execute(f"DROP POLICY IF EXISTS tenant_insert_{table} ON {table}")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_table('landing_trusted_brands')
    op.drop_table('landing_reviews')
    op.drop_table('landing_doctors')

    op.drop_column('landing_configs', 'brands_section_title')
    op.drop_column('landing_configs', 'reviews_section_title')
    op.drop_column('landing_configs', 'doctors_section_title')
