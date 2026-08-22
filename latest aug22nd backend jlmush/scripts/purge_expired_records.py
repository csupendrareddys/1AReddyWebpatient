"""Retention-expiry purge — the DPDP storage-limitation sweep.

Completes the erasure of DELETED accounts once the statutory retention
window on their records lapses (see ``app/common/retention.py`` for the
legal framing, the clock rules and exactly what is — and is not — in
scope). Dry-run by default; nothing is written without ``--apply``.

Run monthly from cron::

    python -m scripts.purge_expired_records            # report only
    python -m scripts.purge_expired_records --apply    # perform purge

Options:
  --tenant <id>   limit to one tenant
  --years <n>     override the clinical window (REHEARSALS ONLY — the
                  production default comes from RETENTION_CLINICAL_YEARS)
"""
from __future__ import annotations

import argparse
import logging
import sys

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger('purge_expired_records')


def main():
    from app import create_app
    from app.common import retention

    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true',
                        help='Perform the purge (default: dry-run report)')
    parser.add_argument('--tenant', default=None,
                        help='Limit to one tenant id')
    parser.add_argument('--years', type=int, default=None,
                        help='Override clinical retention years (rehearsal only)')
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        stats = retention.purge_expired(
            apply=args.apply, only_tenant_id=args.tenant, years=args.years,
        )
        mode = 'APPLIED' if args.apply else 'DRY-RUN'
        logger.info(
            '%s: checked=%s due=%s purged_users=%s pending=%s '
            'non_patient_skipped=%s (appts=%s rx=%s health_records=%s)',
            mode, stats['checked'], stats['due'], stats['purged_users'],
            stats['pending'], stats['skipped_non_patient'],
            stats['appointments'], stats['prescriptions'],
            stats['health_records'],
        )
    return 0


if __name__ == '__main__':
    sys.exit(main())
