"""
Doctor model.

Changes from original model.py:
- Inherits TenantMixin (adds tenant_id FK)
- REMOVED: first_name, middle_name, last_name, gender, dob, profile_image,
           about (Text), signature_image  — these now live on User
- Added: full_name property that delegates to self.user.full_name
- registration_number unique -> tenant-scoped UniqueConstraint
- slot_visibility_approval_requested_at / slot_visibility_approved_at: timezone=True
- All DateTime columns use timezone=True
"""
import uuid

from sqlalchemy import Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, utcnow
from app.models._enums import (
    UserVerificationStatus,
    AcceptingAppointmentType,
    AvailabilityApprovalStatus,
    PublishStatus,
    DocumentVerificationStatus,
)


class Doctor(TenantMixin, db.Model):
    """Doctor profile extending the User model."""
    __tablename__ = 'doctors'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='doctor_id')
    user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='CASCADE'),
        unique=True,
        nullable=False,
        index=True
    )

    # Physical / biometric (non-personal-identity)
    fingerprint = db.Column(db.LargeBinary, nullable=True)  # Have to be researched
    profile_video = db.Column(db.String(100), nullable=True)  # Have to be researched

    # Aadhaar details (encrypted)
    aadhar_number = db.Column(db.String(255), nullable=False)  # Encrypted 12-digit
    aadhar_attachment = db.Column(db.String(500), nullable=False)  # File path
    name_as_per_aadhaar = db.Column(db.String(200), nullable=True)

    # Professional info
    registration_number = db.Column(db.String(100), nullable=False, index=True)
    registration_certificate = db.Column(db.String(500), nullable=False)  # File path
    # Approval state of the registration certificate file (admin verifies).
    registration_certificate_verification_status = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )
    registration_council = db.Column(db.String(200), nullable=True)
    registration_year = db.Column(db.Integer, nullable=True)
    # Extended registration details (Practice section — Board / State / validity).
    registration_name = db.Column(db.String(200), nullable=True)
    registration_date = db.Column(db.Date, nullable=True)
    registration_expiry = db.Column(db.Date, nullable=True)
    registration_board = db.Column(db.String(200), nullable=True)
    registration_state = db.Column(db.String(100), nullable=True)
    # Certificate of Practice (COP) — a second registration block.
    cop_number = db.Column(db.String(100), nullable=True)
    cop_name = db.Column(db.String(200), nullable=True)
    cop_date = db.Column(db.Date, nullable=True)
    cop_expiry = db.Column(db.Date, nullable=True)
    cop_board = db.Column(db.String(200), nullable=True)
    cop_state = db.Column(db.String(100), nullable=True)
    cop_attachment = db.Column(db.String(500), nullable=True)  # File path
    # Approval state of the COP attachment file (admin verifies).
    cop_attachment_verification_status = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )
    experience_years = db.Column(db.Integer, nullable=True)

    # Consultation details
    consultation_fee = db.Column(db.Numeric(10, 2), nullable=True)
    languages_known = db.Column(JSON, nullable=True)  # ["English", "Hindi", "Telugu"]
    slot_pricing = db.Column(JSON, nullable=True)  # [{ "price": 500, "description": "Regular", "duration": 15 }]

    # Extended Profile
    alternative_phone = db.Column(db.String(20), nullable=True)
    alternative_email = db.Column(db.String(254), nullable=True)
    height = db.Column(db.Numeric(5, 2), nullable=True)  # in cm
    weight = db.Column(db.Numeric(5, 2), nullable=True)  # in kg
    category = db.Column(db.String(100), nullable=True)  # General, OBC, SC, ST etc.
    religion = db.Column(db.String(100), nullable=True)
    citizenship = db.Column(db.String(100), nullable=True)
    pan_number = db.Column(db.String(50), nullable=True)
    pan_attachment = db.Column(db.String(500), nullable=True)  # File path
    name_as_per_pan = db.Column(db.String(200), nullable=True)

    # Female Specific
    female_health_details = db.Column(JSON, nullable=True)

    # Addresses
    communication_address = db.Column(JSON, nullable=True)
    permanent_address = db.Column(JSON, nullable=True)

    # Availability configuration (doctor-managed, admin-approved)
    availability_config = db.Column(JSON, nullable=True)

    # Admin approval of availability config.
    # values_callable matches ``slot_visibility_approval_status`` below so
    # both columns agree on lowercase-value storage for this enum type.
    availability_approval_status = db.Column(
        db.Enum(AvailabilityApprovalStatus, values_callable=lambda x: [e.value for e in x]),
        default=AvailabilityApprovalStatus.NOT_SUBMITTED,
        nullable=False
    )
    availability_approval_requested_at = db.Column(db.DateTime(timezone=True), nullable=True)
    availability_approved_at = db.Column(db.DateTime(timezone=True), nullable=True)
    availability_approved_by_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True
    )
    availability_rejection_reason = db.Column(db.Text, nullable=True)

    # Approved snapshots
    approved_slot_pricing = db.Column(JSON, nullable=True)
    approved_working_days = db.Column(JSON, nullable=True)
    # Per-slot approval: the admin-approved copy of availability_config['day_overrides'].
    # Only slots present here (approval_status='approved') are materialised into
    # bookable TimeSlot rows / shown to patients. The live availability_config
    # remains the doctor's draft where pending/rejected edits live.
    approved_day_overrides = db.Column(JSON, nullable=True)

    # Verification
    verification_status = db.Column(
        db.Enum(UserVerificationStatus),
        default=UserVerificationStatus.PENDING,
        nullable=False,
        index=True
    )

    # Self-declaration acceptance
    self_declaration_data = db.Column(JSON, nullable=True)

    # Appointment settings
    accepting_appointments = db.Column(
        db.Enum(AcceptingAppointmentType),
        default=AcceptingAppointmentType.MANUAL,
        nullable=False
    )
    admin_allowed_appointment_modes = db.Column(JSON, nullable=False, default=lambda: ['manual'])

    # Doctor-facing master switch for taking appointments at all (Item 3B).
    # Distinct from admin `is_live` (patient-search visibility) and from
    # `accepting_appointments` (accept policy) — this is the doctor's own
    # "I am / am not taking appointments" toggle.
    appointments_enabled = db.Column(db.Boolean, nullable=False, default=True)
    # Which consultation types the doctor offers (subset of the schedulable
    # types; NULL = all). A plan may later constrain this to a ceiling (Item 2E).
    offered_consultation_types = db.Column(JSON, nullable=True)

    # Live status
    is_live = db.Column(db.Boolean, default=False, nullable=False, index=True)

    # Publish status
    publish_status = db.Column(
        db.Enum(PublishStatus, values_callable=lambda x: [e.value for e in x]),
        default=PublishStatus.INACTIVE,
        nullable=False,
        index=True
    )

    # Per-consultation-type publish status (admin-controlled)
    publish_status_by_type = db.Column(JSON, nullable=True)

    # Per-doctor approval-mode OVERRIDES (admin-controlled). Only the keys the
    # admin overrode for this doctor are present; missing keys fall back to the
    # tenant ApprovalPolicy default. See app.api.admin.approval_policy_service.
    #   approval_permission_modes: { section: 'auto'|'manual' }
    #   approval_action_modes:     { action:  'auto_accept'|'auto_reject'|'manual' }
    approval_permission_modes = db.Column(JSON, nullable=True)
    approval_action_modes = db.Column(JSON, nullable=True)

    # Admin-curated "show on the public landing booking widget" flag. The
    # anonymous landing widget shows only popular doctors (a curated
    # subset), while the full published directory is bookable after login.
    # Independent of ``publish_status``: a doctor must be BOTH popular AND
    # publish_status=ACTIVE to surface on the landing.
    is_popular = db.Column(
        db.Boolean, default=False, server_default=db.text('false'),
        nullable=False, index=True,
    )

    # Affiliation invite code (Round 8) — short opaque code the doctor
    # shares with a hospital/clinic admin so they can claim this doctor
    # onto their roster (the "code-redeem" path of the apex add-doctor
    # feature). Stays nullable: not every doctor publishes a code; once
    # generated the doctor can rotate or revoke it. Tenant-scoped
    # uniqueness is enforced in ``__table_args__``; the column itself
    # carries an index for fast lookup-by-code without scanning the
    # tenant. ``_expires_at`` is the cut-off after which the code is
    # treated as inactive (service-side check; we do not delete the
    # column to retain audit trail of who-shared-what).
    affiliation_invite_code = db.Column(db.String(40), nullable=True, index=True)
    affiliation_invite_code_expires_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Slot visibility window
    slot_visibility_gap = db.Column(JSON, nullable=True)
    slot_visibility_approval_status = db.Column(
        db.Enum(AvailabilityApprovalStatus, values_callable=lambda x: [e.value for e in x]),
        default=AvailabilityApprovalStatus.NOT_SUBMITTED,
        nullable=False,
    )
    slot_visibility_approved_gap = db.Column(JSON, nullable=True)
    slot_visibility_approval_requested_at = db.Column(db.DateTime(timezone=True), nullable=True)
    slot_visibility_approved_at = db.Column(db.DateTime(timezone=True), nullable=True)
    slot_visibility_rejection_reason = db.Column(db.String(500), nullable=True)

    # Per-consultation-type audience targeting, keyed by schedulable type
    # ({"video": {...}, "audio": {...}}); each value has the same shape as
    # ``DoctorProduct.targeting``. Edited on the Slot Visibility tab;
    # config-only until the patient-list reordering phase lands.
    consultation_targeting = db.Column(JSON, nullable=True)

    # Timestamps
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    # Soft delete
    is_deleted = db.Column(db.Boolean, default=False, nullable=False, index=True)
    deleted_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Relationships
    user = db.relationship('User', back_populates='doctor_profile', foreign_keys=[user_id])
    # Centralized profile-detail owner (see docs/profile-owner-centralization.md).
    profile_owner = db.relationship('ProfileOwner', back_populates='doctor', uselist=False)
    # Retargeted to the consolidated tables (legacy doctor_qualification_* pruned).
    qualifications = db.relationship(
        'ProfileEducationDegree', back_populates='doctor', lazy='dynamic',
    )
    specializations = db.relationship(
        'ProfileEducationSpecialization', back_populates='doctor', lazy='dynamic',
    )
    services = db.relationship(
        'DoctorService', back_populates='doctor',
        cascade="all, delete-orphan", lazy='dynamic'
    )
    appointments = db.relationship('Appointment', back_populates='doctor', lazy='dynamic')
    prescriptions = db.relationship('Prescription', back_populates='doctor', lazy='dynamic')
    doctor_documents = db.relationship('DoctorDocument', back_populates='doctor', lazy='dynamic')
    hospital_affiliations = db.relationship(
        'DoctorHospitalAffiliation', back_populates='doctor',
        cascade="all, delete-orphan", lazy='dynamic'
    )
    questions = db.relationship('DoctorQuestion', back_populates='doctor', lazy='dynamic')
    treatable_symptoms = db.relationship(
        'DoctorSymptom', back_populates='doctor',
        cascade="all, delete-orphan", lazy='dynamic'
    )
    availability_approver = db.relationship(
        'User', foreign_keys=[availability_approved_by_id],
        backref='approved_availabilities'
    )

    __table_args__ = (
        Index('ix_doctors_tenant_verification', 'tenant_id', 'verification_status'),
        UniqueConstraint('tenant_id', 'registration_number', name='uq_doctors_tenant_reg'),
        Index('ix_doctors_active', 'tenant_id', 'verification_status', postgresql_where=text('is_deleted = FALSE')),
        # The affiliation invite code is meant to be redeemed by hospital
        # admins inside the same tenant — uniqueness is tenant-scoped so
        # codes can't collide. Partial index (WHERE NOT NULL) keeps the
        # column sparse-friendly: most doctors don't have an active code.
        Index(
            'uq_doctors_tenant_affiliation_invite_code',
            'tenant_id', 'affiliation_invite_code',
            unique=True,
            postgresql_where=text('affiliation_invite_code IS NOT NULL'),
        ),
    )

    # Statutory record identity, sealed at account deletion — mirrors
    # ``Patient.record_identity``. Clinical records identify the TREATING
    # doctor too, and prescriptions/bills must keep rendering the real
    # name for their retention period after the doctor's login identity
    # is erased. NULL for every live account.
    record_identity = db.Column(JSON, nullable=True)

    @property
    def full_name(self):
        """Delegate to the linked User's full_name — unless the account
        was deleted, in which case the sealed ``record_identity`` keeps
        retained clinical records identifiable."""
        if self.record_identity and self.record_identity.get('full_name'):
            return self.record_identity['full_name']
        if self.user:
            return self.user.full_name
        return ''

    # ── Backward-compat property shims ───────────────────────────────────
    #
    # Several columns (first_name / middle_name / last_name / gender / dob /
    # profile_image / about / signature_image) used to live on Doctor but
    # were moved to ``User`` (and ``ProfileAbout`` for ``about``,
    # ``ProfileSignature`` for the signature columns) when the
    # doctor/admin shared-profile tables were split. Existing code still
    # reads ``doctor.first_name`` / ``doctor.profile_image`` / etc. in
    # ~dozens of places (services, routes, serializers, response
    # builders) — fixing each call site one-by-one is whack-a-mole and
    # we'd regress again every time someone copies an older pattern.
    #
    # These thin properties forward the read to the right source-of-
    # truth table. ``None`` when the related row doesn't exist (the
    # doctor hasn't filled in their about block yet, etc.) so callers
    # can still build serializable response dicts without TypeError.
    #
    # NB: read-only — none of these have setters. Writes still go through
    # the right source-of-truth model (User.set_email, User.phone_number,
    # ProfileAbout(...), etc.). If a future caller tries
    # ``doctor.first_name = 'X'`` it'll raise AttributeError instead of
    # silently writing to a non-existent column.

    @property
    def first_name(self):
        return self.user.first_name if self.user else None

    @property
    def middle_name(self):
        return self.user.middle_name if self.user else None

    @property
    def last_name(self):
        return self.user.last_name if self.user else None

    @property
    def gender(self):
        return self.user.gender if self.user else None

    @property
    def dob(self):
        return self.user.dob if self.user else None

    @property
    def profile_image(self):
        return self.user.profile_image if self.user else None

    @property
    def about(self):
        """Resolve ``brief_about_text`` from ProfileAbout (the post-split
        home of ``about``). Lazy import to avoid the model-load circular
        dependency."""
        from app.models.profile_shared import ProfileAbout
        row = ProfileAbout.query.filter_by(doctor_id=self.id).first()
        return row.brief_about_text if row else None

    @property
    def signature_image(self):
        """Resolve the doctor's primary signature URL from
        ProfileSignature.signature1_url. ``None`` when no signature has
        been uploaded yet."""
        from app.models.profile_shared import ProfileSignature
        row = ProfileSignature.query.filter_by(doctor_id=self.id).first()
        return row.signature1_url if row else None

    def to_dict(self, include_user=False):
        data = {
            'id': str(self.id),
            'user_id': str(self.user_id),
            'full_name': self.full_name,
            # Personal info now sourced from User
            'first_name': self.user.first_name if self.user else None,
            'middle_name': self.user.middle_name if self.user else None,
            'last_name': self.user.last_name if self.user else None,
            'gender': self.user.gender.value if (self.user and self.user.gender) else None,
            'dob': self.user.dob.isoformat() if (self.user and self.user.dob) else None,
            'profile_image': self.user.profile_image if self.user else None,
            'registration_number': self.registration_number,
            'experience_years': self.experience_years,
            'consultation_fee': str(self.consultation_fee) if self.consultation_fee else None,
            'verification_status': self.verification_status.value,
            'languages_known': self.languages_known,
            'slot_pricing': self.slot_pricing,
            'availability_config': self.availability_config,
            'availability_approval_status': self.availability_approval_status.value,
            'availability_rejection_reason': self.availability_rejection_reason,
            'availability_approval_requested_at': self.availability_approval_requested_at.isoformat() if self.availability_approval_requested_at else None,
            'availability_approved_at': self.availability_approved_at.isoformat() if self.availability_approved_at else None,
            # Extended profile fields
            'alternative_phone': self.alternative_phone,
            'alternative_email': self.alternative_email,
            'height': str(self.height) if self.height else None,
            'weight': str(self.weight) if self.weight else None,
            'category': self.category,
            'religion': self.religion,
            'citizenship': self.citizenship,
            'pan_number': self.pan_number,
            'pan_attachment': self.pan_attachment,
            'aadhar_number': self.aadhar_number,
            'aadhar_attachment': self.aadhar_attachment,
            'female_health_details': self.female_health_details,
            'communication_address': self.communication_address,
            'permanent_address': self.permanent_address,
            'accepting_appointments': self.accepting_appointments.value if self.accepting_appointments else 'manual',
            'admin_allowed_appointment_modes': self.admin_allowed_appointment_modes or ['manual'],
            'is_live': self.is_live,
            'publish_status': self.publish_status.value if self.publish_status else 'inactive',
            'publish_status_by_type': self.publish_status_by_type or {},
            'is_popular': bool(self.is_popular),
            'slot_visibility_gap': self.slot_visibility_gap or {},
            'slot_visibility_approval_status': self.slot_visibility_approval_status.value if self.slot_visibility_approval_status else 'not_submitted',
            'slot_visibility_approved_gap': self.slot_visibility_approved_gap or {},
            'consultation_targeting': self.consultation_targeting or {},
            'slot_visibility_approval_requested_at': self.slot_visibility_approval_requested_at.isoformat() if self.slot_visibility_approval_requested_at else None,
            'slot_visibility_approved_at': self.slot_visibility_approved_at.isoformat() if self.slot_visibility_approved_at else None,
            'slot_visibility_rejection_reason': self.slot_visibility_rejection_reason,
        }
        if include_user and self.user:
            data['user_details'] = self.user.to_dict()
        return data

    def __repr__(self):
        return f"<Doctor {self.full_name} - {self.registration_number}>"
