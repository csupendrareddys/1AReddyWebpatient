"""Doctor↔hospital affiliation request lifecycle (Round 8).

Adds the columns + indexes needed for the apex-marketplace
"hospital admin adds a doctor" feature:

  * ``doctors.affiliation_invite_code`` + ``..._expires_at`` — short
    opaque code the doctor shares with a hospital/clinic admin so they
    can claim this doctor onto their roster. Tenant-scoped uniqueness
    enforced by a partial unique index (only NOT NULL rows count).

  * ``doctor_hospital_affiliations`` is repurposed to model both
    PENDING and APPROVED relationships in the same table. New
    ``status`` enum (``doctoraffiliationrequeststatus``: PENDING /
    APPROVED / REJECTED / CANCELLED), audit columns for the hospital
    admin who initiated the request, and the redemption method.

    The original ``UniqueConstraint(doctor_id, hospital_id)`` is
    replaced with a *partial* unique index that fires only when
    ``status IN ('pending', 'approved')`` — that way historical
    rejected / cancelled requests stick around for audit but a doctor
    and hospital can legitimately re-invite each other after a prior
    rejection.

Revision ID: e1z2a3b4c5d6
Revises: d0y1z2a3b4c5
Create Date: 2026-05-21
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers
revision = 'e1z2a3b4c5d6'
down_revision = 'd0y1z2a3b4c5'
branch_labels = None
depends_on = None


def upgrade():
    # ── 1. New enum type ──────────────────────────────────────────────
    request_status_enum = postgresql.ENUM(
        'pending', 'approved', 'rejected', 'cancelled',
        name='doctoraffiliationrequeststatus',
    )
    request_status_enum.create(op.get_bind(), checkfirst=True)

    # ── 2. doctors: invite-code columns + partial unique index ────────
    op.add_column(
        'doctors',
        sa.Column('affiliation_invite_code', sa.String(length=40),
                  nullable=True),
    )
    op.add_column(
        'doctors',
        sa.Column('affiliation_invite_code_expires_at',
                  sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        'ix_doctors_affiliation_invite_code',
        'doctors', ['affiliation_invite_code'], unique=False,
    )
    op.create_index(
        'uq_doctors_tenant_affiliation_invite_code',
        'doctors', ['tenant_id', 'affiliation_invite_code'],
        unique=True,
        postgresql_where=sa.text('affiliation_invite_code IS NOT NULL'),
    )

    # ── 3. doctor_hospital_affiliations: lifecycle columns ────────────
    # Reuse the already-created enum. Use server_default so existing
    # rows get a value during the ADD COLUMN — we then update them
    # to a sensible derived status below before stripping the default.
    op.add_column(
        'doctor_hospital_affiliations',
        sa.Column(
            'status',
            postgresql.ENUM(
                'pending', 'approved', 'rejected', 'cancelled',
                name='doctoraffiliationrequeststatus',
                create_type=False,
            ),
            nullable=False,
            server_default='approved',
        ),
    )
    op.add_column(
        'doctor_hospital_affiliations',
        sa.Column('requested_by_user_id',
                  postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_doctor_hospital_affiliations_requested_by_user',
        'doctor_hospital_affiliations', 'users',
        ['requested_by_user_id'], ['user_id'], ondelete='SET NULL',
    )
    op.add_column(
        'doctor_hospital_affiliations',
        sa.Column('request_method', sa.String(length=20), nullable=True),
    )
    op.add_column(
        'doctor_hospital_affiliations',
        sa.Column('invite_code_used', sa.String(length=40), nullable=True),
    )
    op.add_column(
        'doctor_hospital_affiliations',
        sa.Column('requested_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'doctor_hospital_affiliations',
        sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'doctor_hospital_affiliations',
        sa.Column('rejection_reason', sa.String(length=500), nullable=True),
    )

    # Backfill: any pre-existing rows are historical APPROVED links
    # (the only path that wrote them so far was the patient-side
    # query helper at apex, which only filtered by is_active=True).
    # Inactive rows are treated as CANCELLED for the lifecycle column.
    op.execute(
        "UPDATE doctor_hospital_affiliations "
        "SET status = 'approved' WHERE is_active = TRUE"
    )
    op.execute(
        "UPDATE doctor_hospital_affiliations "
        "SET status = 'cancelled' WHERE is_active = FALSE"
    )
    # Drop the server_default — the model carries the Python-side
    # default for new rows so the column stays "honest" about
    # requiring an explicit value.
    op.alter_column(
        'doctor_hospital_affiliations', 'status', server_default=None,
    )

    # ── 4. Swap unique constraint → partial unique index ──────────────
    # The original constraint blocked the legitimate "hospital
    # re-invites doctor after a prior reject" case, so it has to go.
    op.drop_constraint(
        'uq_doctor_hospital', 'doctor_hospital_affiliations',
        type_='unique',
    )
    op.create_index(
        'uq_doctor_hospital_active',
        'doctor_hospital_affiliations',
        ['doctor_id', 'hospital_id'],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('pending', 'approved')"
        ),
    )


def downgrade():
    # ── 4. Partial unique index → restore the original unique constraint
    # Restoring the constraint requires the table to currently have at
    # most one row per (doctor_id, hospital_id). Existing data should
    # already satisfy this because the partial-unique-index above keeps
    # it true (no two PENDING/APPROVED for the same pair) and we will
    # have deleted any REJECTED / CANCELLED rows below before adding
    # back the constraint.
    op.drop_index(
        'uq_doctor_hospital_active',
        table_name='doctor_hospital_affiliations',
    )
    # Drop historical rejected/cancelled rows so the strict unique
    # constraint can be re-added without dup-key conflicts.
    op.execute(
        "DELETE FROM doctor_hospital_affiliations "
        "WHERE status IN ('rejected', 'cancelled')"
    )
    op.create_unique_constraint(
        'uq_doctor_hospital', 'doctor_hospital_affiliations',
        ['doctor_id', 'hospital_id'],
    )

    # ── 3. drop doctor_hospital_affiliations lifecycle columns ───────
    op.drop_column('doctor_hospital_affiliations', 'rejection_reason')
    op.drop_column('doctor_hospital_affiliations', 'responded_at')
    op.drop_column('doctor_hospital_affiliations', 'requested_at')
    op.drop_column('doctor_hospital_affiliations', 'invite_code_used')
    op.drop_column('doctor_hospital_affiliations', 'request_method')
    op.drop_constraint(
        'fk_doctor_hospital_affiliations_requested_by_user',
        'doctor_hospital_affiliations', type_='foreignkey',
    )
    op.drop_column('doctor_hospital_affiliations', 'requested_by_user_id')
    op.drop_column('doctor_hospital_affiliations', 'status')

    # ── 2. drop doctors invite-code columns ──────────────────────────
    op.drop_index(
        'uq_doctors_tenant_affiliation_invite_code', table_name='doctors',
    )
    op.drop_index(
        'ix_doctors_affiliation_invite_code', table_name='doctors',
    )
    op.drop_column('doctors', 'affiliation_invite_code_expires_at')
    op.drop_column('doctors', 'affiliation_invite_code')

    # ── 1. drop enum ─────────────────────────────────────────────────
    postgresql.ENUM(
        name='doctoraffiliationrequeststatus',
    ).drop(op.get_bind(), checkfirst=True)
