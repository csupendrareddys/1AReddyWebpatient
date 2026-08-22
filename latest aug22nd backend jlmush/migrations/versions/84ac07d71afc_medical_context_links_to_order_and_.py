"""medical context links to order and group booking

Revision ID: 84ac07d71afc
Revises: memberpay1
Create Date: 2026-07-31 08:20:48.660163

Attach the per-booking intake object (``appointment_medical_contexts``) to a
marketplace order or a group-offering booking, in addition to a consultation
appointment, so the same "collect this information" intake works for every
booking flow.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '84ac07d71afc'
down_revision = '9383fc38cf53'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('appointment_medical_contexts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('marketplace_order_id', sa.UUID(), nullable=True))
        batch_op.add_column(sa.Column('group_offering_booking_id', sa.UUID(), nullable=True))
        batch_op.create_index(
            batch_op.f('ix_appointment_medical_contexts_marketplace_order_id'),
            ['marketplace_order_id'], unique=False)
        batch_op.create_index(
            batch_op.f('ix_appointment_medical_contexts_group_offering_booking_id'),
            ['group_offering_booking_id'], unique=False)
        batch_op.create_foreign_key(
            'fk_amc_marketplace_order_id', 'marketplace_orders',
            ['marketplace_order_id'], ['order_id'], ondelete='SET NULL')
        batch_op.create_foreign_key(
            'fk_amc_group_offering_booking_id', 'group_offering_bookings',
            ['group_offering_booking_id'], ['booking_id'], ondelete='SET NULL')


def downgrade():
    # Drop the columns directly — Postgres cascades their FK constraint and
    # index. Dropping the FK by name would fail when the DB was bootstrapped via
    # ``db.create_all()`` (CI), because SQLAlchemy names the model-defined FK
    # differently from this migration's ``fk_amc_*`` names.
    op.drop_column('appointment_medical_contexts', 'group_offering_booking_id')
    op.drop_column('appointment_medical_contexts', 'marketplace_order_id')
