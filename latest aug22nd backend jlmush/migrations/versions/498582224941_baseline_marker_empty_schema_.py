"""Baseline marker — empty migration.

The schema is bootstrapped on first deploy via ``scripts/migrate.py``,
which calls ``db.create_all()`` (handles SQLAlchemy's topological FK
ordering correctly) and then ``flask db stamp head`` to mark the DB
at this baseline revision.

From this revision forward, every model change is captured as a normal
incremental migration via ``flask db migrate -m "..."`` and applied via
``flask db upgrade`` (or ``scripts/migrate.py`` which wraps both paths).

Do NOT delete or rename this file — every subsequent migration's
``down_revision`` chains back to this id.

Revision ID: 498582224941
Revises: -
Create Date: 2026-04-16
"""
from alembic import op  # noqa: F401  (kept for downstream migrations)
import sqlalchemy as sa  # noqa: F401


# revision identifiers, used by Alembic.
revision = '498582224941'
down_revision = None     # ← this is the root of the migration chain
branch_labels = None
depends_on = None


def upgrade():
    """No-op — schema is bootstrapped before this stamp runs."""
    pass


def downgrade():
    """No-op — there is no earlier revision to roll back to."""
    pass
