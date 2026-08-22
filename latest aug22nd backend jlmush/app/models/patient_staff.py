"""Patient support staff — a caregiver who acts on a patient's behalf.

A dependent patient (e.g. a paralyzed patient) needs someone to manage their
care: book appointments, read records, run the service chats. That caregiver
gets their OWN login — for **accountability**: every action is attributable to
the caregiver, never silently done "as the patient" — and a role that bounds
what they may do.

This mirrors ``ProviderStaff`` (``app/models/provider_staff.py``) on the patient
side, but leaner:

  * A patient is a single entity — no doctor/clinic/hospital discriminator, so
    the anchor is one plain ``patient_id`` FK with none of the three-FK / CHECK
    machinery the provider row needs.
  * The roles + permission matrix are the EXISTING ``PatientRole`` /
    ``PatientRolePermission`` (Family Phase 2). A support-staff caregiver and a
    linked adult are gated by the same grant shape, so only the SEAT — a
    login-capable person employed by one patient — is new here.

Tables:
    patient_staff        the caregiver, anchored to one patient, with a login seat
    patient_staff_roles  which PatientRoles the caregiver holds (union = effective)
"""
import uuid

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import (
    TenantMixin, AuditMixin, TimestampMixin, SoftDeleteMixin, utcnow,
)
from app.models._enums import PatientStaffStatus


class PatientStaff(TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, db.Model):
    """A caregiver employed by one patient, with their own login.

    Unlike ``ProviderStaff`` (which was seatless), a patient support-staff row is
    created together with its login — the patient provisions the caregiver's
    account directly (name + email + password). ``user_id`` is the seat and is
    unique: one login belongs to exactly one caregiver row (one account per
    patient, per the product decision).
    """
    __tablename__ = 'patient_staff'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                   name='patient_staff_id')

    # The patient this caregiver works for. CASCADE: deleting the patient takes
    # their staff seats with them rather than leaving rows pointing at nothing.
    patient_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patients.patient_id', ondelete='CASCADE'),
        nullable=False, index=True)

    # Display identity, kept in step with the login's name by the credential
    # helper. This is what the patient labels the caregiver as.
    first_name = db.Column(db.String(120), nullable=False)
    last_name = db.Column(db.String(120), nullable=True)
    email = db.Column(db.String(255), nullable=True, index=True)
    phone_number = db.Column(db.String(20), nullable=True, index=True)
    relation = db.Column(db.String(120), nullable=True)  # "Nurse", "Aide", "Son"
    notes = db.Column(db.Text, nullable=True)

    status = db.Column(db.Enum(PatientStaffStatus),
                       default=PatientStaffStatus.ACTIVE, nullable=False, index=True)

    # Whether this caregiver may PAY for bookings they create on the patient's
    # behalf, from their OWN payment method (the patient's card is never
    # charged). Off by default — money stays with the patient unless they
    # explicitly grant it. Deliberately a per-seat flag rather than a role/module
    # grant: payment is special-cased everywhere (off the act-on-behalf proxy),
    # so it's kept out of the shared role catalog a linked adult could inherit.
    can_pay_on_behalf = db.Column(db.Boolean, default=False, nullable=False,
                                  server_default='false')

    # The login seat. Always set in practice (a caregiver is provisioned WITH a
    # login), but nullable + SET NULL so a deleted user doesn't take the staff
    # row / audit trail with it. Unique — one login, one caregiver.
    user_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True, unique=True, index=True)

    user = db.relationship('User', foreign_keys=[user_id])
    role_assignments = db.relationship(
        'PatientStaffRole', back_populates='staff',
        cascade='all, delete-orphan', lazy='selectin',
    )

    __table_args__ = (
        db.Index('ix_patient_staff_active', 'tenant_id', 'patient_id', 'status',
                 postgresql_where=text('is_deleted = FALSE')),
    )

    @property
    def full_name(self):
        return ' '.join(p for p in (self.first_name, self.last_name) if p).strip()

    def to_dict(self, include_roles=True):
        data = {
            'id': str(self.id),
            'patient_id': str(self.patient_id),
            'first_name': self.first_name,
            'last_name': self.last_name,
            'full_name': self.full_name,
            'email': self.email,
            'phone_number': self.phone_number,
            'relation': self.relation,
            'notes': self.notes,
            'status': self.status.value,
            'can_login': self.user_id is not None,
            'can_pay_on_behalf': bool(self.can_pay_on_behalf),
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
        if include_roles:
            active = [a for a in self.role_assignments if a.is_active]
            data['roles'] = [
                {'id': str(a.role_id), 'name': a.role.name}
                for a in active if a.role and not a.role.is_deleted
            ]
        # Minor sub-profiles this caregiver was granted (whole = null role).
        data['minor_grants'] = [
            {
                'member_id': str(s.house_group_member_id),
                'name': (' '.join(p for p in (
                    s.member.first_name, s.member.last_name) if p).strip()
                    if s.member else None),
                'role_id': str(s.role_id) if s.role_id else None,
                'role_name': s.role.name if s.role else None,
            }
            for s in getattr(self, 'minor_scopes', [])
        ]
        return data


class PatientStaffRole(TenantMixin, db.Model):
    """Which ``PatientRole``s a caregiver holds. Effective grants are the union.

    Deactivate-not-delete (mirrors ``ProviderStaffRole``) so "who could act last
    month" survives a role being removed. Unique ``(staff_id, role_id)`` so
    re-assigning reactivates rather than inserting a duplicate.
    """
    __tablename__ = 'patient_staff_roles'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    staff_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patient_staff.patient_staff_id', ondelete='CASCADE'),
        nullable=False, index=True)
    role_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patient_roles.patient_role_id', ondelete='CASCADE'),
        nullable=False, index=True)

    assigned_by_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True)
    assigned_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)
    deactivated_at = db.Column(db.DateTime(timezone=True), nullable=True)

    staff = db.relationship('PatientStaff', back_populates='role_assignments')
    role = db.relationship('PatientRole')

    __table_args__ = (
        db.UniqueConstraint('staff_id', 'role_id', name='uq_patient_staff_role'),
    )


class PatientStaffMinorScope(TenantMixin, db.Model):
    """Which of the employer patient's MINOR sub-profiles a caregiver may act on.

    Orthogonal to the caregiver's single patient anchor: the ``patient_staff`` row
    anchors to the MAIN patient, and THIS table lists which of that patient's
    login-less minor sub-profiles (``house_group_members`` with
    ``is_child_account = True``) the caregiver may switch into — "granular per
    minor, not all at once", one row per minor granted. Owner-assigned only.
    Mirrors ``ProviderStaffBranchScope`` on the provider side.

    ``role_id`` decides WHAT on that minor, mirroring ``HouseGroupMember.role_id``:
      * NULL  → the WHOLE minor account (the standard patient surface — but capped
                below the parent: no authorship / contact-OTP AS the minor);
      * set   → only the modules that ``PatientRole`` grants (granular).
    """
    __tablename__ = 'patient_staff_minor_scopes'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    staff_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patient_staff.patient_staff_id', ondelete='CASCADE'),
        nullable=False, index=True)
    # The MINOR sub-profile this caregiver may act on (a ``house_group_members``
    # row with ``is_child_account = True`` belonging to the caregiver's patient).
    house_group_member_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('house_group_members.member_id', ondelete='CASCADE'),
        nullable=False, index=True)
    # NULL → whole minor account; set → bounded by this PatientRole's modules.
    role_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patient_roles.patient_role_id', ondelete='SET NULL'),
        nullable=True, index=True)

    granted_by_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True)
    granted_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    staff = db.relationship(
        'PatientStaff',
        backref=db.backref('minor_scopes', cascade='all, delete-orphan', lazy='selectin'),
    )
    member = db.relationship('HouseGroupMember', foreign_keys=[house_group_member_id])
    role = db.relationship('PatientRole')

    __table_args__ = (
        db.UniqueConstraint('staff_id', 'house_group_member_id', name='uq_patient_staff_minor'),
    )
