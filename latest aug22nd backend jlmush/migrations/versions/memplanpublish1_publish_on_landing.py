"""Membership plan: publish_on_landing flag

An ACTIVE plan is only offered for self-serve signup on the public landing when
publish_on_landing is True; otherwise it exists and works but can only be
assigned to a member by an admin.

Revision ID: memplanpublish1
Revises: 3f1cefde8fe0
Create Date: 2026-07-28
"""
from alembic import op
import sqlalchemy as sa


revision = 'memplanpublish1'
down_revision = '3f1cefde8fe0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('membership_plans', sa.Column(
        'publish_on_landing', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    # Preserve current behaviour: plans that are already ACTIVE keep being
    # self-serve on the landing. New plans default to unpublished (admin-assign
    # only until an admin explicitly publishes them).
    op.execute("UPDATE membership_plans SET publish_on_landing = true "
               "WHERE status = 'ACTIVE'")


def downgrade():
    op.drop_column('membership_plans', 'publish_on_landing')
