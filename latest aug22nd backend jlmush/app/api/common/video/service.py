"""
Video Meeting Service
Business logic for Twilio Video room creation and token generation
"""
from flask import current_app
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VideoGrant
from twilio.rest import Client


class VideoService:
    """Service class for video meeting operations."""

    @staticmethod
    def _get_twilio_client():
        """Get Twilio REST client using config credentials."""
        account_sid = current_app.config['TWILIO_ACCOUNT_SID']
        api_key_sid = current_app.config['TWILIO_API_KEY_SID']
        api_key_secret = current_app.config['TWILIO_API_KEY_SECRET']

        if not all([account_sid, api_key_sid, api_key_secret]):
            raise ValueError(
                'Twilio credentials not configured. '
                'Set TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, and TWILIO_API_KEY_SECRET.'
            )

        return Client(api_key_sid, api_key_secret, account_sid)

    @staticmethod
    def create_room(room_name):
        """
        Create a Twilio Video room.

        Args:
            room_name: Unique name for the room

        Returns:
            Dict with room SID, name, and status

        Raises:
            Exception: If room creation fails
        """
        client = VideoService._get_twilio_client()

        try:
            # 'group' is the only room type supported by Twilio accounts created after Oct 21, 2024.
            # Legacy types ('go', 'peer-to-peer') are only available to older accounts.
            room = client.video.v1.rooms.create(
                unique_name=room_name,
                type='group'
            )
            return {
                'room_sid': room.sid,
                'room_name': room.unique_name,
                'status': room.status
            }
        except Exception as e:
            # If room already exists (Twilio error code 53113), fetch the existing room
            if 'Room exists' in str(e) or '53113' in str(e):
                rooms = client.video.v1.rooms.list(unique_name=room_name, limit=1)
                if rooms:
                    room = rooms[0]
                    return {
                        'room_sid': room.sid,
                        'room_name': room.unique_name,
                        'status': room.status
                    }
            raise

    @staticmethod
    def maybe_pre_create_room(appointment):
        """
        Immediately create a Twilio room if the appointment starts within 5 minutes.
        Called right after a doctor confirms an appointment, so imminent slots
        are not missed before the APScheduler job next runs.

        Args:
            appointment: Appointment model instance (must be ONLINE and CONFIRMED)
        """
        # IST wall-clock comparison — appointment times are stored
        # naive IST; server is UTC. See the parallel comment in
        # ``join_appointment`` for the full reasoning. Without
        # this, on a UTC server the (appt - now) gap is always
        # ~5.5h positive for today's slots, so the 0–5-min window
        # below never matches and the pre-create never fires.
        from datetime import datetime, timedelta, timezone as _tz
        IST = _tz(timedelta(hours=5, minutes=30))
        now = datetime.now(IST).replace(tzinfo=None)
        appt_dt = datetime.combine(
            appointment.appointment_date,
            appointment.start_time
        )

        # Only pre-create if starting within the next 5 minutes
        if timedelta(0) <= (appt_dt - now) <= timedelta(minutes=5):
            room_name = f"appt-{appointment.id}"
            VideoService.create_room(room_name)  # handles "room exists" gracefully

    @staticmethod
    def join_appointment(appointment_id, current_user):
        """
        Validate appointment access + time window, create room if needed,
        and return a Twilio token for the caller.

        Args:
            appointment_id: UUID string of the appointment
            current_user: The authenticated User model instance

        Returns:
            Dict with { token, identity, roomName }

        Raises:
            ValueError: Invalid appointment, wrong type/status, or outside time window
            PermissionError: User is not the doctor or patient for this appointment
        """
        from datetime import datetime, timedelta
        from app.models import Appointment, AppointmentStatus, AppointmentType, ConsultationType
        from app.extensions import db

        # --- Fetch appointment ---
        appointment = Appointment.query.filter_by(
            id=appointment_id, is_deleted=False
        ).first()
        if not appointment:
            raise ValueError("Appointment not found")

        # --- Validate type ---
        if appointment.appointment_type != AppointmentType.ONLINE:
            raise ValueError("This is not an online appointment")

        # --- Validate status ---
        # Both CONFIRMED (call hasn't started) and IN_PROGRESS (one
        # party has already joined) are valid join states. The
        # ``join_appointment`` handler flips CONFIRMED → IN_PROGRESS
        # the first time anyone joins, so the second party's join +
        # any re-joins from either party land in IN_PROGRESS — they
        # must be allowed in or the second participant can never
        # enter the call.
        if appointment.status not in (
            AppointmentStatus.CONFIRMED,
            AppointmentStatus.IN_PROGRESS,
        ):
            raise ValueError(
                f"Appointment is not joinable "
                f"(current status: {appointment.status.value})"
            )

        # --- Validate user is doctor or patient for this appointment ---
        is_doctor = (appointment.doctor.user_id == current_user.id)
        is_patient = (appointment.patient.user_id == current_user.id)
        if not is_doctor and not is_patient:
            raise PermissionError("You are not authorized to join this appointment")

        # --- Validate time window: T-5min to T+end_time (or T+60min) ---
        # Appointment date + start_time / end_time are stored as
        # naive ``date`` + ``time`` objects representing IST wall-
        # clock — the booking UI uses the patient's local IST,
        # writes those values, and that's what the doctor sees too.
        # Our server containers run in UTC, so ``datetime.now()``
        # returns UTC and the naive comparison was off by the IST
        # offset (~5.5 hours). Surfaced in prod as
        # ``"Meeting room opens in 329 minute(s)"`` even when the
        # appointment was due *right now*. Pin the comparison to
        # IST wall-clock so server-tz doesn't matter.
        from datetime import timezone as _tz
        IST = _tz(timedelta(hours=5, minutes=30))
        now = datetime.now(IST).replace(tzinfo=None)
        appt_dt = datetime.combine(
            appointment.appointment_date,
            appointment.start_time
        )

        if appointment.end_time:
            end_dt = datetime.combine(
                appointment.appointment_date,
                appointment.end_time
            )
        else:
            end_dt = appt_dt + timedelta(hours=1)

        window_open = appt_dt - timedelta(minutes=5)

        # --- DEV BYPASS: skip time window check in development mode ---
        import os
        is_dev = os.environ.get('FLASK_ENV', 'production').lower() == 'development'
        if is_dev:
            import logging
            logging.getLogger(__name__).warning(
                f"[DEV] Time window check bypassed for appointment {appointment_id}"
            )
        else:
            if now < window_open:
                mins_until = int((window_open - now).total_seconds() / 60) + 1
                raise ValueError(f"Meeting room opens in {mins_until} minute(s)")
            if now > end_dt:
                raise ValueError("This meeting's time window has passed")

        # --- Create room if not already created ---
        room_name = f"appt-{appointment.id}"
        VideoService.create_room(room_name)  # handles "room exists" gracefully

        # --- Persist meeting_link if not already set ---
        if not appointment.meeting_link:
            appointment.meeting_link = f"/meeting/{appointment.id}"
            db.session.commit()

        # --- Build identity string ---
        role = current_user.role.value if current_user.role else 'user'
        first_name = current_user.first_name or 'User'
        last_name = current_user.last_name or ''
        if role == 'doctor':
            identity = f"Dr. {first_name} {last_name}".strip()
        else:
            identity = f"{first_name} {last_name}".strip()

        # --- Generate Twilio token ---
        token = VideoService.generate_token(identity, room_name)

        # ── Record join attendance ────────────────────────────────
        # The token has been minted, so the caller now has access to
        # the room. Stamp the appropriate side's joined flag +
        # timestamp on the appointment. Powers two downstream
        # behaviours:
        #   * Attendance & Activity metrics ("Missed by Doctor" /
        #     "Missed by Patient" / "Appointments Attended" tiles).
        #   * Completion gate (a doctor cannot mark the appointment
        #     COMPLETED unless both joined_at timestamps are set;
        #     see AppointmentService.complete).
        #
        # Idempotent: re-firing on a re-join only overwrites a
        # null timestamp; an already-stamped row keeps its first
        # join time (the more meaningful one for attendance audits).
        from datetime import timezone as _tz
        now_utc = datetime.now(_tz.utc)
        if is_doctor:
            if not appointment.doctor_joined:
                appointment.doctor_joined = True
                appointment.doctor_joined_at = now_utc
        elif is_patient:
            if not appointment.patient_joined:
                appointment.patient_joined = True
                appointment.patient_joined_at = now_utc
        # Flip status to IN_PROGRESS the first time anyone joins so
        # downstream filters that look at "live calls" pick it up.
        if appointment.status == AppointmentStatus.CONFIRMED and (
            appointment.doctor_joined or appointment.patient_joined
        ):
            appointment.status = AppointmentStatus.IN_PROGRESS
        db.session.commit()

        # Determine consultation type — default to 'video' for backward compat
        consultation_type = 'video'
        if appointment.consultation_type:
            consultation_type = appointment.consultation_type.value

        return {
            'token': token,
            'identity': identity,
            'roomName': room_name,
            'consultationType': consultation_type,
        }

    @staticmethod
    def generate_token(identity, room_name):
        """
        Generate a Twilio Access Token with a Video grant.

        Args:
            identity: User identity string (e.g., "Dr. Smith" or "Patient John")
            room_name: Name of the room to grant access to

        Returns:
            JWT token string
        """
        account_sid = current_app.config['TWILIO_ACCOUNT_SID']
        api_key_sid = current_app.config['TWILIO_API_KEY_SID']
        api_key_secret = current_app.config['TWILIO_API_KEY_SECRET']

        if not all([account_sid, api_key_sid, api_key_secret]):
            raise ValueError(
                'Twilio credentials not configured. '
                'Set TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, and TWILIO_API_KEY_SECRET.'
            )

        token = AccessToken(
            account_sid,
            api_key_sid,
            api_key_secret,
            identity=identity,
            ttl=3600  # 1 hour
        )

        video_grant = VideoGrant(room=room_name)
        token.add_grant(video_grant)

        return token.to_jwt()
