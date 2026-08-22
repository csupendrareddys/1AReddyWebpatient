"""Marketplace clinics + hospital owner binding (Round 3+4).

Adds the schema for marketplace clinic + hospital signup on the apex:

  * New ``CLINIC`` and ``HOSPITAL`` values on the ``userrole`` enum so
    apex signups can mint Users with the right role.
  * New ``CLINIC_VERIFICATION`` / ``HOSPITAL_VERIFICATION`` values on
    the RBAC ``permissionmodule`` enum so sub-admins can be granted
    facility-verification rights independently.
  * Two new nullable columns on ``hospitals``: ``admin_user_id`` (FK
    to the apex User who owns this hospital's marketplace membership)
    and ``admin_aadhaar_attachment`` (S3 key).
  * Brand-new ``clinics`` table — smaller cousin of ``hospitals``
    (no facilities / images / hospital_type), with the same address
    shape and ``verification_status`` lifecycle.

Enum literals use uppercase member NAMES because SQLAlchemy's
``db.Enum(PyEnum)`` stores ``Enum.name`` not ``Enum.value`` — same
convention every other migration in this tree follows.

Downgrade drops the new ``clinics`` table and the two new hospital
columns. Postgres has no ``DROP VALUE`` for enums, so the enum
additions are not removable — that's safe because no rows reference
``CLINIC`` / ``HOSPITAL`` after downgrade (User rows in those roles
would have soft-deleted with the rollback). Leaving the values in
place is the standard pattern (see ``v2q3r4s5t6u7``).

Revision ID: w3r4s5t6u7v8
Revises: v2q3r4s5t6u7
Create Date: 2026-05-18
"""
from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers
revision = 'w3r4s5t6u7v8'
down_revision = 'v2q3r4s5t6u7'
branch_labels = None
depends_on = None


# ``userverificationstatus`` is a SHARED Postgres enum — it already
# exists at this point in the migration chain (created when Doctor's
# verification_status column was first introduced). The clinic table
# needs to reference it WITHOUT recreating it; ``sa.Enum(...,
# create_type=False)`` is documented to do this but doesn't always
# honour create_type during ``op.create_table`` (the second upgrade
# after a downgrade then trips with ``DuplicateObject: type
# userverificationstatus already exists``).
#
# ``postgresql.ENUM(..., create_type=False)`` is the reliable form
# used by every other migration in this tree (e.g.
# ``u1p2k3l4m5n6_membership_plans``). Build the column-level handle
# once and reuse it inside ``create_table``.
_VERIFICATION_STATUS_COL = postgresql.ENUM(
    'PENDING', 'VERIFIED', 'REJECTED',
    name='userverificationstatus', create_type=False,
)


_USERROLE_ADDS = ('CLINIC', 'HOSPITAL')
_PERMISSIONMODULE_ADDS = (
    'CLINIC_VERIFICATION', 'HOSPITAL_VERIFICATION',
    'CLINIC_LIST', 'CLINIC_PROFILE',
)


def upgrade():
    # ── Enum value additions ─────────────────────────────────────
    for value in _USERROLE_ADDS:
        op.execute(
            f"ALTER TYPE userrole ADD VALUE IF NOT EXISTS '{value}';"
        )
    for value in _PERMISSIONMODULE_ADDS:
        op.execute(
            f"ALTER TYPE permissionmodule ADD VALUE IF NOT EXISTS '{value}';"
        )

    # ── hospitals: marketplace owner binding ─────────────────────
    op.add_column(
        'hospitals',
        sa.Column(
            'admin_user_id', UUID(as_uuid=True),
            sa.ForeignKey('users.user_id', ondelete='SET NULL'),
            nullable=True,
        ),
    )
    op.create_index(
        'ix_hospitals_admin_user_id',
        'hospitals', ['admin_user_id'],
    )
    op.add_column(
        'hospitals',
        sa.Column('admin_aadhaar_attachment', sa.Text(), nullable=True),
    )

    # ── clinics (new table) ──────────────────────────────────────
    op.create_table(
        'clinics',
        sa.Column(
            'id', UUID(as_uuid=True),
            primary_key=True, default=uuid.uuid4,
        ),
        # TenantMixin
        sa.Column(
            'tenant_id', UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'),
            nullable=False, index=True,
        ),
        # Marketplace owner — nullable at schema level so a partial
        # bootstrap doesn't break; signup endpoint always sets it.
        sa.Column(
            'admin_user_id', UUID(as_uuid=True),
            sa.ForeignKey('users.user_id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('name', sa.String(300), nullable=False),
        sa.Column('registration_number', sa.String(100), nullable=True),
        # Contact
        sa.Column('phone', sa.String(15), nullable=True),
        sa.Column('email', sa.String(254), nullable=True),
        sa.Column('website', sa.String(500), nullable=True),
        # Address (mirrors Hospital)
        sa.Column('address', sa.Text(), nullable=False),
        sa.Column('city', sa.String(100), nullable=False),
        sa.Column('state', sa.String(100), nullable=False),
        sa.Column('pincode', sa.String(10), nullable=False),
        sa.Column('latitude', sa.Numeric(10, 8), nullable=True),
        sa.Column('longitude', sa.Numeric(11, 8), nullable=True),
        # S3 keys captured during signup
        sa.Column('registration_certificate', sa.Text(), nullable=True),
        sa.Column('admin_aadhaar_attachment', sa.Text(), nullable=True),
        # Status — ``index=True`` mirrors ``Clinic.is_active``'s column
        # declaration so Alembic's schema-parity check finds a matching
        # ``ix_clinics_is_active`` index. The composite partial-where
        # index ``ix_clinics_active`` below is a *different* index
        # (filtered on is_deleted=false); both coexist.
        sa.Column(
            'is_active', sa.Boolean(),
            nullable=False, server_default=sa.true(), index=True,
        ),
        sa.Column(
            'verification_status',
            _VERIFICATION_STATUS_COL,
            nullable=False, server_default='PENDING',
        ),
        # TimestampMixin
        sa.Column(
            'created_at', sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text('CURRENT_TIMESTAMP'),
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text('CURRENT_TIMESTAMP'),
        ),
        # SoftDeleteMixin — ``index=True`` matches the mixin's column
        # declaration (Backend/app/models/_base.py:46-52) so the schema
        # parity check finds ``ix_clinics_is_deleted``.
        sa.Column(
            'is_deleted', sa.Boolean(), nullable=False,
            server_default=sa.false(), index=True,
        ),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        # AuditMixin
        sa.Column(
            'created_by_id', UUID(as_uuid=True),
            sa.ForeignKey('users.user_id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column(
            'updated_by_id', UUID(as_uuid=True),
            sa.ForeignKey('users.user_id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.UniqueConstraint(
            'tenant_id', 'registration_number',
            name='uq_clinic_tenant_registration_number',
        ),
    )
    op.create_index(
        'ix_clinics_registration_number',
        'clinics', ['registration_number'],
    )
    op.create_index('ix_clinic_tenant_city', 'clinics', ['tenant_id', 'city'])
    op.create_index('ix_clinics_city', 'clinics', ['city'])
    op.create_index('ix_clinics_pincode', 'clinics', ['pincode'])
    op.create_index(
        'ix_clinics_admin_user_id', 'clinics', ['admin_user_id'],
    )
    op.create_index(
        'ix_clinics_active', 'clinics', ['tenant_id', 'is_active'],
        postgresql_where=sa.text('is_deleted = FALSE'),
    )


def downgrade():
    # Drop the new clinics table + its indexes.
    op.drop_index('ix_clinics_active', table_name='clinics')
    op.drop_index('ix_clinics_admin_user_id', table_name='clinics')
    op.drop_index('ix_clinics_pincode', table_name='clinics')
    op.drop_index('ix_clinics_city', table_name='clinics')
    op.drop_index('ix_clinic_tenant_city', table_name='clinics')
    op.drop_index('ix_clinics_registration_number', table_name='clinics')
    op.drop_table('clinics')

    # Drop the two new hospital columns.
    op.drop_index('ix_hospitals_admin_user_id', table_name='hospitals')
    op.drop_column('hospitals', 'admin_aadhaar_attachment')
    op.drop_column('hospitals', 'admin_user_id')

    # Enum ADD VALUEs are intentionally NOT undone — Postgres has no
    # DROP VALUE. Leaving CLINIC / HOSPITAL / CLINIC_VERIFICATION /
    # HOSPITAL_VERIFICATION values present is safe; nothing references
    # them after the table drops + column drops above.
