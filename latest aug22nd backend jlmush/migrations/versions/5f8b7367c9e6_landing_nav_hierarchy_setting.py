"""landing nav hierarchy setting

Adds the operator's choice of how deep the public top-nav dropdown goes —
'two_level' (module → feature) or 'three_level' (module → category → feature).
See ``LandingConfig.nav_hierarchy``.

NOT NULL with a server default of 'three_level', so every existing config row
is backfilled to it in the same statement. That is the no-change value: the nav
renders a module flat whenever none of its features are categorised, which is
the state of every row today.

The ``ix_*_team`` → ``ix_*_team_id`` index renames autogenerate proposes again
here are the same pre-existing model/DB drift left out of ``afef6560a58e``, and
are left out for the same reason.

Revision ID: 5f8b7367c9e6
Revises: afef6560a58e
Create Date: 2026-07-29 04:50:44.673935

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '5f8b7367c9e6'
down_revision = 'afef6560a58e'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('landing_configs', schema=None) as batch_op:
        batch_op.add_column(sa.Column(
            'nav_hierarchy', sa.String(length=20),
            server_default=sa.text("'three_level'"), nullable=False,
        ))

    with op.batch_alter_table('platform_landing_configs', schema=None) as batch_op:
        batch_op.add_column(sa.Column(
            'nav_hierarchy', sa.String(length=20),
            server_default=sa.text("'three_level'"), nullable=False,
        ))


def downgrade():
    with op.batch_alter_table('platform_landing_configs', schema=None) as batch_op:
        batch_op.drop_column('nav_hierarchy')

    with op.batch_alter_table('landing_configs', schema=None) as batch_op:
        batch_op.drop_column('nav_hierarchy')
