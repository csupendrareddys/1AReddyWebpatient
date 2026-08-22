"""Cross-feature scheduling-conflict guard.

A doctor's consultation appointments and their service / group-offering
*scheduled calls* both draw on the same person's calendar. This module is the
single place that checks a proposed ``[start, end)`` window against BOTH kinds
of commitment, so neither booking path can double-book the same doctor.

It deliberately lives in ``app/common`` rather than inside the
service-communication package (which, by contract, must not import appointment
models) — the cross-domain coupling therefore sits in shared code that both
sides may import.

Time model note: appointments store a naive local date + times
(``appointment_date`` / ``start_time`` / ``end_time``), while scheduled calls
store tz-aware UTC datetimes. Everything here is normalised to tz-aware
datetimes in the tenant zone (Asia/Kolkata) before comparison so the two
systems line up on one timeline.
"""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

# The whole app treats the tenant wall-clock as Asia/Kolkata (see
# app/api/service_communication/working_hours.py).
TENANT_TZ = ZoneInfo('Asia/Kolkata')

# Fallback slot length when an appointment has no explicit end_time.
DEFAULT_SLOT_MINUTES = 30


def _as_date(v):
    """Coerce a date / datetime / 'YYYY-MM-DD' string to a date, else None."""
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str) and v:
        try:
            return datetime.strptime(v[:10], '%Y-%m-%d').date()
        except ValueError:
            return None
    return None


def _as_time(v):
    """Coerce a time / datetime / 'HH:MM[:SS]' string to a time, else None."""
    if isinstance(v, datetime):
        return v.time()
    if isinstance(v, time):
        return v
    if isinstance(v, str) and v:
        for fmt in ('%H:%M:%S', '%H:%M'):
            try:
                return datetime.strptime(v, fmt).time()
            except ValueError:
                continue
    return None


def _combine(d, t):
    """A naive local date + time → tz-aware datetime in the tenant zone."""
    return datetime.combine(d, t).replace(tzinfo=TENANT_TZ)


def _fmt(dt):
    """Human-friendly local time, e.g. '14:30 on 05 Aug'."""
    local = dt.astimezone(TENANT_TZ)
    return local.strftime('%H:%M on %d %b')


def _active_appointment_statuses():
    from app.models import AppointmentStatus
    out = []
    for name in ('PENDING_PAYMENT', 'PENDING', 'CONFIRMED', 'IN_PROGRESS'):
        val = getattr(AppointmentStatus, name, None)
        if val is not None:
            out.append(val)
    return out


def _appointment_conflict(doctor_id, tenant_id, start, end, exclude_appointment_id=None):
    """First overlapping appointment for the doctor, or None."""
    from app.models import Appointment

    local_start = start.astimezone(TENANT_TZ)
    local_end = end.astimezone(TENANT_TZ)

    q = Appointment.query.filter(
        Appointment.doctor_id == doctor_id,
        Appointment.tenant_id == tenant_id,
        Appointment.is_deleted.is_(False),
        Appointment.status.in_(_active_appointment_statuses()),
        # Appointments never span midnight, so any conflict sits on a date
        # inside the (inclusive) local-date window of the proposed slot.
        Appointment.appointment_date >= local_start.date(),
        Appointment.appointment_date <= local_end.date(),
    )
    if exclude_appointment_id is not None:
        q = q.filter(Appointment.id != exclude_appointment_id)

    for appt in q.all():
        if not appt.start_time:
            continue
        existing_start = _combine(appt.appointment_date, appt.start_time)
        if appt.end_time:
            existing_end = _combine(appt.appointment_date, appt.end_time)
        else:
            existing_end = existing_start + timedelta(minutes=DEFAULT_SLOT_MINUTES)
        # Half-open overlap: [existing_start, existing_end) ∩ [start, end).
        if existing_start < end and existing_end > start:
            return existing_start, existing_end
    return None


def serving_doctor_ids(channel, tenant_id):
    """Doctor ids (doctors.doctor_id) served by a channel.

    Holding channel → the held vendor. Otherwise every PROVIDER participant
    (covers 1:1 service channels and group channels alike, since providers are
    always participants). Used both to know whose calendar a new call blocks
    and to find a doctor's calls from the appointment side.
    """
    from app.models import ChannelParticipant, ChannelParticipantRole, Doctor

    if channel.is_holding:
        return [channel.held_doctor_id] if channel.held_doctor_id else []

    rows = ChannelParticipant.query.filter_by(
        tenant_id=tenant_id, channel_id=channel.id,
        role=ChannelParticipantRole.PROVIDER, is_deleted=False,
    ).all()
    user_ids = [r.user_id for r in rows if r.user_id]
    if not user_ids:
        return []
    docs = Doctor.query.filter(
        Doctor.user_id.in_(user_ids), Doctor.tenant_id == tenant_id,
        Doctor.is_deleted.is_(False),
    ).all()
    return [d.id for d in docs]


def _doctor_channel_ids(doctor_id, tenant_id):
    """Channels where this doctor is a serving PROVIDER (any kind, incl. holding)."""
    from app.models import ChannelParticipant, ChannelParticipantRole, Doctor, ServiceChannel

    doc = Doctor.query.filter_by(id=doctor_id, tenant_id=tenant_id).first()
    ids = set()
    if doc and doc.user_id:
        rows = ChannelParticipant.query.filter_by(
            tenant_id=tenant_id, user_id=doc.user_id,
            role=ChannelParticipantRole.PROVIDER, is_deleted=False,
        ).all()
        ids.update(r.channel_id for r in rows)
    # Holding channels are keyed directly on the doctor.
    held = ServiceChannel.query.filter_by(
        tenant_id=tenant_id, held_doctor_id=doctor_id, is_deleted=False,
    ).all()
    ids.update(c.id for c in held)
    return list(ids)


def _call_conflict(doctor_id, tenant_id, start, end, exclude_scheduled_call_id=None):
    """First overlapping scheduled call for the doctor, or None."""
    from app.models import ScheduledCall, ScheduledCallStatus

    channel_ids = _doctor_channel_ids(doctor_id, tenant_id)
    if not channel_ids:
        return None

    active = [
        ScheduledCallStatus.SCHEDULED,
        ScheduledCallStatus.ACCEPTED,
        ScheduledCallStatus.IN_PROGRESS,
    ]
    q = ScheduledCall.query.filter(
        ScheduledCall.tenant_id == tenant_id,
        ScheduledCall.channel_id.in_(channel_ids),
        ScheduledCall.is_deleted.is_(False),
        ScheduledCall.status.in_(active),
        ScheduledCall.scheduled_start < end,
        ScheduledCall.scheduled_end > start,
    )
    if exclude_scheduled_call_id is not None:
        q = q.filter(ScheduledCall.id != exclude_scheduled_call_id)
    call = q.order_by(ScheduledCall.scheduled_start).first()
    if call:
        return call.scheduled_start, call.scheduled_end
    return None


def find_conflict(doctor_id, tenant_id, start, end, *,
                  exclude_appointment_id=None, exclude_scheduled_call_id=None):
    """Return a human-readable message if the doctor is already busy in
    ``[start, end)`` — from either a consultation or a scheduled service/group
    call — else None.

    ``start`` / ``end`` must be tz-aware datetimes.
    """
    if not doctor_id or start is None or end is None:
        return None

    appt = _appointment_conflict(
        doctor_id, tenant_id, start, end,
        exclude_appointment_id=exclude_appointment_id,
    )
    if appt:
        return (
            'This doctor already has a consultation from '
            f'{_fmt(appt[0])} to {_fmt(appt[1])}. Please pick another time.'
        )

    call = _call_conflict(
        doctor_id, tenant_id, start, end,
        exclude_scheduled_call_id=exclude_scheduled_call_id,
    )
    if call:
        return (
            'This doctor already has a scheduled call from '
            f'{_fmt(call[0])} to {_fmt(call[1])}. Please pick another time.'
        )
    return None


def find_conflict_local(doctor_id, tenant_id, appointment_date, start_time, end_time=None,
                        *, exclude_appointment_id=None):
    """Convenience for the appointment side: build the tz-aware window from a
    naive local date + times, then delegate to :func:`find_conflict`."""
    d = _as_date(appointment_date)
    st = _as_time(start_time)
    if not (d and st):
        return None
    start = _combine(d, st)
    et = _as_time(end_time)
    if et:
        end = _combine(d, et)
    else:
        end = start + timedelta(minutes=DEFAULT_SLOT_MINUTES)
    return find_conflict(
        doctor_id, tenant_id, start, end,
        exclude_appointment_id=exclude_appointment_id,
    )
