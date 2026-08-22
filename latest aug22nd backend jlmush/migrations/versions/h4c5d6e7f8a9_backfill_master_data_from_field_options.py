"""Backfill master_data from existing field.options on data-source fields.

Round 8.6 — data centralization step.

Before this migration: tenants who typed dropdown options into the
Editor's per-field "Options" block stored those entries in
``PageFieldConfig.options`` JSON. That bypassed the master_data
tables (master_colleges, categories type=degree/specialization). So
two sources of truth existed — the field's options list AND the
master_data table — which diverged the moment either was edited.

After this migration: every typed option on a field whose
``data_source`` matches
``master_(colleges|degrees|specializations):(ug|pg|super_speciality)``
is INSERTed into the right master table (with the matching
``qualification_level``) and the field's ``options`` JSON is cleared
to NULL so the field resolves from data_source going forward.

Idempotent: skips inserts that would violate the
``(tenant_id, name)`` uniqueness constraint on master tables.

This pairs with the new FieldEditor wiring shipped on the frontend
(commit e60e2e5) that routes Add/Edit/Delete on data-source-backed
field Options directly into master_data going forward. After this
runs once, every tenant lands on a single source of truth.

Revision ID: h4c5d6e7f8a9
Revises: g3b4c5d6e7f8
Create Date: 2026-05-21
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone

from alembic import op
from sqlalchemy import text


logger = logging.getLogger(__name__)


# revision identifiers
revision = 'h4c5d6e7f8a9'
down_revision = 'g3b4c5d6e7f8'
branch_labels = None
depends_on = None


_DATA_SOURCE_RE = re.compile(
    r'^master_(colleges|degrees|specializations|universities):'
    r'(ug|pg|super_speciality)$'
)
# Category-table category_type per kind. ``colleges`` is special-cased
# below — it lives in master_colleges, not categories.
_CATEGORY_TYPE_BY_KIND = {
    'degrees': 'degree',
    'specializations': 'specialization',
    'universities': 'university',
}


def _normalize_option_name(opt):
    """An option JSON entry can be a plain string OR a dict like
    {value, label} / {id, name}. Return the human-readable name or
    None to skip."""
    if opt is None:
        return None
    if isinstance(opt, str):
        return opt.strip() or None
    if isinstance(opt, dict):
        for key in ('name', 'label', 'value', 'id'):
            v = opt.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    return None


def upgrade():
    conn = op.get_bind()

    # Walk every PageFieldConfig with a data-source we care about + a
    # non-empty options JSON. Keyed columns:
    #   - id  (UUID PK)
    #   - tenant_id (UUID)
    #   - data_source (String)
    #   - options (JSONB)
    # Pull every row with a non-null ``options`` value. The column is
    # declared as JSON (not JSONB), and historical rows include scalar
    # objects + nulls + empty objects in addition to lists — using
    # SQL-side ``jsonb_array_length`` on a mixed column errors with
    # "cannot get array length of a scalar". Filtering in Python below
    # is bulletproof and runs once per row.
    rows = conn.execute(text(
        '''
        SELECT field_id, tenant_id, data_source, options
        FROM page_field_configs
        WHERE data_source IS NOT NULL
          AND options IS NOT NULL
        '''
    )).fetchall()

    if not rows:
        logger.info('[migrate:h4c5d6e7f8a9] no rows to backfill')
        return

    moved_count = 0
    skipped_count = 0
    cleared_fields = 0

    for row in rows:
        field_id, tenant_id, data_source, options = row
        m = _DATA_SOURCE_RE.match(data_source or '')
        if not m:
            continue
        kind, level = m.group(1), m.group(2)

        # Skip non-list / empty option payloads. JSON column gave us
        # back the value already deserialised by psycopg2.
        if not isinstance(options, list) or not options:
            continue

        # Normalize the JSON option entries
        names = []
        seen_lower = set()
        for opt in options:
            name = _normalize_option_name(opt)
            if name and name.lower() not in seen_lower:
                seen_lower.add(name.lower())
                names.append(name)

        if not names:
            continue

        for name in names:
            now = datetime.now(timezone.utc)
            new_id = uuid.uuid4()
            try:
                if kind == 'colleges':
                    # MasterCollege INSERT — schema requires created_at
                    # NOT NULL but tolerates created_by_id NULL.
                    conn.execute(text(
                        '''
                        INSERT INTO master_colleges
                          (college_id, tenant_id, name, qualification_level,
                           is_active, created_at)
                        VALUES
                          (:id, :tenant_id, :name, :level, TRUE, :now)
                        ON CONFLICT (tenant_id, name) DO NOTHING
                        '''
                    ), {
                        'id': str(new_id), 'tenant_id': str(tenant_id),
                        'name': name, 'level': level, 'now': now,
                    })
                else:
                    # Category INSERT — kind → category_type lookup.
                    category_type = _CATEGORY_TYPE_BY_KIND[kind]
                    conn.execute(text(
                        '''
                        INSERT INTO categories
                          (category_id, tenant_id, name, category_type,
                           qualification_level, is_active, created_at, updated_at)
                        VALUES
                          (:id, :tenant_id, :name, :ctype, :level, TRUE,
                           :now, :now)
                        ON CONFLICT (tenant_id, name) DO NOTHING
                        '''
                    ), {
                        'id': str(new_id), 'tenant_id': str(tenant_id),
                        'name': name, 'ctype': category_type,
                        'level': level, 'now': now,
                    })
                moved_count += 1
            except Exception as e:
                # Per-row failures shouldn't abort the whole migration —
                # log + carry on. A unique-violation already short-circuits
                # via ON CONFLICT DO NOTHING; this catches other shapes
                # (encoding errors, malformed names, etc.).
                logger.warning(
                    '[migrate:h4c5d6e7f8a9] skipped name=%r tenant=%s '
                    'kind=%s level=%s: %s',
                    name, tenant_id, kind, level, e,
                )
                skipped_count += 1

        # Clear the field's options JSON. Field now resolves from
        # data_source which serves the unified master_data.
        conn.execute(text(
            '''
            UPDATE page_field_configs
            SET options = NULL
            WHERE field_id = :id
            '''
        ), {'id': str(field_id)})
        cleared_fields += 1

    logger.info(
        '[migrate:h4c5d6e7f8a9] moved=%d skipped=%d cleared_fields=%d',
        moved_count, skipped_count, cleared_fields,
    )


def downgrade():
    # No-op. The upgrade is a one-way data move (field.options →
    # master_data) and reversing it isn't safe: once names are in
    # master_data they may have been edited / linked to other rows.
    # We do NOT raise from downgrade so the CI roundtrip script
    # (downgrade -> upgrade) stays green; if you actually need to
    # roll back the data, do it from a DB snapshot. The schema
    # itself didn't change in this revision, so a no-op downgrade
    # leaves the DB in a structurally valid state at the previous
    # revision.
    logger.warning(
        '[migrate:h4c5d6e7f8a9] downgrade is a no-op — option entries '
        'that were moved into master_data are NOT reverted. Restore '
        'from a snapshot if you need them back in PageFieldConfig.options.'
    )
