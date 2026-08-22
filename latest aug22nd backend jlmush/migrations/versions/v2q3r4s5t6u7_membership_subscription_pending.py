"""Add ``PENDING`` value to ``membershipsubscriptionstatus`` enum.

Round 2 — pre-signup plan picker. The doctor-signup flow creates a
``MembershipSubscription`` row before the admin has verified the
doctor's credentials. We want the trial clock to start on approval,
not on signup, so the row needs an intermediate ``PENDING`` state
where ``trial_ends_at`` is NULL. The doctor-approval handler flips
PENDING → TRIAL and seeds the trial end-date.

Idempotent via ``ADD VALUE IF NOT EXISTS``. ``BEFORE 'TRIAL'`` keeps
the enum literal ordering meaningful (PENDING comes first lifecycle-
wise) even though Postgres doesn't enforce ordering on the value.

The partial unique index on ``membership_subscriptions`` only filters
``status IN ('TRIAL', 'ACTIVE')`` — PENDING rows are deliberately
excluded so a provider can have a PENDING row that gets activated
without first dropping the index entry, AND so an admin couldn't
accidentally create a second PENDING row for the same provider
(application-layer guard in the service catches this).

There's nothing to undo on downgrade — Postgres doesn't support
removing values from an enum once they exist. We make the downgrade
a no-op to keep ``flask db downgrade`` cleanly invertible against
this migration.

Revision ID: v2q3r4s5t6u7
Revises: u1p2k3l4m5n6
Create Date: 2026-05-16
"""
from alembic import op


# revision identifiers
revision = 'v2q3r4s5t6u7'
down_revision = 'u1p2k3l4m5n6'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TYPE membershipsubscriptionstatus "
        "ADD VALUE IF NOT EXISTS 'PENDING' BEFORE 'TRIAL';"
    )


def downgrade():
    # Postgres has no DROP VALUE for enums. The 'PENDING' value is
    # therefore non-removable once added. Leaving the value in place
    # is safe: it's only referenced by application-layer code and
    # subscriptions in PENDING state will exist if Round 2 ever ran.
    pass
