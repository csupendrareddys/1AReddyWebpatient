"""Family Doctor / Empanelment models.

A patient links ONE family doctor (empanelment); a doctor can have MANY
empanelled patients. Either side can initiate a request; the other accepts.
Mirrors the care-network / house-group request-accept pattern:

  * ``FamilyDoctorLink`` — the active link (one active per patient, enforced
    by a partial-unique index).
  * ``FamilyDoctorRequest`` — a pending request keyed to ``target_user_id``
    (the party who must accept), reusing ``HouseGroupRequestStatus``.
"""
import uuid

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin, utcnow
from app.models._enums import HouseGroupRequestStatus


class FamilyDoctorLink(TenantMixin, TimestampMixin, db.Model):
    """An active patient<->family-doctor link. At most one active row per
    patient (a patient has a single family doctor); a doctor may appear on
    many rows (many empanelled patients)."""
    __tablename__ = 'family_doctor_links'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patients.patient_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    # 'patient' or 'doctor' — who initiated the link (audit / display).
    linked_via = db.Column(db.String(20), nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)

    patient = db.relationship('Patient', foreign_keys=[patient_id])
    doctor = db.relationship('Doctor', foreign_keys=[doctor_id])

    __table_args__ = (
        # One ACTIVE family doctor per patient. Historical (delinked) rows may
        # coexist. A doctor can have many patients, so no doctor-side unique.
        db.Index(
            'uq_family_doctor_active_patient',
            'tenant_id', 'patient_id',
            unique=True, postgresql_where=text('is_active'),
        ),
    )

    def to_dict(self):
        doc = self.doctor
        pat = self.patient
        return {
            'id': str(self.id),
            'patient_id': str(self.patient_id),
            'doctor_id': str(self.doctor_id),
            'doctor_name': doc.full_name if doc else None,
            'patient_name': pat.full_name if pat else None,
            'linked_via': self.linked_via,
            'is_active': self.is_active,
            'linked_at': self.created_at.isoformat() if self.created_at else None,
        }


class FamilyDoctorRequest(TenantMixin, TimestampMixin, db.Model):
    """A pending family-doctor request. Either a patient requesting a doctor
    or a doctor requesting a patient; the ``target_user_id`` is whichever
    party must accept (resolved via their own inbox)."""
    __tablename__ = 'family_doctor_requests'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Known parties (either may be null until the request is resolved by phone).
    patient_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patients.patient_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    initiated_by = db.Column(db.String(20), nullable=False)  # 'patient' | 'doctor'
    requested_by_user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )
    # The party who must accept (the counterparty's user account).
    target_user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    target_phone = db.Column(db.String(20), nullable=True)
    target_name = db.Column(db.String(200), nullable=True)
    target_last_name = db.Column(db.String(100), nullable=True)
    invite_code = db.Column(db.String(40), nullable=True, index=True)
    status = db.Column(
        db.Enum(HouseGroupRequestStatus),
        default=HouseGroupRequestStatus.PENDING, nullable=False, index=True,
    )
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True)

    patient = db.relationship('Patient', foreign_keys=[patient_id])
    doctor = db.relationship('Doctor', foreign_keys=[doctor_id])
    target_user = db.relationship('User', foreign_keys=[target_user_id])

    def to_dict(self):
        return {
            'id': str(self.id),
            'patient_id': str(self.patient_id) if self.patient_id else None,
            'doctor_id': str(self.doctor_id) if self.doctor_id else None,
            'patient_name': self.patient.full_name if self.patient else None,
            'doctor_name': self.doctor.full_name if self.doctor else None,
            'initiated_by': self.initiated_by,
            'target_user_id': str(self.target_user_id) if self.target_user_id else None,
            'target_phone': self.target_phone,
            'target_name': self.target_name,
            'target_last_name': self.target_last_name,
            'invite_code': self.invite_code,
            'status': self.status.value if self.status else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
        }
