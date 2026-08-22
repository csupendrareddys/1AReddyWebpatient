"""Master data: per-qualification-level scoping for colleges + specializations.

Why
---
Doctor signup (and the existing profile editor) needs to offer DIFFERENT
master lists for UG / PG / Super-Speciality colleges, and the same for
the specializations attached to each level. Until now, ``master_colleges``
held one global list and ``categories.category_type='specialization'``
held one global specialization list — both per-tenant but level-agnostic.

We add a nullable ``qualification_level`` column to both tables. Existing
rows stay at NULL (treated as "all levels" / backwards-compatible). The
admin master-data UI will let the operator stamp the level on new rows
and edit existing ones, and the signup data resolver filters by level
when the field's ``data_source`` is e.g. ``master_colleges:ug``.

Values used at the application layer: ``ug``, ``pg``, ``super_speciality``.
The column is a free-form ``String(20)`` (not a DB enum) so that new
levels can be added without another migration.

Revision ID: p6k7f8a9b0c1
Revises: o5j6e7f8a9b0
Create Date: 2026-05-11
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = 'p6k7f8a9b0c1'
down_revision = 'o5j6e7f8a9b0'
branch_labels = None
depends_on = None


def upgrade():
    # master_colleges.qualification_level
    op.add_column(
        'master_colleges',
        sa.Column('qualification_level', sa.String(length=20), nullable=True),
    )
    op.create_index(
        'ix_master_colleges_tenant_level',
        'master_colleges',
        ['tenant_id', 'qualification_level'],
    )

    # categories.qualification_level
    op.add_column(
        'categories',
        sa.Column('qualification_level', sa.String(length=20), nullable=True),
    )
    op.create_index(
        'ix_categories_tenant_type_level',
        'categories',
        ['tenant_id', 'category_type', 'qualification_level'],
    )


def downgrade():
    op.drop_index('ix_categories_tenant_type_level', table_name='categories')
    op.drop_column('categories', 'qualification_level')

    op.drop_index('ix_master_colleges_tenant_level', table_name='master_colleges')
    op.drop_column('master_colleges', 'qualification_level')
