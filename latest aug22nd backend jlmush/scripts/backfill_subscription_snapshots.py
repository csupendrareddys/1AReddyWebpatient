"""Backfill ``tenant_subscriptions.plan_snapshot`` for pre-snapshot rows.

Grandfathering (see ``build_plan_snapshot``) freezes a plan's terms on the
subscription at assign time. Rows created before the feature have no
snapshot and resolution falls back to the live plan — the old behaviour.
This backfill freezes each such subscription at its plan's CURRENT terms,
which is the closest available approximation of "what they subscribed to".

Dry-run by default; idempotent (rows that already carry a snapshot are
never touched). Run inside the backend container:

    docker exec -w /app -e PYTHONPATH=/app <backend> \
        python scripts/backfill_subscription_snapshots.py [--apply]
"""
import argparse
import sys

from app import create_app
from app.extensions import db
from app.models import TenantSubscription


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true',
                        help='Write snapshots (default: dry run).')
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        from app.api.pricing.plan_catalog_service import build_plan_snapshot

        subs = (TenantSubscription.query
                .filter_by(is_deleted=False)
                .filter(TenantSubscription.plan_snapshot.is_(None))
                .all())
        print('subscriptions without a snapshot: %d' % len(subs))
        done = skipped = 0
        for sub in subs:
            plan = sub.plan
            if plan is None:
                skipped += 1
                print('  [skip] sub %s — plan row missing' % sub.id)
                continue
            if args.apply:
                sub.plan_snapshot = build_plan_snapshot(plan)
            done += 1
        if args.apply:
            db.session.commit()
            print('[OK] snapshotted %d subscription(s), skipped %d' % (done, skipped))
        else:
            print('DRY RUN — would snapshot %d subscription(s), skip %d. '
                  'Re-run with --apply.' % (done, skipped))
    return 0


if __name__ == '__main__':
    sys.exit(main())
