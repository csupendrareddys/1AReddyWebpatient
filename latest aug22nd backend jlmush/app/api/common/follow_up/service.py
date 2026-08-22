"""
Follow-Up Appointment Service
Business logic for creating follow-up appointments and invites.
"""
import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.extensions import db
from app.models import (
    Appointment, AppointmentStatus, AppointmentType, ConsultationType,
    Doctor, Patient, Prescription, PrescriptionStatus, TimeSlot,
    FollowUpInvite, FollowUpInviteStatus, FollowUpType,
    AcceptanceMethod,
)
from app.api.common.timeslot.service import TimeSlotService

logger = logging.getLogger(__name__)


class FollowUpService:
    """Service class for follow-up appointment operations."""

    # ──────────────────────────────────────────────────────────────────────
    # OPTION 1: Free Follow-Up (Doctor picks slot, creates confirmed appt)
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def create_free_follow_up(doctor_id, prescription_id, time_slot_id, consultation_type_str):
        """
        Doctor gives a free follow-up appointment directly.
        Creates a CONFIRMED appointment with fee=0.
        """
        prescription, parent_appointment = FollowUpService._validate_prescription(
            doctor_id, prescription_id
        )
        patient_id = parent_appointment.patient_id

        # Validate consultation type
        try:
            ct_enum = ConsultationType(consultation_type_str)
        except (ValueError, KeyError):
            raise ValueError(f"Invalid consultation type: {consultation_type_str}")

        # Book the slot (validates existence, not booked, type offered)
        slot = TimeSlotService.book_slot(time_slot_id, consultation_type_str)

        # Determine appointment_type from consultation type
        appt_type = FollowUpService._consultation_to_appointment_type(ct_enum)

        # Create the appointment
        appointment = Appointment(
            patient_id=patient_id,
            doctor_id=doctor_id,
            appointment_date=slot.date,
            start_time=slot.start_time,
            end_time=slot.end_time,
            appointment_type=appt_type,
            consultation_type=ct_enum,
            time_slot_id=slot.id,
            status=AppointmentStatus.CONFIRMED,
            consultation_fee=0,
            is_follow_up=True,
            follow_up_type=FollowUpType.FREE_DOCTOR,
            follow_up_appointment_id=parent_appointment.id,
            follow_up_prescription_id=prescription.id,
            acceptance_method=AcceptanceMethod.AUTO_APPROVED,
            chief_complaint=f"Follow-up for prescription dated {prescription.issue_date or 'N/A'}",
        )
        db.session.add(appointment)
        db.session.commit()

        logger.info(f"[FOLLOW-UP] Free follow-up created: appointment={appointment.id} for patient={patient_id}")
        return appointment

    # ──────────────────────────────────────────────────────────────────────
    # OPTION 2a: Paid — Doctor suggests day, patient picks slot
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def create_paid_patient_picks(doctor_id, prescription_id, consultation_type_str, suggested_date):
        """
        Doctor suggests a day for follow-up. Patient must pick a slot and pay.
        Creates a FollowUpInvite with status=PENDING.
        """
        prescription, parent_appointment = FollowUpService._validate_prescription(
            doctor_id, prescription_id
        )

        try:
            ct_enum = ConsultationType(consultation_type_str)
        except (ValueError, KeyError):
            raise ValueError(f"Invalid consultation type: {consultation_type_str}")

        if suggested_date <= datetime.now(timezone.utc).date():
            raise ValueError("Suggested date must be in the future")

        invite = FollowUpInvite(
            id=uuid4(),
            doctor_id=doctor_id,
            patient_id=parent_appointment.patient_id,
            prescription_id=prescription.id,
            parent_appointment_id=parent_appointment.id,
            follow_up_type=FollowUpType.PAID_PATIENT_PICKS,
            consultation_type=ct_enum,
            suggested_date=suggested_date,
            status=FollowUpInviteStatus.PENDING,
        )
        db.session.add(invite)
        db.session.commit()

        logger.info(f"[FOLLOW-UP] Paid (patient picks) invite created: invite={invite.id}")
        return invite

    # ──────────────────────────────────────────────────────────────────────
    # OPTION 2b: Paid — Doctor picks exact slot, soft-reserved for patient
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def create_paid_doctor_picks(doctor_id, prescription_id, time_slot_id, consultation_type_str, reservation_hours=48):
        """
        Doctor picks an exact slot and soft-reserves it for the patient.
        Patient must pay to confirm.
        """
        prescription, parent_appointment = FollowUpService._validate_prescription(
            doctor_id, prescription_id
        )
        patient_id = parent_appointment.patient_id

        try:
            ct_enum = ConsultationType(consultation_type_str)
        except (ValueError, KeyError):
            raise ValueError(f"Invalid consultation type: {consultation_type_str}")

        # Validate slot belongs to this doctor
        slot = TimeSlot.query.get(time_slot_id)
        if not slot:
            raise ValueError("Time slot not found")
        if str(slot.doctor_id) != str(doctor_id):
            raise ValueError("Time slot does not belong to this doctor")

        # Soft-reserve the slot
        expiry = datetime.now(timezone.utc) + timedelta(hours=reservation_hours)
        TimeSlotService.soft_reserve_slot(time_slot_id, patient_id, expiry)

        invite = FollowUpInvite(
            id=uuid4(),
            doctor_id=doctor_id,
            patient_id=patient_id,
            prescription_id=prescription.id,
            parent_appointment_id=parent_appointment.id,
            follow_up_type=FollowUpType.PAID_DOCTOR_PICKS,
            consultation_type=ct_enum,
            reserved_time_slot_id=time_slot_id,
            soft_reservation_expiry=expiry,
            status=FollowUpInviteStatus.PENDING,
        )
        db.session.add(invite)
        db.session.commit()

        logger.info(f"[FOLLOW-UP] Paid (doctor picks) invite created: invite={invite.id}, slot={time_slot_id}")
        return invite

    # ──────────────────────────────────────────────────────────────────────
    # PATIENT ACTIONS
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def get_patient_invites(patient_id):
        """Get all pending follow-up invites for a patient."""
        return FollowUpInvite.query.filter_by(
            patient_id=patient_id,
            status=FollowUpInviteStatus.PENDING,
        ).order_by(FollowUpInvite.created_at.desc()).all()

    @staticmethod
    def book_from_invite(invite_id, patient_user_id, time_slot_id=None):
        """
        Patient acts on a follow-up invite.

        For PAID_PATIENT_PICKS: patient provides time_slot_id (they picked the slot).
        For PAID_DOCTOR_PICKS: uses the pre-reserved slot (time_slot_id from invite).

        Returns the created Appointment (status=PENDING_PAYMENT) for Razorpay flow.
        """
        invite = FollowUpInvite.query.get(invite_id)
        if not invite:
            raise ValueError("Follow-up invite not found")
        if invite.status != FollowUpInviteStatus.PENDING:
            raise ValueError(f"This invite is already {invite.status.value}")

        # Verify this patient owns the invite
        patient = Patient.query.filter_by(user_id=patient_user_id, is_deleted=False).first()
        if not patient or patient.id != invite.patient_id:
            raise PermissionError("Not authorized to act on this invite")

        doctor = Doctor.query.get(invite.doctor_id)
        if not doctor:
            raise ValueError("Doctor not found")

        ct_enum = invite.consultation_type

        if invite.follow_up_type == FollowUpType.PAID_PATIENT_PICKS:
            # Patient picked their own slot
            if not time_slot_id:
                raise ValueError("time_slot_id is required for patient-picks follow-up")
            slot = TimeSlotService.book_slot(time_slot_id, ct_enum.value)
        elif invite.follow_up_type == FollowUpType.PAID_DOCTOR_PICKS:
            # Use the pre-reserved slot — convert soft reserve to hard book
            if not invite.reserved_time_slot_id:
                raise ValueError("Reserved slot no longer available")
            slot = TimeSlot.query.get(invite.reserved_time_slot_id)
            if not slot:
                raise ValueError("Reserved time slot not found")
            if slot.is_booked:
                raise ValueError("Reserved slot has been booked by someone else")
            # Clear soft reservation and hard-book
            slot.soft_reserved_for_patient_id = None
            slot.soft_reservation_expiry = None
            slot.is_booked = True
            db.session.flush()
        else:
            raise ValueError(f"Cannot book from invite type: {invite.follow_up_type.value}")

        # Determine fee from doctor's slot pricing, then take the patient's
        # membership tier off it — the booking screen quotes a follow-up
        # through the same summary as any other consultation, so the two have
        # to agree on the number.
        #
        # The reserved slot names the offering, so the slot's own pricing rule
        # is what decides how much of the tier applies: ``member_discount_pct``
        # is a ceiling, and a follow-up on a consultation type an admin dialled
        # below it must not quietly charge the full ceiling back.
        from app.common.display_pricing import rule_for_booking
        from app.common.member_discount import discount_for_user

        fee_before_membership = doctor.consultation_fee or 0
        consultation_fee = discount_for_user(
            fee_before_membership,
            patient_user_id,
            rule=rule_for_booking(
                doctor,
                ct_enum.value,
                FollowUpService._slot_minutes(slot),
                fallback_fee=fee_before_membership,
            ),
        )[0]

        appt_type = FollowUpService._consultation_to_appointment_type(ct_enum)
        payment_expiry = datetime.now(timezone.utc) + timedelta(minutes=10)

        appointment = Appointment(
            patient_id=invite.patient_id,
            doctor_id=invite.doctor_id,
            appointment_date=slot.date,
            start_time=slot.start_time,
            end_time=slot.end_time,
            appointment_type=appt_type,
            consultation_type=ct_enum,
            time_slot_id=slot.id,
            status=AppointmentStatus.PENDING_PAYMENT,
            consultation_fee=consultation_fee,
            payment_expiry=payment_expiry,
            is_follow_up=True,
            follow_up_type=invite.follow_up_type,
            follow_up_appointment_id=invite.parent_appointment_id,
            follow_up_prescription_id=invite.prescription_id,
            acceptance_method=AcceptanceMethod.AUTO_APPROVED,
            chief_complaint=f"Follow-up consultation",
        )
        db.session.add(appointment)
        db.session.flush()

        # Update invite
        invite.status = FollowUpInviteStatus.BOOKED
        invite.resulting_appointment_id = appointment.id
        db.session.commit()

        logger.info(f"[FOLLOW-UP] Patient booked from invite={invite.id}, appointment={appointment.id}")
        return appointment

    # ──────────────────────────────────────────────────────────────────────
    # PREVIOUS PRESCRIPTION CONTEXT
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def get_previous_prescription(appointment):
        """
        For a follow-up appointment, retrieve the previous prescription.
        """
        if not appointment.is_follow_up:
            return None

        # Direct link via follow_up_prescription_id
        if appointment.follow_up_prescription_id:
            rx = Prescription.query.filter_by(
                id=appointment.follow_up_prescription_id,
                is_deleted=False,
            ).first()
            if rx:
                return rx

        # Fallback: find prescriptions from the parent appointment
        if appointment.follow_up_appointment_id:
            rx = Prescription.query.filter_by(
                appointment_id=appointment.follow_up_appointment_id,
                is_deleted=False,
            ).order_by(Prescription.created_at.desc()).first()
            if rx:
                return rx

        return None

    # ──────────────────────────────────────────────────────────────────────
    # HELPERS
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def _validate_prescription(doctor_id, prescription_id):
        """Validate prescription belongs to doctor, is ACTIVE, has an appointment."""
        prescription = Prescription.query.filter_by(
            id=prescription_id,
            is_deleted=False,
        ).first()
        if not prescription:
            raise ValueError("Prescription not found")
        if str(prescription.doctor_id) != str(doctor_id):
            raise ValueError("Prescription does not belong to this doctor")
        if prescription.status != PrescriptionStatus.ACTIVE:
            raise ValueError("Prescription must be in active status to create a follow-up")
        if not prescription.appointment_id:
            raise ValueError("Prescription is not linked to an appointment")

        parent_appointment = Appointment.query.get(prescription.appointment_id)
        if not parent_appointment:
            raise ValueError("Parent appointment not found")

        return prescription, parent_appointment

    @staticmethod
    def _slot_minutes(slot):
        """Length of ``slot`` in minutes, or ``None`` if it can't be measured.

        Only ever feeds a pricing-rule lookup, so ``None`` is a usable answer:
        it prices the follow-up on consultation type alone, which is what the
        booking summary does for a slot with no measurable length too.
        """
        start, end = (getattr(slot, 'start_time', None),
                      getattr(slot, 'end_time', None))
        try:
            minutes = ((end.hour * 60 + end.minute)
                       - (start.hour * 60 + start.minute))
        except AttributeError:
            return None
        return minutes if minutes > 0 else None

    @staticmethod
    def _consultation_to_appointment_type(ct_enum):
        """Map ConsultationType to AppointmentType."""
        if ct_enum in (ConsultationType.VIDEO, ConsultationType.AUDIO, ConsultationType.CHAT):
            return AppointmentType.ONLINE
        elif ct_enum == ConsultationType.HOME_VISIT:
            return AppointmentType.HOME_VISIT
        else:
            return AppointmentType.IN_CLINIC
