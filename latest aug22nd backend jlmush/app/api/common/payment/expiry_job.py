"""
Payment expiry cleanup job.
Runs every 5 minutes to expire PENDING_PAYMENT appointments that exceed their payment window,
releasing the slot for other patients.
"""
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def is_expiry_exempt(appointment):
    """True when this appointment's payment window must not be enforced.

    An admin booking on a patient's behalf and leaving it unpaid tags the
    linked ``Payment`` row ``expiry_exempt`` (see
    ``admin/operations/settle_payment.py``): the patient is expected to pay
    from their own app whenever they get to it, which is nothing like the
    10-minute window that exists to stop a patient's abandoned checkout
    holding a slot.

    Lives here, and is used by BOTH the reaper below and
    ``payment/routes.create_payment_order``. They were out of step: the job
    skipped these bookings but the create-order route still expired them, so
    the patient's Pay button would have failed *and* cancelled the admin's
    booking ten minutes after it was made.
    """
    return any(
        (p.payment_metadata or {}).get('expiry_exempt')
        for p in appointment.payments.all()
    )


def expire_unpaid_appointments(app):
    """
    Mark PENDING_PAYMENT appointments as EXPIRED if payment_expiry has passed.
    Should be called on a schedule (e.g., every 5 minutes via APScheduler).
    """
    with app.app_context():
        from app.extensions import get_redis_client, db
        from app.models import Appointment, AppointmentStatus, TimeSlot

        redis = get_redis_client()
        if redis and not redis.set('job:payment_expiry:lock', '1', nx=True, ex=240):
            return  # Another worker is already running this job

        try:
            now = datetime.now(timezone.utc)
            candidates = Appointment.query.filter(
                Appointment.status == AppointmentStatus.PENDING_PAYMENT,
                Appointment.payment_expiry != None,  # noqa: E711
                Appointment.payment_expiry < now,
                Appointment.is_deleted == False,
            ).all()

            expired = []
            for appt in candidates:
                if is_expiry_exempt(appt):
                    logger.info("[EXPIRY] Skipping expiry-exempt appointment %s (ops pay-later)", appt.id)
                    continue
                appt.status = AppointmentStatus.EXPIRED
                # Release the held slot so it's bookable again. ``book_slot`` marks
                # the TimeSlot ``is_booked=True`` the moment the PENDING_PAYMENT row
                # is created; without releasing it here an expired reservation would
                # hold that slot forever. (Bookings made without a ``time_slot_id``
                # rely on the status guard, which already treats EXPIRED as free.)
                if appt.time_slot_id:
                    slot = TimeSlot.query.get(appt.time_slot_id)
                    if slot and slot.is_booked:
                        slot.is_booked = False
                expired.append(appt)
                logger.info("[EXPIRY] Appointment %s expired (was PENDING_PAYMENT since %s)", appt.id, appt.payment_expiry)

            if expired:
                db.session.commit()
                logger.info("[EXPIRY] Expired %d appointment(s)", len(expired))
        finally:
            if redis:
                redis.delete('job:payment_expiry:lock')
