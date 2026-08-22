"""Add ``profile_work_qualification`` — multi doctor↔work-qualification link.

Parallels ``profile_education_specialization`` but for
``Category.category_type == 'work_qualification'``; a doctor may hold
several. The public booking widget groups/filters by these. Greenfield
(no existing rows to backfill — the old single ``profile_about.
work_qualification_id`` stays for back-compat). Full RLS, reusing the
existing ``documentverificationstatus`` enum.

Revision ID: workqual1multi2
Revises: docpop1landing2
Create Date: 2026-07-20
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import UUID

from app.models._base import generate_rls_sql


revision = 'workqual1multi2'
down_revision = 'docpop1landing2'
branch_labels = None
depends_on = None

# Reused enum — DO NOT re-create it (create_type=False).
_DVS = postgresql.ENUM(
    'PENDING', 'VERIFIED', 'REJECTED',
    name='documentverificationstatus', create_type=False,
)


def upgrade():
    op.create_table(
        'profile_work_qualification',
        sa.Column('id', UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False),
        sa.Column('profile_owner_id', UUID(as_uuid=True), nullable=False),
        sa.Column('doctor_id', UUID(as_uuid=True), nullable=False),
        sa.Column('category_id', UUID(as_uuid=True), nullable=False),
        sa.Column('is_primary', sa.Boolean(), nullable=False,
                  server_default=sa.text('false')),
        sa.Column('verification_status', _DVS, nullable=False,
                  server_default='PENDING'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['profile_owner_id'], ['profile_owner.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['doctor_id'], ['doctors.doctor_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['category_id'], ['categories.category_id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'profile_owner_id', 'category_id',
                            name='uq_prof_work_qual_owner_category'),
    )
    op.create_index('ix_profile_work_qualification_tenant_id', 'profile_work_qualification', ['tenant_id'])
    op.create_index('ix_profile_work_qualification_profile_owner_id', 'profile_work_qualification', ['profile_owner_id'])
    op.create_index('ix_profile_work_qualification_doctor_id', 'profile_work_qualification', ['doctor_id'])
    op.create_index('ix_profile_work_qualification_category_id', 'profile_work_qualification', ['category_id'])
    op.create_index('ix_prof_work_qual_tenant_category', 'profile_work_qualification', ['tenant_id', 'category_id'])

    for stmt in generate_rls_sql('profile_work_qualification'):
        op.execute(stmt)


def downgrade():
    op.execute("DROP POLICY IF EXISTS tenant_insert_profile_work_qualification ON profile_work_qualification")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_profile_work_qualification ON profile_work_qualification")
    op.execute("ALTER TABLE profile_work_qualification DISABLE ROW LEVEL SECURITY")
    op.drop_table('profile_work_qualification')
