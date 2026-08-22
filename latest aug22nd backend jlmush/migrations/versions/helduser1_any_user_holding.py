"""Holding channel: held_user_id (any user can be held, not just doctors)

Revision ID: helduser1
Revises: vendorinst1
Create Date: 2026-07-28
"""
from alembic import op
import sqlalchemy as sa


revision = 'helduser1'
down_revision = 'vendorinst1'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('service_channels', schema=None) as batch_op:
        batch_op.add_column(sa.Column('held_user_id', sa.UUID(), nullable=True))
        batch_op.create_index(batch_op.f('ix_service_channels_held_user_id'), ['held_user_id'], unique=True)
        batch_op.create_foreign_key(
            'service_channels_held_user_id_fkey', 'users',
            ['held_user_id'], ['user_id'], ondelete='CASCADE',
        )


def downgrade():
    with op.batch_alter_table('service_channels', schema=None) as batch_op:
        batch_op.drop_constraint('service_channels_held_user_id_fkey', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_service_channels_held_user_id'))
        batch_op.drop_column('held_user_id')
