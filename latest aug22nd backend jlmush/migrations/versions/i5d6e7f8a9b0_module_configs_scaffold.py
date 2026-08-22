"""Per-module publish lifecycle — Phase 1 scaffold.

Round 9, Phase 1. Additive only:

  * NEW table ``module_configs`` — per-module draft / preview / live
    lifecycle. Empty initially; Phase 2 backfills from existing
    PageConfigs.
  * NEW column ``page_field_configs.module_config_id`` — nullable FK
    to ``module_configs``. Stays NULL during the back-compat window;
    Phase 2 populates it.

No behavior changes in this migration. The existing
``page_field_configs.config_id`` → ``page_configs`` chain stays the
read/write path until Phase 3 cuts over.

See ``docs/features/08-configuration-system/per-module-publish-design.md``
for the full plan.

Revision ID: i5d6e7f8a9b0
Revises: h4c5d6e7f8a9
Create Date: 2026-05-21
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers
revision = 'i5d6e7f8a9b0'
down_revision = 'h4c5d6e7f8a9'
branch_labels = None
depends_on = None


def upgrade():
    # ── module_configs ────────────────────────────────────────────────
    # Reuse the existing ``configstatus`` and ``pagetype`` enum types
    # (created in the initial pricing/config migrations). ``create_type=
    # False`` keeps Alembic from trying to CREATE TYPE again.
    config_status_enum = postgresql.ENUM(
        'DRAFT', 'PREVIEW', 'LIVE', 'ARCHIVED',
        name='configstatus', create_type=False,
    )
    page_type_enum = postgresql.ENUM(
        # Match exactly the values in app/models/_enums.py::PageType.
        # Enum is stored by *name* (uppercase) per SQLAlchemy default.
        'DOCTOR_PROFILE', 'ADMIN_PROFILE', 'PATIENT_PROFILE',
        'PATIENT_APPOINTMENT', 'PATIENT_APPOINTMENT_SYMPTOMS',
        'DOCTOR_SIGNUP',
        name='pagetype', create_type=False,
    )

    op.create_table(
        'module_configs',
        sa.Column(
            'module_config_id', postgresql.UUID(as_uuid=True),
            primary_key=True, nullable=False,
        ),
        sa.Column(
            'tenant_id', postgresql.UUID(as_uuid=True), nullable=False,
        ),
        sa.Column('page_type', page_type_enum, nullable=False),
        sa.Column('module', sa.String(length=60), nullable=False),
        sa.Column(
            'version', sa.Integer(), nullable=False,
            server_default=sa.text('1'),
        ),
        sa.Column(
            'status', config_status_enum, nullable=False,
            server_default=sa.text("'DRAFT'"),
        ),
        sa.Column(
            'published_at', sa.DateTime(timezone=True), nullable=True,
        ),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column(
            'created_by_id', postgresql.UUID(as_uuid=True), nullable=True,
        ),
        sa.Column(
            'created_at', sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text('CURRENT_TIMESTAMP'),
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text('CURRENT_TIMESTAMP'),
        ),
        sa.ForeignKeyConstraint(
            ['tenant_id'], ['tenants.id'], ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['created_by_id'], ['users.user_id'], ondelete='SET NULL',
        ),
    )
    op.create_index(
        'ix_module_configs_tenant_pagetype_module_status',
        'module_configs',
        ['tenant_id', 'page_type', 'module', 'status'],
    )
    op.create_index(
        'ix_module_configs_page_type',
        'module_configs', ['page_type'],
    )
    op.create_index(
        'ix_module_configs_module',
        'module_configs', ['module'],
    )
    op.create_index(
        'ix_module_configs_status',
        'module_configs', ['status'],
    )
    # Partial unique index: a tenant has AT MOST one active row per
    # (page_type, module, status) where status is non-ARCHIVED. The
    # service layer should enforce this too but the DB guards against
    # race conditions promoting two drafts to live.
    op.create_index(
        'uq_module_configs_active',
        'module_configs',
        ['tenant_id', 'page_type', 'module', 'status'],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('DRAFT', 'PREVIEW', 'LIVE')"
        ),
    )

    # ── page_field_configs.module_config_id ──────────────────────────
    op.add_column(
        'page_field_configs',
        sa.Column(
            'module_config_id', postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        'fk_page_field_configs_module_config_id',
        'page_field_configs', 'module_configs',
        ['module_config_id'], ['module_config_id'],
        ondelete='CASCADE',
    )
    op.create_index(
        'ix_page_field_configs_module_config_id',
        'page_field_configs', ['module_config_id'],
    )


def downgrade():
    # NB: this downgrade is safe because the migration is purely
    # additive — nothing else has been wired to module_configs yet.
    # Once Phase 2/3 land, downgrading past this revision needs to
    # restore the PageConfig-based lookup for all field rows; that
    # logic lives in Phase 2's migration.
    op.execute(
        'DROP INDEX IF EXISTS ix_page_field_configs_module_config_id'
    )
    op.execute(
        'ALTER TABLE page_field_configs '
        'DROP CONSTRAINT IF EXISTS fk_page_field_configs_module_config_id'
    )
    op.drop_column('page_field_configs', 'module_config_id')

    op.execute('DROP INDEX IF EXISTS uq_module_configs_active')
    op.execute('DROP INDEX IF EXISTS ix_module_configs_status')
    op.execute('DROP INDEX IF EXISTS ix_module_configs_module')
    op.execute('DROP INDEX IF EXISTS ix_module_configs_page_type')
    op.execute(
        'DROP INDEX IF EXISTS '
        'ix_module_configs_tenant_pagetype_module_status'
    )
    op.drop_table('module_configs')
