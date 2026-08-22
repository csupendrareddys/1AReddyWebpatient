"""
Payout hold-promotion job.

Every 15 minutes, promotes DoctorPayout rows whose T-day hold has elapsed:
  autopay → PENDING (admin settle queue); claim → CLAIMABLE (doctor may claim).

Modeled on ``expiry_job.py`` (Redis leader lock, cross-tenant sweep). Note the
same promotion also runs lazily whenever a doctor opens My Bills or an admin
opens the payout queue, so correctness does not depend on this job running.
"""
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def promote_matured_payouts_job(app):
    with app.app_context():
        from app.extensions import get_redis_client, db
        from app.models import DoctorPayout, PayoutStatus

        redis = get_redis_client()
        if redis and not redis.set('job:payout_hold:lock', '1', nx=True, ex=240):
            return  # another worker is running it

        try:
            now = datetime.now(timezone.utc)
            matured = DoctorPayout.query.filter(
                DoctorPayout.status == PayoutStatus.ON_HOLD,
                DoctorPayout.hold_until.isnot(None),
                DoctorPayout.hold_until < now,
            ).all()
            for p in matured:
                p.status = PayoutStatus.CLAIMABLE if p.payout_mode == 'claim' else PayoutStatus.PENDING
            if matured:
                db.session.commit()
                logger.info('[PAYOUT_HOLD] promoted %d matured payout(s)', len(matured))
        finally:
            if redis:
                redis.delete('job:payout_hold:lock')
