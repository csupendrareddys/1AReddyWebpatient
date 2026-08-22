"""Invite flow (phone_verified gate) + clinic-side affiliations.

Round 8.5: layers two changes on top of e1z2a3b4c5d6:

  1. ``users.phone_verified`` Boolean column — the in-tenant signin
     path now gates login on ``email_verified AND phone_verified AND
     NOT must_set_password``. Backfilled to TRUE for every existing
     row so previously-onboarded users keep logging in.

  2. ``doctor_hospital_affiliations.clinic_id`` nullable UUID + a
     CHECK constraint enforcing exactly one of ``hospital_id`` /
     ``clinic_id`` is non-NULL. ``hospital_id`` becomes nullable. The
     partial unique index now keys on both columns so a doctor can be
     active at one hospital OR one clinic but not duplicate either.

Revision ID: f2a3b4c5d6e7
Revises: e1z2a3b4c5d6
Create Date: 2026-05-21
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers
revision = 'f2a3b4c5d6e7'
down_revision = 'e1z2a3b4c5d6'
branch_labels = None
depends_on = None


def upgrade():
    # ── 1. users.phone_verified ─────────────────────────────────────
    # server_default='false' lets the ADD COLUMN succeed without
    # rewriting every row, then we backfill explicitly so existing
    # users (who went through OTP signup) aren't accidentally locked
    # out by the new gate.
    op.add_column(
        'users',
        sa.Column(
            'phone_verified', sa.Boolean(),
            nullable=False, server_default=sa.text('false'),
        ),
    )
    op.create_index(
        'ix_users_phone_verified', 'users', ['phone_verified'],
    )
    # Every existing User pre-dates the invite flow → their phone was
    # already OTP-verified at signup. Backfill to TRUE to preserve
    # signin behavior.
    op.execute('UPDATE users SET phone_verified = TRUE')

    # ── 2. doctor_hospital_affiliations.clinic_id + constraint swap ─
    op.add_column(
        'doctor_hospital_affiliations',
        sa.Column('clinic_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_doctor_hospital_affiliations_clinic_id',
        'doctor_hospital_affiliations', 'clinics',
        ['clinic_id'], ['id'], ondelete='CASCADE',
    )
    op.create_index(
        'ix_doctor_hospital_affiliations_clinic_id',
        'doctor_hospital_affiliations', ['clinic_id'],
    )
    # hospital_id was NOT NULL because every row was a hospital row;
    # with clinic rows also living here it has to be nullable.
    op.alter_column(
        'doctor_hospital_affiliations', 'hospital_id',
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    # Exactly one of hospital_id / clinic_id must be set.
    op.create_check_constraint(
        'ck_doctor_hospital_affiliations_facility_xor',
        'doctor_hospital_affiliations',
        '(hospital_id IS NOT NULL AND clinic_id IS NULL) '
        'OR (hospital_id IS NULL AND clinic_id IS NOT NULL)',
    )
    # Replace the old partial unique index (keyed only on
    # hospital_id) with one that keys on both, so a doctor can be
    # active at one facility-of-each-kind but not duplicate either.
    op.drop_index(
        'uq_doctor_hospital_active',
        table_name='doctor_hospital_affiliations',
    )
    op.create_index(
        'uq_doctor_facility_active',
        'doctor_hospital_affiliations',
        ['doctor_id', 'hospital_id', 'clinic_id'],
        unique=True,
        postgresql_where=sa.text("status IN ('pending', 'approved')"),
    )


def downgrade():
    # ── 2. revert affiliation changes ───────────────────────────────
    #
    # NB: ``db.create_all()`` (used by the bootstrap-on-empty-DB path
    # in CI) names FKs / checks / indexes per SQLAlchemy's default
    # convention, which differs from the explicit names this
    # migration set in upgrade(). To roundtrip cleanly in *both* a
    # migration-built schema AND a model-built schema, drop these by
    # raw SQL with ``IF EXISTS`` and try both names.
    op.execute(
        'DROP INDEX IF EXISTS uq_doctor_facility_active'
    )
    op.create_index(
        'uq_doctor_hospital_active',
        'doctor_hospital_affiliations',
        ['doctor_id', 'hospital_id'],
        unique=True,
        postgresql_where=sa.text("status IN ('pending', 'approved')"),
    )
    op.execute(
        'ALTER TABLE doctor_hospital_affiliations '
        'DROP CONSTRAINT IF EXISTS '
        'ck_doctor_hospital_affiliations_facility_xor'
    )
    # Restoring hospital_id NOT NULL requires deleting clinic-only
    # rows first so the column doesn't fail the constraint.
    op.execute(
        'DELETE FROM doctor_hospital_affiliations '
        'WHERE hospital_id IS NULL'
    )
    op.alter_column(
        'doctor_hospital_affiliations', 'hospital_id',
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.execute(
        'DROP INDEX IF EXISTS ix_doctor_hospital_affiliations_clinic_id'
    )
    # FK name differs depending on how the schema was built:
    #   migration-built → ``fk_doctor_hospital_affiliations_clinic_id``
    #   db.create_all() → ``doctor_hospital_affiliations_clinic_id_fkey``
    op.execute(
        'ALTER TABLE doctor_hospital_affiliations '
        'DROP CONSTRAINT IF EXISTS '
        'fk_doctor_hospital_affiliations_clinic_id'
    )
    op.execute(
        'ALTER TABLE doctor_hospital_affiliations '
        'DROP CONSTRAINT IF EXISTS '
        'doctor_hospital_affiliations_clinic_id_fkey'
    )
    op.drop_column('doctor_hospital_affiliations', 'clinic_id')

    # ── 1. revert users.phone_verified ──────────────────────────────
    op.execute('DROP INDEX IF EXISTS ix_users_phone_verified')
    op.drop_column('users', 'phone_verified')
