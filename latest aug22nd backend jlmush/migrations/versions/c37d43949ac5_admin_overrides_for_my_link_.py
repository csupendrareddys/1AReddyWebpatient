"""admin overrides for My Link relationship tiers

Revision ID: c37d43949ac5
Revises: a1288160ece1
Create Date: 2026-08-08 09:45:42.328168

Hand-trimmed to the new table. Autogenerate also proposed drops and renames on
entity_profiles, charge_policies, feature_doctors, platform_feature_doctors and
service_channels — none of which this change touches. They are drift between
this dev database and migrations that ran elsewhere, and folding them into a
feature migration would ship someone else's unreviewed schema change under this
one's name.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c37d43949ac5'
down_revision = 'a1288160ece1'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'link_relationship_policies',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('relationship', sa.String(length=20), nullable=False),
        sa.Column('section', sa.String(length=32), nullable=False),
        sa.Column('access', sa.String(length=10), nullable=False),
        sa.Column('updated_by_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by_id'], ['users.user_id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'relationship', 'section',
                            name='uq_link_relationship_policy'),
    )
    with op.batch_alter_table('link_relationship_policies', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_link_relationship_policies_relationship'),
            ['relationship'], unique=False)
        batch_op.create_index(
            batch_op.f('ix_link_relationship_policies_tenant_id'),
            ['tenant_id'], unique=False)


def downgrade():
    with op.batch_alter_table('link_relationship_policies', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_link_relationship_policies_tenant_id'))
        batch_op.drop_index(batch_op.f('ix_link_relationship_policies_relationship'))
    op.drop_table('link_relationship_policies')
