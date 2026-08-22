"""Admin group-offering template flag on doctor_products (Item 3D admin)

Adds doctor_products.is_group_service — when True the catalog item is a group
offering (doctors form multi-doctor groups against it) rather than an
individually-sold service. Additive; defaults False.

Revision ID: b4o5p6q7r8s9
Revises: a3n4o5p6q7r8
Create Date: 2026-07-14
"""
from alembic import op


revision = 'b4o5p6q7r8s9'
down_revision = 'a3n4o5p6q7r8'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE doctor_products ADD COLUMN IF NOT EXISTS "
        "is_group_service BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_doctor_products_is_group_service "
               "ON doctor_products (is_group_service)")


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_doctor_products_is_group_service")
    op.execute("ALTER TABLE doctor_products DROP COLUMN IF EXISTS is_group_service")
