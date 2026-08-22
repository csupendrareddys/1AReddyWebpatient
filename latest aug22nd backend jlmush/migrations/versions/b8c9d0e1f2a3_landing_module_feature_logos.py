"""Landing modules + features: optional uploaded logo.

Adds ``logo_asset_id`` (UUID FK → page_config_assets) to:

  * ``landing_modules``  — module-level logo shown in the navbar dropdown,
                           module hero, and footer column headers.
  * ``landing_features`` — feature-level logo shown on service cards and
                           on the service detail page hero.

Both columns are nullable. Admins reuse the existing ``page_config_assets``
upload flow (POST /api/page-config/admin/assets) and store the returned
asset_id here.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-04-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'b8c9d0e1f2a3'
down_revision = 'a7b8c9d0e1f2'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'landing_modules',
        sa.Column('logo_asset_id', UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_landing_modules_logo_asset',
        'landing_modules', 'page_config_assets',
        ['logo_asset_id'], ['asset_id'],
        ondelete='SET NULL',
    )

    op.add_column(
        'landing_features',
        sa.Column('logo_asset_id', UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_landing_features_logo_asset',
        'landing_features', 'page_config_assets',
        ['logo_asset_id'], ['asset_id'],
        ondelete='SET NULL',
    )


def downgrade():
    op.drop_constraint('fk_landing_features_logo_asset', 'landing_features', type_='foreignkey')
    op.drop_column('landing_features', 'logo_asset_id')
    op.drop_constraint('fk_landing_modules_logo_asset', 'landing_modules', type_='foreignkey')
    op.drop_column('landing_modules', 'logo_asset_id')
