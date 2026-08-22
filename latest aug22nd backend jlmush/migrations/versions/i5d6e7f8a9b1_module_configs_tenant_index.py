"""Per-module publish lifecycle — fix Phase 1 missing tenant_id index.

CI's schema-parity check caught a drift: ``ModuleConfig`` inherits
``TenantMixin``, which declares ``tenant_id`` with ``index=True``.
SQLAlchemy's ``db.create_all()`` produces ``ix_module_configs_tenant_id``
from that, but Phase 1's migration only created a composite index on
``(tenant_id, page_type, module, status)`` — no standalone tenant_id
index. ``flask db migrate`` therefore generated a "missing index"
diff every CI run.

Pure additive fix-up. No data churn.

Revision ID: i5d6e7f8a9b1
Revises: i5d6e7f8a9b0
Create Date: 2026-05-22
"""
from __future__ import annotations

from alembic import op


# revision identifiers
revision = 'i5d6e7f8a9b1'
down_revision = 'i5d6e7f8a9b0'
branch_labels = None
depends_on = None


def upgrade():
    # ``IF NOT EXISTS`` because the CI bootstrap path (``db.create_all()
    # + stamp head``) already created this index via the TenantMixin
    # declaration — running the migration on top would then CREATE
    # INDEX a second time and fail. The op.create_index helper doesn't
    # support IF NOT EXISTS, so go through raw SQL.
    op.execute(
        'CREATE INDEX IF NOT EXISTS ix_module_configs_tenant_id '
        'ON module_configs (tenant_id)'
    )


def downgrade():
    op.execute('DROP INDEX IF EXISTS ix_module_configs_tenant_id')
