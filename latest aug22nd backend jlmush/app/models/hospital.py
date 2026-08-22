"""
Hospital and DoctorHospitalAffiliation models.

Keeps all original table names, column names, and FK names for backward
compatibility. Adds TenantMixin to both models. DateTime columns use
timezone=True throughout. registration_number uniqueness is now scoped
to tenant_id (instead of a global UNIQUE constraint) via UniqueConstraint.
"""
import uuid

from sqlalchemy import CheckConstraint, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin, SoftDeleteMixin
from app.models._enums import (
    UserVerificationStatus, EmploymentType,
    DoctorAffiliationRequestStatus,
)


class Hospital(TenantMixin, TimestampMixin, SoftDeleteMixin, db.Model):
    """Hospital/Clinic entity."""
    __tablename__ = 'hospitals'

    id   = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='hospital_id')
    name = db.Column(db.String(300), nullable=False)

    # registration_number uniqueness is scoped to tenant (see __table_args__)
    registration_number = db.Column(db.String(100), nullable=True, index=True)
    hospital_type       = db.Column(db.String(100), nullable=True)

    # Contact
    phone   = db.Column(db.String(15),  nullable=True)
    email   = db.Column(db.String(254), nullable=True)
    website = db.Column(db.String(500), nullable=True)

    # Address
    address   = db.Column(db.Text,        nullable=False)
    city      = db.Column(db.String(100), nullable=False, index=True)
    state     = db.Column(db.String(100), nullable=False)
    pincode   = db.Column(db.String(10),  nullable=False, index=True)
    latitude  = db.Column(db.Numeric(10, 8), nullable=True)
    longitude = db.Column(db.Numeric(11, 8), nullable=True)

    # Features
    operating_hours = db.Column(JSON, nullable=True)
    facilities      = db.Column(JSON, nullable=True)
    images          = db.Column(JSON, nullable=True)

    # Status
    is_active           = db.Column(db.Boolean, default=True, nullable=False, index=True)
    verification_status = db.Column(
        db.Enum(UserVerificationStatus),
        default=UserVerificationStatus.PENDING, nullable=False,
    )

    # Marketplace owner (Round 3+4) — the apex User who signed up + pays
    # for this hospital's marketplace membership. Nullable to keep the
    # column safe for any pre-existing Hospital rows (none in prod
    # today, but the column stays nullable so the migration is a pure
    # additive change). ON DELETE SET NULL — if the admin User is
    # deleted we keep the directory record so patient bookings don't
    # cascade away.
    admin_user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    # Admin Aadhaar — S3 key set during marketplace signup
    # (mirrors the Doctor.aadhar_attachment).
    admin_aadhaar_attachment = db.Column(db.Text, nullable=True)

    # Relationships
    doctor_affiliations = db.relationship(
        'DoctorHospitalAffiliation', back_populates='hospital', lazy='dynamic',
    )
    appointments = db.relationship('Appointment', back_populates='hospital', lazy='dynamic')
    # The owning User, spelled the way Doctor and Patient spell it — see the
    # matching note on Clinic. A hospital links through ``admin_user_id``, so
    # this needs the explicit ``foreign_keys``; the Operations act-on-behalf
    # proxy resolves whoever it is impersonating with ``target.user``.
    user = db.relationship('User', foreign_keys=[admin_user_id], viewonly=True)
    # Centralized profile-detail owner (see docs/profile-owner-centralization.md).
    profile_owner = db.relationship('ProfileOwner', back_populates='hospital', uselist=False)

    __table_args__ = (
        UniqueConstraint('tenant_id', 'registration_number',
                         name='uq_hospital_tenant_registration_number'),
        Index('ix_hospital_tenant_city', 'tenant_id', 'city'),
        Index('ix_hospitals_active', 'tenant_id', 'is_active', postgresql_where=text('is_deleted = FALSE')),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'hospital_type': self.hospital_type,
            'city': self.city,
            'is_active': self.is_active,
        }

    def __repr__(self):
        return f"<Hospital {self.name}>"


class DoctorHospitalAffiliation(TenantMixin, TimestampMixin, db.Model):
    """Doctor's affiliations with hospitals/clinics."""
    __tablename__ = 'doctor_hospital_affiliations'

    id         = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='affiliation_id')
    doctor_id  = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    # Round 8.5: facility is polymorphic — exactly one of
    # ``hospital_id`` or ``clinic_id`` is set per row, enforced by the
    # ``ck_doctor_hospital_affiliations_facility_xor`` CHECK below.
    # Clinic admins use the same affiliation surface as hospital admins,
    # routed through the same service code and the same UI.
    hospital_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('hospitals.hospital_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    clinic_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('clinics.id', ondelete='CASCADE'),
        nullable=True, index=True,
    )

    employment_type = db.Column(db.Enum(EmploymentType), nullable=False)
    available_days  = db.Column(JSON, nullable=True)
    available_slots = db.Column(JSON, nullable=True)

    is_active  = db.Column(db.Boolean, default=True, nullable=False, index=True)
    start_date = db.Column(db.Date, nullable=True)
    end_date   = db.Column(db.Date, nullable=True)

    # Round 8 — request-lifecycle metadata.
    # ``status`` tracks PENDING → APPROVED/REJECTED/CANCELLED. Direct-create
    # rows (hospital fills full signup) land APPROVED immediately; code-
    # redemption + future "search by phone" flows land PENDING and wait for
    # the doctor's accept/reject. ``is_active`` is now derived: True only
    # when status == APPROVED, so the existing patient-side
    # ``filter_by(is_active=True)`` query keeps surfacing only confirmed
    # affiliations without changes.
    status = db.Column(
        db.Enum(DoctorAffiliationRequestStatus,
                values_callable=lambda x: [e.value for e in x]),
        default=DoctorAffiliationRequestStatus.PENDING,
        nullable=False, index=True,
    )
    # Hospital admin who initiated the request (kept for audit).
    # SET NULL on user delete so we don't cascade away the affiliation
    # if the admin User is later removed.
    requested_by_user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )
    # 'code' = hospital used the doctor's invite code; 'direct_create' =
    # hospital created the doctor's account themselves. Future values:
    # 'search', 'invite_link'.
    request_method = db.Column(db.String(20), nullable=True)
    invite_code_used = db.Column(db.String(40), nullable=True)
    requested_at = db.Column(db.DateTime(timezone=True), nullable=True)
    responded_at = db.Column(db.DateTime(timezone=True), nullable=True)
    rejection_reason = db.Column(db.String(500), nullable=True)

    doctor   = db.relationship('Doctor', back_populates='hospital_affiliations')
    hospital = db.relationship('Hospital', back_populates='doctor_affiliations')
    clinic   = db.relationship('Clinic', foreign_keys=[clinic_id])
    requested_by_user = db.relationship('User', foreign_keys=[requested_by_user_id])

    __table_args__ = (
        # Replaces the old plain UniqueConstraint(doctor_id, hospital_id).
        # We now allow multiple historical rows per (doctor, facility) as
        # long as at most ONE is currently active (PENDING or APPROVED).
        # Rejected / cancelled requests are kept for audit; a facility can
        # legitimately re-invite a doctor after a prior rejection.
        Index(
            'uq_doctor_facility_active',
            'doctor_id', 'hospital_id', 'clinic_id',
            unique=True,
            postgresql_where=text("status IN ('pending', 'approved')"),
        ),
        # Exactly one of hospital_id / clinic_id is set — guard against
        # both-NULL or both-set rows landing in the table.
        CheckConstraint(
            '(hospital_id IS NOT NULL AND clinic_id IS NULL) '
            'OR (hospital_id IS NULL AND clinic_id IS NOT NULL)',
            name='ck_doctor_hospital_affiliations_facility_xor',
        ),
    )

    def to_dict(self):
        # Facility name + kind unify the hospital/clinic rendering on
        # the frontend; the doctor's UI doesn't need to care which
        # vertical the row belongs to.
        if self.hospital_id:
            facility_id = str(self.hospital_id)
            facility_kind = 'hospital'
            facility_name = self.hospital.name if self.hospital else None
        elif self.clinic_id:
            facility_id = str(self.clinic_id)
            facility_kind = 'clinic'
            facility_name = self.clinic.name if self.clinic else None
        else:
            facility_id = None
            facility_kind = None
            facility_name = None
        return {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id),
            'facility_id': facility_id,
            'facility_kind': facility_kind,
            'facility_name': facility_name,
            # Back-compat keys kept so existing UI code keeps working.
            'hospital_id': str(self.hospital_id) if self.hospital_id else None,
            'clinic_id': str(self.clinic_id) if self.clinic_id else None,
            'hospital_name': facility_name,
            'doctor_name': (
                self.doctor.full_name if self.doctor else None
            ),
            'employment_type': self.employment_type.value,
            'is_active': self.is_active,
            'status': self.status.value if self.status else None,
            'request_method': self.request_method,
            'requested_at': self.requested_at.isoformat() if self.requested_at else None,
            'responded_at': self.responded_at.isoformat() if self.responded_at else None,
            'rejection_reason': self.rejection_reason,
        }

    def __repr__(self):
        return f"<DoctorHospitalAffiliation {self.doctor_id} - {self.hospital_id}>"
