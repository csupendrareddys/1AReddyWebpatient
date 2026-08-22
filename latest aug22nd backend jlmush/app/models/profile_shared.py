"""
Profile sub-models shared between Doctor and Admin entities.

Each model uses dual nullable FK columns (doctor_id, admin_id) with a
CHECK constraint guaranteeing exactly one is set.  This replaces the old
polymorphic entity_type + entity_id pattern.

Backward-compatible computed properties entity_type and entity_id are
provided on every model so that existing service/route code continues to
work without changes.

Also contains DeclarationConfig which is admin-configurable and applies to
both doctors and admins (no entity columns needed there).
"""
import uuid

from sqlalchemy import CheckConstraint, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin
from app.models._enums import DocumentVerificationStatus


# ---------------------------------------------------------------------------
# ProfileSignature  (was DoctorSignature + AdminSignature)
# ---------------------------------------------------------------------------

class ProfileSignature(TenantMixin, TimestampMixin, db.Model):
    """
    Signature records for both doctors and admins.
    Exactly one of doctor_id / admin_id must be non-NULL.
    """
    __tablename__ = 'profile_signatures'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Dual nullable FK pattern
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    admin_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('admins.admin_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )

    # Centralized owner (Phase A: additive/nullable; doctor_id + admin_id above
    # stay until the contract migration). See docs/profile-owner-centralization.md.
    profile_owner_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('profile_owner.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    profile_owner = db.relationship('ProfileOwner', back_populates='signatures')

    # Signature 1
    signature1_url                    = db.Column(db.String(500), nullable=True)
    signature1_s3_key                 = db.Column(db.String(500), nullable=True)
    signature1_s3_bucket              = db.Column(db.String(200), nullable=True)
    signature1_verification_status    = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    # Signature 2
    signature2_url                    = db.Column(db.String(500), nullable=True)
    signature2_s3_key                 = db.Column(db.String(500), nullable=True)
    signature2_s3_bucket              = db.Column(db.String(200), nullable=True)
    signature2_verification_status    = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    # Digital Signature
    digital_signature_url                 = db.Column(db.String(500), nullable=True)
    digital_signature_s3_key              = db.Column(db.String(500), nullable=True)
    digital_signature_s3_bucket           = db.Column(db.String(200), nullable=True)
    digital_signature_verification_status = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            '(doctor_id IS NOT NULL AND admin_id IS NULL) OR (doctor_id IS NULL AND admin_id IS NOT NULL)',
            name='ck_profile_signatures_exactly_one_owner',
        ),
        UniqueConstraint('tenant_id', 'doctor_id', name='uq_prof_sig_tenant_doctor'),
        UniqueConstraint('tenant_id', 'admin_id',  name='uq_prof_sig_tenant_admin'),
        Index('ix_profile_signature_tenant_doctor', 'tenant_id', 'doctor_id'),
        Index('ix_profile_signature_tenant_admin',  'tenant_id', 'admin_id'),
    )

    # ── backward-compat computed properties ───────────────────────────────────

    @property
    def entity_type(self):
        """Backward-compat: returns 'doctor' or 'admin'."""
        return 'doctor' if self.doctor_id else 'admin'

    @property
    def entity_id(self):
        """Backward-compat: returns the doctor_id or admin_id."""
        return self.doctor_id or self.admin_id

    # ── serialisation ─────────────────────────────────────────────────────────

    def _file_url(self, stored_url, s3_bucket, s3_key):
        """A URL that is actually alive at READ time.

        The ``*_url`` columns historically had 1-hour PRESIGNED URLs
        persisted into them ("refresh before returning" writers), so a row
        read later than an hour after its last write served a dead link.
        Sign fresh from the key whenever we have one; the stored URL is
        only a fallback for legacy rows that never got a key.
        """
        if s3_key:
            from app.services.s3_service import S3Service
            return S3Service.generate_presigned_url(
                s3_bucket, s3_key, expiration=1800) or stored_url
        return stored_url

    def to_response_dict(self):
        data = {}
        sig1 = self._file_url(self.signature1_url,
                              self.signature1_s3_bucket, self.signature1_s3_key)
        if sig1:
            data['signature1'] = {
                'fileUrl': sig1,
                'verificationStatus': self.signature1_verification_status.value,
            }
        sig2 = self._file_url(self.signature2_url,
                              self.signature2_s3_bucket, self.signature2_s3_key)
        if sig2:
            data['signature2'] = {
                'fileUrl': sig2,
                'verificationStatus': self.signature2_verification_status.value,
            }
        dsig = self._file_url(self.digital_signature_url,
                              self.digital_signature_s3_bucket,
                              self.digital_signature_s3_key)
        if dsig:
            data['digital_signature'] = {
                'fileUrl': dsig,
                'verificationStatus': self.digital_signature_verification_status.value,
            }
        return data

    def __repr__(self):
        return f"<ProfileSignature entity_type={self.entity_type} entity_id={self.entity_id}>"


# ---------------------------------------------------------------------------
# ProfileAbout  (was DoctorAbout + AdminAbout)
# ---------------------------------------------------------------------------

class ProfileAbout(TenantMixin, TimestampMixin, db.Model):
    """
    About info for both doctors and admins.
    Exactly one of doctor_id / admin_id must be non-NULL.
    """
    __tablename__ = 'profile_about'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Dual nullable FK pattern
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    admin_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('admins.admin_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )

    profile_owner_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('profile_owner.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    profile_owner = db.relationship('ProfileOwner', back_populates='about')

    brief_about_text                       = db.Column(db.Text, nullable=True)
    brief_about_attachment_url             = db.Column(db.String(500), nullable=True)
    brief_about_attachment_s3_key          = db.Column(db.String(500), nullable=True)
    brief_about_attachment_s3_bucket       = db.Column(db.String(200), nullable=True)
    brief_about_verification_status        = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    nature_of_work_text                    = db.Column(db.Text, nullable=True)
    nature_of_work_attachment_url          = db.Column(db.String(500), nullable=True)
    nature_of_work_attachment_s3_key       = db.Column(db.String(500), nullable=True)
    nature_of_work_attachment_s3_bucket    = db.Column(db.String(200), nullable=True)
    nature_of_work_verification_status     = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    currently_working_with_text                 = db.Column(db.Text, nullable=True)
    currently_working_with_attachment_url        = db.Column(db.String(500), nullable=True)
    currently_working_with_attachment_s3_key     = db.Column(db.String(500), nullable=True)
    currently_working_with_attachment_s3_bucket  = db.Column(db.String(200), nullable=True)
    currently_working_with_verification_status   = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    # Admin-curated work qualification the doctor picks (Category row with
    # category_type='work_qualification'). Carries its own verification status
    # so it moves through the same approval path as the blocks above.
    work_qualification_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('categories.category_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    work_qualification_verification_status = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )
    work_qualification = db.relationship('Category', foreign_keys=[work_qualification_id])

    # Work experience at each rung of the education ladder, in whole years.
    # NULL means "not stated", which is not the same as 0 — a product's
    # experience rule treats an unstated level as unmet rather than as zero
    # years served. One shared verification status: they are entered and
    # approved together as a single claim about the doctor's history.
    ug_experience_years = db.Column(db.Integer, nullable=True)
    pg_experience_years = db.Column(db.Integer, nullable=True)
    super_speciality_experience_years = db.Column(db.Integer, nullable=True)
    experience_verification_status = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    # Maps the ladder's level keys to their column, so callers don't hand-roll
    # the mapping (the qualification_level strings are free-form).
    EXPERIENCE_COLUMN_BY_LEVEL = {
        'ug': 'ug_experience_years',
        'pg': 'pg_experience_years',
        'super_speciality': 'super_speciality_experience_years',
    }

    def experience_by_level(self):
        """{level: years} for every level the doctor has actually stated."""
        out = {}
        for level, attr in self.EXPERIENCE_COLUMN_BY_LEVEL.items():
            years = getattr(self, attr, None)
            if years is not None:
                out[level] = years
        return out

    __table_args__ = (
        CheckConstraint(
            '(doctor_id IS NOT NULL AND admin_id IS NULL) OR (doctor_id IS NULL AND admin_id IS NOT NULL)',
            name='ck_profile_about_exactly_one_owner',
        ),
        UniqueConstraint('tenant_id', 'doctor_id', name='uq_prof_about_tenant_doctor'),
        UniqueConstraint('tenant_id', 'admin_id',  name='uq_prof_about_tenant_admin'),
        Index('ix_profile_about_tenant_doctor', 'tenant_id', 'doctor_id'),
        Index('ix_profile_about_tenant_admin',  'tenant_id', 'admin_id'),
    )

    # ── backward-compat computed properties ───────────────────────────────────

    @property
    def entity_type(self):
        """Backward-compat: returns 'doctor' or 'admin'."""
        return 'doctor' if self.doctor_id else 'admin'

    @property
    def entity_id(self):
        """Backward-compat: returns the doctor_id or admin_id."""
        return self.doctor_id or self.admin_id

    # ── serialisation ─────────────────────────────────────────────────────────

    def to_response_dict(self):
        data = {}
        if self.brief_about_text or self.brief_about_attachment_url:
            data['brief_about'] = {
                'text': self.brief_about_text,
                'attachment_url': self.brief_about_attachment_url,
                'verification_status': self.brief_about_verification_status.value,
            }
        if self.nature_of_work_text or self.nature_of_work_attachment_url:
            data['nature_of_work'] = {
                'text': self.nature_of_work_text,
                'attachment_url': self.nature_of_work_attachment_url,
                'verification_status': self.nature_of_work_verification_status.value,
            }
        if self.currently_working_with_text or self.currently_working_with_attachment_url:
            data['currently_working_with'] = {
                'text': self.currently_working_with_text,
                'attachment_url': self.currently_working_with_attachment_url,
                'verification_status': self.currently_working_with_verification_status.value,
            }
        if self.work_qualification_id:
            data['work_qualification'] = {
                'id': str(self.work_qualification_id),
                'name': self.work_qualification.name if self.work_qualification else None,
                'verification_status': self.work_qualification_verification_status.value,
            }
        # Always emitted, unlike the blocks above: the form needs to show the
        # empty fields so a doctor can fill them in the first place.
        data['experience'] = {
            'ug_years': self.ug_experience_years,
            'pg_years': self.pg_experience_years,
            'super_speciality_years': self.super_speciality_experience_years,
            'verification_status': self.experience_verification_status.value,
        }
        return data

    def __repr__(self):
        return f"<ProfileAbout entity_type={self.entity_type} entity_id={self.entity_id}>"


# ---------------------------------------------------------------------------
# ProfileEducation  (was DoctorEducation + AdminEducation)
# ---------------------------------------------------------------------------

class ProfileEducation(TenantMixin, TimestampMixin, db.Model):
    """
    Education details for both doctors and admins.
    Covers: Graduation, Post-Graduation, Super-Speciality, Other Certification.
    Exactly one of doctor_id / admin_id must be non-NULL.
    """
    __tablename__ = 'profile_education'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Dual nullable FK pattern
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    admin_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('admins.admin_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    # Third owner: an authorized person of a corporate EntityProfile. Reuses
    # this exact education→certification structure for the entity onboarding
    # sub-form. Exactly one of the three owner FKs is set (CHECK below).
    authorized_personnel_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('authorized_personnel.id', ondelete='CASCADE'),
        nullable=True, index=True,
    )

    profile_owner_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('profile_owner.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    profile_owner = db.relationship('ProfileOwner', back_populates='education')

    # Graduation
    graduation_data                               = db.Column(JSON, nullable=True)
    graduation_certificate_url                    = db.Column(db.String(500), nullable=True)
    graduation_certificate_s3_key                 = db.Column(db.String(500), nullable=True)
    graduation_certificate_s3_bucket              = db.Column(db.String(200), nullable=True)
    graduation_certificate_verification_status    = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )
    graduation_marksheet_url                      = db.Column(db.String(500), nullable=True)
    graduation_marksheet_s3_key                   = db.Column(db.String(500), nullable=True)
    graduation_marksheet_s3_bucket                = db.Column(db.String(200), nullable=True)
    graduation_marksheet_verification_status      = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    # Post Graduation
    post_graduation_data                               = db.Column(JSON, nullable=True)
    post_graduation_certificate_url                    = db.Column(db.String(500), nullable=True)
    post_graduation_certificate_s3_key                 = db.Column(db.String(500), nullable=True)
    post_graduation_certificate_s3_bucket              = db.Column(db.String(200), nullable=True)
    post_graduation_certificate_verification_status    = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )
    post_graduation_marksheet_url                      = db.Column(db.String(500), nullable=True)
    post_graduation_marksheet_s3_key                   = db.Column(db.String(500), nullable=True)
    post_graduation_marksheet_s3_bucket                = db.Column(db.String(200), nullable=True)
    post_graduation_marksheet_verification_status      = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    # Super Speciality
    super_speciality_data                               = db.Column(JSON, nullable=True)
    super_speciality_certificate_url                    = db.Column(db.String(500), nullable=True)
    super_speciality_certificate_s3_key                 = db.Column(db.String(500), nullable=True)
    super_speciality_certificate_s3_bucket              = db.Column(db.String(200), nullable=True)
    super_speciality_certificate_verification_status    = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )
    super_speciality_marksheet_url                      = db.Column(db.String(500), nullable=True)
    super_speciality_marksheet_s3_key                   = db.Column(db.String(500), nullable=True)
    super_speciality_marksheet_s3_bucket                = db.Column(db.String(200), nullable=True)
    super_speciality_marksheet_verification_status      = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    # Other Certification
    other_certification_data                               = db.Column(JSON, nullable=True)
    other_certification_certificate_url                    = db.Column(db.String(500), nullable=True)
    other_certification_certificate_s3_key                 = db.Column(db.String(500), nullable=True)
    other_certification_certificate_s3_bucket              = db.Column(db.String(200), nullable=True)
    other_certification_certificate_verification_status    = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )
    other_certification_marksheet_url                      = db.Column(db.String(500), nullable=True)
    other_certification_marksheet_s3_key                   = db.Column(db.String(500), nullable=True)
    other_certification_marksheet_s3_bucket                = db.Column(db.String(200), nullable=True)
    other_certification_marksheet_verification_status      = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            '(CASE WHEN doctor_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN admin_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN authorized_personnel_id IS NOT NULL THEN 1 ELSE 0 END) = 1',
            name='ck_profile_education_exactly_one_owner',
        ),
        UniqueConstraint('tenant_id', 'doctor_id', name='uq_prof_edu_tenant_doctor'),
        UniqueConstraint('tenant_id', 'admin_id',  name='uq_prof_edu_tenant_admin'),
        UniqueConstraint('tenant_id', 'authorized_personnel_id', name='uq_prof_edu_tenant_personnel'),
        Index('ix_profile_education_tenant_doctor', 'tenant_id', 'doctor_id'),
        Index('ix_profile_education_tenant_admin',  'tenant_id', 'admin_id'),
        Index('ix_profile_education_tenant_personnel', 'tenant_id', 'authorized_personnel_id'),
    )

    # ── backward-compat computed properties ───────────────────────────────────

    @property
    def entity_type(self):
        """Backward-compat: returns 'doctor', 'admin' or 'authorized_personnel'."""
        if self.doctor_id:
            return 'doctor'
        if self.admin_id:
            return 'admin'
        return 'authorized_personnel'

    @property
    def entity_id(self):
        """Backward-compat: returns the set owner FK."""
        return self.doctor_id or self.admin_id or self.authorized_personnel_id

    # ── helpers ───────────────────────────────────────────────────────────────

    def _section_to_dict(self, data, cert_url, cert_status, mark_url, mark_status):
        return {
            **(data or {}),
            'certificateUrl': cert_url,
            'certificateVerificationStatus': cert_status.value if cert_status else 'pending',
            'marksheetUrl': mark_url,
            'marksheetVerificationStatus': mark_status.value if mark_status else 'pending',
        }

    def to_response_dict(self):
        return {
            'graduation': self._section_to_dict(
                self.graduation_data,
                self.graduation_certificate_url,
                self.graduation_certificate_verification_status,
                self.graduation_marksheet_url,
                self.graduation_marksheet_verification_status,
            ),
            'postGraduation': self._section_to_dict(
                self.post_graduation_data,
                self.post_graduation_certificate_url,
                self.post_graduation_certificate_verification_status,
                self.post_graduation_marksheet_url,
                self.post_graduation_marksheet_verification_status,
            ),
            'superSpeciality': self._section_to_dict(
                self.super_speciality_data,
                self.super_speciality_certificate_url,
                self.super_speciality_certificate_verification_status,
                self.super_speciality_marksheet_url,
                self.super_speciality_marksheet_verification_status,
            ),
            'otherCertification': self._section_to_dict(
                self.other_certification_data,
                self.other_certification_certificate_url,
                self.other_certification_certificate_verification_status,
                self.other_certification_marksheet_url,
                self.other_certification_marksheet_verification_status,
            ),
        }

    def __repr__(self):
        return f"<ProfileEducation entity_type={self.entity_type} entity_id={self.entity_id}>"


# ---------------------------------------------------------------------------
# ProfileBankAccount  (was DoctorBankAccount + AdminBankAccount)
# ---------------------------------------------------------------------------

class ProfileBankAccount(TenantMixin, TimestampMixin, db.Model):
    """
    Bank accounts for both doctors and admins.
    order_index 0 = primary, 1 = secondary, 2+ = additional.
    verification_status (overall) is carried from DoctorBankAccount; nullable
    so legacy admin records that never had this column remain valid.
    Exactly one of doctor_id / admin_id must be non-NULL.
    """
    __tablename__ = 'profile_bank_accounts'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Dual nullable FK pattern
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    admin_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('admins.admin_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )

    profile_owner_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('profile_owner.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    profile_owner = db.relationship('ProfileOwner', back_populates='bank_accounts')

    order_index  = db.Column(db.Integer, nullable=False, default=0)

    bank_name      = db.Column(db.String(200), nullable=True)
    account_name   = db.Column(db.String(200), nullable=True)
    account_number = db.Column(db.String(50),  nullable=True)
    ifsc_code      = db.Column(db.String(20),  nullable=True)
    branch         = db.Column(db.String(200), nullable=True)

    # Document: Bank Passbook
    passbook_url                 = db.Column(db.String(500), nullable=True)
    passbook_s3_key              = db.Column(db.String(500), nullable=True)
    passbook_s3_bucket           = db.Column(db.String(200), nullable=True)
    passbook_verification_status = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    # Document: Check Leaf
    check_leaf_url                 = db.Column(db.String(500), nullable=True)
    check_leaf_s3_key              = db.Column(db.String(500), nullable=True)
    check_leaf_s3_bucket           = db.Column(db.String(200), nullable=True)
    check_leaf_verification_status = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    # Document: Bank Statement
    bank_statement_url                 = db.Column(db.String(500), nullable=True)
    bank_statement_s3_key              = db.Column(db.String(500), nullable=True)
    bank_statement_s3_bucket           = db.Column(db.String(200), nullable=True)
    bank_statement_verification_status = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    # Overall account verification (from DoctorBankAccount; nullable for admin compat)
    verification_status = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=True,
    )

    # ── Cashfree payout beneficiary (Phase B) ──────────────────────────────
    # Registered once (add + penny-drop + doctor confirm), reused for every
    # payout, removed on bank change / offboarding.
    cashfree_beneficiary_id = db.Column(db.String(100), nullable=True, index=True)
    # none | registered | penny_sent | verified | failed | removed
    beneficiary_status = db.Column(db.String(30), nullable=True, default='none')
    penny_drop_ref = db.Column(db.String(100), nullable=True)   # ₹1 transfer_id
    penny_drop_amount = db.Column(db.Numeric(10, 2), nullable=True)
    verified_name = db.Column(db.String(200), nullable=True)    # name from Cashfree, if any
    doctor_confirmed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(
            '(doctor_id IS NOT NULL AND admin_id IS NULL) OR (doctor_id IS NULL AND admin_id IS NOT NULL)',
            name='ck_profile_bank_accounts_exactly_one_owner',
        ),
        UniqueConstraint('tenant_id', 'doctor_id', 'order_index',
                         name='uq_prof_bank_tenant_doctor_order'),
        UniqueConstraint('tenant_id', 'admin_id',  'order_index',
                         name='uq_prof_bank_tenant_admin_order'),
        Index('ix_profile_bank_account_tenant_doctor', 'tenant_id', 'doctor_id'),
        Index('ix_profile_bank_account_tenant_admin',  'tenant_id', 'admin_id'),
    )

    # ── backward-compat computed properties ───────────────────────────────────

    @property
    def entity_type(self):
        """Backward-compat: returns 'doctor' or 'admin'."""
        return 'doctor' if self.doctor_id else 'admin'

    @property
    def entity_id(self):
        """Backward-compat: returns the doctor_id or admin_id."""
        return self.doctor_id or self.admin_id

    # ── serialisation ─────────────────────────────────────────────────────────

    def to_response_dict(self):
        return {
            'id': str(self.id),
            'orderIndex': self.order_index,
            'bankName': self.bank_name or '',
            'accountName': self.account_name or '',
            'accountNumber': self.account_number or '',
            'ifscCode': self.ifsc_code or '',
            'branch': self.branch or '',
            'passbook': {
                'fileUrl': self.passbook_url,
                'verificationStatus': self.passbook_verification_status.value
                    if self.passbook_verification_status else 'pending',
            },
            'checkLeaf': {
                'fileUrl': self.check_leaf_url,
                'verificationStatus': self.check_leaf_verification_status.value
                    if self.check_leaf_verification_status else 'pending',
            },
            'bankStatement': {
                'fileUrl': self.bank_statement_url,
                'verificationStatus': self.bank_statement_verification_status.value
                    if self.bank_statement_verification_status else 'pending',
            },
            'verificationStatus': self.verification_status.value
                if self.verification_status else 'pending',
            'beneficiaryStatus': self.beneficiary_status or 'none',
            'pennyDropSent': bool(self.penny_drop_ref),
            'doctorConfirmed': bool(self.doctor_confirmed_at),
        }

    def __repr__(self):
        return f"<ProfileBankAccount entity_type={self.entity_type} entity_id={self.entity_id} order={self.order_index}>"


# ---------------------------------------------------------------------------
# DeclarationConfig  (unchanged — no entity columns needed)
# ---------------------------------------------------------------------------

class DeclarationConfig(TenantMixin, TimestampMixin, db.Model):
    """
    Admin-configurable declaration questions and document type definitions.
    config_type='question' for yes/no declaration questions.
    config_type='document' for required document upload types.
    """
    __tablename__ = 'declaration_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    config_type    = db.Column(db.String(20),  nullable=False)   # 'question' | 'document'
    label          = db.Column(db.String(500), nullable=False)
    description    = db.Column(db.Text,        nullable=True)
    is_required    = db.Column(db.Boolean, default=False, nullable=False)
    is_active      = db.Column(db.Boolean, default=True,  nullable=False)
    display_order  = db.Column(db.Integer, default=0,     nullable=False)
    # For questions: whether "explain" text field is shown on "Yes"
    has_explanation = db.Column(db.Boolean, default=True, nullable=False)
    # For questions: whether attachment is allowed on "Yes"
    has_attachment  = db.Column(db.Boolean, default=True, nullable=False)

    created_by = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id'), nullable=True)

    def to_response_dict(self):
        return {
            'id': str(self.id),
            'configType': self.config_type,
            'label': self.label,
            'description': self.description or '',
            'isRequired': self.is_required,
            'isActive': self.is_active,
            'displayOrder': self.display_order,
            'hasExplanation': self.has_explanation,
            'hasAttachment': self.has_attachment,
        }

    def __repr__(self):
        return f"<DeclarationConfig id={self.id} type={self.config_type}>"


# ---------------------------------------------------------------------------
# ProfileDeclarationResponse  (was DoctorDeclarationResponse + AdminDeclarationResponse)
# ---------------------------------------------------------------------------

class ProfileDeclarationResponse(TenantMixin, TimestampMixin, db.Model):
    """
    Declaration responses (yes/no answers) for both doctors and admins.
    Exactly one of doctor_id / admin_id must be non-NULL.
    """
    __tablename__ = 'profile_declaration_responses'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Dual nullable FK pattern
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    admin_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('admins.admin_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )

    profile_owner_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('profile_owner.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    profile_owner = db.relationship('ProfileOwner', back_populates='declaration_responses')

    config_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('declaration_configs.id', ondelete='CASCADE'),
        nullable=False,
    )

    answer          = db.Column(db.Boolean,     nullable=True)   # True=Yes, False=No
    explanation     = db.Column(db.Text,        nullable=True)
    attachment_url  = db.Column(db.String(500), nullable=True)
    attachment_s3_key    = db.Column(db.String(500), nullable=True)
    attachment_s3_bucket = db.Column(db.String(200), nullable=True)

    config = db.relationship('DeclarationConfig')

    __table_args__ = (
        CheckConstraint(
            '(doctor_id IS NOT NULL AND admin_id IS NULL) OR (doctor_id IS NULL AND admin_id IS NOT NULL)',
            name='ck_profile_declaration_responses_exactly_one_owner',
        ),
        UniqueConstraint('tenant_id', 'doctor_id', 'config_id',
                         name='uq_prof_decl_resp_tenant_doctor_config'),
        UniqueConstraint('tenant_id', 'admin_id',  'config_id',
                         name='uq_prof_decl_resp_tenant_admin_config'),
        Index('ix_profile_decl_resp_tenant_doctor', 'tenant_id', 'doctor_id'),
        Index('ix_profile_decl_resp_tenant_admin',  'tenant_id', 'admin_id'),
    )

    # ── backward-compat computed properties ───────────────────────────────────

    @property
    def entity_type(self):
        """Backward-compat: returns 'doctor' or 'admin'."""
        return 'doctor' if self.doctor_id else 'admin'

    @property
    def entity_id(self):
        """Backward-compat: returns the doctor_id or admin_id."""
        return self.doctor_id or self.admin_id

    # ── serialisation ─────────────────────────────────────────────────────────

    def to_response_dict(self):
        return {
            'id': str(self.id),
            'configId': str(self.config_id),
            'answer': self.answer,
            'explanation': self.explanation or '',
            'attachmentUrl': self.attachment_url,
        }

    def __repr__(self):
        return f"<ProfileDeclarationResponse entity_type={self.entity_type} entity_id={self.entity_id}>"


# ---------------------------------------------------------------------------
# ProfileDocument  (was DoctorDocument + AdminDocument)
# ---------------------------------------------------------------------------

class ProfileDocument(TenantMixin, TimestampMixin, db.Model):
    """
    Uploaded documents for admin-defined document types, for both doctors and admins.
    Exactly one of doctor_id / admin_id must be non-NULL.
    """
    __tablename__ = 'profile_documents'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Dual nullable FK pattern
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    admin_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('admins.admin_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )

    profile_owner_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('profile_owner.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    profile_owner = db.relationship('ProfileOwner', back_populates='documents')

    config_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('declaration_configs.id', ondelete='CASCADE'),
        nullable=False,
    )

    file_url         = db.Column(db.String(500), nullable=True)
    file_s3_key      = db.Column(db.String(500), nullable=True)
    file_s3_bucket   = db.Column(db.String(200), nullable=True)
    verification_status = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    config = db.relationship('DeclarationConfig')

    __table_args__ = (
        CheckConstraint(
            '(doctor_id IS NOT NULL AND admin_id IS NULL) OR (doctor_id IS NULL AND admin_id IS NOT NULL)',
            name='ck_profile_documents_exactly_one_owner',
        ),
        UniqueConstraint('tenant_id', 'doctor_id', 'config_id',
                         name='uq_prof_doc_tenant_doctor_config'),
        UniqueConstraint('tenant_id', 'admin_id',  'config_id',
                         name='uq_prof_doc_tenant_admin_config'),
        Index('ix_profile_document_tenant_doctor', 'tenant_id', 'doctor_id'),
        Index('ix_profile_document_tenant_admin',  'tenant_id', 'admin_id'),
    )

    # ── backward-compat computed properties ───────────────────────────────────

    @property
    def entity_type(self):
        """Backward-compat: returns 'doctor' or 'admin'."""
        return 'doctor' if self.doctor_id else 'admin'

    @property
    def entity_id(self):
        """Backward-compat: returns the doctor_id or admin_id."""
        return self.doctor_id or self.admin_id

    # ── serialisation ─────────────────────────────────────────────────────────

    def to_response_dict(self):
        return {
            'id': str(self.id),
            'configId': str(self.config_id),
            'fileUrl': self.file_url,
            'verificationStatus': self.verification_status.value
                if self.verification_status else 'pending',
        }

    def __repr__(self):
        return f"<ProfileDocument entity_type={self.entity_type} entity_id={self.entity_id}>"


# ---------------------------------------------------------------------------
# ProfileOwner  (central owner for all per-actor profile-detail tables)
# ---------------------------------------------------------------------------

class ProfileOwner(TenantMixin, TimestampMixin, db.Model):
    """Single canonical owner for every per-actor profile-detail table.

    Doctor / Admin / Clinic / Hospital / AuthorizedPersonnel each get exactly
    one ``profile_owner`` row (enforced by the exactly-one-owner CHECK below).
    The six profile sub-tables (signature / about / education / bank /
    declaration / document) reference this row via ``profile_owner_id`` instead
    of carrying their own per-owner FK columns — so ownership is resolved in
    ONE place and every sub-table uniformly supports every owner type.

    See docs/profile-owner-centralization.md for the full rollout.
    """
    __tablename__ = 'profile_owner'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Convenience discriminator (derivable from the FKs; handy for filtering).
    owner_type = db.Column(db.String(20), nullable=False)  # doctor|admin|clinic|hospital|authorized_personnel

    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    admin_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('admins.admin_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    clinic_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('clinics.id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    hospital_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('hospitals.hospital_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    authorized_personnel_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('authorized_personnel.id', ondelete='CASCADE'),
        nullable=True, index=True,
    )

    # ── owner-side relationships (each maps to its single FK) ─────────────────
    doctor               = db.relationship('Doctor',              back_populates='profile_owner')
    admin                = db.relationship('Admin',               back_populates='profile_owner')
    clinic               = db.relationship('Clinic',              back_populates='profile_owner')
    hospital             = db.relationship('Hospital',            back_populates='profile_owner')
    authorized_personnel = db.relationship('AuthorizedPersonnel')

    # ── the six profile sub-tables ────────────────────────────────────────────
    signatures            = db.relationship('ProfileSignature',           back_populates='profile_owner', cascade='all, delete-orphan')
    about                 = db.relationship('ProfileAbout',               back_populates='profile_owner', cascade='all, delete-orphan')
    education             = db.relationship('ProfileEducation',           back_populates='profile_owner', cascade='all, delete-orphan')
    bank_accounts         = db.relationship('ProfileBankAccount',         back_populates='profile_owner', cascade='all, delete-orphan')
    declaration_responses = db.relationship('ProfileDeclarationResponse', back_populates='profile_owner', cascade='all, delete-orphan')
    documents             = db.relationship('ProfileDocument',            back_populates='profile_owner', cascade='all, delete-orphan')
    extended                  = db.relationship('ProfileExtended',                back_populates='profile_owner', uselist=False, cascade='all, delete-orphan')
    education_specializations = db.relationship('ProfileEducationSpecialization', back_populates='profile_owner', cascade='all, delete-orphan')
    education_degrees         = db.relationship('ProfileEducationDegree',         back_populates='profile_owner', cascade='all, delete-orphan')

    __table_args__ = (
        CheckConstraint(
            '(CASE WHEN doctor_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN admin_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN clinic_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN hospital_id IS NOT NULL THEN 1 ELSE 0 END) + '
            '(CASE WHEN authorized_personnel_id IS NOT NULL THEN 1 ELSE 0 END) = 1',
            name='ck_profile_owner_exactly_one_owner',
        ),
        UniqueConstraint('tenant_id', 'doctor_id',   name='uq_profile_owner_tenant_doctor'),
        UniqueConstraint('tenant_id', 'admin_id',    name='uq_profile_owner_tenant_admin'),
        UniqueConstraint('tenant_id', 'clinic_id',   name='uq_profile_owner_tenant_clinic'),
        UniqueConstraint('tenant_id', 'hospital_id', name='uq_profile_owner_tenant_hospital'),
        UniqueConstraint('tenant_id', 'authorized_personnel_id', name='uq_profile_owner_tenant_personnel'),
    )

    @property
    def owner_id(self):
        """The single set actor FK, whichever owner this row represents."""
        return (self.doctor_id or self.admin_id or self.clinic_id
                or self.hospital_id or self.authorized_personnel_id)

    def __repr__(self):
        return f"<ProfileOwner {self.owner_type}:{self.owner_id}>"


# ---------------------------------------------------------------------------
# ProfileExtended  (shared identity/professional fields for every owner)
# ---------------------------------------------------------------------------

class ProfileExtended(TenantMixin, TimestampMixin, db.Model):
    """Shared per-owner profile fields common to doctor/admin (and, going
    forward, clinic/hospital) — the identity / professional / demographic fields
    today split between the ``doctors`` table inline columns and
    ``admin_profiles_extended``. One row per ``profile_owner``. Queryable fields
    are real columns; only genuinely free-form fields stay JSON.
    See docs/profile-consolidation-target-design.md.
    """
    __tablename__ = 'profile_extended'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_owner_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('profile_owner.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    # Identity documents (source columns are spelled ``aadhar_*``; canonical here).
    aadhaar_number      = db.Column(db.String(255), nullable=True)
    aadhaar_attachment  = db.Column(db.String(500), nullable=True)
    pan_number          = db.Column(db.String(50),  nullable=True)
    pan_attachment      = db.Column(db.String(500), nullable=True)

    # Professional
    registration_number = db.Column(db.String(100), nullable=True)
    experience_years    = db.Column(db.Integer,     nullable=True)
    consultation_fee    = db.Column(db.Numeric(10, 2), nullable=True)

    # Personal / demographic
    height       = db.Column(db.Numeric(5, 2), nullable=True)
    weight       = db.Column(db.Numeric(5, 2), nullable=True)
    category     = db.Column(db.String(100), nullable=True)
    religion     = db.Column(db.String(100), nullable=True)
    citizenship  = db.Column(db.String(100), nullable=True)
    alternative_phone = db.Column(db.String(20),  nullable=True)
    alternative_email = db.Column(db.String(254), nullable=True)

    # Free-form (kept JSON by decision — not filtered/joined).
    languages_known       = db.Column(JSON, nullable=True)
    slot_pricing          = db.Column(JSON, nullable=True)
    female_health_details = db.Column(JSON, nullable=True)
    # Absorbed from admin_profiles_extended / doctors so nothing is lost on prune.
    communication_address = db.Column(JSON, nullable=True)
    permanent_address     = db.Column(JSON, nullable=True)
    self_declaration_data = db.Column(JSON, nullable=True)

    profile_owner = db.relationship('ProfileOwner', back_populates='extended')

    __table_args__ = (
        UniqueConstraint('profile_owner_id', name='uq_profile_extended_profile_owner'),
    )

    def to_dict(self):
        # aadhaar_* columns surfaced as aadhar_* for existing frontend clients.
        return {
            'id': str(self.id),
            'aadhar_number': self.aadhaar_number,
            'aadhar_attachment': self.aadhaar_attachment,
            'pan_number': self.pan_number,
            'pan_attachment': self.pan_attachment,
            'registration_number': self.registration_number,
            'experience_years': self.experience_years,
            'consultation_fee': float(self.consultation_fee) if self.consultation_fee is not None else None,
            'height': float(self.height) if self.height is not None else None,
            'weight': float(self.weight) if self.weight is not None else None,
            'category': self.category,
            'religion': self.religion,
            'citizenship': self.citizenship,
            'alternative_phone': self.alternative_phone,
            'alternative_email': self.alternative_email,
            'languages_known': self.languages_known,
            'slot_pricing': self.slot_pricing,
            'female_health_details': self.female_health_details,
            'communication_address': self.communication_address,
            'permanent_address': self.permanent_address,
            'self_declaration_data': self.self_declaration_data,
        }

    def __repr__(self):
        return f"<ProfileExtended owner={self.profile_owner_id}>"


# ---------------------------------------------------------------------------
# ProfileEducationSpecialization  (queryable specialization — replaces the
# legacy doctor_qualification_specializations)
# ---------------------------------------------------------------------------

class ProfileEducationSpecialization(TenantMixin, TimestampMixin, db.Model):
    """Queryable doctor↔specialization link. Patient search / product-gating /
    service-groups JOIN this, so it stays a real table (JSON can't be joined).
    Replaces ``doctor_qualification_specializations``.
    See docs/profile-consolidation-target-design.md.
    """
    __tablename__ = 'profile_education_specialization'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_owner_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('profile_owner.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    category_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('categories.category_id'),
        nullable=False, index=True,
    )
    qualification_level = db.Column(db.String(20), nullable=True)  # ug | pg | super_speciality
    is_primary          = db.Column(db.Boolean, default=False, server_default=db.text('false'), nullable=False)

    profile_owner = db.relationship('ProfileOwner', back_populates='education_specializations')
    doctor        = db.relationship('Doctor', back_populates='specializations')
    category      = db.relationship('Category', back_populates='specializations')

    __table_args__ = (
        UniqueConstraint('tenant_id', 'profile_owner_id', 'category_id',
                         name='uq_prof_edu_spec_tenant_owner_category'),
        Index('ix_prof_edu_spec_tenant_category_primary', 'tenant_id', 'category_id', 'is_primary'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'category_name': self.category.name if self.category else None,
            'qualification_level': self.qualification_level,
            'is_primary': self.is_primary,
        }

    def __repr__(self):
        return f"<ProfileEducationSpecialization owner={self.profile_owner_id} cat={self.category_id}>"


# ---------------------------------------------------------------------------
# ProfileWorkQualification  (queryable doctor↔work-qualification link, MULTI)
# ---------------------------------------------------------------------------

class ProfileWorkQualification(TenantMixin, TimestampMixin, db.Model):
    """Queryable doctor↔work-qualification link. Parallels
    ``ProfileEducationSpecialization`` but points at
    ``Category.category_type == 'work_qualification'`` and a doctor may hold
    SEVERAL. The public booking widget groups / filters by these instead of
    education specializations. Kept a real table (not JSON) so the booking
    query can JOIN + GROUP BY the category. Supersedes the single
    ``ProfileAbout.work_qualification_id``.
    """
    __tablename__ = 'profile_work_qualification'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_owner_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('profile_owner.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    category_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('categories.category_id'),
        nullable=False, index=True,
    )
    is_primary = db.Column(
        db.Boolean, default=False, server_default=db.text('false'),
        nullable=False,
    )
    verification_status = db.Column(
        db.Enum(DocumentVerificationStatus),
        default=DocumentVerificationStatus.PENDING, nullable=False,
    )

    category = db.relationship('Category', foreign_keys=[category_id])
    doctor = db.relationship('Doctor', foreign_keys=[doctor_id])

    __table_args__ = (
        UniqueConstraint('tenant_id', 'profile_owner_id', 'category_id',
                         name='uq_prof_work_qual_owner_category'),
        Index('ix_prof_work_qual_tenant_category', 'tenant_id', 'category_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'category_id': str(self.category_id),
            'category_name': self.category.name if self.category else None,
            'is_primary': self.is_primary,
            'verification_status': (
                self.verification_status.value if self.verification_status else None
            ),
        }

    def __repr__(self):
        return f"<ProfileWorkQualification owner={self.profile_owner_id} cat={self.category_id}>"


# ---------------------------------------------------------------------------
# ProfileEducationDegree  (queryable degrees — lossless replacement for the
# legacy doctor_qualification_degrees; one row per degree)
# ---------------------------------------------------------------------------

class ProfileEducationDegree(TenantMixin, TimestampMixin, db.Model):
    """One row per doctor degree — lossless replacement for
    doctor_qualification_degrees (preserves degree_name, institution,
    passing_year, certificate_link, and any number of degrees). Adds the
    profile_owner hub FK + an optional resolved degree_category_id.
    """
    __tablename__ = 'profile_education_degree'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_owner_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('profile_owner.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    degree_name      = db.Column(db.String(200), nullable=True)
    institution      = db.Column(db.String(300), nullable=True)
    passing_year     = db.Column(db.Integer, nullable=True)
    certificate_link = db.Column(db.String(500), nullable=True)
    degree_category_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('categories.category_id', ondelete='SET NULL'),
        nullable=True,
    )

    profile_owner = db.relationship('ProfileOwner', back_populates='education_degrees')
    doctor        = db.relationship('Doctor', back_populates='qualifications')
    category      = db.relationship('Category', foreign_keys=[degree_category_id])

    __table_args__ = (
        Index('ix_prof_edu_degree_tenant_doctor', 'tenant_id', 'doctor_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'degree_name': self.degree_name,
            'institution': self.institution,
            'passing_year': self.passing_year,
        }

    def __repr__(self):
        return f"<ProfileEducationDegree {self.degree_name}>"
