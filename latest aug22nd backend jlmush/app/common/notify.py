"""NotificationService — persist-first in-app notifications.

The one entry point domain code calls when something a person cares
about happens ("your appointment was confirmed", "a new appointment is
waiting for you"). Follows the realtime layer's contract exactly:

  1. the Notification row is committed (Postgres = source of truth);
  2. THEN ``notification:new`` is broadcast, best-effort, to the
     recipient's Socket.IO user room (auto-joined at connect) — open
     pages show a toast and refetch without a refresh;
  3. a failure anywhere here must NEVER break the domain flow that
     triggered it — everything is caught, logged, and swallowed.

``data.kind`` doubles as the client's cache-invalidation key (e.g.
``appointment`` → the frontend refetches its appointment queries), which
is what makes "important pages update without refresh" work beyond the
bell itself.
"""
import logging

logger = logging.getLogger(__name__)


EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'


def send_device_push(*, tenant_id, user_id, title, body=None, data=None):
    """Deliver to the user's registered mobile devices (Expo Push API).

    Best-effort, batched per user, short timeout — a push failure must
    never affect the calling flow. Tokens Expo reports as
    ``DeviceNotRegistered`` are pruned so uninstalled apps stop costing
    requests. Inert (returns 0) while the user has no registered device.

    PRIVACY: healthcare detail must never ride the push payload — pass
    generic titles/bodies; the app loads real content over the
    authenticated API on tap.
    """
    try:
        import requests as _requests

        from app.common.tenant_context import with_tenant_context
        from app.extensions import db
        from app.models import DevicePushToken

        with with_tenant_context(tenant_id):
            rows = DevicePushToken.query.filter_by(
                user_id=user_id, provider='expo').all()
            tokens = [r.token for r in rows]
        if not tokens:
            return 0

        messages = [{
            'to': t,
            'title': title[:150],
            'body': (body or '')[:200],
            'data': data or {},
            'sound': 'default',
        } for t in tokens]
        resp = _requests.post(EXPO_PUSH_URL, json=messages, timeout=8)
        tickets = (resp.json() or {}).get('data') or []

        # Prune dead tokens so churned devices stop costing requests.
        dead = [
            tokens[i] for i, t in enumerate(tickets)
            if isinstance(t, dict)
            and (t.get('details') or {}).get('error') == 'DeviceNotRegistered'
        ]
        if dead:
            with with_tenant_context(tenant_id):
                DevicePushToken.query.filter(
                    DevicePushToken.token.in_(dead)).delete(
                    synchronize_session=False)
                db.session.commit()
        return len(tokens) - len(dead)
    except Exception:  # noqa: BLE001 — never break the calling flow
        logger.exception('[NOTIFY] device push failed user=%s', user_id)
        return 0


def push_notification(*, tenant_id, user_id, type, title, body=None,
                      data=None):
    """Create + broadcast one notification. Best-effort; returns the row
    (or None on failure). Runs its own commit — call it AFTER the domain
    transaction has committed, mirroring the chat broadcast helpers."""
    try:
        from app.common.tenant_context import with_tenant_context
        from app.extensions import db
        from app.models import Notification

        with with_tenant_context(tenant_id):
            row = Notification(
                tenant_id=tenant_id, user_id=user_id, type=type,
                title=title[:200], body=body, data=data or {},
            )
            db.session.add(row)
            # Mobile leg rides the OUTBOX in the SAME commit — the
            # Expo HTTP call (8s timeout, one per admin in fan-outs)
            # no longer runs inside the request, and a crash can never
            # persist the notification without its push (or vice
            # versa). Delivery kicks right after this commit.
            from app.services.outbox import enqueue
            enqueue(
                tenant_id=tenant_id, channel='push',
                recipient=str(user_id), purpose=type,
                payload={'user_id': str(user_id), 'title': title[:150],
                         'body': body, 'data': data or {}},
            )
            db.session.commit()
            payload = row.to_dict()
    except Exception:  # noqa: BLE001 — never break the calling flow
        logger.exception('[NOTIFY] persist failed type=%s user=%s', type, user_id)
        try:
            from app.extensions import db
            db.session.rollback()
        except Exception:  # noqa: BLE001
            pass
        return None

    try:
        from app.extensions import socketio
        from app.realtime.rooms import user_room
        socketio.emit('notification:new', payload,
                      to=user_room(tenant_id, user_id))
    except Exception:  # noqa: BLE001
        logger.exception('[NOTIFY] emit failed type=%s user=%s', type, user_id)

    # (Mobile leg enqueued above, same commit as the Notification row.)
    return payload


def notify_appointment_event(appointment, event):
    """One call per appointment lifecycle event, AFTER the domain commit.

    Resolves recipients from the committed row and pushes the right
    notification(s):

      * ``booked``               → doctor ("new appointment awaiting you")
      * ``booked_auto_confirmed``→ doctor (info) + patient (confirmed)
      * ``confirmed``            → patient (doctor accepted)
      * ``cancelled_by_doctor``  → patient
      * ``auto_cancelled``       → patient (auto-reject policy)

    Best-effort; never raises.
    """
    try:
        from app.models import Doctor

        tenant_id = appointment.tenant_id
        when = ''
        try:
            when = appointment.appointment_date.strftime('%d %b %Y')
            if appointment.start_time:
                when += appointment.start_time.strftime(', %I:%M %p')
        except Exception:  # noqa: BLE001
            pass

        patient_user_id = getattr(
            getattr(appointment, 'patient', None), 'user_id', None)
        doctor = Doctor.query.get(appointment.doctor_id) \
            if appointment.doctor_id else None
        doctor_user_id = getattr(doctor, 'user_id', None)
        doctor_name = getattr(doctor, 'full_name', '') or 'your doctor'

        data = {
            'kind': 'appointment',
            'appointment_id': str(appointment.id),
            'status': appointment.status.value,
        }

        if event in ('booked', 'booked_auto_confirmed') and doctor_user_id:
            push_notification(
                tenant_id=tenant_id, user_id=doctor_user_id,
                type='appointment_booked',
                title='New appointment booked',
                body=(f'{when}. ' if when else '') + (
                    'Auto-confirmed by your acceptance policy.'
                    if event == 'booked_auto_confirmed'
                    else 'Waiting for you to accept.'),
                data={**data, 'url': '/dashboard/doctor/appointments'},
            )
        if event in ('confirmed', 'booked_auto_confirmed') and patient_user_id:
            push_notification(
                tenant_id=tenant_id, user_id=patient_user_id,
                type='appointment_confirmed',
                title='Appointment confirmed',
                body=f'{doctor_name} confirmed your appointment'
                     + (f' on {when}.' if when else '.'),
                data={**data, 'url': '/dashboard/patient/my-appointments'},
            )
        if event == 'booked_for_you' and patient_user_id:
            push_notification(
                tenant_id=tenant_id, user_id=patient_user_id,
                type='appointment_booked_for_you',
                title='Appointment booked for you',
                body=f'Our team booked you with {doctor_name}'
                     + (f' on {when}.' if when else '.'),
                data={**data, 'url': '/dashboard/patient/my-appointments'},
            )
        if event == 'starting_soon':
            # Both sides, ~5 minutes before an online consultation. The
            # deep link is the meeting page itself.
            meeting_url = appointment.meeting_link or '/dashboard'
            if patient_user_id:
                push_notification(
                    tenant_id=tenant_id, user_id=patient_user_id,
                    type='consultation_starting',
                    title='Your consultation starts in about 5 minutes',
                    body=f'{doctor_name} will see you shortly. Tap to join.',
                    data={**data, 'kind': 'consultation', 'url': meeting_url},
                )
            if doctor_user_id:
                push_notification(
                    tenant_id=tenant_id, user_id=doctor_user_id,
                    type='consultation_starting',
                    title='Your consultation starts in about 5 minutes',
                    body=(f'Consultation{" at " + when if when else ""} is '
                          'about to begin. Tap to join.'),
                    data={**data, 'kind': 'consultation', 'url': meeting_url},
                )
        if event == 'rescheduled_by_patient' and doctor_user_id:
            push_notification(
                tenant_id=tenant_id, user_id=doctor_user_id,
                type='appointment_rescheduled',
                title='Appointment rescheduled',
                body=f'The patient moved an appointment to {when}.' if when
                     else 'The patient moved an appointment.',
                data={**data, 'url': '/dashboard/doctor/appointments'},
            )
        if event == 'rescheduled_by_doctor' and patient_user_id:
            push_notification(
                tenant_id=tenant_id, user_id=patient_user_id,
                type='appointment_rescheduled',
                title='Appointment rescheduled',
                body=f'{doctor_name} moved your appointment to {when}.' if when
                     else f'{doctor_name} moved your appointment.',
                data={**data, 'url': '/dashboard/patient/my-appointments'},
            )
        if event == 'cancelled_by_patient' and doctor_user_id:
            push_notification(
                tenant_id=tenant_id, user_id=doctor_user_id,
                type='appointment_cancelled',
                title='Appointment cancelled by the patient',
                body=(f'The appointment{" on " + when if when else ""} '
                      'was cancelled by the patient.'),
                data={**data, 'url': '/dashboard/doctor/appointments'},
            )
        if event in ('cancelled_by_doctor', 'auto_cancelled') and patient_user_id:
            push_notification(
                tenant_id=tenant_id, user_id=patient_user_id,
                type='appointment_cancelled',
                title='Appointment cancelled',
                body=(f'Your appointment{" on " + when if when else ""} '
                      'was cancelled.'
                      + ('' if event == 'cancelled_by_doctor'
                         else ' Any payment is credited back.')),
                data={**data, 'url': '/dashboard/patient/my-appointments'},
            )
    except Exception:  # noqa: BLE001
        logger.exception('[NOTIFY] appointment event failed (%s)', event)


def notify_prescription_pushed(prescription):
    """The doctor pushed a prescription to the patient (created ACTIVE, or
    APPROVED→ACTIVE) — AFTER the commit. Best-effort."""
    try:
        from app.models import Patient
        patient = Patient.query.get(prescription.patient_id)
        user_id = getattr(patient, 'user_id', None)
        if not user_id:
            return
        doctor_name = ''
        try:
            doctor_name = prescription.doctor.full_name if prescription.doctor else ''
        except Exception:  # noqa: BLE001
            pass
        push_notification(
            tenant_id=prescription.tenant_id, user_id=user_id,
            type='prescription_received',
            title='New prescription for you',
            body=(f'{doctor_name} sent you a prescription.'
                  if doctor_name else 'Your doctor sent you a prescription.'),
            data={'kind': 'prescription',
                  'prescription_id': str(prescription.id),
                  'url': '/dashboard/patient/my-prescriptions'},
        )
    except Exception:  # noqa: BLE001
        logger.exception('[NOTIFY] prescription push notify failed')


def notify_order_event(order, event):
    """Marketplace service order lifecycle, AFTER the commit.

      * ``paid``      → provider ("a paid order is waiting for you")
      * ``accepted``  → patient (provider started the service)
      * ``rejected``  → patient
      * ``completed`` → patient

    Best-effort.
    """
    try:
        from app.models import Doctor, Patient

        tenant_id = order.tenant_id
        try:
            service_name = order.product.name if order.product else 'your service'
        except Exception:  # noqa: BLE001
            service_name = 'your service'
        data = {'kind': 'order', 'order_id': str(order.id)}

        if event == 'paid':
            doctor = Doctor.query.get(order.doctor_id) if order.doctor_id else None
            if getattr(doctor, 'user_id', None):
                push_notification(
                    tenant_id=tenant_id, user_id=doctor.user_id,
                    type='order_paid',
                    title='New service order',
                    body='A patient paid for a service and is waiting for '
                         'you to accept.',
                    data={**data, 'url': '/dashboard/doctor/appointments'},
                )
            return

        patient = Patient.query.get(order.patient_id) if order.patient_id else None
        patient_user_id = getattr(patient, 'user_id', None)
        if not patient_user_id:
            return
        titles = {
            'accepted': ('Service started',
                         f'Your provider accepted {service_name} — it is now '
                         'in progress.'),
            'rejected': ('Service order declined',
                         f'Your provider declined {service_name}. Support '
                         'will help with the refund.'),
            'completed': ('Service completed',
                          f'{service_name} was marked completed.'),
        }
        if event in titles:
            title, body = titles[event]
            push_notification(
                tenant_id=tenant_id, user_id=patient_user_id,
                type=f'order_{event}', title=title, body=body,
                data={**data, 'url': '/dashboard/patient/my-appointments'},
            )
    except Exception:  # noqa: BLE001
        logger.exception('[NOTIFY] order event failed (%s)', event)


def notify_payout_completed(payout):
    """A doctor's payout transfer landed (Cashfree webhook) — AFTER the
    commit. Best-effort."""
    try:
        from app.models import Doctor
        doctor = Doctor.query.get(payout.doctor_id) if payout.doctor_id else None
        user_id = getattr(doctor, 'user_id', None)
        if not user_id:
            return
        amount = None
        try:
            amount = float(payout.payout_amount)
        except Exception:  # noqa: BLE001
            pass
        push_notification(
            tenant_id=payout.tenant_id, user_id=user_id,
            type='payout_completed',
            title='Payout completed',
            body=(f'₹{amount:,.2f} was transferred to your bank account.'
                  if amount is not None else
                  'A payout was transferred to your bank account.'),
            data={'kind': 'payout', 'payout_id': str(payout.id),
                  'url': '/dashboard/doctor/bills'},
        )
    except Exception:  # noqa: BLE001
        logger.exception('[NOTIFY] payout notify failed')


def push_to_super_admins(*, tenant_id, type, title, body=None, data=None):
    """Notify every active SUPER_ADMIN of a tenant (e.g. 'a new doctor is
    waiting for verification'). Best-effort."""
    try:
        from app.common.tenant_context import with_tenant_context
        from app.models import User, UserRole, UserStatus
        with with_tenant_context(tenant_id):
            admins = User.query.filter_by(
                tenant_id=tenant_id, role=UserRole.SUPER_ADMIN,
                status=UserStatus.ACTIVE, is_deleted=False,
            ).all()
            ids = [a.id for a in admins]
    except Exception:  # noqa: BLE001
        logger.exception('[NOTIFY] admin lookup failed tenant=%s', tenant_id)
        return 0
    sent = 0
    for uid in ids:
        if push_notification(tenant_id=tenant_id, user_id=uid, type=type,
                             title=title, body=body, data=data):
            sent += 1
    return sent

def notify_tenant_admins(tenant_id, *, type, title, body=None, data=None):
    """In-app fan-out to every active SUPER_ADMIN of ``tenant_id``.

    The seller-to-tenant channel (vendor -> level-1 tenant, apex -> level-2
    child): subscription/billing events land in the tenant admins' bell,
    not only their inbox. Best-effort, commits per notification — call it
    AFTER the domain transaction has committed (same contract as
    :func:`push_notification`). Returns how many notifications were made.
    """
    try:
        from app.common.tenant_context import with_tenant_context
        from app.models import User, UserRole

        with with_tenant_context(tenant_id):
            admins = User.query.filter_by(
                tenant_id=tenant_id, role=UserRole.SUPER_ADMIN,
                is_deleted=False,
            ).all()
            admin_ids = [a.id for a in admins]
    except Exception:  # noqa: BLE001 — never break the calling flow
        logger.exception('[NOTIFY] admin fan-out lookup failed tenant=%s', tenant_id)
        return 0

    made = 0
    for uid in admin_ids:
        if push_notification(tenant_id=tenant_id, user_id=uid, type=type,
                             title=title, body=body, data=data):
            made += 1
    return made

