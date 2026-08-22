"""backfill profile_owner phase B

Revision ID: a3b72202636b
Revises: a52b139f7fb0
Create Date: 2026-07-16 13:38:35.000008

Phase B of centralizing per-actor profile details
(see docs/profile-owner-centralization.md).

  1. Creates one ``profile_owner`` row per existing Doctor / Admin / Clinic /
     Hospital / AuthorizedPersonnel (idempotent via ON CONFLICT DO NOTHING).
  2. Points every existing profile sub-table row at its owner by matching the
     legacy doctor_id / admin_id / authorized_personnel_id columns.

Runs as the ``postgres`` superuser (RLS-bypassing), so the cross-tenant
INSERT/UPDATE is allowed without per-tenant SET LOCAL. Idempotent and safely
re-runnable; ``downgrade`` clears the backfill.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a3b72202636b'
down_revision = 'a52b139f7fb0'
branch_labels = None
depends_on = None


# Owner rows are created for ALL actors (including soft-deleted ones) so every
# existing sub-table row can be linked regardless of the actor's is_deleted.
# (owner_type, source_table, profile_owner_fk_col, source_pk_col)
_OWNER_INSERTS = (
    ("doctor",               "doctors",              "doctor_id",               "doctor_id"),
    ("admin",                "admins",               "admin_id",                "admin_id"),
    ("clinic",               "clinics",              "clinic_id",               "id"),
    ("hospital",             "hospitals",            "hospital_id",             "hospital_id"),
    ("authorized_personnel", "authorized_personnel", "authorized_personnel_id", "id"),
)

# The five doctor/admin-owned sub-tables (education is handled separately since
# it also carries authorized_personnel_id).
_DOCTOR_ADMIN_SUBTABLES = (
    'profile_signatures',
    'profile_about',
    'profile_bank_accounts',
    'profile_declaration_responses',
    'profile_documents',
)


def upgrade():
    conn = op.get_bind()

    # 1) one profile_owner row per actor of each type
    for owner_type, table, po_col, src_pk in _OWNER_INSERTS:
        conn.execute(sa.text(f"""
            INSERT INTO profile_owner (id, tenant_id, owner_type, {po_col}, created_at, updated_at)
            SELECT gen_random_uuid(), t.tenant_id, '{owner_type}', t.{src_pk}, now(), now()
            FROM {table} t
            ON CONFLICT (tenant_id, {po_col}) DO NOTHING
        """))

    # 2a) doctor/admin-owned sub-tables
    for tbl in _DOCTOR_ADMIN_SUBTABLES:
        conn.execute(sa.text(f"""
            UPDATE {tbl} s
            SET profile_owner_id = o.id
            FROM profile_owner o
            WHERE o.tenant_id = s.tenant_id
              AND s.profile_owner_id IS NULL
              AND ( (s.doctor_id IS NOT NULL AND o.doctor_id = s.doctor_id)
                 OR (s.admin_id  IS NOT NULL AND o.admin_id  = s.admin_id) )
        """))

    # 2b) education — doctor / admin / authorized_personnel
    conn.execute(sa.text("""
        UPDATE profile_education s
        SET profile_owner_id = o.id
        FROM profile_owner o
        WHERE o.tenant_id = s.tenant_id
          AND s.profile_owner_id IS NULL
          AND ( (s.doctor_id IS NOT NULL AND o.doctor_id = s.doctor_id)
             OR (s.admin_id  IS NOT NULL AND o.admin_id  = s.admin_id)
             OR (s.authorized_personnel_id IS NOT NULL
                 AND o.authorized_personnel_id = s.authorized_personnel_id) )
    """))


def downgrade():
    conn = op.get_bind()
    for tbl in _DOCTOR_ADMIN_SUBTABLES + ('profile_education',):
        conn.execute(sa.text(f"UPDATE {tbl} SET profile_owner_id = NULL"))
    conn.execute(sa.text("DELETE FROM profile_owner"))
