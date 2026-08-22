"""Allow a display pricing rule with no doctor (group offerings)

A group offering is an admin-authored plan with a team of doctors behind it and
a single ``patient_price``. Its display-pricing overlay therefore belongs to the
offering, not to any one member, so ``display_pricing_rules.doctor_id`` becomes
nullable and ``scope_key`` holds the group offering id.

Postgres treats NULLs as distinct inside a UNIQUE constraint, so
``uq_display_pricing_scope`` stops constraining anything once doctor_id is NULL.
A partial unique index covers exactly that case, keeping "one rule per scope"
true on both halves.

Revision ID: grpoff1price2ovl3
Revises: platdisc1wide2pct3
Create Date: 2026-07-27
"""
from alembic import op
import sqlalchemy as sa


revision = 'grpoff1price2ovl3'
down_revision = 'platdisc1wide2pct3'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        'display_pricing_rules', 'doctor_id',
        existing_type=sa.dialects.postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    op.create_index(
        'uq_display_pricing_scope_no_doctor',
        'display_pricing_rules',
        ['tenant_id', 'scope_type', 'scope_key'],
        unique=True,
        postgresql_where=sa.text('doctor_id IS NULL'),
    )


def downgrade():
    op.drop_index('uq_display_pricing_scope_no_doctor',
                  table_name='display_pricing_rules')
    # Doctor-less rules cannot survive the column going back to NOT NULL.
    op.execute('DELETE FROM display_pricing_rules WHERE doctor_id IS NULL')
    op.alter_column(
        'display_pricing_rules', 'doctor_id',
        existing_type=sa.dialects.postgresql.UUID(as_uuid=True),
        nullable=False,
    )
