"""
Appointment Service
Business logic for appointment operations
"""
from datetime import datetime, timedelta
from decimal import Decimal
from app.extensions import db
from app.models import (
    Appointment, Doctor, Patient, AppointmentStatus, AppointmentType,
    ConsultationType, AcceptingAppointmentType, AcceptanceMethod,
)


def _minutes_between(start_time, end_time):
    """Slot length in minutes from two ``HH:MM`` strings or ``time`` objects.

    ``None`` when either end is missing or unparseable — callers then price on
    consultation type alone rather than guessing a duration.
    """
    def _mins(value):
        if value is None:
            return None
        if hasattr(value, 'hour'):
            return value.hour * 60 + value.minute
        parts = str(value).split(':')
        if len(parts) < 2:
            return None
        try:
            return int(parts[0]) * 60 + int(parts[1])
        except (TypeError, ValueError):
            return None

    start, end = _mins(start_time), _mins(end_time)
    if start is None or end is None:
        return None
    return end - start if end > start else None


class AppointmentService:
    """Service class for appointment operations."""
    
    @staticmethod
    def get_by_id(appointment_id):
        """Get appointment by ID."""
        return Appointment.query.filter_by(id=appointment_id, is_deleted=False).first()
    
    @staticmethod
    def _resolve_consultation_fee(doctor, consultation_type, start_time,
                                  end_time, requested_fee, buyer_user_id=None,
                                  redeemed_ids=None):
        """Server-side price for a booking — never trust the client's number.

        Resolves the doctor's ``slot_pricing`` tier for this consultation type
        and slot length, then applies the SUPER_ADMIN display-pricing overlay
        (``/dashboard/admin/pricing-config``). That makes the amount stored on
        the appointment — and therefore the Razorpay order raised from it — the
        same figure the patient was quoted on the card.

        Finally the buyer's own membership tier takes its cut off that display
        price. It is applied last, and never to the doctor's raw fee, because
        it discounts the number the patient was shown — see
        :mod:`app.common.member_discount`. The slot's own pricing rule goes
        into that call: the tier's ``member_discount_pct`` is a ceiling, and
        the rule is where an admin dials this particular slot below it, so
        charging without it would bill more of the tier than the booking
        summary offered.

        Falls back to the doctor's flat ``consultation_fee`` (still overlaid),
        and only then to whatever the client sent, so bookings for doctors
        with no pricing at all keep working exactly as before.
        """
        from app.common.display_pricing import (
            resolve_booking_fee, rule_for_booking, rules_for_doctors,
        )
        from app.common.member_discount import discount_for_user, redeemed_amount

        if not doctor:
            # Still member-discounted, but at the tier's ceiling: with no
            # doctor there is no offering to look a rule up for. The client's
            # number is the only quote there is, and the patient was shown it
            # net of their tier.
            return discount_for_user(requested_fee, buyer_user_id)[0]

        ctype = consultation_type or 'complete'
        duration = _minutes_between(start_time, end_time)
        # One rule lookup feeding both halves of the price, so the overlay that
        # produced the fee and the plan_discounts that reduce it can only ever
        # come off the same row.
        rules = rules_for_doctors([doctor.id])
        display_fee = resolve_booking_fee(
            doctor, ctype, duration, fallback_fee=requested_fee, rules=rules,
        )
        rule = rule_for_booking(
            doctor, ctype, duration, fallback_fee=requested_fee, rules=rules,
        )
        net = discount_for_user(display_fee, buyer_user_id, rule=rule)[0]
        # Then whatever the buyer chose to redeem. Re-validated against the
        # same rule rather than trusted: ``redeemed_amount`` only counts ids
        # this buyer's plan is actually offered on this offering, so a client
        # naming someone else's voucher pays full price rather than an
        # arbitrary one.
        if net is None or not redeemed_ids:
            return net
        spent = redeemed_amount(rule, redeemed_ids, user_id=buyer_user_id)
        return float(max(Decimal(str(net)) - spent, Decimal('0')))

    @staticmethod
    def create(patient_user_id, data, initiated_by_id=None, defer_payment=False):
        """
        Create a new appointment with duplicate-slot protection.

        Guards:
          1. Same-patient spam guard: a patient cannot make more than one PENDING
             or CONFIRMED request for the same doctor + date + start_time.
          2. Slot-taken guard: once ANY patient's request is CONFIRMED for a given
             doctor + date + start_time, nobody else can book that slot.

        Args:
            patient_user_id: User ID of the patient
            data: Appointment data (must include doctor_id, appointment_date, start_time)
            initiated_by_id: When set, records which user booked this appointment
                (used by the Operations "book on behalf" path to stamp the acting
                admin). Left None for normal patient self-service bookings.

        Returns:
            Created Appointment instance

        Raises:
            ValueError: if duplicate or slot already taken
        """
        patient = Patient.query.filter_by(user_id=patient_user_id, is_deleted=False).first()
        if not patient:
            raise ValueError("Patient profile not found")

        doctor_id = data.get('doctor_id')
        appt_date = data.get('appointment_date')
        start_time = data.get('start_time')

        if doctor_id and appt_date and start_time:
            # Guard 1 — same patient already has a pending/confirmed/pending_payment request for this slot
            existing_own = Appointment.query.filter(
                Appointment.patient_id == patient.id,
                Appointment.doctor_id == doctor_id,
                Appointment.appointment_date == appt_date,
                Appointment.start_time == start_time,
                Appointment.status.in_([
                    AppointmentStatus.PENDING_PAYMENT,
                    AppointmentStatus.PENDING,
                    AppointmentStatus.CONFIRMED,
                ]),
                Appointment.is_deleted == False,
            ).first()
            if existing_own:
                raise ValueError(
                    "You already have a pending or confirmed booking for this slot. "
                    "Cancel it before making a new one."
                )

            # Guard 2 — slot already taken by another patient (any active status)
            existing_active = Appointment.query.filter(
                Appointment.doctor_id == doctor_id,
                Appointment.appointment_date == appt_date,
                Appointment.start_time == start_time,
                Appointment.patient_id != patient.id,
                Appointment.status.in_([
                    AppointmentStatus.PENDING_PAYMENT,
                    AppointmentStatus.PENDING,
                    AppointmentStatus.CONFIRMED,
                ]),
                Appointment.is_deleted == False,
            ).first()
            if existing_active:
                raise ValueError(
                    "This slot has already been booked by another patient. "
                    "Please choose a different time."
                )

            # Guard 3 — the doctor's own calendar: this consultation must not
            # overlap a service / group-offering call they already have booked.
            from app.common.scheduling_conflicts import find_conflict_local
            from app.common.tenant_context import current_tenant_id_strict
            conflict = find_conflict_local(
                doctor_id, current_tenant_id_strict(),
                appt_date, start_time, data.get('end_time'),
            )
            if conflict:
                raise ValueError(conflict)

        # ── TimeSlot-based booking (multi-consultation-type path) ──────────
        time_slot_id = data.get('time_slot_id')
        consultation_type_str = data.get('consultation_type')
        consultation_type_enum = None

        if consultation_type_str:
            try:
                consultation_type_enum = ConsultationType(consultation_type_str)
            except (ValueError, KeyError):
                raise ValueError(f"Invalid consultation type: {consultation_type_str}")

        if time_slot_id:
            from app.api.common.timeslot.service import TimeSlotService
            # book_slot validates: slot exists, not booked, type offered
            TimeSlotService.book_slot(time_slot_id, consultation_type_str or 'complete')

        from datetime import timezone
        # A caregiver/linked person books on the patient's behalf but the PATIENT
        # (main account) settles it. The slot is held as a real reservation for a
        # longer 20-minute window (vs the 10-minute self-checkout window) so the
        # patient has time to be notified and pay from their own account — a
        # countdown of this expiry is shown on their pending-payment card. When it
        # lapses the reaper expires the booking AND releases the slot (see
        # expire_unpaid_appointments), so a reservation nobody paid for frees up.
        _minutes = 20 if defer_payment else 10
        payment_expiry = datetime.now(timezone.utc) + timedelta(minutes=_minutes)

        # Determine acceptance method based on doctor's current setting
        doctor = Doctor.query.get(doctor_id)
        if doctor and doctor.accepting_appointments == AcceptingAppointmentType.AUTO_ACCEPT:
            acceptance_method = AcceptanceMethod.AUTO_APPROVED
        else:
            acceptance_method = AcceptanceMethod.MANUALLY_APPROVED

        appointment = Appointment(
            patient_id=patient.id,
            doctor_id=doctor_id,
            hospital_id=data.get('hospital_id'),
            service_id=data.get('service_id'),
            appointment_date=appt_date,
            start_time=start_time,
            end_time=data.get('end_time'),
            appointment_type=data.get('appointment_type', AppointmentType.ONLINE),
            chief_complaint=data.get('chief_complaint'),
            consultation_fee=AppointmentService._resolve_consultation_fee(
                doctor, consultation_type_str, start_time, data.get('end_time'),
                data.get('consultation_fee'),
                # The patient's membership sets the discount, not the acting
                # admin's — on the "book on behalf" path ``initiated_by_id``
                # is the staff member, so it must not be used here.
                buyer_user_id=patient_user_id,
                # Which of the offers their tier makes available on this slot
                # they chose to spend. Validated inside, so an id the client
                # invented buys nothing.
                redeemed_ids=data.get('redeemed_discount_ids') or [],
            ),
            status=AppointmentStatus.PENDING_PAYMENT,
            payment_expiry=payment_expiry,
            time_slot_id=time_slot_id,
            consultation_type=consultation_type_enum,
            acceptance_method=acceptance_method,
            initiated_by_id=initiated_by_id,
        )
        db.session.add(appointment)
        db.session.flush()  # materialise the id for the credit ledger ref

        # Health-credit redemption on top of the resolved fee — server re-caps
        # the requested amount by the plan's per-offering rule + balance.
        try:
            redeem_req = float(data.get('redeem_credits') or 0)
            if redeem_req > 0:
                from app.api.membership import credit_service
                applied = credit_service.redeem(
                    appointment.tenant_id, patient_user_id,
                    consultation_type_str, float(appointment.consultation_fee or 0),
                    redeem_req, ref_type='appointment', ref_id=appointment.id)
                if applied > 0:
                    appointment.consultation_fee = (
                        float(appointment.consultation_fee or 0) - applied)
        except Exception:  # noqa: BLE001 — credits must never break booking
            import logging
            logging.getLogger(__name__).exception('[CREDIT] appointment redeem failed')

        db.session.commit()
        return appointment

    @staticmethod
    def cancel(appointment_id, user_id):
        """Cancel an appointment."""
        appointment = AppointmentService.get_by_id(appointment_id)
        if not appointment:
            return None
        
        # Check if user is authorized (patient or doctor)
        if appointment.patient.user_id != user_id and appointment.doctor.user_id != user_id:
            raise PermissionError("Not authorized to cancel this appointment")
            
        # Validation: Cannot cancel if already completed or cancelled
        if appointment.status in [AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED]:
            raise ValueError(f"Cannot cancel appointment in {appointment.status.value} state")
        
        appointment.status = AppointmentStatus.CANCELLED

        # Release the time slot so other patients can book it
        if appointment.time_slot_id:
            from app.api.common.timeslot.service import TimeSlotService
            TimeSlotService.release_slot(appointment.time_slot_id)

        # Return any health credits spent on this booking to the wallet.
        try:
            from app.api.membership import credit_service
            credit_service.refund_for_ref(
                appointment.tenant_id, appointment.patient.user_id,
                'appointment', appointment.id)
        except Exception:  # noqa: BLE001
            import logging
            logging.getLogger(__name__).exception('[CREDIT] appointment refund failed')

        db.session.commit()
        return appointment

    # How close to the start an appointment may still be moved. The
    # product copy promises "free rescheduling up to 24 hours before".
    RESCHEDULE_MIN_HOURS = 24

    @staticmethod
    def reschedule(appointment_id, user_id, new_time_slot_id):
        """Move an appointment to a different free slot of the SAME doctor.

        Authorized for the appointment's patient or its doctor (mirrors
        ``cancel``). Allowed while the appointment is PENDING/CONFIRMED
        and more than ``RESCHEDULE_MIN_HOURS`` before the current start.
        The new slot must be free and offer the appointment's
        consultation type; the old slot is released. Status is KEPT (a
        confirmed consultation stays confirmed — the other side is
        notified by the route instead of forced through re-acceptance).

        Returns the updated appointment. Raises PermissionError /
        ValueError with user-facing messages.
        """
        from datetime import datetime, timedelta, timezone

        from app.api.common.timeslot.service import TimeSlotService

        appointment = AppointmentService.get_by_id(appointment_id)
        if not appointment:
            return None
        if appointment.patient.user_id != user_id \
                and appointment.doctor.user_id != user_id:
            raise PermissionError('Not authorized to reschedule this appointment')
        if appointment.status not in (AppointmentStatus.PENDING,
                                      AppointmentStatus.CONFIRMED):
            raise ValueError(
                f'Cannot reschedule an appointment in '
                f'{appointment.status.value} state')

        start_dt = datetime.combine(
            appointment.appointment_date,
            appointment.start_time,
            tzinfo=timezone.utc,
        )
        if start_dt - datetime.now(timezone.utc) < timedelta(
                hours=AppointmentService.RESCHEDULE_MIN_HOURS):
            raise ValueError(
                f'Appointments can be rescheduled up to '
                f'{AppointmentService.RESCHEDULE_MIN_HOURS} hours before '
                f'they start.')

        if str(new_time_slot_id) == str(appointment.time_slot_id or ''):
            raise ValueError('Pick a different time slot.')

        # book_slot locks the row, checks availability + consultation
        # type, and commits. If anything after it fails we release it
        # again so the failed reschedule can't strand a held slot.
        ct_value = (appointment.consultation_type.value
                    if appointment.consultation_type else 'video')
        new_slot = TimeSlotService.book_slot(new_time_slot_id, ct_value)
        try:
            if str(new_slot.doctor_id) != str(appointment.doctor_id):
                raise ValueError(
                    'The new slot belongs to a different doctor.')
            new_start = datetime.combine(
                new_slot.date, new_slot.start_time, tzinfo=timezone.utc)
            if new_start <= datetime.now(timezone.utc):
                raise ValueError('The new slot is in the past.')

            old_slot_id = appointment.time_slot_id
            appointment.time_slot_id = new_slot.id
            appointment.appointment_date = new_slot.date
            appointment.start_time = new_slot.start_time
            appointment.end_time = new_slot.end_time
            appointment.is_rescheduled = True
            db.session.commit()
            if old_slot_id:
                TimeSlotService.release_slot(old_slot_id)
        except Exception:
            db.session.rollback()
            TimeSlotService.release_slot(new_slot.id)
            raise
        return appointment

    @staticmethod
    def confirm(appointment_id, doctor_user_id):
        """Confirm an appointment (doctor only)."""
        appointment = AppointmentService.get_by_id(appointment_id)
        if not appointment:
            return None
        
        if appointment.doctor.user_id != doctor_user_id:
            raise PermissionError("Not authorized to confirm this appointment")
            
        # Validation: Can only confirm pending appointments
        # (Optional: Allow re-confirming if connection dropped, but definitely block if Cancelled/Completed)
        if appointment.status != AppointmentStatus.PENDING:
            raise ValueError(f"Cannot confirm appointment in {appointment.status.value} state")
        
        appointment.status = AppointmentStatus.CONFIRMED
        db.session.commit()
        return appointment

    @staticmethod
    def apply_acceptance_mode(appointment):
        """Apply the doctor's effective appointment-acceptance mode once payment
        has landed (appointment is PENDING). Set by the admin approval policy /
        per-doctor override, falling back to the doctor's own
        ``accepting_appointments``:

          * ``auto_accept`` → CONFIRMED immediately (patient sees instant accept)
          * ``auto_reject`` → CANCELLED, slot released + health credits refunded
          * ``manual``      → left PENDING for the doctor to act

        Does NOT commit — the caller (payment confirmation) owns the transaction.
        Never raises: a resolver hiccup must not break payment confirmation.
        """
        if appointment is None or appointment.status != AppointmentStatus.PENDING:
            return appointment
        try:
            from app.api.admin.approval_policy_service import effective_action_mode
            doctor = Doctor.query.get(appointment.doctor_id)
            if doctor is None:
                return appointment
            mode = effective_action_mode(doctor, 'appointment_acceptance')
            if mode == 'auto_accept':
                appointment.status = AppointmentStatus.CONFIRMED
                appointment.acceptance_method = AcceptanceMethod.AUTO_APPROVED
            elif mode == 'auto_reject':
                appointment.status = AppointmentStatus.CANCELLED
                appointment.acceptance_method = AcceptanceMethod.AUTO_APPROVED
                if appointment.time_slot_id:
                    from app.api.common.timeslot.service import TimeSlotService
                    TimeSlotService.release_slot(appointment.time_slot_id)
                try:
                    from app.api.membership import credit_service
                    credit_service.refund_for_ref(
                        appointment.tenant_id, appointment.patient.user_id,
                        'appointment', appointment.id)
                except Exception:  # noqa: BLE001
                    import logging
                    logging.getLogger(__name__).exception('[CREDIT] auto-reject refund failed')
            # 'manual' → leave PENDING
        except Exception:  # noqa: BLE001 — never break payment confirmation
            import logging
            logging.getLogger(__name__).exception('[APPT] apply_acceptance_mode failed')
        return appointment

    @staticmethod
    def complete(appointment_id, doctor_user_id, notes=None):
        """Mark appointment as completed.

        Gate: BOTH the doctor and the patient must have actually
        joined the video call (recorded by ``POST /api/video/join``
        setting ``doctor_joined_at`` / ``patient_joined_at``).
        Without this gate a doctor could accept an appointment,
        skip the call entirely, then write a prescription + mark
        complete + push it to the patient — with no record that
        the consultation never happened. Now the doctor cannot
        complete until the patient has demonstrably been on the
        call too.

        For ``IN_CLINIC`` appointments the gate is naturally
        satisfied by the existing acceptance flow (the patient
        physically being there is the join equivalent), so we
        skip the call-join check for non-online appointments.
        Online (video / audio / chat) appointments fall under the
        full both-joined rule.
        """
        appointment = AppointmentService.get_by_id(appointment_id)
        if not appointment:
            return None

        if appointment.doctor.user_id != doctor_user_id:
            raise PermissionError("Not authorized to complete this appointment")

        # Validation: Can only complete confirmed or in-progress appointments
        if appointment.status not in [AppointmentStatus.CONFIRMED, AppointmentStatus.IN_PROGRESS]:
            raise ValueError(f"Cannot complete appointment in {appointment.status.value} state")

        # Both-joined gate for online (video / audio / chat)
        # appointments. The /api/video/join handler stamps these
        # timestamps the moment each side gets a token, so this
        # check naturally fires only when the call genuinely
        # didn't happen.
        if appointment.appointment_type == AppointmentType.ONLINE:
            if not appointment.doctor_joined_at:
                raise ValueError(
                    'Cannot complete: you have not joined the video '
                    'call for this appointment. Open the meeting from '
                    'My Appointments first.'
                )
            if not appointment.patient_joined_at:
                raise ValueError(
                    'Cannot complete: the patient has not joined the '
                    'video call yet. If they are a no-show, mark the '
                    'appointment as missed instead.'
                )

        appointment.status = AppointmentStatus.COMPLETED
        if notes:
            appointment.notes = notes

        db.session.commit()

        # Family-doctor second-opinion commission: award the patient's family
        # doctor credits for this completed consultation. Defensive — never
        # blocks completion.
        try:
            from app.api.family_doctor.credit_service import award_for_booking
            award_for_booking(
                appointment.tenant_id, appointment.patient_id, appointment.doctor_id,
                'appointment', appointment.id,
                label='Second opinion — consultation',
                amount=float(getattr(appointment, 'consultation_fee', 0) or 0),
            )
            db.session.commit()
        except Exception:  # noqa: BLE001
            db.session.rollback()
        return appointment
    
    # NOTE: a legacy free-form ``reschedule(new_date, new_start_time, …)``
    # used to live here. It had NO callers (the route was HTTP 501), reset
    # confirmed appointments to PENDING, and bypassed slot booking — the
    # slot-based implementation above (line ~315) replaced it.

    @staticmethod
    def get_available_slots(doctor_id, date, duration_minutes=30):
        """
        Get available time slots for a doctor on a given date.
        
        Args:
            doctor_id: UUID of the doctor
            date: Date to check availability
            duration_minutes: Duration of each slot
        
        Returns:
            List of available time slots
        """
        # TODO: Implement based on doctor's schedule and existing appointments
        # This is a placeholder implementation
        from datetime import time
        
        # Default working hours
        slots = []
        start_hour = 9
        end_hour = 17
        
        for hour in range(start_hour, end_hour):
            for minute in [0, 30]:
                slots.append({
                    'time': time(hour, minute).strftime('%H:%M'),
                    'available': True  # Would check against existing appointments
                })
        
        return slots
