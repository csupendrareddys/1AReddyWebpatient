"""Facility target on care-network requests (clinic/hospital request→accept)

Adds nullable target_hospital_id / target_clinic_id to care_network_requests so a
doctor's connect to a clinic/hospital becomes a PENDING request routed to the
facility's owner account, which accepts (creating the doctor→facility
connection). Both nullable; table already has RLS.

Revision ID: u7h8i9j0k1l2
Revises: t6g7h8i9j0k1
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'u7h8i9j0k1l2'
down_revision = 't6g7h8i9j0k1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'care_network_requests',
        sa.Column('target_hospital_id', UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        'care_network_requests',
        sa.Column('target_clinic_id', UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_cnr_target_hospital', 'care_network_requests', 'hospitals',
        ['target_hospital_id'], ['hospital_id'], ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_cnr_target_clinic', 'care_network_requests', 'clinics',
        ['target_clinic_id'], ['id'], ondelete='CASCADE',
    )


def downgrade():
    op.drop_constraint('fk_cnr_target_clinic', 'care_network_requests', type_='foreignkey')
    op.drop_constraint('fk_cnr_target_hospital', 'care_network_requests', type_='foreignkey')
    op.drop_column('care_network_requests', 'target_clinic_id')
    op.drop_column('care_network_requests', 'target_hospital_id')
