"""Reparent platform_landing_recognitions + platform_landing_videos
under the platform_landing_configs row that owns them.

Why
---
The platform landing editor moved to the same DRAFT → PREVIEW → LIVE →
ARCHIVED lifecycle that Page Config and Tenant Landing already use.
Modules + features were already keyed by ``landing_config_id`` so they
ride the lifecycle naturally: cloned with the draft, promoted with it,
archived with the prior LIVE. Recognitions and videos were keyed by
``scope`` only — they sat outside every individual row and so edits
landed on production immediately, defeating the whole lifecycle.

This migration adds the FK so recognitions + videos belong to ONE
config row each, and backfills every existing row to point at the
current LIVE config for its scope.

What
----
1. ``platform_landing_recognitions``:
   - add ``landing_config_id`` UUID, FK to ``platform_landing_configs``,
     ON DELETE CASCADE (when the parent config row is archived/deleted
     its recognitions go with it).
   - backfill existing rows: pick the LIVE config of the same scope and
     point at it. Rows whose scope has no LIVE config land on NULL —
     they're orphans from a never-published scope and will be cleaned
     up the next time someone opens the editor (the service's
     get_or_create_draft seeds them from scratch).
   - add an index on ``landing_config_id``.
2. ``platform_landing_videos``: identical treatment.

The ``scope`` column stays on both tables. The platform-landing service
still uses it as a fast-lookup discriminator on the public read path
("which scope's LIVE config do I serve?"), and tearing it out would
ripple into routes that aren't part of this round.

Down-revision drops the FK and the column; the index goes with the
column drop. Data isn't restorable but the column was additive.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers
revision = 's9n0i1d2e3f4'
down_revision = 'r8m9h0c1d2e3'
branch_labels = None
depends_on = None


# Backfill SQL — applied separately so the FK can be added NOT NULL
# only AFTER every row has a valid parent. Rows without a LIVE config
# in their scope are left NULL; they're orphans from never-published
# scopes and will be cleaned out by the editor on next open.
_BACKFILL_RECOGNITIONS = """
UPDATE platform_landing_recognitions r
SET landing_config_id = (
    SELECT c.config_id
    FROM platform_landing_configs c
    WHERE c.scope = r.scope
      AND c.status = 'LIVE'
    LIMIT 1
)
WHERE r.landing_config_id IS NULL;
"""

_BACKFILL_VIDEOS = """
UPDATE platform_landing_videos v
SET landing_config_id = (
    SELECT c.config_id
    FROM platform_landing_configs c
    WHERE c.scope = v.scope
      AND c.status = 'LIVE'
    LIMIT 1
)
WHERE v.landing_config_id IS NULL;
"""


def upgrade():
    # ── platform_landing_recognitions ────────────────────────────
    op.add_column(
        'platform_landing_recognitions',
        sa.Column(
            'landing_config_id', postgresql.UUID(as_uuid=True), nullable=True,
        ),
    )
    op.create_foreign_key(
        'fk_platform_landing_recognitions_config',
        'platform_landing_recognitions',
        'platform_landing_configs',
        ['landing_config_id'],
        ['config_id'],
        ondelete='CASCADE',
    )
    op.execute(_BACKFILL_RECOGNITIONS)
    op.create_index(
        'ix_platform_landing_recognitions_config',
        'platform_landing_recognitions',
        ['landing_config_id'],
    )

    # ── platform_landing_videos ──────────────────────────────────
    op.add_column(
        'platform_landing_videos',
        sa.Column(
            'landing_config_id', postgresql.UUID(as_uuid=True), nullable=True,
        ),
    )
    op.create_foreign_key(
        'fk_platform_landing_videos_config',
        'platform_landing_videos',
        'platform_landing_configs',
        ['landing_config_id'],
        ['config_id'],
        ondelete='CASCADE',
    )
    op.execute(_BACKFILL_VIDEOS)
    op.create_index(
        'ix_platform_landing_videos_config',
        'platform_landing_videos',
        ['landing_config_id'],
    )


def downgrade():
    # Drop the index (its name is stable across both bootstrap and
    # migration paths since we control it explicitly), then drop the
    # column. Postgres cascades the foreign-key constraint when its
    # owning column is dropped, so we don't drop_constraint() by name —
    # the constraint name differs depending on whether the schema was
    # bootstrapped via ``db.create_all()`` (SQLAlchemy default name)
    # or via this migration's upgrade (the explicit name we set). Both
    # paths produce identical end-state schemas, but ``drop_constraint``
    # would only match one of the two.
    op.drop_index(
        'ix_platform_landing_videos_config',
        table_name='platform_landing_videos',
    )
    op.drop_column('platform_landing_videos', 'landing_config_id')

    op.drop_index(
        'ix_platform_landing_recognitions_config',
        table_name='platform_landing_recognitions',
    )
    op.drop_column('platform_landing_recognitions', 'landing_config_id')
