"""Add 'patient' to the membershipvertical enum.

Lets a patient hold a marketplace (receiver) membership subscription, chosen at
registration — a ``MembershipSubscription`` with provider_type='patient' and
provider_id = the patients row. Additive; existing rows are unaffected.

Revision ID: pat1ent2plan3vert
Revises: ordr8attach9link0
Create Date: 2026-07-24
"""
from alembic import op


revision = 'pat1ent2plan3vert'
down_revision = 'ordr8attach9link0'
branch_labels = None
depends_on = None


def upgrade():
    # This enum type stores the member NAMES (DOCTOR / CLINIC / HOSPITAL — the
    # SQLAlchemy default), so the new label must be the uppercase name 'PATIENT'
    # to match MembershipVertical.PATIENT. PG12+ allows ADD VALUE in a txn when
    # the value isn't used in the same txn (it isn't here).
    op.execute("ALTER TYPE membershipvertical ADD VALUE IF NOT EXISTS 'PATIENT'")


def downgrade():
    # Postgres cannot DROP a value from an enum type; leaving 'patient' in place
    # is harmless (no rows reference it after a downgrade of the feature).
    pass
