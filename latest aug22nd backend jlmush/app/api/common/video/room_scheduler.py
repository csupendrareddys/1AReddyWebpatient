"""
Video Room Scheduler
APScheduler job that pre-creates Twilio Video rooms for ONLINE appointments
starting within the next 4-6 minutes (so both parties can join at T-5 min).
"""
import logging

logger = logging.getLogger(__name__)


def create_upcoming_video_rooms(app):
    """
    Pre-create Twilio Video rooms for confirmed online appointments
    that start in approximately 5 minutes (T+4min to T+6min window).

    Called by APScheduler every 1 minute.
    Sets appointment.meeting_link = '/meeting/{appointment_id}' once room is created.
    """
    with app.app_context():
        from datetime import datetime, timedelta, timezone
        from app.models import Appointment, AppointmentStatus, AppointmentType
        from app.extensions import get_redis_client, db
        from app.api.common.video.service import VideoService

        redis = get_redis_client()
        if redis and not redis.set('job:video_room:lock', '1', nx=True, ex=50):
            return  # Another worker is already running this job

        try:
            now = datetime.now(timezone.utc)
            window_start = (now + timedelta(minutes=4)).time()
            window_end = (now + timedelta(minutes=6)).time()
            today = now.date()

            # Find CONFIRMED ONLINE appointments starting in the 4-6 min window
            # that don't yet have a meeting room
            appointments = Appointment.query.filter(
                Appointment.status == AppointmentStatus.CONFIRMED,
                Appointment.appointment_type == AppointmentType.ONLINE,
                Appointment.appointment_date == today,
                Appointment.start_time >= window_start,
                Appointment.start_time <= window_end,
                Appointment.meeting_link.is_(None),
                Appointment.is_deleted == False,
            ).all()

            if not appointments:
                return

            logger.info("[VIDEO_SCHED] Found %d appointment(s) needing rooms", len(appointments))

            created_count = 0
            for appt in appointments:
                room_name = f"appt-{appt.id}"
                try:
                    VideoService.create_room(room_name)
                    appt.meeting_link = f"/meeting/{appt.id}"
                    created_count += 1
                    logger.info(
                        "[VIDEO_SCHED] ✅ Created room '%s' for appointment %s (starts at %s %s)",
                        room_name, appt.id, appt.appointment_date, appt.start_time
                    )
                except Exception as e:
                    logger.error(
                        "[VIDEO_SCHED] ✗ Failed to create room for appointment %s: %s",
                        appt.id, e
                    )

            if created_count > 0:
                db.session.commit()
                logger.info("[VIDEO_SCHED] Committed %d new room(s)", created_count)

                # Persist-first: rooms are committed — tell both sides
                # their consultation is about to start. Room creation
                # happens exactly once per appointment (meeting_link
                # guard above), so this can't double-notify.
                from app.common.notify import notify_appointment_event
                for appt in appointments:
                    if appt.meeting_link:
                        notify_appointment_event(appt, 'starting_soon')
        finally:
            if redis:
                redis.delete('job:video_room:lock')
