"""Public anonymous booking — User.must_set_password + PendingPublicBooking + addon seed.

Three changes:

  1. ``users.must_set_password`` (Boolean, default False) — flag set when a
     ``User`` is auto-created by the public-booking flow (no password ever
     entered by the patient). The frontend route guard force-redirects
     such users through ``/book/set-password`` after first OTP login.

  2. New ``pending_public_bookings`` table — transient form-state +
     Razorpay order ref between ``/api/public/booking/initiate`` and
     ``.../verify``. Holds the patient details so we don't write a
     ``User`` row until payment lands. RLS-enforced like every other
     tenant-scoped table.

  3. Catalog seed: one new ``Addon`` row with code ``public_booking`` /
     feature_path ``public.booking``. The platform tenant always passes
     the gate (``PLATFORM_OWNER`` bypass / anonymous-on-platform-host
     check); other tenants would need a ``TenantAddon`` link. Seeding
     here so the catalog is in a known state on fresh installs.

The existing ``time_slots.soft_reservation_expiry`` column is reused for
the public-booking pre-lock — no new column needed. Anonymous locks have
``soft_reserved_for_patient_id IS NULL`` + ``soft_reservation_expiry`` set;
authenticated locks have both populated.

Revision ID: e2f3a4b5c6d7
Revises: h8c9d0e1f2a3
Create Date: 2026-04-30

Note on parentage: this was briefly modelled as a tuple-merge of
``d0e1f2a3b4c5`` + ``h8c9d0e1f2a3`` because those two heads landed on
``main`` in parallel. The CI roundtrip step (``flask db downgrade -1``)
can't walk a merge revision deterministically — it raises "Ambiguous
walk" — so we collapsed the tree to a strict linear chain instead by
re-parenting ``h8`` onto ``d0e1`` (see that file's docstring) and
having this revision descend from ``h8`` alone.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'e2f3a4b5c6d7'
down_revision = 'h8c9d0e1f2a3'
branch_labels = None
depends_on = None


def upgrade():
    # ── 1. users.must_set_password ────────────────────────────────────
    op.add_column(
        'users',
        sa.Column(
            'must_set_password', sa.Boolean(),
            nullable=False, server_default=sa.false(),
        ),
    )
    op.create_index(
        'ix_users_must_set_password', 'users', ['must_set_password'],
    )

    # ── 2. pending_public_bookings table ──────────────────────────────
    op.create_table(
        'pending_public_bookings',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('doctor_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('time_slot_id', UUID(as_uuid=True), nullable=False, index=True),
        sa.Column('consultation_type', sa.String(length=30), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('phone_number', sa.String(length=20), nullable=False, index=True),
        sa.Column('email', sa.String(length=320), nullable=True),
        sa.Column('dob', sa.Date(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('razorpay_order_id', sa.String(length=100), nullable=False, unique=True, index=True),
        sa.Column('razorpay_payment_id', sa.String(length=100), nullable=True),
        sa.Column('amount_paise', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending', index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('consumed_user_id', UUID(as_uuid=True), nullable=True),
        sa.Column('consumed_appointment_id', UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(
            ['tenant_id'], ['tenants.id'],
            ondelete='CASCADE', name='fk_pending_public_bookings_tenant',
        ),
        sa.ForeignKeyConstraint(
            ['doctor_id'], ['doctors.doctor_id'],
            ondelete='CASCADE', name='fk_pending_public_bookings_doctor',
        ),
        sa.ForeignKeyConstraint(
            ['time_slot_id'], ['time_slots.id'],
            ondelete='CASCADE', name='fk_pending_public_bookings_time_slot',
        ),
        sa.ForeignKeyConstraint(
            ['consumed_user_id'], ['users.user_id'],
            ondelete='SET NULL', name='fk_pending_public_bookings_user',
        ),
        sa.ForeignKeyConstraint(
            ['consumed_appointment_id'], ['appointments.appointment_id'],
            ondelete='SET NULL', name='fk_pending_public_bookings_appointment',
        ),
    )

    # ── RLS policies (canonical helper) ──────────────────────────────
    from app.models._base import generate_rls_sql

    for stmt in generate_rls_sql('pending_public_bookings'):
        op.execute(stmt)

    # ── 3. Public Booking add-on seed ────────────────────────────────
    # Idempotent: skip if a row with this code already exists. Done via
    # raw SQL because the model layer isn't necessarily importable at
    # migration time and we want zero side effects on rollback.
    #
    # ``addonstatus`` enum is persisted by Python member NAME (e.g.
    # ``'ACTIVE'``) — same convention as ``configstatus``,
    # ``permissionmodule``, etc. across this project. Using the
    # lowercase ``.value`` here would raise ``invalid input value for
    # enum addonstatus`` and was caught by the CI roundtrip step.
    op.execute("""
        INSERT INTO addons (id, code, name, description, status, features, created_at, updated_at)
        VALUES (
            gen_random_uuid(),
            'public_booking',
            'Public Booking',
            'Allow anonymous visitors to book a consultation slot from the public landing page. Account is auto-created on payment; first login is via phone OTP.',
            'ACTIVE',
            '{"public.booking": true}'::json,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (code) DO NOTHING
    """)


def downgrade():
    # Catalog seed — remove the row we inserted (best-effort).
    op.execute("DELETE FROM addons WHERE code = 'public_booking'")

    # RLS + table
    op.execute("DROP POLICY IF EXISTS tenant_insert_pending_public_bookings ON pending_public_bookings")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_pending_public_bookings ON pending_public_bookings")
    op.execute("ALTER TABLE pending_public_bookings NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE pending_public_bookings DISABLE ROW LEVEL SECURITY")
    op.drop_table('pending_public_bookings')

    # users column
    op.drop_index('ix_users_must_set_password', table_name='users')
    op.drop_column('users', 'must_set_password')
