"""Daily reconciliation for tenant subscriptions: over-limit AND billing.

Run as a cron job (once a day is enough — the check is a billing signal,
not a real-time gate; route decorators / service checks already stop new
seats at request time):

    python -m scripts.sweep_over_limit [--tenant <tenant_id>]

Behaviour:
  * Over-limit pass — for every active :class:`TenantSubscription`,
    compare live user counts against the resolved plan limits; flip
    ``OVER_LIMIT`` / ``SUSPENDED`` per the plan's ``over_limit_action``.
  * Billing pass (Phase 5 dunning) — trial-ending reminders, expired
    trials / lapsed paid periods → ``PAST_DUE``, and ``PAST_DUE`` past the
    plan's grace window → ``SUSPENDED``. A SUSPENDED subscription answers
    False to every FeatureGate path until a payment lands.

``--tenant`` runs ONLY the billing pass, narrowed to that tenant —
targeted local verification / support runs without touching every row.

Never deletes or deactivates users.
"""
from __future__ import annotations

import argparse
import logging
import sys

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger('sweep_over_limit')


def main():
    # Imports are lazy so the module can be discovered even if the Flask
    # app package isn't fully importable (e.g. during alembic upgrades).
    from app import create_app
    from app.api.pricing import subscription_billing
    from app.api.pricing.service import PlanService

    parser = argparse.ArgumentParser()
    parser.add_argument('--tenant', default=None,
                        help='Limit the sweep to one tenant id')
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        if args.tenant:
            logger.info('sweep narrowed to tenant %s', args.tenant)
        else:
            stats = PlanService.sweep_over_limit_subscriptions()
            logger.info(
                'over-limit sweep: reconciled=%s suspended=%s recovered=%s',
                stats['reconciled'], stats['suspended'], stats['recovered'],
            )
        billing = subscription_billing.sweep_billing_periods(
            only_tenant_id=args.tenant,
        )
        logger.info(
            'billing sweep: checked=%s reminded=%s past_due=%s suspended=%s',
            billing['checked'], billing['reminded'], billing['past_due'],
            billing['suspended'],
        )
    return 0


if __name__ == '__main__':
    sys.exit(main())
