"""Membership plan payments: subscription.plan_period + payment link

Adds the paid billing PERIOD to a membership subscription and a link from a
Payment to the membership subscription it settled, so plan-based providers can
pay to activate / renew / upgrade a tier via the Razorpay create-order path.

Revision ID: memberpay1
Revises: prodlink1
Create Date: 2026-07-30

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "memberpay1"
down_revision = "prodlink1"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("membership_subscriptions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("plan_period", sa.String(length=20), nullable=True))

    with op.batch_alter_table("payments", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("membership_subscription_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True)
        )
        batch_op.create_index(
            "ix_payments_membership_subscription_id", ["membership_subscription_id"]
        )
        batch_op.create_foreign_key(
            "fk_payments_membership_subscription_id",
            "membership_subscriptions",
            ["membership_subscription_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade():
    # Drop the column directly — Postgres cascades its FK constraint and index
    # automatically. Dropping them by name first would break the create_all()
    # bootstrap roundtrip, where SQLAlchemy auto-names the FK
    # (``payments_membership_subscription_id_fkey``) rather than the explicit
    # name this migration's upgrade() uses.
    with op.batch_alter_table("payments", schema=None) as batch_op:
        batch_op.drop_column("membership_subscription_id")

    with op.batch_alter_table("membership_subscriptions", schema=None) as batch_op:
        batch_op.drop_column("plan_period")
