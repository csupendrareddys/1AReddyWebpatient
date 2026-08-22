"""
Doctor-Patient consultation (text chat) models: Consultation, ConsultationMessage.
"""
import uuid

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, SoftDeleteMixin, utcnow
from app.models._enums import ConsultationStatus


class Consultation(TenantMixin, SoftDeleteMixin, db.Model):
    """
    Doctor-Patient text-based consultation (not video call).
    Patient asks query → Doctor reviews → may ask reverse query → answers → closes.
    """
    __tablename__ = 'consultations'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='consultation_id')

    patient_id = db.Column(UUID(as_uuid=True), db.ForeignKey('patients.patient_id', ondelete='CASCADE'), nullable=False, index=True)
    doctor_id = db.Column(UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'), nullable=False, index=True)
    appointment_id = db.Column(UUID(as_uuid=True), db.ForeignKey('appointments.appointment_id'), nullable=True, index=True)

    subject = db.Column(db.String(500), nullable=True)
    initial_query = db.Column(db.Text, nullable=False)

    status = db.Column(db.Enum(ConsultationStatus), default=ConsultationStatus.PENDING, nullable=False, index=True)

    consultation_fee = db.Column(db.Numeric(10, 2), nullable=True)
    is_paid = db.Column(db.Boolean, default=False, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    closed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Relationships
    patient = db.relationship('Patient', backref=db.backref('consultations', lazy='dynamic'))
    doctor = db.relationship('Doctor', backref=db.backref('consultations', lazy='dynamic'))
    appointment = db.relationship('Appointment', backref=db.backref('consultation', uselist=False))
    messages = db.relationship(
        'ConsultationMessage',
        back_populates='consultation',
        cascade='all, delete-orphan',
        lazy='dynamic',
        order_by='ConsultationMessage.created_at'
    )

    __table_args__ = (
        Index('ix_consultations_tenant_patient_status', 'tenant_id', 'patient_id', 'status'),
        Index('ix_consultations_tenant_doctor_status', 'tenant_id', 'doctor_id', 'status'),
        Index('ix_consultations_active', 'tenant_id', 'status', postgresql_where=text('is_deleted = FALSE')),
    )

    def to_dict(self, include_messages=False):
        data = {
            'id': str(self.id),
            'patient_id': str(self.patient_id),
            'doctor_id': str(self.doctor_id),
            'subject': self.subject,
            'initial_query': self.initial_query,
            'status': self.status.value,
            'consultation_fee': str(self.consultation_fee) if self.consultation_fee else None,
            'is_paid': self.is_paid,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'closed_at': self.closed_at.isoformat() if self.closed_at else None,
        }
        if include_messages:
            data['messages'] = [m.to_dict() for m in self.messages.all()]
        return data

    def __repr__(self):
        return f"<Consultation {self.id} [{self.status.value}]>"


class ConsultationMessage(TenantMixin, db.Model):
    """Individual messages in a consultation chat."""
    __tablename__ = 'consultation_messages'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='message_id')
    consultation_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('consultations.consultation_id', ondelete='CASCADE'),
        nullable=False, index=True
    )

    sender_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True, index=True)
    sender_role = db.Column(db.String(20), nullable=False)  # 'patient', 'doctor', 'system'

    message_text = db.Column(db.Text, nullable=True)

    # Attachments: [{"name": "report.pdf", "url": "s3://...", "type": "application/pdf", "size": 1024}]
    attachments = db.Column(JSON, nullable=True)

    is_query = db.Column(db.Boolean, default=False, nullable=False)

    is_read = db.Column(db.Boolean, default=False, nullable=False)
    read_at = db.Column(db.DateTime(timezone=True), nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    # Relationships
    consultation = db.relationship('Consultation', back_populates='messages')
    sender = db.relationship('User', foreign_keys=[sender_id])

    def to_dict(self):
        return {
            'id': str(self.id),
            'consultation_id': str(self.consultation_id),
            'sender_id': str(self.sender_id) if self.sender_id else None,
            'sender_role': self.sender_role,
            'message_text': self.message_text,
            'attachments': self.attachments,
            'is_query': self.is_query,
            'is_read': self.is_read,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<ConsultationMessage {self.id} by {self.sender_role}>"
