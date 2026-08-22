"""Clinic marketplace entity (Round 3+4).

A ``Clinic`` is a marketplace participant on ``larazen.in`` — registered
via the apex pricing-card flow alongside doctors and hospitals. Patient
discovery (Round 6+) browses clinics in the same surface as doctors and
hospitals.

Schema-wise this is a smaller cousin of ``Hospital``: clinics don't carry
``hospital_type`` / facilities / images. They DO carry the same address
shape and the same ``verification_status`` lifecycle, so the existing
admin verification UX generalises with minimal duplication.

The owning User is bound via ``admin_user_id`` so:
  * ``MembershipSubscription.provider_id`` resolves to a real row.
  * ``current_user.id`` on a clinic-admin session can look up "my clinic"
    in O(1) via the FK.
"""
import uuid

from sqlalchemy import Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import (
    AuditMixin, SoftDeleteMixin, TenantMixin, TimestampMixin,
)
from app.models._enums import UserVerificationStatus


class Clinic(
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, db.Model,
):
    """Marketplace clinic — apex larazen.in participant."""
    __tablename__ = 'clinics'

    id = db.Column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )

    # Owner / payer — the User who registered this clinic on the apex.
    # NOT NULL on new rows (set at signup), but the column is nullable
    # at the schema level so any rogue ``db.create_all()`` bootstrap on
    # a partial DB doesn't trip.
    admin_user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )

    # A BRANCH points at its MAIN (parent) clinic; a main clinic leaves this
    # NULL. A branch is a full, login-less clinic (managed admin User, see
    # app/common/managed_clinic.py) that the parent manages and "switches into"
    # — the provider-side analogue of a minor sub-profile. Self-FK; CASCADE so
    # deleting the parent takes its branches with it.
    parent_clinic_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('clinics.id', ondelete='CASCADE', name='fk_clinics_parent_clinic_id'),
        nullable=True, index=True,
    )

    name = db.Column(db.String(300), nullable=False)
    registration_number = db.Column(db.String(100), nullable=True, index=True)

    # Contact
    phone = db.Column(db.String(15), nullable=True)
    email = db.Column(db.String(254), nullable=True)
    website = db.Column(db.String(500), nullable=True)

    # Address — mirror Hospital so patient-discovery filters generalise.
    address = db.Column(db.Text, nullable=False)
    city = db.Column(db.String(100), nullable=False, index=True)
    state = db.Column(db.String(100), nullable=False)
    pincode = db.Column(db.String(10), nullable=False, index=True)
    latitude = db.Column(db.Numeric(10, 8), nullable=True)
    longitude = db.Column(db.Numeric(11, 8), nullable=True)

    # S3 keys captured during signup.
    registration_certificate = db.Column(db.Text, nullable=True)
    admin_aadhaar_attachment = db.Column(db.Text, nullable=True)

    # Lifecycle / status
    is_active = db.Column(
        db.Boolean, default=True, nullable=False, index=True,
    )
    verification_status = db.Column(
        db.Enum(UserVerificationStatus),
        default=UserVerificationStatus.PENDING, nullable=False,
    )

    # The owning User, spelled the way Doctor and Patient spell it. A clinic
    # links through ``admin_user_id`` rather than ``user_id``, which is why
    # this needs the explicit ``foreign_keys``; without the relationship any
    # code that treats members uniformly — chiefly the Operations
    # act-on-behalf proxy, which does ``target.user`` — can't reach it.
    # Read-only from this side: the FK stays the column's business.
    user = db.relationship('User', foreign_keys=[admin_user_id], viewonly=True)

    # Self-referential branches: a main clinic's ``branches`` are its login-less
    # locations; a branch's ``parent_clinic`` is its main clinic. Only one FK
    # points back at ``clinics`` (parent_clinic_id), so the adjacency-list join
    # is unambiguous.
    parent_clinic = db.relationship(
        'Clinic', remote_side=[id], backref='branches',
    )

    # Centralized profile-detail owner (see docs/profile-owner-centralization.md).
    profile_owner = db.relationship('ProfileOwner', back_populates='clinic', uselist=False)

    __table_args__ = (
        UniqueConstraint(
            'tenant_id', 'registration_number',
            name='uq_clinic_tenant_registration_number',
        ),
        Index('ix_clinic_tenant_city', 'tenant_id', 'city'),
        Index(
            'ix_clinics_active', 'tenant_id', 'is_active',
            postgresql_where=text('is_deleted = FALSE'),
        ),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'city': self.city,
            'is_active': self.is_active,
            'verification_status': self.verification_status.value,
            'parent_clinic_id': str(self.parent_clinic_id) if self.parent_clinic_id else None,
            'is_branch': self.parent_clinic_id is not None,
        }

    def __repr__(self):
        return f"<Clinic {self.name}>"
