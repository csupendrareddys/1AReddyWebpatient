"""landing feature category (3-level nav)

Adds the middle level of the public navigation — module → category → feature
— as a plain label on the feature rather than a table of its own. See
``LandingFeature.category`` for why.

Nullable with no backfill on purpose: every existing feature stays
uncategorised, and the nav renders a module whose features are all
uncategorised exactly as it did before, as one flat list.

Autogenerate also proposed renaming ``ix_feature_doctors_team`` /
``ix_platform_feature_doctors_team`` to the ``_team_id`` convention. That is
pre-existing drift between the models and the DB, unrelated to this change,
and folding an index rename into a column migration would make this one hard
to revert cleanly — it has been left out.

Revision ID: afef6560a58e
Revises: careteamteam1
Create Date: 2026-07-29 04:27:10.239380

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'afef6560a58e'
down_revision = 'careteamteam1'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('landing_features', schema=None) as batch_op:
        batch_op.add_column(sa.Column('category', sa.String(length=120), nullable=True))

    with op.batch_alter_table('platform_landing_features', schema=None) as batch_op:
        batch_op.add_column(sa.Column('category', sa.String(length=120), nullable=True))


def downgrade():
    with op.batch_alter_table('platform_landing_features', schema=None) as batch_op:
        batch_op.drop_column('category')

    with op.batch_alter_table('landing_features', schema=None) as batch_op:
        batch_op.drop_column('category')
