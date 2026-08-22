"""profile_owner canonical enable clinic hospital phase D core

Revision ID: be1adf4e1a11
Revises: a3b72202636b
Create Date: 2026-07-16 14:02:35.665594

Phase D-core of centralizing per-actor profile details
(see docs/profile-owner-centralization.md). Makes ``profile_owner`` the
canonical owner and UNLOCKS clinic/hospital ownership, WITHOUT dropping the
legacy doctor_id/admin_id/authorized_personnel_id columns (those stay as
dual-written back-compat so the ~50 existing readers keep working; physically
removing them + rewriting readers is a separate cleanup).

  0. Idempotent safety re-link (repeats Phase B) so NOT NULL below is safe.
  1. profile_owner_id -> NOT NULL on all six sub-tables.
  2. Drops the six ``ck_*_exactly_one_owner`` CHECKs — a clinic/hospital-owned
     row sets neither doctor_id nor admin_id, which those CHECKs forbid.
  3. Adds owner-based uniqueness (the old per-doctor / per-admin uniques don't
     constrain clinic/hospital rows).

NOTE: ``downgrade`` re-adds the doctor/admin XOR CHECKs and therefore only
succeeds if no clinic/hospital-owned profile rows exist yet.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'be1adf4e1a11'
down_revision = 'a3b72202636b'
branch_labels = None
depends_on = None


# (owner_type, source_table, profile_owner_fk_col, source_pk_col)
_OWNER_INSERTS = (
    ("doctor",               "doctors",              "doctor_id",               "doctor_id"),
    ("admin",                "admins",               "admin_id",                "admin_id"),
    ("clinic",               "clinics",              "clinic_id",               "id"),
    ("hospital",             "hospitals",            "hospital_id",             "hospital_id"),
    ("authorized_personnel", "authorized_personnel", "authorized_personnel_id", "id"),
)
_DOCTOR_ADMIN_SUBTABLES = (
    'profile_signatures', 'profile_about', 'profile_bank_accounts',
    'profile_declaration_responses', 'profile_documents',
)
_ALL_SUBTABLES = _DOCTOR_ADMIN_SUBTABLES + ('profile_education',)
_OWNER_CHECKS = (
    ('ck_profile_signatures_exactly_one_owner', 'profile_signatures'),
    ('ck_profile_about_exactly_one_owner', 'profile_about'),
    ('ck_profile_education_exactly_one_owner', 'profile_education'),
    ('ck_profile_bank_accounts_exactly_one_owner', 'profile_bank_accounts'),
    ('ck_profile_declaration_responses_exactly_one_owner', 'profile_declaration_responses'),
    ('ck_profile_documents_exactly_one_owner', 'profile_documents'),
)
_OWNER_UNIQUES = (
    ('uq_prof_sig_tenant_owner', 'profile_signatures', ['tenant_id', 'profile_owner_id']),
    ('uq_prof_about_tenant_owner', 'profile_about', ['tenant_id', 'profile_owner_id']),
    ('uq_prof_edu_tenant_owner', 'profile_education', ['tenant_id', 'profile_owner_id']),
    ('uq_prof_bank_tenant_owner_order', 'profile_bank_accounts', ['tenant_id', 'profile_owner_id', 'order_index']),
    ('uq_prof_decl_resp_tenant_owner_config', 'profile_declaration_responses', ['tenant_id', 'profile_owner_id', 'config_id']),
    ('uq_prof_doc_tenant_owner_config', 'profile_documents', ['tenant_id', 'profile_owner_id', 'config_id']),
)


def upgrade():
    conn = op.get_bind()

    # 0) Idempotent safety re-link (repeat of Phase B).
    for owner_type, table, po_col, src_pk in _OWNER_INSERTS:
        conn.execute(sa.text(f"""
            INSERT INTO profile_owner (id, tenant_id, owner_type, {po_col}, created_at, updated_at)
            SELECT gen_random_uuid(), t.tenant_id, '{owner_type}', t.{src_pk}, now(), now()
            FROM {table} t
            ON CONFLICT (tenant_id, {po_col}) DO NOTHING
        """))
    for tbl in _DOCTOR_ADMIN_SUBTABLES:
        conn.execute(sa.text(f"""
            UPDATE {tbl} s SET profile_owner_id = o.id
            FROM profile_owner o
            WHERE o.tenant_id = s.tenant_id AND s.profile_owner_id IS NULL
              AND ((s.doctor_id IS NOT NULL AND o.doctor_id = s.doctor_id)
                OR (s.admin_id IS NOT NULL AND o.admin_id = s.admin_id))
        """))
    conn.execute(sa.text("""
        UPDATE profile_education s SET profile_owner_id = o.id
        FROM profile_owner o
        WHERE o.tenant_id = s.tenant_id AND s.profile_owner_id IS NULL
          AND ((s.doctor_id IS NOT NULL AND o.doctor_id = s.doctor_id)
            OR (s.admin_id IS NOT NULL AND o.admin_id = s.admin_id)
            OR (s.authorized_personnel_id IS NOT NULL
                AND o.authorized_personnel_id = s.authorized_personnel_id))
    """))

    # 1) profile_owner_id becomes required.
    for tbl in _ALL_SUBTABLES:
        op.alter_column(tbl, 'profile_owner_id', existing_type=sa.UUID(), nullable=False)

    # 2) Drop the per-table exactly-one-owner CHECKs (they forbid clinic/hospital).
    for name, tbl in _OWNER_CHECKS:
        op.execute(f"ALTER TABLE {tbl} DROP CONSTRAINT IF EXISTS {name}")

    # 3) One-row-per-owner enforced through profile_owner_id.
    for name, tbl, cols in _OWNER_UNIQUES:
        op.create_unique_constraint(name, tbl, cols)


def downgrade():
    for name, tbl, _cols in _OWNER_UNIQUES:
        op.execute(f"ALTER TABLE {tbl} DROP CONSTRAINT IF EXISTS {name}")

    dual = ("(doctor_id IS NOT NULL AND admin_id IS NULL) "
            "OR (doctor_id IS NULL AND admin_id IS NOT NULL)")
    for name, tbl in _OWNER_CHECKS:
        if tbl == 'profile_education':
            op.create_check_constraint(
                name, tbl,
                '(CASE WHEN doctor_id IS NOT NULL THEN 1 ELSE 0 END) + '
                '(CASE WHEN admin_id IS NOT NULL THEN 1 ELSE 0 END) + '
                '(CASE WHEN authorized_personnel_id IS NOT NULL THEN 1 ELSE 0 END) = 1',
            )
        else:
            op.create_check_constraint(name, tbl, dual)

    for tbl in _ALL_SUBTABLES:
        op.alter_column(tbl, 'profile_owner_id', existing_type=sa.UUID(), nullable=True)
