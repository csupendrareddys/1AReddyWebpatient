"""Landing page: recognitions carousel + video gallery tables.

Adds two tenant-scoped collection tables that sit alongside the
``landing_configs`` lifecycle (NOT inside its draft / preview / live tree
— admins edit these in place and changes go live immediately):

  * ``landing_recognitions`` — accreditation / certification cards rendered
                               in a carousel directly below the hero.
  * ``landing_videos``      — videos rendered as a strip on the landing page
                               and a dedicated ``/gallery/videos`` page when
                               the visible count exceeds the strip cap.

Both reuse the existing ``page_config_assets`` upload flow via FK columns
``logo_asset_id`` / ``video_asset_id`` / ``thumbnail_asset_id``.

Revision ID: c9d0e1f2a3b4
Revises: g7b8c9d0e1f2
Create Date: 2026-04-26

Note on parentage: originally chained off ``b8c9d0e1f2a3`` (the
module/feature logo migration). The email-templates migration
``g7b8c9d0e1f2`` was added on a parallel branch with the same
down_revision, producing two heads. Re-parented to descend from
``g7b8c9d0e1f2`` so the chain stays linear without renaming the
revision id (any environment that already applied this migration has
the data; only the parent pointer changes for fresh bootstraps).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'c9d0e1f2a3b4'
down_revision = 'g7b8c9d0e1f2'
branch_labels = None
depends_on = None


def upgrade():
    # ────────────────────── landing_recognitions ──────────────────────
    # ``tenant_id`` is declared with ``index=True`` so alembic auto-
    # creates ``ix_landing_recognitions_tenant_id`` — matching what
    # ``TenantMixin``'s ``index=True`` declaration produces when
    # ``db.create_all()`` runs the model metadata. Without this the
    # roundtrip + schema-parity CI step detects drift (DB has the
    # custom-named index from the migration but lacks the
    # model-expected one).
    op.create_table(
        'landing_recognitions',
        sa.Column('recognition_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('subtitle', sa.String(length=300), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('logo_asset_id', UUID(as_uuid=True), nullable=True),
        sa.Column('display_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_visible', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(
            ['tenant_id'], ['tenants.id'],
            ondelete='CASCADE',
            name='fk_landing_recognitions_tenant',
        ),
        sa.ForeignKeyConstraint(
            ['logo_asset_id'], ['page_config_assets.asset_id'],
            ondelete='SET NULL',
            name='fk_landing_recognitions_logo_asset',
        ),
    )

    # ─────────────────────────── landing_videos ───────────────────────
    # Same ``index=True`` shim on ``tenant_id``. The composite
    # ``(tenant_id, category)`` index is meaningful (gallery page groups
    # by category within a tenant) so it stays as an explicit
    # create_index — that one IS declared in the model's __table_args__.
    op.create_table(
        'landing_videos',
        sa.Column('video_id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('video_url', sa.String(length=1000), nullable=True),
        sa.Column('video_asset_id', UUID(as_uuid=True), nullable=True),
        sa.Column('thumbnail_asset_id', UUID(as_uuid=True), nullable=True),
        sa.Column('category', sa.String(length=120), nullable=True),
        sa.Column('display_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_visible', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(
            ['tenant_id'], ['tenants.id'],
            ondelete='CASCADE',
            name='fk_landing_videos_tenant',
        ),
        sa.ForeignKeyConstraint(
            ['video_asset_id'], ['page_config_assets.asset_id'],
            ondelete='SET NULL',
            name='fk_landing_videos_video_asset',
        ),
        sa.ForeignKeyConstraint(
            ['thumbnail_asset_id'], ['page_config_assets.asset_id'],
            ondelete='SET NULL',
            name='fk_landing_videos_thumbnail_asset',
        ),
    )
    op.create_index(
        'ix_landing_videos_tenant_category',
        'landing_videos', ['tenant_id', 'category'],
    )

    # ────── RLS policies (canonical helper from app.models._base) ──────
    # Uses the same ``current_setting('app.current_tenant_id', true)``
    # pattern as every other tenant-scoped table — enforced FORCE so even
    # superusers honour the policy unless they explicitly bypass.
    from app.models._base import generate_rls_sql

    for table in ('landing_recognitions', 'landing_videos'):
        for stmt in generate_rls_sql(table):
            op.execute(stmt)


def downgrade():
    for table in ('landing_videos', 'landing_recognitions'):
        op.execute(f"DROP POLICY IF EXISTS tenant_insert_{table} ON {table}")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_{table} ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    # The ``ix_<table>_tenant_id`` auto-indexes (created by ``index=True``
    # on the column) are dropped automatically when their parent table is
    # dropped — no need to drop them explicitly. We only drop the
    # composite index since it has a custom name and is independent.
    op.drop_index('ix_landing_videos_tenant_category', table_name='landing_videos')
    op.drop_table('landing_videos')

    op.drop_table('landing_recognitions')
