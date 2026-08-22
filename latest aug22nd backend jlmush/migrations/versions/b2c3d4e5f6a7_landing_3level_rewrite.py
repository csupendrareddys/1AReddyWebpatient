"""Landing page config: drop v1 schema, create 3-level hierarchy.

Dropped tables (per user direction — existing landing data is discarded):

  * ``landing_page_configs``
  * ``landing_nav_headings``
  * ``landing_nav_items``
  * ``landing_features`` (v1 shape — recreated with new columns below)

Created tables:

  * ``landing_configs`` — root, status + version, hero + translations
  * ``landing_modules`` — dynamic top-nav modules
  * ``landing_features`` — per-module features with on/off section toggles
  * ``landing_config_snapshots`` — per-publish frozen tree, powers history

``tenant_permission_allocations`` is preserved (still used by the platform
owner's permission-allocation UI).

The new ``PermissionModule`` values (``landing_config``, ``landing_module``)
are string-valued on an existing ``permissionmodule`` PG enum — extending the
enum is done via ``ALTER TYPE … ADD VALUE`` in a separate data step.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-04-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'b2c3d4e5f6a7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


# ``db.Enum(ConfigStatus)`` in SQLAlchemy persists the Python enum *name*
# ("DRAFT") — not the lowercase ``.value``. The existing ``configstatus``
# enum in the DB was created via the page_config models with that same
# convention, so we reference it here with uppercase members too.
config_status_enum = postgresql.ENUM(
    'DRAFT', 'PREVIEW', 'LIVE', 'ARCHIVED',
    name='configstatus', create_type=False,
)


def upgrade():
    # --- extend PermissionModule enum with the new values ------------------
    # ALTER TYPE … ADD VALUE cannot run in a transaction block on old PG
    # versions; Alembic by default opens one. For portability we use the
    # safe IF NOT EXISTS form.
    #
    # ``db.Enum(PermissionModule)`` stores the Python enum *name*
    # (``LANDING_CONFIG``), not the lowercase ``.value`` (``landing_config``),
    # so the new DB enum values mirror the Python member names.
    op.execute("ALTER TYPE permissionmodule ADD VALUE IF NOT EXISTS 'LANDING_CONFIG'")
    op.execute("ALTER TYPE permissionmodule ADD VALUE IF NOT EXISTS 'LANDING_MODULE'")

    # --- drop v1 landing schema -------------------------------------------
    # Children first to satisfy FK ordering. IF EXISTS so dev boxes that
    # never created the v1 schema don't error out.
    op.execute('DROP TABLE IF EXISTS landing_nav_items CASCADE')
    op.execute('DROP TABLE IF EXISTS landing_nav_headings CASCADE')
    op.execute('DROP TABLE IF EXISTS landing_features CASCADE')
    op.execute('DROP TABLE IF EXISTS landing_page_configs CASCADE')

    # --- landing_configs (root) -------------------------------------------
    op.create_table(
        'landing_configs',
        sa.Column('config_id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('status', config_status_enum, nullable=False, server_default='DRAFT'),
        sa.Column('version', sa.Integer, nullable=False, server_default='1'),
        sa.Column('hero_title', sa.String(200), nullable=True),
        sa.Column('hero_subtitle', sa.String(500), nullable=True),
        sa.Column('hero_cta_label', sa.String(100), nullable=True),
        sa.Column('hero_cta_href', sa.String(500), nullable=True),
        sa.Column('hero_image_asset_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('page_config_assets.asset_id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('primary_color', sa.String(20), server_default='#1976d2'),
        sa.Column('secondary_color', sa.String(20), server_default='#dc004e'),
        sa.Column('background_color', sa.String(20), server_default='#ffffff'),
        sa.Column('marketing_tagline', sa.String(500), nullable=True),
        sa.Column('footer_text', sa.Text, nullable=True),
        sa.Column('meta', postgresql.JSON, nullable=True),
        sa.Column('translations', postgresql.JSON, nullable=True),
        sa.Column('published_languages', postgresql.JSON, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
    )
    op.create_index(
        'ix_landing_configs_tenant_status',
        'landing_configs', ['tenant_id', 'status'],
    )

    # --- landing_modules --------------------------------------------------
    op.create_table(
        'landing_modules',
        sa.Column('module_id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('landing_config_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('landing_configs.config_id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('slug', sa.String(120), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('icon_key', sa.String(100), nullable=True),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('display_order', sa.Integer, nullable=False, server_default='0'),
        sa.Column('is_visible', sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column('faq_json', postgresql.JSON, nullable=True),
        sa.Column('sections_enabled_json', postgresql.JSON, nullable=True),
        sa.Column('translations', postgresql.JSON, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint('tenant_id', 'landing_config_id', 'slug',
                            name='uq_landing_module_tenant_slug'),
    )
    op.create_index(
        'ix_landing_modules_tenant_config',
        'landing_modules', ['tenant_id', 'landing_config_id'],
    )

    # --- landing_features -------------------------------------------------
    op.create_table(
        'landing_features',
        sa.Column('feature_id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('module_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('landing_modules.module_id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('slug', sa.String(120), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('starting_price', sa.String(50), nullable=True),
        sa.Column('timeline', sa.String(100), nullable=True),
        sa.Column('rating', sa.String(20), nullable=True),
        sa.Column('what_is', sa.Text, nullable=True),
        sa.Column('requirements', postgresql.JSON, nullable=True),
        sa.Column('documents', postgresql.JSON, nullable=True),
        sa.Column('benefits', postgresql.JSON, nullable=True),
        sa.Column('disadvantages', postgresql.JSON, nullable=True),
        sa.Column('process', postgresql.JSON, nullable=True),
        sa.Column('book_cta_label', sa.String(100), nullable=True,
                  server_default='Book Now'),
        sa.Column('sections_enabled_json', postgresql.JSON, nullable=True),
        sa.Column('translations', postgresql.JSON, nullable=True),
        sa.Column('display_order', sa.Integer, nullable=False, server_default='0'),
        sa.Column('is_visible', sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.UniqueConstraint('tenant_id', 'module_id', 'slug',
                            name='uq_landing_feature_tenant_slug'),
    )
    op.create_index(
        'ix_landing_features_tenant_module',
        'landing_features', ['tenant_id', 'module_id'],
    )

    # --- landing_config_snapshots ----------------------------------------
    op.create_table(
        'landing_config_snapshots',
        sa.Column('snapshot_id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('landing_config_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('landing_configs.config_id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('version', sa.Integer, nullable=False),
        sa.Column('tree_json', postgresql.JSON, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('created_by_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('note', sa.Text, nullable=True),
    )
    op.create_index(
        'ix_landing_snapshots_tenant_version',
        'landing_config_snapshots', ['tenant_id', 'version'],
    )


def downgrade():
    # Drop new schema
    op.drop_index('ix_landing_snapshots_tenant_version', table_name='landing_config_snapshots')
    op.drop_table('landing_config_snapshots')
    op.drop_index('ix_landing_features_tenant_module', table_name='landing_features')
    op.drop_table('landing_features')
    op.drop_index('ix_landing_modules_tenant_config', table_name='landing_modules')
    op.drop_table('landing_modules')
    op.drop_index('ix_landing_configs_tenant_status', table_name='landing_configs')
    op.drop_table('landing_configs')

    # v1 tables are NOT recreated here — the user confirmed the v1 data is
    # discarded and a downgrade is expected to land on a schema without v1
    # landing at all.

    # permissionmodule enum values cannot be removed without recreating the
    # whole enum; we leave them in place (harmless unused values).
