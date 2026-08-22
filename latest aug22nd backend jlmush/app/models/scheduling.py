"""
Scheduling models: TimeSlot, TimeSlotType, AttendancePageConfig.

All original table names, column names, FK names, constraints, and methods
are preserved. Adds TenantMixin to all models. DateTime columns use
timezone=True throughout.
"""
import uuid

from sqlalchemy import Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin
from app.models._enums import ConsultationType


class TimeSlot(TenantMixin, TimestampMixin, db.Model):
    """
    A concrete time-slot record for a doctor on a specific date.
    Replaces the ephemeral JSON-computed slots for booking purposes.
    One time_slot = one capacity unit (only one booking allowed).
    """
    __tablename__ = 'time_slots'

    id        = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    date       = db.Column(db.Date, nullable=False, index=True)
    start_time = db.Column(db.Time, nullable=False)
    end_time   = db.Column(db.Time, nullable=False)
    is_booked  = db.Column(db.Boolean, default=False, nullable=False)

    # Soft reservation for follow-up
    soft_reserved_for_patient_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patients.patient_id'),
        nullable=True, index=True,
    )
    soft_reservation_expiry = db.Column(db.DateTime(timezone=True), nullable=True)

    # Relationships
    doctor = db.relationship('Doctor', backref=db.backref('time_slots', lazy='dynamic'))
    soft_reserved_patient = db.relationship(
        'Patient', foreign_keys=[soft_reserved_for_patient_id],
    )
    consultation_types = db.relationship(
        'TimeSlotType', back_populates='time_slot',
        cascade='all, delete-orphan', lazy='joined',
    )
    appointment = db.relationship(
        'Appointment', back_populates='time_slot', uselist=False,
    )

    __table_args__ = (
        Index('ix_timeslots_doctor_date', 'doctor_id', 'date'),
        UniqueConstraint('doctor_id', 'date', 'start_time', name='uq_timeslot_doctor_date_start'),
        Index('ix_timeslots_tenant_doctor', 'tenant_id', 'doctor_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'doctorId': str(self.doctor_id),
            'date': self.date.isoformat(),
            'start': self.start_time.strftime('%H:%M'),
            'end': self.end_time.strftime('%H:%M'),
            'duration': (
                (self.end_time.hour * 60 + self.end_time.minute)
                - (self.start_time.hour * 60 + self.start_time.minute)
            ),
            'isBooked': self.is_booked,
            'softReservedForPatientId': str(self.soft_reserved_for_patient_id)
                if self.soft_reserved_for_patient_id else None,
            'softReservationExpiry': self.soft_reservation_expiry.isoformat()
                if self.soft_reservation_expiry else None,
            'consultationTypes': [
                ct.consultation_type.value for ct in self.consultation_types
            ],
        }

    def __repr__(self):
        return (
            f"<TimeSlot {self.date} {self.start_time}-{self.end_time} "
            f"booked={self.is_booked}>"
        )


class TimeSlotType(TenantMixin, db.Model):
    """
    Maps a consultation type to a time slot.
    Many-to-one: a single TimeSlot can offer VIDEO, AUDIO, CHAT, COMPLETE, etc.
    """
    __tablename__ = 'time_slot_types'

    id           = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    time_slot_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('time_slots.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    consultation_type = db.Column(
        db.Enum(
            ConsultationType,
            values_callable=lambda e: [m.value for m in e],
            create_constraint=False,
        ),
        nullable=False,
    )

    time_slot = db.relationship('TimeSlot', back_populates='consultation_types')

    __table_args__ = (
        UniqueConstraint('time_slot_id', 'consultation_type', name='uq_slottype_slot_type'),
    )

    def __repr__(self):
        return f"<TimeSlotType slot={self.time_slot_id} type={self.consultation_type.value}>"


class AttendancePageConfig(TenantMixin, TimestampMixin, db.Model):
    """
    Admin-configurable page settings for the Attendance & Activity module.
    Stores section labels, field visibility, consultation type filters, and translations.
    doctor_id=NULL means this is the global default config.
    """
    __tablename__ = 'attendance_page_configs'

    id          = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doctor_id   = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, index=True,  # null = global default
    )
    section_key = db.Column(db.String(50), nullable=False)  # 'acceptance', 'executive', etc.
    config      = db.Column(JSON, nullable=False)
    # config schema:
    # {
    #   "enabled": true,
    #   "label": "Acceptance Stage",
    #   "fields": {
    #     "auto_approved_total": { "enabled": true, "label": "Auto Approved" },
    #     ...
    #   },
    #   "consultation_types": ["video", "audio", "chat", "complete"],
    #   "translations": { "label": { "hi": "...", "te": "..." } }
    # }

    created_by_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )

    # Relationships
    doctor     = db.relationship('Doctor', backref=db.backref('attendance_configs', lazy='dynamic'))
    created_by = db.relationship('User', foreign_keys=[created_by_id])

    __table_args__ = (
        UniqueConstraint('doctor_id', 'section_key', name='uq_attendance_config_doctor_section'),
        Index('ix_attendance_config_tenant', 'tenant_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id) if self.doctor_id else None,
            'section_key': self.section_key,
            'config': self.config,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f"<AttendancePageConfig doctor={self.doctor_id} section={self.section_key}>"
