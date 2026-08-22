"""Add missing ``roles.updated_by_id`` column.

Why
---
The ``Role`` model in ``app.models.rbac`` inherits ``AuditMixin``, which
declares both ``created_by_id`` and ``updated_by_id``. The ``roles``
table was created on dev via ``db.create_all()`` (which honors the
mixin and adds both columns) — but no Alembic migration ever added
``updated_by_id`` on environments that were brought up via the
migration chain. Production's ``roles`` table is missing the column,
so any RBAC read (``GET /api/admin/rbac/roles`` etc.) explodes with:

    psycopg2.errors.UndefinedColumn: column roles.updated_by_id does not exist

How
---
``ALTER TABLE … ADD COLUMN IF NOT EXISTS`` is the cleanest idempotent
form. Postgres treats the inline ``REFERENCES`` clause as part of the
single ``ADD COLUMN`` op, so when the column already exists (dev DB
from ``db.create_all()``) the entire statement no-ops and the FK
isn't double-added. When it doesn't exist (prod), the column AND the
FK are created in one shot.

The column shape matches ``AuditMixin.updated_by_id`` verbatim:
``UUID`` nullable, FK to ``users.user_id`` with ``ON DELETE SET NULL``
(same as ``created_by_id`` already in this table — keeping the audit
trail when the user who edited the row is later soft-deleted).

Downgrade drops the column. The FK goes with it.
"""
from alembic import op


# revision identifiers
revision = 't0o1j2e3f4g5'
down_revision = 's9n0i1d2e3f4'
branch_labels = None
depends_on = None


def upgrade():
    # Idempotent: dev DBs already have the column from db.create_all(),
    # so ADD COLUMN IF NOT EXISTS short-circuits there. Prod gets the
    # column + FK created atomically.
    op.execute(
        """
        ALTER TABLE roles
            ADD COLUMN IF NOT EXISTS updated_by_id UUID
            REFERENCES users(user_id) ON DELETE SET NULL;
        """
    )


def downgrade():
    # Plain DROP COLUMN — Postgres cascades the FK on column drop. No
    # explicit constraint name needed (and the inline ADD didn't pin
    # one, so trying to drop by name would mis-fire).
    op.execute("ALTER TABLE roles DROP COLUMN IF EXISTS updated_by_id;")
