"""CI helper — exercise the latest migration's actual upgrade() SQL.

The standard CI bootstrap uses ``db.create_all()`` to create the schema
from current SQLAlchemy models, then ``flask db stamp head`` to mark the
DB at the current revision. That path NEVER executes the migration
script's ``op.create_table(...)`` / ``op.add_column(...)`` SQL — so a
typo in a migration (wrong FK target column, misspelled table name,
missing ``server_default``) silently passes CI and only blows up when
production runs ``flask db upgrade`` against a real previously-bootstrapped
DB.

This script catches that class of bug by:

  1. Downgrading by one revision (rolls back the most-recently-added
     migration via its ``downgrade()`` function — actually executing
     the rollback SQL).
  2. Upgrading back to head (re-executes the migration's ``upgrade()``
     SQL against the live DB schema — the same code path production
     takes).

If either step fails, the migration is broken and CI fails before deploy.

We use the Flask-Migrate Python API rather than the CLI because the CLI
goes through Click which parses ``-1`` as an option flag instead of a
relative-revision spec. The Python API accepts the relative ``'-1'``
string the same way Alembic does internally.
"""
import os
import sys

# When run as ``python scripts/migrate_roundtrip.py`` the script's own
# dir is on sys.path but the parent (which contains ``app/``, ``wsgi.py``,
# etc.) is not. Add it so ``from app import …`` works regardless of cwd.
# Mirrors the same shim used in ``scripts/migrate.py``.
_PARENT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from app import create_app  # noqa: E402  — needs sys.path shim above
from flask_migrate import downgrade, upgrade  # noqa: E402


def _ancestors(script, rev_id):
    """Every revision reachable downward from ``rev_id`` (inclusive)."""
    seen, stack = set(), [rev_id]
    while stack:
        rid = stack.pop()
        if rid in (None, 'base') or rid in seen:
            continue
        seen.add(rid)
        down = script.get_revision(rid).down_revision
        if down is None:
            continue
        stack.extend(down if isinstance(down, (tuple, list)) else [down])
    return seen


def _downgrade_target():
    """Revision to roll back to — ``'-1'``, unless the head is a merge.

    A merge revision has two ``down_revision`` parents, so "one step back"
    has no single answer and Alembic aborts with "Ambiguous walk". That is
    exactly the state the multiple-heads guard steers you into: it tells you
    to run ``flask db merge heads``, which then makes this roundtrip
    impossible.

    Rolling back to a *parent* would technically resolve the ambiguity, but
    it would only unapply the merge revision itself — and a merge revision is
    empty, so the check would silently degrade into a no-op that exercises no
    SQL at all. Instead target the parents' nearest common ancestor: that
    unapplies and replays exactly the migrations the merge brought together,
    which is the real SQL this check exists to catch bugs in.
    """
    from alembic.script import ScriptDirectory
    from flask import current_app

    cfg = current_app.extensions['migrate'].migrate.get_config()
    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()
    if len(heads) != 1:
        return '-1'  # the dedicated head-count guard reports this properly
    down = script.get_revision(heads[0]).down_revision
    if not isinstance(down, (tuple, list)) or len(down) < 2:
        return '-1'

    common = set.intersection(*(_ancestors(script, p) for p in down))
    if not common:
        # Unrelated lineages (no shared base) — fall back to a parent.
        return down[0]
    # "Nearest" == the deepest shared revision, i.e. the one with the most
    # ancestors of its own.
    target = max(common, key=lambda r: len(_ancestors(script, r)))
    print(
        f'[INFO] head {heads[0]} is a merge revision; "-1" would be an '
        f'ambiguous walk. Rolling back to the parents\' common ancestor '
        f'{target} so the merged-in migrations are actually exercised.'
    )
    return target


def main():
    app = create_app()
    with app.app_context():
        target = _downgrade_target()
        try:
            downgrade(revision=target)
        except Exception as e:  # noqa: BLE001  — CI script wants a clean message
            print(
                f'[FAIL] downgrade({target}) raised: {e!r}\n'
                f'       The latest migration\'s downgrade() function is '
                f'broken or missing. Either fix it or split the rollback-able '
                f'parts into a separate migration.',
                file=sys.stderr,
            )
            return 1
        try:
            upgrade()
        except Exception as e:  # noqa: BLE001
            print(
                f'[FAIL] upgrade() raised after downgrade: {e!r}\n'
                f'       The migration\'s upgrade() SQL is invalid against '
                f'real Postgres. This is the production-style failure mode '
                f'(e.g. FK referencing a column that doesn\'t exist on the '
                f'target table).',
                file=sys.stderr,
            )
            return 2
    print('[OK] latest migration roundtripped cleanly against Postgres')
    return 0


if __name__ == '__main__':
    sys.exit(main())
