"""Operations module — appointment audit + ops audit log + slot uniqueness + perms

Adds the schema the super-admin Operations (act-on-behalf) module needs:

  * ``appointments.initiated_by_id`` — which user booked the appointment
    (NULL = patient self-booked; set to the acting admin for on-behalf).
  * ``operations_audit_logs`` — trail of every Operations write (profile
    edits, bookings).
  * New ``permissionmodule`` enum values (operations_*) so sub-admins can be
    granted scoped Operations access later.

Slot double-booking is prevented by the row-level ``SELECT ... FOR UPDATE``
lock in ``TimeSlotService.book_slot`` (not a unique index), so nothing here
touches the appointments index set.

All additive/nullable. On a fresh DB ``db.create_all()`` produces the same
shape (this migration is only applied on existing DBs via ``flask db upgrade``).

Revision ID: n0a1b2c3d4e5
Revises: m9h0i1j2k3l4
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSON


revision = 'n0a1b2c3d4e5'
down_revision = 'm9h0i1j2k3l4'
branch_labels = None
depends_on = None


def upgrade():
    # 1. appointments.initiated_by_id ---------------------------------------
    op.add_column(
        'appointments',
        sa.Column('initiated_by_id', UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        'fk_appointments_initiated_by_id',
        'appointments', 'users',
        ['initiated_by_id'], ['user_id'],
        ondelete='SET NULL',
    )
    op.create_index(
        'ix_appointments_initiated_by_id',
        'appointments', ['initiated_by_id'],
    )

    # 2. operations_audit_logs ---------------------------------------------
    op.create_table(
        'operations_audit_logs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
                  sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('actor_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True),
        sa.Column('target_type', sa.String(30), nullable=False),
        sa.Column('target_id', UUID(as_uuid=True), nullable=False),
        sa.Column('action', sa.String(50), nullable=False),
        sa.Column('summary', JSON, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_operations_audit_logs_tenant_id', 'operations_audit_logs', ['tenant_id'])
    op.create_index('ix_operations_audit_logs_actor_id', 'operations_audit_logs', ['actor_id'])
    op.create_index('ix_operations_audit_logs_target_id', 'operations_audit_logs', ['target_id'])
    op.create_index('ix_operations_audit_logs_created_at', 'operations_audit_logs', ['created_at'])
    op.create_index('ix_ops_audit_tenant_target', 'operations_audit_logs',
                    ['tenant_id', 'target_type', 'target_id'])
    op.create_index('ix_ops_audit_tenant_actor', 'operations_audit_logs',
                    ['tenant_id', 'actor_id', 'created_at'])

    # 3. permissionmodule enum values --------------------------------------
    # PG16 allows ADD VALUE inside a transaction as long as the value isn't
    # USED in the same transaction (we don't). IF NOT EXISTS makes re-runs and
    # the create_all path (which already has them) safe.
    for value in ('operations_patient', 'operations_booking',
                  'operations_doctor', 'operations_admin'):
        op.execute(
            f"ALTER TYPE permissionmodule ADD VALUE IF NOT EXISTS '{value}'"
        )


def downgrade():
    # Enum values can't be dropped in Postgres — leave them (harmless).
    op.drop_table('operations_audit_logs')
    op.execute('DROP INDEX IF EXISTS ix_appointments_initiated_by_id')
    op.execute(
        'ALTER TABLE appointments DROP CONSTRAINT IF EXISTS '
        'fk_appointments_initiated_by_id'
    )
    op.drop_column('appointments', 'initiated_by_id')
