"""saas_categories — dynamic industry segments for the vendor site

Creates the category table, hangs saas_plan_types off it, seeds the
'healthcare' default category with the hero copy the pricing page used
to hardcode, and adopts every existing plan type into it — so the live
pricing page renders EXACTLY as before, but from data.

Revision ID: saascat1_saas_categories
Revises: media1_media_assets
"""
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = 'saascat1_saas_categories'
down_revision = 'media1_media_assets'
branch_labels = None
depends_on = None

_HEALTHCARE_ID = str(uuid.uuid4())


def upgrade():
    op.create_table(
        'saas_categories',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('code', sa.String(50), nullable=False, unique=True),
        sa.Column('name', sa.String(150), nullable=False),
        sa.Column('tagline', sa.String(200), nullable=True),
        sa.Column('headline', sa.String(300), nullable=True),
        sa.Column('subheadline', sa.Text(), nullable=True),
        sa.Column('display_order', sa.Integer(), nullable=False,
                  server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False,
                  server_default=sa.true()),
        sa.Column('is_default', sa.Boolean(), nullable=False,
                  server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
    )
    op.create_index('ix_saas_categories_code', 'saas_categories', ['code'])
    # Exactly one default category, DB-enforced.
    op.create_index('ux_saas_categories_single_default', 'saas_categories',
                    ['is_default'], unique=True,
                    postgresql_where=sa.text('is_default'))

    op.add_column('saas_plan_types', sa.Column(
        'category_id', postgresql.UUID(as_uuid=True),
        sa.ForeignKey('saas_categories.id', ondelete='RESTRICT',
                      name='fk_saas_plan_types_category_id'),
        nullable=True))
    op.create_index('ix_saas_plan_types_category_id', 'saas_plan_types',
                    ['category_id'])

    # Seed the default category with the copy SaasPricingPage hardcoded,
    # and adopt every existing plan type so nothing changes visually.
    op.execute(sa.text(
        "INSERT INTO saas_categories "
        "(id, code, name, tagline, headline, subheadline, display_order, "
        " is_active, is_default) VALUES "
        "(:id, 'healthcare', 'Healthcare', 'For healthcare organizations', "
        " 'Run your healthcare organization on your own branded portal', "
        " 'Get your own subdomain, branded patient portal, calendar, "
        "billing, and prescription workflows. Pick the bundle that matches "
        "your team size — upgrade or attach add-ons à la carte at any "
        "time.', 0, true, true)"
    ).bindparams(id=_HEALTHCARE_ID))
    op.execute(sa.text(
        "UPDATE saas_plan_types SET category_id = :id "
        "WHERE category_id IS NULL"
    ).bindparams(id=_HEALTHCARE_ID))


def downgrade():
    op.drop_index('ix_saas_plan_types_category_id',
                  table_name='saas_plan_types')
    op.drop_column('saas_plan_types', 'category_id')
    op.drop_index('ux_saas_categories_single_default',
                  table_name='saas_categories')
    op.drop_index('ix_saas_categories_code', table_name='saas_categories')
    op.drop_table('saas_categories')
