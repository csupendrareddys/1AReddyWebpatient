"""membership plan caps for support staff and my link

Revision ID: b64b68869562
Revises: c37d43949ac5
Create Date: 2026-08-08 11:05:52.486351

Hand-trimmed. Autogenerate additionally swept in three items that have nothing
to do with this change and pre-date it — a tenant FK on ``charge_policies`` and
an index rename on ``feature_doctors`` / ``platform_feature_doctors``. They are
left where they were rather than smuggled in under a membership-plan message,
so that whoever fixes them can do it in a migration that says so.

Both columns are nullable, and NULL means **unlimited** here rather than "not
backfilled yet" (the reading ``Plan.max_provider_*`` uses). These arrive on a
table whose rows already have subscribers: any other default would have this
migration take support staff away from every existing member.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b64b68869562'
down_revision = 'c37d43949ac5'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('membership_plans', schema=None) as batch_op:
        batch_op.add_column(sa.Column('max_support_staff', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('max_link_connections', sa.Integer(), nullable=True))
        # NULL already says "unlimited", so a negative has no meaning left to
        # carry. The admin route folds ``-1`` into NULL on the way in; this
        # stops anything that bypasses the route from storing a second
        # spelling of the same thing.
        batch_op.create_check_constraint(
            'ck_membership_plan_capacity_nonneg',
            '(max_support_staff IS NULL OR max_support_staff >= 0) AND '
            '(max_link_connections IS NULL OR max_link_connections >= 0)',
        )


def downgrade():
    with op.batch_alter_table('membership_plans', schema=None) as batch_op:
        batch_op.drop_constraint('ck_membership_plan_capacity_nonneg', type_='check')
        batch_op.drop_column('max_link_connections')
        batch_op.drop_column('max_support_staff')
