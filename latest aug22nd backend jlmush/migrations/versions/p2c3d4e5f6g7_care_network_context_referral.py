"""Care network: context (network|link) + referral_type + relationship_type

Adds classification columns to the care-network tables so the same connection
machinery backs two surfaces:

  * My Network  — context='network', classified by referral_type (A|B|C)
  * My Link     — context='link',    classified by relationship_type
                  (partner|associate|employee)

All additive; ``context`` defaults to 'network' so existing rows keep their
meaning. The super-admin provider-directory visibility toggle is stored in
``Tenant.settings`` JSON and needs no migration.

Revision ID: p2c3d4e5f6g7
Revises: o1b2c3d4e5f6
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa


revision = 'p2c3d4e5f6g7'
down_revision = 'o1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    for table in ('care_network_connections', 'care_network_requests'):
        op.add_column(table, sa.Column('context', sa.String(20), nullable=False, server_default='network'))
        op.add_column(table, sa.Column('referral_type', sa.String(10), nullable=True))
        op.add_column(table, sa.Column('relationship_type', sa.String(20), nullable=True))
    op.create_index('ix_care_network_connections_context', 'care_network_connections', ['context'])

    # Widen the connection uniqueness to include context so the same target can
    # be both a My Network and a My Link connection.
    op.drop_constraint('uq_care_network_connection', 'care_network_connections', type_='unique')
    op.create_unique_constraint(
        'uq_care_network_connection', 'care_network_connections',
        ['tenant_id', 'doctor_id', 'connection_type', 'context',
         'target_doctor_id', 'target_hospital_id', 'target_clinic_id'],
    )


def downgrade():
    op.drop_constraint('uq_care_network_connection', 'care_network_connections', type_='unique')
    op.create_unique_constraint(
        'uq_care_network_connection', 'care_network_connections',
        ['tenant_id', 'doctor_id', 'connection_type',
         'target_doctor_id', 'target_hospital_id', 'target_clinic_id'],
    )
    op.execute('DROP INDEX IF EXISTS ix_care_network_connections_context')
    for table in ('care_network_requests', 'care_network_connections'):
        op.drop_column(table, 'relationship_type')
        op.drop_column(table, 'referral_type')
        op.drop_column(table, 'context')
