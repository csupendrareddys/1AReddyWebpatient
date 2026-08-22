"""holding channel: nullable purchase, held_doctor_id, admin role

Revision ID: 827b023a4f48
Revises: f80f45bc762d
Create Date: 2026-07-27 07:01:07.974431

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '827b023a4f48'
down_revision = 'f80f45bc762d'
branch_labels = None
depends_on = None


def upgrade():
    # New ADMIN participant role (autogenerate doesn't detect enum additions).
    # PG16 allows ADD VALUE inside the migration transaction; it isn't used in
    # this same migration, so no cross-statement hazard.
    op.execute("ALTER TYPE channelparticipantrole ADD VALUE IF NOT EXISTS 'admin'")

    with op.batch_alter_table('service_channels', schema=None) as batch_op:
        batch_op.add_column(sa.Column('held_doctor_id', sa.UUID(), nullable=True))
        batch_op.alter_column('purchased_service_id',
               existing_type=sa.UUID(),
               nullable=True)
        batch_op.create_index(batch_op.f('ix_service_channels_held_doctor_id'), ['held_doctor_id'], unique=True)
        batch_op.create_foreign_key('service_channels_held_doctor_id_fkey', 'doctors', ['held_doctor_id'], ['doctor_id'], ondelete='CASCADE')


def downgrade():
    with op.batch_alter_table('service_channels', schema=None) as batch_op:
        batch_op.drop_constraint('service_channels_held_doctor_id_fkey', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_service_channels_held_doctor_id'))
        batch_op.alter_column('purchased_service_id',
               existing_type=sa.UUID(),
               nullable=False)
        batch_op.drop_column('held_doctor_id')
    # Note: Postgres cannot DROP an enum value, so 'admin' stays on
    # channelparticipantrole after downgrade (harmless).
