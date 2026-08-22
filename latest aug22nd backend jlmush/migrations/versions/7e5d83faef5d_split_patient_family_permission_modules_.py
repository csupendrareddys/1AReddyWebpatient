"""split patient family permission modules into fine-grained leaves

Data migration: the coarse permission keys ``appointments`` / ``health_records``
/ ``prescriptions`` were split into fine-grained leaves (see
``app/api/patient_family/module_catalog.py``). Every existing granted permission
is copied onto each of its new leaves (same view/manage), so no role — family or
support-staff caregiver — loses access. The old ``appointments`` row is then
dropped (no leaf keeps that name); ``health_records`` and ``prescriptions``
survive as leaves so their rows stay.

Revision ID: 7e5d83faef5d
Revises: 19aad26cfcdc
Create Date: 2026-08-11 02:31:31.358045

"""
import uuid

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7e5d83faef5d'
down_revision = '19aad26cfcdc'
branch_labels = None
depends_on = None


# Old coarse key -> the leaves it became. A leaf equal to the old key means that
# key survives (its row is kept); otherwise the old row is removed after copy.
LEGACY_SPLIT = {
    'appointments': ['appt_upcoming', 'appt_history', 'appt_service_list', 'appt_booking'],
    'health_records': ['health_vitals', 'health_habits', 'health_surgeries',
                       'health_records', 'profile_female_health'],
    'prescriptions': ['prescriptions', 'documents'],
}

_INSERT = sa.text(
    "INSERT INTO patient_role_permissions "
    "(patient_permission_id, tenant_id, role_id, module_key, can_view, can_manage, "
    " created_at, updated_at) "
    "VALUES (:pid, :tid, :rid, :mk, :cv, :cm, now(), now()) "
    "ON CONFLICT (role_id, module_key) DO NOTHING"
)


def upgrade():
    conn = op.get_bind()
    for old_key, leaves in LEGACY_SPLIT.items():
        rows = conn.execute(sa.text(
            "SELECT tenant_id, role_id, can_view, can_manage "
            "FROM patient_role_permissions WHERE module_key = :k"
        ), {'k': old_key}).mappings().all()
        for r in rows:
            for leaf in leaves:
                conn.execute(_INSERT, {
                    'pid': str(uuid.uuid4()), 'tid': r['tenant_id'], 'rid': r['role_id'],
                    'mk': leaf, 'cv': r['can_view'], 'cm': r['can_manage'],
                })
        if old_key not in leaves:
            conn.execute(sa.text(
                "DELETE FROM patient_role_permissions WHERE module_key = :k"
            ), {'k': old_key})


def downgrade():
    """Best-effort collapse: recreate each coarse key as the OR of its leaves,
    then drop the leaves that only exist post-split."""
    conn = op.get_bind()
    for old_key, leaves in LEGACY_SPLIT.items():
        agg = sa.text(
            "SELECT tenant_id, role_id, bool_or(can_view) AS cv, bool_or(can_manage) AS cm "
            "FROM patient_role_permissions WHERE module_key IN :ls "
            "GROUP BY tenant_id, role_id"
        ).bindparams(sa.bindparam('ls', expanding=True))
        for r in conn.execute(agg, {'ls': leaves}).mappings().all():
            conn.execute(_INSERT, {
                'pid': str(uuid.uuid4()), 'tid': r['tenant_id'], 'rid': r['role_id'],
                'mk': old_key, 'cv': r['cv'], 'cm': r['cm'],
            })
        drop = [leaf for leaf in leaves if leaf != old_key]
        if drop:
            dstmt = sa.text(
                "DELETE FROM patient_role_permissions WHERE module_key IN :ls"
            ).bindparams(sa.bindparam('ls', expanding=True))
            conn.execute(dstmt, {'ls': drop})
