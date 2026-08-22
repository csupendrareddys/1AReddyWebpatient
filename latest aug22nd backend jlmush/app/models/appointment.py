"""
Appointment models: Appointment, FollowUpInvite, AppointmentMedicalContext,
AppointmentSymptom, AppointmentRating, AppointmentDocument, AppointmentProduct.
"""
import uuid

from sqlalchemy import Index, CheckConstraint, text
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin, SoftDeleteMixin, utcnow
from app.models._enums import (
    AppointmentStatus, AppointmentType, ConsultationType,
    FollowUpType, FollowUpInviteStatus, AcceptanceMethod,
)


class Appointment(TenantMixin, db.Model):
    """Appointment scheduling between doctors and patients."""
    __tablename__ = 'appointments'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='appointment_id')

    patient_id = db.Column(UUID(as_uuid=True), db.ForeignKey('patients.patient_id', ondelete='CASCADE'), nullable=False, index=True)
    doctor_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False, index=True)
    hospital_id = db.Column(UUID(as_uuid=True), db.ForeignKey('hospitals.hospital_id'), nullable=True, index=True)
    service_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctor_services.service_id'), nullable=True)
    follow_up_appointment_id = db.Column(UUID(as_uuid=True), db.ForeignKey('appointments.appointment_id'), nullable=True, index=True)
    is_follow_up = db.Column(db.Boolean, default=False, nullable=False)
    follow_up_type = db.Column(
        db.Enum(FollowUpType, values_callable=lambda e: [m.value for m in e], create_constraint=False),
        nullable=True,
    )
    follow_up_prescription_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('prescriptions.prescription_id'),
        nullable=True, index=True,
    )

    appointment_date = db.Column(db.Date, nullable=False, index=True)
    start_time = db.Column(db.Time, nullable=False)
    end_time = db.Column(db.Time, nullable=True)

    appointment_type = db.Column(db.Enum(AppointmentType), nullable=False, index=True)
    status = db.Column(db.Enum(AppointmentStatus), default=AppointmentStatus.PENDING, nullable=False, index=True)

    # Multi-consultation-type support
    time_slot_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('time_slots.id'),
        nullable=True, index=True,
    )
    consultation_type = db.Column(
        db.Enum(ConsultationType, values_callable=lambda e: [m.value for m in e], create_constraint=False),
        nullable=True,
    )

    chief_complaint = db.Column(db.Text, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    consultation_fee = db.Column(db.Numeric(10, 2), nullable=True)
    meeting_link = db.Column(db.String(500), nullable=True)

    # Doctor-side tracking flags
    acceptance_method = db.Column(
        db.Enum(AcceptanceMethod, values_callable=lambda e: [m.value for m in e], create_constraint=False),
        nullable=True,
    )
    doctor_verified = db.Column(db.Boolean, default=False, nullable=False)
    doctor_verified_at = db.Column(db.DateTime(timezone=True), nullable=True)
    doctor_accepted = db.Column(db.Boolean, default=False, nullable=False)
    doctor_accepted_at = db.Column(db.DateTime(timezone=True), nullable=True)
    doctor_rejected = db.Column(db.Boolean, default=False, nullable=False)
    doctor_rejected_reason = db.Column(db.Text, nullable=True)
    doctor_cancelled = db.Column(db.Boolean, default=False, nullable=False)
    doctor_cancelled_reason = db.Column(db.Text, nullable=True)
    is_rescheduled = db.Column(db.Boolean, default=False, nullable=False)

    # Execution Stage tracking
    doctor_joined = db.Column(db.Boolean, default=False, nullable=False)
    doctor_joined_at = db.Column(db.DateTime(timezone=True), nullable=True)
    patient_joined = db.Column(db.Boolean, default=False, nullable=False)
    patient_joined_at = db.Column(db.DateTime(timezone=True), nullable=True)
    missed_by_doctor = db.Column(db.Boolean, default=False, nullable=False)
    missed_by_patient = db.Column(db.Boolean, default=False, nullable=False)
    missed_technical = db.Column(db.Boolean, default=False, nullable=False)

    # Live / Call Stage tracking
    doctor_used_video = db.Column(db.Boolean, default=False, nullable=False)
    doctor_used_audio = db.Column(db.Boolean, default=False, nullable=False)
    doctor_used_chat = db.Column(db.Boolean, default=False, nullable=False)

    # Audit: which user initiated this booking. NULL = the patient booked it
    # themselves (the default, self-service path). Set to the acting admin's
    # user id for on-behalf bookings made through the Operations module.
    # Mirrors ``DoctorPayout.initiated_by_id``.
    initiated_by_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )

    booking_date = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    payment_expiry = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    is_deleted = db.Column(db.Boolean, default=False, nullable=False, index=True)
    deleted_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Relationships
    patient = db.relationship('Patient', back_populates='appointments')
    doctor = db.relationship('Doctor', back_populates='appointments')
    hospital = db.relationship('Hospital', back_populates='appointments')
    service = db.relationship('DoctorService', back_populates='appointments')
    time_slot = db.relationship('TimeSlot', back_populates='appointment')
    initiated_by = db.relationship('User', foreign_keys=[initiated_by_id])
    prescriptions = db.relationship('Prescription', back_populates='appointment', lazy='dynamic', foreign_keys='[Prescription.appointment_id]')
    follow_up_prescription_rel = db.relationship('Prescription', foreign_keys=[follow_up_prescription_id], uselist=False)
    health_records = db.relationship('HealthRecord', back_populates='appointment', lazy='dynamic')
    payments = db.relationship('Payment', back_populates='appointment', lazy='dynamic')
    question_answers = db.relationship('PatientQuestionAnswer', back_populates='appointment', lazy='dynamic')
    symptoms = db.relationship('AppointmentSymptom', back_populates='appointment', lazy='dynamic', cascade='all, delete-orphan')
    rating = db.relationship('AppointmentRating', back_populates='appointment', uselist=False, cascade='all, delete-orphan')
    documents = db.relationship('AppointmentDocument', back_populates='appointment', lazy='dynamic', cascade='all, delete-orphan')
    follow_up = db.relationship('Appointment', remote_side=[id], backref=db.backref('parent_appointment', uselist=False))
    appointment_product = db.relationship('AppointmentProduct', back_populates='appointment', uselist=False, cascade='all, delete-orphan')

    __table_args__ = (
        Index('ix_appointments_tenant_date_status', 'tenant_id', 'appointment_date', 'status'),
        Index('ix_appointments_tenant_doctor_date', 'tenant_id', 'doctor_id', 'appointment_date'),
        Index('ix_appointments_tenant_patient_date', 'tenant_id', 'patient_id', 'appointment_date'),
        Index('ix_appointments_active', 'tenant_id', 'status', postgresql_where=text('is_deleted = FALSE')),
    )

    def to_dict(self, include_relations=False):
        data = {
            'id': str(self.id),
            'appointment_date': self.appointment_date.isoformat() if self.appointment_date else None,
            'start_time': self.start_time.isoformat() if self.start_time else None,
            'appointment_type': self.appointment_type.value,
            'end_time': self.end_time.isoformat() if self.end_time else None,
            'consultation_type': self.consultation_type.value if self.consultation_type else None,
            'time_slot_id': str(self.time_slot_id) if self.time_slot_id else None,
            'status': self.status.value,
            'meeting_link': self.meeting_link,
            'consultation_fee': str(self.consultation_fee) if self.consultation_fee else None,
            'initiated_by_id': str(self.initiated_by_id) if self.initiated_by_id else None,
            'booked_by': self._booked_by_summary(),
            'acceptance_method': self.acceptance_method.value if self.acceptance_method else None,
            'doctor_verified': self.doctor_verified,
            'doctor_verified_at': self.doctor_verified_at.isoformat() if self.doctor_verified_at else None,
            'doctor_accepted': self.doctor_accepted,
            'doctor_accepted_at': self.doctor_accepted_at.isoformat() if self.doctor_accepted_at else None,
            'doctor_rejected': self.doctor_rejected,
            'doctor_rejected_reason': self.doctor_rejected_reason,
            'doctor_cancelled': self.doctor_cancelled,
            'doctor_cancelled_reason': self.doctor_cancelled_reason,
            'is_rescheduled': self.is_rescheduled,
            'doctor_joined': self.doctor_joined,
            'doctor_joined_at': self.doctor_joined_at.isoformat() if self.doctor_joined_at else None,
            'patient_joined': self.patient_joined,
            'patient_joined_at': self.patient_joined_at.isoformat() if self.patient_joined_at else None,
            'missed_by_doctor': self.missed_by_doctor,
            'missed_by_patient': self.missed_by_patient,
            'missed_technical': self.missed_technical,
            'doctor_used_video': self.doctor_used_video,
            'doctor_used_audio': self.doctor_used_audio,
            'doctor_used_chat': self.doctor_used_chat,
            'is_follow_up': self.is_follow_up,
            'follow_up_type': self.follow_up_type.value if self.follow_up_type else None,
            'follow_up_appointment_id': str(self.follow_up_appointment_id) if self.follow_up_appointment_id else None,
            'follow_up_prescription_id': str(self.follow_up_prescription_id) if self.follow_up_prescription_id else None,
        }
        if include_relations:
            data['doctor_name'] = self.doctor.full_name if self.doctor else None
            data['patient_name'] = self.patient.full_name if self.patient else None
        return data

    def _booked_by_summary(self):
        """Who initiated this booking, for accountability: ``owner`` (the patient
        booked it themselves — ``initiated_by`` is NULL), ``linked`` (a family
        member acting for them), ``staff`` (a support-staff caregiver), ``admin``
        or ``doctor``. Parallels ``profile_audit.describe_last_update`` so the
        two accountability surfaces read the same way."""
        actor = self.initiated_by
        if actor is None:
            return {'actor_type': 'owner', 'name': None}
        role = actor.role.value if getattr(actor, 'role', None) else None
        name = (
            f"{(actor.first_name or '').strip()} {(actor.last_name or '').strip()}".strip()
            or actor.email or None
        )
        actor_type = (
            'staff' if role == 'patient_staff'
            else 'admin' if role in ('super_admin', 'sub_admin', 'platform_owner', 'admin')
            else 'doctor' if role == 'doctor'
            else 'linked' if role == 'patient'
            else 'other'
        )
        return {'actor_type': actor_type, 'name': name}

    def __repr__(self):
        return f"<Appointment {self.id} - {self.status.value}>"


class FollowUpInvite(TenantMixin, db.Model):
    """Tracks a follow-up invite from doctor to patient."""
    __tablename__ = 'follow_up_invites'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    patient_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patients.patient_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    prescription_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('prescriptions.prescription_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    parent_appointment_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('appointments.appointment_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    follow_up_type = db.Column(
        db.Enum(FollowUpType, values_callable=lambda e: [m.value for m in e], create_constraint=False),
        nullable=False,
    )
    consultation_type = db.Column(
        db.Enum(ConsultationType, values_callable=lambda e: [m.value for m in e], create_constraint=False),
        nullable=False,
    )

    suggested_date = db.Column(db.Date, nullable=True)

    reserved_time_slot_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('time_slots.id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    soft_reservation_expiry = db.Column(db.DateTime(timezone=True), nullable=True)

    status = db.Column(
        db.Enum(FollowUpInviteStatus, values_callable=lambda e: [m.value for m in e], create_constraint=False),
        default=FollowUpInviteStatus.PENDING,
        nullable=False, index=True,
    )

    resulting_appointment_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('appointments.appointment_id', ondelete='SET NULL'),
        nullable=True,
    )

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # Relationships
    doctor = db.relationship('Doctor', foreign_keys=[doctor_id])
    patient = db.relationship('Patient', foreign_keys=[patient_id])
    prescription = db.relationship('Prescription', foreign_keys=[prescription_id])
    parent_appointment = db.relationship('Appointment', foreign_keys=[parent_appointment_id])
    resulting_appointment = db.relationship('Appointment', foreign_keys=[resulting_appointment_id])
    reserved_time_slot = db.relationship('TimeSlot', foreign_keys=[reserved_time_slot_id])

    def to_dict(self):
        data = {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id),
            'patient_id': str(self.patient_id),
            'prescription_id': str(self.prescription_id),
            'parent_appointment_id': str(self.parent_appointment_id),
            'follow_up_type': self.follow_up_type.value,
            'consultation_type': self.consultation_type.value,
            'suggested_date': self.suggested_date.isoformat() if self.suggested_date else None,
            'reserved_time_slot_id': str(self.reserved_time_slot_id) if self.reserved_time_slot_id else None,
            'soft_reservation_expiry': self.soft_reservation_expiry.isoformat() if self.soft_reservation_expiry else None,
            'status': self.status.value,
            'resulting_appointment_id': str(self.resulting_appointment_id) if self.resulting_appointment_id else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if self.doctor:
            data['doctor_name'] = self.doctor.full_name
        if self.reserved_time_slot:
            slot = self.reserved_time_slot
            data['reserved_slot'] = {
                'date': slot.date.isoformat(),
                'start': slot.start_time.strftime('%H:%M'),
                'end': slot.end_time.strftime('%H:%M'),
            }
        return data

    def __repr__(self):
        return f"<FollowUpInvite {self.id} type={self.follow_up_type.value} status={self.status.value}>"


class AppointmentMedicalContext(TenantMixin, db.Model):
    """Stores what a patient chooses to share for a specific appointment booking session."""
    __tablename__ = 'appointment_medical_contexts'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    patient_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patients.patient_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    booking_for_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patients.patient_id', ondelete='SET NULL'),
        nullable=True,
    )
    house_group_member_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('house_group_members.member_id', ondelete='SET NULL'),
        nullable=True,
    )
    consultation_type = db.Column(db.String(30), nullable=False)

    # Granular sharing toggles
    shared_health_records = db.Column(JSON, nullable=True)
    shared_vitals = db.Column(JSON, nullable=True)
    shared_habits = db.Column(JSON, nullable=True)
    shared_prescriptions = db.Column(JSON, nullable=True)

    # Additional data added specifically for this appointment
    additional_vitals = db.Column(JSON, nullable=True)
    additional_habits = db.Column(JSON, nullable=True)
    additional_records = db.Column(JSON, nullable=True)
    additional_prescriptions = db.Column(JSON, nullable=True)

    # Resolved data snapshots
    vitals_snapshot = db.Column(JSON, nullable=True)
    habits_snapshot = db.Column(JSON, nullable=True)
    records_snapshot = db.Column(JSON, nullable=True)
    surgeries_snapshot = db.Column(JSON, nullable=True)
    patient_notes = db.Column(JSON, nullable=True)

    # Symptoms
    selected_symptoms = db.Column(JSON, nullable=True)
    selected_custom_symptoms = db.Column(JSON, nullable=True)

    # Lifecycle
    filter_preferences = db.Column(JSON, nullable=True)
    # The intake object attaches to exactly ONE booking of any kind — a
    # consultation appointment, a marketplace/service order, or a group /
    # health-plan booking. All three FKs are nullable; a draft (pre-booking)
    # context has all three null.
    appointment_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('appointments.appointment_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    marketplace_order_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('marketplace_orders.order_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    group_offering_booking_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('group_offering_bookings.booking_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    status = db.Column(db.String(20), default='draft', nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Relationships
    patient = db.relationship('Patient', foreign_keys=[patient_id], backref=db.backref('medical_contexts', lazy='dynamic'))
    booking_for = db.relationship('Patient', foreign_keys=[booking_for_id])
    house_group_member = db.relationship('HouseGroupMember')
    appointment = db.relationship('Appointment', backref=db.backref('medical_context', uselist=False))
    marketplace_order = db.relationship('MarketplaceOrder', backref=db.backref('medical_context', uselist=False))
    group_offering_booking = db.relationship('GroupOfferingBooking', backref=db.backref('medical_context', uselist=False))

    __table_args__ = (
        Index('ix_med_ctx_tenant_patient_status', 'tenant_id', 'patient_id', 'status'),
    )

    # Booking statuses that lock the intake from further edits — once the
    # service is delivered or the booking is dead, the shared info is frozen.
    _LOCKED_BOOKING_STATUSES = {'completed', 'cancelled', 'expired', 'no_show'}

    def linked_booking(self):
        """The single booking this intake is attached to (appointment / order /
        group booking), or None while it is still a draft."""
        return self.appointment or self.marketplace_order or self.group_offering_booking

    def is_editable(self):
        """Whether the patient may still change what they shared. A draft is
        always editable; a linked context stays editable until its booking is
        completed / cancelled / expired."""
        booking = self.linked_booking()
        if booking is None:
            return True
        st = getattr(booking, 'status', None)
        st = getattr(st, 'value', st)
        return str(st).lower() not in self._LOCKED_BOOKING_STATUSES

    def to_dict(self):
        return {
            'id': str(self.id),
            'patient_id': str(self.patient_id),
            'booking_for_id': str(self.booking_for_id) if self.booking_for_id else None,
            'house_group_member_id': str(self.house_group_member_id) if self.house_group_member_id else None,
            'consultation_type': self.consultation_type,
            'shared_health_records': self.shared_health_records,
            'shared_vitals': self.shared_vitals,
            'shared_habits': self.shared_habits,
            'shared_prescriptions': self.shared_prescriptions,
            'additional_vitals': self.additional_vitals,
            'additional_habits': self.additional_habits,
            'additional_records': self.additional_records,
            'additional_prescriptions': self.additional_prescriptions,
            'vitals_snapshot': self.vitals_snapshot,
            'habits_snapshot': self.habits_snapshot,
            'records_snapshot': self.records_snapshot,
            'surgeries_snapshot': self.surgeries_snapshot,
            'patient_notes': self.patient_notes,
            'selected_symptoms': self.selected_symptoms,
            'selected_custom_symptoms': self.selected_custom_symptoms,
            'filter_preferences': self.filter_preferences,
            'appointment_id': str(self.appointment_id) if self.appointment_id else None,
            'marketplace_order_id': str(self.marketplace_order_id) if self.marketplace_order_id else None,
            'group_offering_booking_id': str(self.group_offering_booking_id) if self.group_offering_booking_id else None,
            'is_editable': self.is_editable(),
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
        }

    def __repr__(self):
        return f"<AppointmentMedicalContext {self.id} - {self.status}>"


class AppointmentSymptom(TenantMixin, db.Model):
    """Association table for Appointment-Symptom many-to-many relationship."""
    __tablename__ = 'appointment_symptoms'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    appointment_id = db.Column(UUID(as_uuid=True), db.ForeignKey('appointments.appointment_id', ondelete='CASCADE'), nullable=False, index=True)
    symptom_id = db.Column(UUID(as_uuid=True), db.ForeignKey('symptoms.symptom_id', ondelete='CASCADE'), nullable=False, index=True)
    severity = db.Column(db.String(20), nullable=True)
    duration = db.Column(db.String(100), nullable=True)
    notes = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    # Relationships
    appointment = db.relationship('Appointment', back_populates='symptoms')
    symptom = db.relationship('Symptom', back_populates='appointments')

    __table_args__ = (
        db.UniqueConstraint('appointment_id', 'symptom_id', name='uq_appointment_symptom'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'symptom_id': str(self.symptom_id),
            'name': self.symptom.name if self.symptom else None,
            'severity': self.severity,
            'duration': self.duration,
            'notes': self.notes,
        }

    def __repr__(self):
        return f"<AppointmentSymptom {self.appointment_id} - {self.symptom_id}>"


class AppointmentRating(TenantMixin, db.Model):
    """Ratings for appointments - one rating per appointment."""
    __tablename__ = 'appointment_ratings'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='rating_id')
    appointment_id = db.Column(UUID(as_uuid=True), db.ForeignKey('appointments.appointment_id', ondelete='CASCADE'), unique=True, nullable=False, index=True)

    rating = db.Column(db.Integer, nullable=False)
    review = db.Column(db.Text, nullable=True)
    is_anonymous = db.Column(db.Boolean, default=False, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # Relationship
    appointment = db.relationship('Appointment', back_populates='rating')

    __table_args__ = (
        CheckConstraint('rating >= 1 AND rating <= 5', name='check_rating_range'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'appointment_id': str(self.appointment_id),
            'rating': self.rating,
            'review': self.review,
            'is_anonymous': self.is_anonymous,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<AppointmentRating {self.id} - {self.rating} stars>"


class AppointmentDocument(TenantMixin, db.Model):
    """Documents attached to appointments (reports, prescriptions, etc.)."""
    __tablename__ = 'appointment_documents'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='document_id')
    appointment_id = db.Column(UUID(as_uuid=True), db.ForeignKey('appointments.appointment_id', ondelete='CASCADE'), nullable=False, index=True)

    document_name = db.Column(db.String(300), nullable=False)
    description = db.Column(db.Text, nullable=True)
    attachment_link = db.Column(db.String(500), nullable=False)
    document_type = db.Column(db.String(50), nullable=True)
    uploaded_by = db.Column(db.String(20), nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    is_deleted = db.Column(db.Boolean, default=False, nullable=False)

    # Relationship
    appointment = db.relationship('Appointment', back_populates='documents')

    def to_dict(self):
        return {
            'id': str(self.id),
            'appointment_id': str(self.appointment_id),
            'document_name': self.document_name,
            'description': self.description,
            'attachment_link': self.attachment_link,
            'document_type': self.document_type,
            'uploaded_by': self.uploaded_by,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<AppointmentDocument {self.document_name}>"


class AppointmentProduct(TenantMixin, db.Model):
    """A single product/service item attached to an appointment."""
    __tablename__ = 'appointment_products'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='ap_id')
    appointment_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('appointments.appointment_id', ondelete='CASCADE'),
        nullable=False,
        unique=True,
        index=True
    )
    product_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctor_products.product_id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )

    doctor_price = db.Column(db.Numeric(10, 2), nullable=False)
    doctor_description = db.Column(db.Text, nullable=True)

    is_completed = db.Column(db.Boolean, default=False, nullable=False, index=True)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # Relationships
    appointment = db.relationship('Appointment', back_populates='appointment_product')
    product = db.relationship('DoctorProduct', back_populates='appointment_products')

    def to_dict(self):
        return {
            'id': str(self.id),
            'appointment_id': str(self.appointment_id),
            'product_id': str(self.product_id),
            'product_name': self.product.name if self.product else None,
            'product_description': self.product.description if self.product else None,
            'doctor_price': str(self.doctor_price),
            'doctor_description': self.doctor_description,
            'is_completed': self.is_completed,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
        }

    def __repr__(self):
        return f'<AppointmentProduct appointment={self.appointment_id}>'
