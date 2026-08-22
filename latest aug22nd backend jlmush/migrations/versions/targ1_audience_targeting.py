"""audience-targeting config columns

One canonical ``targeting`` JSON shape stored in three places:
``doctor_products.targeting`` and ``group_offerings.targeting`` (admin-set,
services + group services) and ``doctors.consultation_targeting`` (doctor-set,
keyed by schedulable consultation type). Config-only — the patient-list
reordering that consumes it lands in a later phase.

Revision ID: targ1_audience_targeting
Revises: pccat1_product_category_types
Create Date: 2026-08-08 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'targ1_audience_targeting'
down_revision = 'pccat1_product_category_types'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('doctor_products', schema=None) as batch_op:
        batch_op.add_column(sa.Column('targeting', sa.JSON(), nullable=True))
    with op.batch_alter_table('group_offerings', schema=None) as batch_op:
        batch_op.add_column(sa.Column('targeting', sa.JSON(), nullable=True))
    with op.batch_alter_table('doctors', schema=None) as batch_op:
        batch_op.add_column(sa.Column('consultation_targeting', sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table('doctors', schema=None) as batch_op:
        batch_op.drop_column('consultation_targeting')
    with op.batch_alter_table('group_offerings', schema=None) as batch_op:
        batch_op.drop_column('targeting')
    with op.batch_alter_table('doctor_products', schema=None) as batch_op:
        batch_op.drop_column('targeting')
