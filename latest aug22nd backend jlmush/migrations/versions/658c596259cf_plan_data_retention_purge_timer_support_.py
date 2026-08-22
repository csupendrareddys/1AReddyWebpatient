"""plan data retention + purge timer + support_chat module

Revision ID: 658c596259cf
Revises: 24fcfa1cc769
Create Date: 2026-08-21 08:12:37.739011

Hand-scoped (same rationale as 24fcfa1cc769): autogen also proposed the
unrelated group_offerings.product_category and saas_categories index
churn drift — stripped so this migration carries exactly the retention
feature: the two new columns and the SUPPORT_CHAT permission value.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '658c596259cf'
down_revision = '24fcfa1cc769'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('plans', schema=None) as batch_op:
        batch_op.add_column(sa.Column(
            'data_retention_days', sa.Integer(),
            server_default='180', nullable=False))

    with op.batch_alter_table('tenant_subscriptions', schema=None) as batch_op:
        batch_op.add_column(sa.Column(
            'data_purge_after', sa.DateTime(timezone=True), nullable=True))

    # PermissionModule gains SUPPORT_CHAT. Values in this PG enum are the
    # Python member NAMES (uppercase). PG >= 12 allows ADD VALUE inside a
    # transaction as long as the new value isn't used in the same one.
    op.execute("ALTER TYPE permissionmodule ADD VALUE IF NOT EXISTS "
               "'SUPPORT_CHAT'")


def downgrade():
    # PG cannot drop enum values; leaving SUPPORT_CHAT in place is
    # harmless for older code (it simply never references it).
    with op.batch_alter_table('tenant_subscriptions', schema=None) as batch_op:
        batch_op.drop_column('data_purge_after')

    with op.batch_alter_table('plans', schema=None) as batch_op:
        batch_op.drop_column('data_retention_days')
