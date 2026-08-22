"""
Clinical / patient-health models.

Models: HealthRecord, DoctorQuestion, PatientQuestionAnswer,
        QuestionnaireBlock, DoctorSymptom

All original table names, column names, FK names, constraints, and methods
are preserved. Adds TenantMixin to all models. DateTime columns use
timezone=True.

Note: AppointmentSymptom lives in the appointment module because it is a
join table for Appointment and Symptom; it is referenced here via the
Symptom relationship but not defined here.
"""
import uuid

from sqlalchemy import Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin, SoftDeleteMixin
from app.models._enums import QuestionType, PatientQuestionType


class HealthRecord(TenantMixin, TimestampMixin, SoftDeleteMixin, db.Model):
    """Patient health records (vitals, lab reports, etc.)."""
    __tablename__ = 'health_records'

    id             = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='record_id')
    patient_id     = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patients.patient_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    appointment_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('appointments.appointment_id'),
        nullable=True, index=True,
    )

    record_type      = db.Column(db.String(100), nullable=False, index=True)
    record_date      = db.Column(db.Date,        nullable=False, index=True)
    details          = db.Column(JSON,            nullable=False)
    attachment_links = db.Column(JSON,            nullable=True)
    notes            = db.Column(db.Text,         nullable=True)
    uploaded_by      = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id'), nullable=True)

    # Relationships
    patient     = db.relationship('Patient',     back_populates='health_records')
    appointment = db.relationship('Appointment', back_populates='health_records')

    __table_args__ = (
        Index('ix_health_record_tenant_patient', 'tenant_id', 'patient_id'),
        Index('ix_health_records_active', 'tenant_id', 'patient_id', postgresql_where=text('is_deleted = FALSE')),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'patient_id': str(self.patient_id),
            'appointment_id': str(self.appointment_id) if self.appointment_id else None,
            'record_type': self.record_type,
            'record_date': self.record_date.isoformat() if self.record_date else None,
            'details': self.details,
            'attachment_links': self.attachment_links,
            'notes': self.notes,
            'uploaded_by': str(self.uploaded_by) if self.uploaded_by else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f"<HealthRecord {self.record_type} - {self.record_date}>"


class DoctorQuestion(TenantMixin, TimestampMixin, db.Model):
    """Questions that doctors (or super admins globally) configure for patient intake."""
    __tablename__ = 'doctor_questions'

    id        = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='question_id')
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, index=True,   # nullable for global questions (is_global=True)
    )

    question_text    = db.Column(db.Text,  nullable=False)
    question_type    = db.Column(db.Enum(QuestionType),        nullable=False, index=True)
    category         = db.Column(db.Enum(PatientQuestionType), nullable=False, index=True)
    options          = db.Column(JSON,     nullable=True)
    is_required      = db.Column(db.Boolean, default=False, nullable=False)
    validation_rules = db.Column(JSON,     nullable=True)
    display_order    = db.Column(db.Integer, default=0, nullable=False)
    is_active        = db.Column(db.Boolean, default=True,  nullable=False, index=True)
    is_global        = db.Column(db.Boolean, default=False, nullable=False)

    doctor  = db.relationship('Doctor', back_populates='questions')
    answers = db.relationship('PatientQuestionAnswer', back_populates='question', lazy='dynamic')

    __table_args__ = (
        Index('ix_doctor_question_tenant_doctor', 'tenant_id', 'doctor_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'question_text': self.question_text,
            'question_type': self.question_type.value,
            'category': self.category.value,
            'options': self.options,
            'is_required': self.is_required,
        }

    def __repr__(self):
        return f"<DoctorQuestion {self.question_text[:30]}...>"


class PatientQuestionAnswer(TenantMixin, TimestampMixin, db.Model):
    """Patient's answers to doctor questions."""
    __tablename__ = 'patient_question_answers'

    id             = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='answer_id')
    patient_id     = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patients.patient_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    question_id    = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctor_questions.question_id'),
        nullable=False, index=True,
    )
    appointment_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('appointments.appointment_id'),
        nullable=True, index=True,
    )

    answer      = db.Column(JSON, nullable=False)
    answered_at = db.Column(db.DateTime(timezone=True), nullable=False)

    patient     = db.relationship('Patient',     back_populates='question_answers')
    question    = db.relationship('DoctorQuestion', back_populates='answers')
    appointment = db.relationship('Appointment', back_populates='question_answers')

    __table_args__ = (
        Index('ix_pqa_tenant_patient', 'tenant_id', 'patient_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'question_text': self.question.question_text if self.question else None,
            'answer': self.answer,
            'answered_at': self.answered_at.isoformat() if self.answered_at else None,
        }

    def __repr__(self):
        return f"<PatientQuestionAnswer {self.id}>"


class QuestionnaireBlock(TenantMixin, TimestampMixin, db.Model):
    """Pre-defined questionnaire blocks for specific conditions."""
    __tablename__ = 'questionnaire_blocks'

    id          = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='block_id')
    name        = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    category    = db.Column(db.String(100), nullable=True, index=True)
    # DEPRECATED: Use QuestionnaireBlockQuestion junction table instead.
    # Kept temporarily for data migration. Will be removed in a future migration.
    question_ids = db.Column(JSON, nullable=True)
    is_active   = db.Column(db.Boolean, default=True, nullable=False, index=True)

    __table_args__ = (
        Index('ix_questionnaire_block_tenant', 'tenant_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'description': self.description,
            'category': self.category,
        }

    def __repr__(self):
        return f"<QuestionnaireBlock {self.name}>"


class QuestionnaireBlockQuestion(TenantMixin, db.Model):
    """Junction table linking questionnaire blocks to their questions with ordering."""
    __tablename__ = 'questionnaire_block_questions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    block_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('questionnaire_blocks.block_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    question_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctor_questions.question_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    display_order = db.Column(db.Integer, default=0, nullable=False)

    block = db.relationship('QuestionnaireBlock', backref=db.backref('block_questions', lazy='dynamic', cascade='all, delete-orphan'))
    question = db.relationship('DoctorQuestion')

    __table_args__ = (
        UniqueConstraint('tenant_id', 'block_id', 'question_id', name='uq_block_question_tenant'),
        Index('ix_block_question_tenant_block', 'tenant_id', 'block_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'block_id': str(self.block_id),
            'question_id': str(self.question_id),
            'display_order': self.display_order,
        }


class DoctorSymptom(TenantMixin, db.Model):
    """Association table linking doctors to the symptoms they can treat."""
    __tablename__ = 'doctor_symptoms'

    id         = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doctor_id  = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    symptom_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('symptoms.symptom_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    created_at = db.Column(db.DateTime(timezone=True), nullable=False)

    # Relationships
    doctor  = db.relationship('Doctor',  back_populates='treatable_symptoms')
    symptom = db.relationship('Symptom', back_populates='doctors')

    __table_args__ = (
        UniqueConstraint('doctor_id', 'symptom_id', name='uq_doctor_symptom'),
        Index('ix_doctor_symptom_tenant_doctor', 'tenant_id', 'doctor_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id),
            'symptom_id': str(self.symptom_id),
            'symptom_name': self.symptom.name if self.symptom else None,
            'symptom_category': self.symptom.category if self.symptom else None,
        }

    def __repr__(self):
        return f"<DoctorSymptom {self.doctor_id} - {self.symptom_id}>"
