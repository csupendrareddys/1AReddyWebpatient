"""Shared legal-entity profile for hospitals, clinics and corporate patients.

One ``EntityProfile`` row holds the entity-details a corporate registrant
provides — entity type, names, promoters, logos/image, and the four numbered
statutory documents (registration/CIN/GST/PAN) each with its own private-S3
attachment + verification status.

Polymorphic owner via the same "N nullable FKs + CHECK exactly-one" pattern
used by :class:`ProfileEducation` — exactly one of ``hospital_id`` /
``clinic_id`` / ``patient_id`` is set. Tenant-scoped (all three owners are).
The authorized-personnel sub-records (education→certification) hang off this
row and are only meaningful when ``entity_type != INDIVIDUAL``.
"""
import uuid

from sqlalchemy import CheckConstraint, Index, text
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin
from app.models._enums import EntityType, DocumentVerificationStatus


class EntityProfile(TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, db.Model):
    __tablename__ = 'entity_profiles'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # ── Polymorphic owner — exactly one of these is set (CHECK below) ──────
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
    patient_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patients.patient_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )

    # ── Core entity details ───────────────────────────────────────────────
    # Multiple entities may be attached to one owner; exactly one is the
    # primary (the one booking/display/verification flows treat as "the"
    # entity). Enforced by a partial-unique index below.
    is_primary = db.Column(db.Boolean, nullable=False, default=True, index=True)

    entity_type = db.Column(
        db.Enum(EntityType, name='entitytype'),
        nullable=False, default=EntityType.INDIVIDUAL,
    )
    entity_name = db.Column(db.String(300), nullable=True)   # "Name of the entity"
    promoters = db.Column(JSON, nullable=True)               # list of promoter names
    year_of_establishment = db.Column(db.Integer, nullable=True)
    trade_name = db.Column(db.String(300), nullable=True)
    legal_name = db.Column(db.String(300), nullable=True)

    # ── Images (public bucket → permanent URL, no verification) ───────────
    # ``logo`` = brand/account logo; ``entity_logo`` = the legal entity's logo;
    # ``entity_image`` = a photo of the entity/premises.
    logo_url = db.Column(db.String(500), nullable=True)
    logo_s3_key = db.Column(db.String(500), nullable=True)
    logo_s3_bucket = db.Column(db.String(200), nullable=True)
    entity_logo_url = db.Column(db.String(500), nullable=True)
    entity_logo_s3_key = db.Column(db.String(500), nullable=True)
    entity_logo_s3_bucket = db.Column(db.String(200), nullable=True)
    entity_image_url = db.Column(db.String(500), nullable=True)
    entity_image_s3_key = db.Column(db.String(500), nullable=True)
    entity_image_s3_bucket = db.Column(db.String(200), nullable=True)

    # ── Statutory numbers + private-S3 attachments + verification ─────────
    registration_license_number = db.Column(db.String(120), nullable=True)
    registration_license_doc_url = db.Column(db.String(500), nullable=True)
    registration_license_doc_s3_key = db.Column(db.String(500), nullable=True)
    registration_license_doc_s3_bucket = db.Column(db.String(200), nullable=True)
    registration_license_doc_verification_status = db.Column(
        db.Enum(DocumentVerificationStatus), default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    cin_number = db.Column(db.String(120), nullable=True)
    cin_doc_url = db.Column(db.String(500), nullable=True)
    cin_doc_s3_key = db.Column(db.String(500), nullable=True)
    cin_doc_s3_bucket = db.Column(db.String(200), nullable=True)
    cin_doc_verification_status = db.Column(
        db.Enum(DocumentVerificationStatus), default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    gst_number = db.Column(db.String(120), nullable=True)
    gst_doc_url = db.Column(db.String(500), nullable=True)
    gst_doc_s3_key = db.Column(db.String(500), nullable=True)
    gst_doc_s3_bucket = db.Column(db.String(200), nullable=True)
    gst_doc_verification_status = db.Column(
        db.Enum(DocumentVerificationStatus), default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    pan_number = db.Column(db.String(120), nullable=True)
    pan_doc_url = db.Column(db.String(500), nullable=True)
    pan_doc_s3_key = db.Column(db.String(500), nullable=True)
    pan_doc_s3_bucket = db.Column(db.String(200), nullable=True)
    pan_doc_verification_status = db.Column(
        db.Enum(DocumentVerificationStatus), default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    # Authorized personnel (education→certification). Populated only for
    # non-individual entities. Defined in app/models/authorized_personnel.py.
    personnel = db.relationship(
        'AuthorizedPersonnel', backref='entity_profile',
        cascade='all, delete-orphan', lazy='selectin',
    )

    __table_args__ = (
        CheckConstraint(
            '(CASE WHEN hospital_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN clinic_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN patient_id IS NOT NULL THEN 1 ELSE 0 END) = 1',
            name='ck_entity_profile_exactly_one_owner',
        ),
        # At most ONE primary entity per owner (partial-unique). Multiple
        # non-primary entities may share the same owner. Replaces the old
        # one-row-per-owner unique constraints.
        Index('uq_entity_primary_hospital', 'tenant_id', 'hospital_id', unique=True,
              postgresql_where=text('is_primary AND hospital_id IS NOT NULL')),
        Index('uq_entity_primary_clinic', 'tenant_id', 'clinic_id', unique=True,
              postgresql_where=text('is_primary AND clinic_id IS NOT NULL')),
        Index('uq_entity_primary_patient', 'tenant_id', 'patient_id', unique=True,
              postgresql_where=text('is_primary AND patient_id IS NOT NULL')),
        Index('ix_entity_profiles_hospital', 'tenant_id', 'hospital_id'),
        Index('ix_entity_profiles_clinic', 'tenant_id', 'clinic_id'),
        Index('ix_entity_profiles_patient', 'tenant_id', 'patient_id'),
    )

    # -- owner discriminator (mirrors ProfileEducation.entity_type/entity_id) -
    @property
    def owner_type(self):
        if self.hospital_id:
            return 'hospital'
        if self.clinic_id:
            return 'clinic'
        if self.patient_id:
            return 'patient'
        return None

    @property
    def owner_id(self):
        return self.hospital_id or self.clinic_id or self.patient_id

    @property
    def is_individual(self):
        return self.entity_type == EntityType.INDIVIDUAL

    def _doc(self, prefix):
        """Serialized {number, verification_status, has_file} for a statutory doc.
        The presigned URL is added by the service layer (private bucket)."""
        return {
            'number': getattr(self, f'{prefix}_number'),
            'has_file': bool(getattr(self, f'{prefix}_doc_s3_key')),
            'verification_status': getattr(self, f'{prefix}_doc_verification_status').value,
        }

    def to_dict(self):
        return {
            'id': str(self.id),
            'is_primary': self.is_primary,
            'owner_type': self.owner_type,
            'owner_id': str(self.owner_id) if self.owner_id else None,
            'entity_type': self.entity_type.value,
            'entity_name': self.entity_name,
            'promoters': self.promoters or [],
            'year_of_establishment': self.year_of_establishment,
            'trade_name': self.trade_name,
            'legal_name': self.legal_name,
            'logo_url': self.logo_url,
            'entity_logo_url': self.entity_logo_url,
            'entity_image_url': self.entity_image_url,
            'registration_license': self._doc('registration_license'),
            'cin': self._doc('cin'),
            'gst': self._doc('gst'),
            'pan': self._doc('pan'),
            'personnel': [p.to_dict() for p in self.personnel] if not self.is_individual else [],
        }
