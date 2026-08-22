"""Feature-product link: team_id (group offerings link a team, not a doctor)

Revision ID: fplteam1
Revises: memplanpublish1
Create Date: 2026-07-28
"""
from alembic import op
import sqlalchemy as sa


revision = 'fplteam1'
down_revision = 'memplanpublish1'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('feature_product_links', schema=None) as batch_op:
        batch_op.add_column(sa.Column('team_id', sa.UUID(), nullable=True))
        batch_op.create_index(batch_op.f('ix_feature_product_links_team_id'), ['team_id'], unique=False)
        batch_op.create_foreign_key(
            'feature_product_links_team_id_fkey', 'marketplace_service_groups',
            ['team_id'], ['group_id'], ondelete='CASCADE',
        )


def downgrade():
    with op.batch_alter_table('feature_product_links', schema=None) as batch_op:
        batch_op.drop_constraint('feature_product_links_team_id_fkey', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_feature_product_links_team_id'))
        batch_op.drop_column('team_id')
