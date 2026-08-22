"""Landing config: theme preset + accent + hero style columns.

Adds dynamic landing-page theming:

  * ``theme_preset``  – key into the frontend preset table (ocean / emerald /
                        royal / sunset / midnight / custom).
  * ``accent_color``  – tertiary color used for highlights and badges.
  * ``hero_style``    – cosmetic — gradient | solid | pattern.

Backfill: existing rows get ``theme_preset='custom'`` so their already-saved
colors keep rendering as-before; new rows seed with ``ocean`` via the model
default.

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-04-26
"""
from alembic import op
import sqlalchemy as sa


revision = 'a7b8c9d0e1f2'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'landing_configs',
        sa.Column('theme_preset', sa.String(length=40), nullable=True),
    )
    op.add_column(
        'landing_configs',
        sa.Column('accent_color', sa.String(length=20), nullable=True),
    )
    op.add_column(
        'landing_configs',
        sa.Column('hero_style', sa.String(length=40), nullable=True),
    )

    # Backfill: rows that already have admin-customized colors keep them by
    # being marked 'custom'. Brand-new rows will pick up 'ocean' from the
    # model default at insert time.
    op.execute(
        "UPDATE landing_configs SET theme_preset = 'custom' "
        "WHERE theme_preset IS NULL"
    )
    op.execute(
        "UPDATE landing_configs SET accent_color = '#26a69a' "
        "WHERE accent_color IS NULL"
    )
    op.execute(
        "UPDATE landing_configs SET hero_style = 'gradient' "
        "WHERE hero_style IS NULL"
    )


def downgrade():
    op.drop_column('landing_configs', 'hero_style')
    op.drop_column('landing_configs', 'accent_color')
    op.drop_column('landing_configs', 'theme_preset')
