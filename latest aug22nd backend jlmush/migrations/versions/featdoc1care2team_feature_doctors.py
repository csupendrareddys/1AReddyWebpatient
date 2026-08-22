"""Add feature_doctors ("our care team" on a feature page).

Revision ID: featdoc1care2team
Revises: 8dfd6eb651c9
Create Date: 2026-07-20

One row per (landing feature, doctor) the admin pinned to that feature's care
team, plus a boolean per field controlling what is revealed publicly. Doctor
data itself is never copied here — it is read live from ``doctors`` and its
satellites at serialization time.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = 'featdoc1care2team'
down_revision = '8dfd6eb651c9'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'platform_feature_doctors',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('feature_id', UUID(as_uuid=True), nullable=False),
        sa.Column('doctor_id', UUID(as_uuid=True), nullable=False),
        sa.Column('photo', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('experience', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('languages', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('location', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('work_qualification', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('display_order', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(
            ['feature_id'], ['platform_landing_features.feature_id'],
            name='platform_feature_doctors_feature_id_fkey', ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['doctor_id'], ['doctors.doctor_id'],
            name='platform_feature_doctors_doctor_id_fkey', ondelete='CASCADE',
        ),
        sa.UniqueConstraint('feature_id', 'doctor_id', name='uq_platform_feature_doctor'),
    )
    op.create_index(
        'ix_platform_feature_doctors_feature_id', 'platform_feature_doctors',
        ['feature_id'],
    )
    op.create_index(
        'ix_platform_feature_doctors_doctor_id', 'platform_feature_doctors',
        ['doctor_id'],
    )

    op.create_table(
        'feature_doctors',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False),
        sa.Column('feature_id', UUID(as_uuid=True), nullable=False),
        sa.Column('doctor_id', UUID(as_uuid=True), nullable=False),
        sa.Column('photo', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('experience', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('languages', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('location', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('work_qualification', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('display_order', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(
            ['tenant_id'], ['tenants.id'],
            name='feature_doctors_tenant_id_fkey', ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['feature_id'], ['landing_features.feature_id'],
            name='feature_doctors_feature_id_fkey', ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['doctor_id'], ['doctors.doctor_id'],
            name='feature_doctors_doctor_id_fkey', ondelete='CASCADE',
        ),
        sa.UniqueConstraint('feature_id', 'doctor_id', name='uq_feature_doctor'),
    )
    op.create_index('ix_feature_doctors_tenant_id', 'feature_doctors', ['tenant_id'])
    op.create_index('ix_feature_doctors_feature_id', 'feature_doctors', ['feature_id'])
    op.create_index('ix_feature_doctors_doctor_id', 'feature_doctors', ['doctor_id'])
    op.create_index(
        'ix_feature_doctors_tenant_feature', 'feature_doctors',
        ['tenant_id', 'feature_id'],
    )

    # ────── RLS policies (canonical helper from app.models._base) ──────
    from app.models._base import generate_rls_sql

    for stmt in generate_rls_sql('feature_doctors'):
        op.execute(stmt)


def downgrade():
    op.drop_index('ix_platform_feature_doctors_doctor_id', table_name='platform_feature_doctors')
    op.drop_index('ix_platform_feature_doctors_feature_id', table_name='platform_feature_doctors')
    op.drop_table('platform_feature_doctors')

    op.execute('DROP POLICY IF EXISTS tenant_insert_feature_doctors ON feature_doctors')
    op.execute('DROP POLICY IF EXISTS tenant_isolation_feature_doctors ON feature_doctors')
    op.execute('ALTER TABLE feature_doctors NO FORCE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE feature_doctors DISABLE ROW LEVEL SECURITY')

    op.drop_index('ix_feature_doctors_tenant_feature', table_name='feature_doctors')
    op.drop_index('ix_feature_doctors_doctor_id', table_name='feature_doctors')
    op.drop_index('ix_feature_doctors_feature_id', table_name='feature_doctors')
    op.drop_index('ix_feature_doctors_tenant_id', table_name='feature_doctors')
    op.drop_table('feature_doctors')
