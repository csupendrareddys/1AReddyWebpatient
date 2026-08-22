"""Service (DoctorProduct): working_hours

Revision ID: svcwh1
Revises: fplteam1
Create Date: 2026-07-28
"""
from alembic import op
import sqlalchemy as sa


revision = 'svcwh1'
down_revision = 'fplteam1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('doctor_products', sa.Column('working_hours', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('doctor_products', 'working_hours')
