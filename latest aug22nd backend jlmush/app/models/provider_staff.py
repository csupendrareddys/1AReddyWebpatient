"""
Provider staff and the roles they hold.

**What this is.** A doctor, clinic or hospital is one account with one login,
but it is rarely one *person*. A clinic has a front desk; a hospital has ward
administrators; a doctor has an assistant who manages the calendar. Those
people have no account today — the practice shares the owner's login — and so
there is no way to say "the front desk may reschedule but may not touch bank
details". ``ProviderStaff`` is the row that person finally gets, and it is the
thing roles are set on.

**Why these are NOT the admin RBAC tables.** ``rbac.py`` already models roles
and per-module grants, and this deliberately does not reuse them:

  * Different key space. ``RolePermission.module`` is ``Enum(PermissionModule)``
    — a fixed list of ~150 admin screens. Provider grants are keyed by a path
    through the provider's own module tree (``profile.profile_details.bank``),
    which is data, not schema. Forcing those into the enum would mean a
    migration every time a provider screen gains a tab.
  * Different scope. An admin ``Role`` is tenant-wide. A provider role means
    something only inside one vertical — "Front Desk" for a clinic is not the
    same grant surface as "Front Desk" for a hospital.
  * Different blast radius. Sharing one table would put provider-staff grants
    one bad ``role_id`` away from admin modules. Separate tables make that a
    type error rather than a bug.

**No login, on purpose.** Nothing here authenticates. ``user_id`` is a nullable
seat for the day it does, so the eventual auth work is a backfill rather than a
reshape — but today every staff row is a description of a person, not a
credential.

Tables:
    provider_staff              the person, anchored to exactly one provider
    provider_roles              a named role within one provider vertical
    provider_role_permissions   one row per (role, module path) grant
    provider_staff_roles        which staff hold which roles
"""
import uuid

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import (
    TenantMixin, AuditMixin, TimestampMixin, SoftDeleteMixin, utcnow,
)
from app.models._enums import DataRange, ProviderStaffStatus, StaffProviderType


# The action columns, in the order the matrix renders them. Defined once so the
# model, the serializer and the bulk writer can't drift apart — adding a verb
# means adding a column and this list, and nothing else changes.
GRANT_COLUMNS = (
    'full_access', 'can_view', 'can_create', 'can_edit', 'can_update',
    'can_delete', 'can_l1_verify', 'can_l2_verify', 'can_l3_verify',
    'can_lock', 'can_unlock',
)


# ============================================================================
# PROVIDER STAFF
# ============================================================================

class ProviderStaff(TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, db.Model):
    """A person who works for one doctor, clinic or hospital.

    The provider anchor is three nullable FKs rather than a
    ``(provider_type, provider_id)`` pair, even though the pair is what the
    API speaks. Real foreign keys buy two things a polymorphic pair cannot:
    deleting a clinic takes its staff with it instead of leaving rows pointing
    at nothing, and a typo'd id fails at write time rather than at read time.
    ``provider_type`` is stored alongside so queries and the API don't have to
    reverse-engineer which column is set, and a CHECK constraint keeps the two
    representations honest — exactly one FK, and it must be the one the
    discriminator names.
    """
    __tablename__ = 'provider_staff'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                   name='staff_id')

    provider_type = db.Column(db.Enum(StaffProviderType), nullable=False, index=True)
    doctor_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, index=True)
    clinic_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('clinics.id', ondelete='CASCADE'),
        nullable=True, index=True)
    hospital_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('hospitals.hospital_id', ondelete='CASCADE'),
        nullable=True, index=True)

    # Identity. Not a User — see the module docstring.
    first_name = db.Column(db.String(120), nullable=False)
    last_name = db.Column(db.String(120), nullable=True)
    email = db.Column(db.String(255), nullable=True, index=True)
    phone_number = db.Column(db.String(20), nullable=True, index=True)
    designation = db.Column(db.String(150), nullable=True)
    employee_code = db.Column(db.String(60), nullable=True)
    notes = db.Column(db.Text, nullable=True)

    status = db.Column(db.Enum(ProviderStaffStatus),
                       default=ProviderStaffStatus.ACTIVE, nullable=False, index=True)

    # The login seat. Null today for every row — nothing signs in as staff yet.
    # Kept here so wiring auth later is a backfill, not a table reshape.
    user_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True, unique=True, index=True)

    user = db.relationship('User', foreign_keys=[user_id])
    role_assignments = db.relationship(
        'ProviderStaffRole', back_populates='staff',
        cascade='all, delete-orphan', lazy='selectin',
    )

    __table_args__ = (
        # Exactly one anchor, and it agrees with the discriminator. Without the
        # second half, a row could claim provider_type=CLINIC while pointing at
        # a doctor — which reads fine and grants the wrong person's staff.
        db.CheckConstraint(
            'num_nonnulls(doctor_id, clinic_id, hospital_id) = 1',
            name='ck_provider_staff_one_anchor',
        ),
        db.CheckConstraint(
            "(provider_type = 'DOCTOR' AND doctor_id IS NOT NULL) OR "
            "(provider_type = 'CLINIC' AND clinic_id IS NOT NULL) OR "
            "(provider_type = 'HOSPITAL' AND hospital_id IS NOT NULL)",
            name='ck_provider_staff_anchor_matches_type',
        ),
        Index('ix_provider_staff_active', 'tenant_id', 'provider_type', 'status',
              postgresql_where=text('is_deleted = FALSE')),
    )

    # ── provider anchor helpers ──────────────────────────────────────────
    _ANCHOR_ATTR = {
        StaffProviderType.DOCTOR: 'doctor_id',
        StaffProviderType.CLINIC: 'clinic_id',
        StaffProviderType.HOSPITAL: 'hospital_id',
    }

    @property
    def provider_id(self):
        """The id of whichever provider this staff member belongs to."""
        return getattr(self, self._ANCHOR_ATTR[self.provider_type], None)

    def set_provider(self, provider_type, provider_id):
        """Point at one provider, clearing the other two anchors.

        Assigning the FK directly would leave a stale sibling set and trip the
        one-anchor CHECK, so re-anchoring always goes through here.
        """
        self.provider_type = provider_type
        for attr in self._ANCHOR_ATTR.values():
            setattr(self, attr, None)
        setattr(self, self._ANCHOR_ATTR[provider_type], provider_id)

    @property
    def full_name(self):
        return ' '.join(p for p in (self.first_name, self.last_name) if p).strip()

    def to_dict(self, include_roles=True):
        data = {
            'id': str(self.id),
            'provider_type': self.provider_type.value,
            'provider_id': str(self.provider_id) if self.provider_id else None,
            'first_name': self.first_name,
            'last_name': self.last_name,
            'full_name': self.full_name,
            'email': self.email,
            'phone_number': self.phone_number,
            'designation': self.designation,
            'employee_code': self.employee_code,
            'notes': self.notes,
            'status': self.status.value,
            # Always false today. Surfaced so the UI can say "no login yet"
            # from data rather than from a hardcoded assumption that will
            # quietly become wrong the day auth lands.
            'can_login': self.user_id is not None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
        if include_roles:
            active = [a for a in self.role_assignments if a.is_active]
            data['roles'] = [
                {'id': str(a.role_id), 'name': a.role.name}
                for a in active if a.role and not a.role.is_deleted
            ]
        # Branch clinics this (clinic) staff member may act on. Empty for
        # doctor / hospital staff, who have no branches.
        data['branch_ids'] = [str(bs.clinic_id) for bs in self.branch_scopes]
        return data


# ============================================================================
# PROVIDER ROLE
# ============================================================================

class ProviderRole(TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin, db.Model):
    """A named role within one provider vertical, e.g. clinic "Front Desk".

    **Two tiers, and the difference is who may edit it.**

    A role with no owner is TENANT-WIDE: curated by the admin, offered to every
    practice in that vertical. Every clinic in a tenant means the same thing by
    "Front Desk", and defining it once is the difference between an admin
    curating three roles and curating three per clinic.

    A role with an owner belongs to ONE practice. Providers can author their
    own, and this is what keeps that from being destructive: without an owner
    column, a clinic renaming "Front Desk" or narrowing its grants would have
    silently re-scoped every other clinic's receptionist in the tenant. The
    owning practice is the only one that can see or change it.

    The owner anchor mirrors ``ProviderStaff``: three nullable FKs plus the
    ``provider_type`` discriminator that is already on the row, with a CHECK
    that at most one is set and that it matches the type.

    ``is_system`` marks the roles seeded for a vertical. They can be edited by
    an admin but not deleted, so a tenant can't end up with a vertical that has
    no roles at all.
    """
    __tablename__ = 'provider_roles'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                   name='provider_role_id')

    provider_type = db.Column(db.Enum(StaffProviderType), nullable=False, index=True)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)

    # Null on all three = a tenant-wide role. See the class docstring.
    owner_doctor_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, index=True)
    owner_clinic_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('clinics.id', ondelete='CASCADE'),
        nullable=True, index=True)
    owner_hospital_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('hospitals.hospital_id', ondelete='CASCADE'),
        nullable=True, index=True)

    is_system = db.Column(db.Boolean, default=False, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)

    permissions = db.relationship(
        'ProviderRolePermission', back_populates='role',
        cascade='all, delete-orphan', lazy='selectin',
    )
    staff_assignments = db.relationship(
        'ProviderStaffRole', back_populates='role',
        cascade='all, delete-orphan', lazy='dynamic',
    )

    _OWNER_ATTR = {
        StaffProviderType.DOCTOR: 'owner_doctor_id',
        StaffProviderType.CLINIC: 'owner_clinic_id',
        StaffProviderType.HOSPITAL: 'owner_hospital_id',
    }

    @property
    def owner_id(self):
        """The practice that owns this role, or None if it's tenant-wide."""
        return getattr(self, self._OWNER_ATTR[self.provider_type], None)

    def set_owner(self, provider_id):
        """Anchor to one practice, clearing the other two owner columns.

        ``None`` makes it tenant-wide. Always goes through here so a re-anchor
        can't leave a stale sibling and trip the at-most-one CHECK.
        """
        for attr in self._OWNER_ATTR.values():
            setattr(self, attr, None)
        if provider_id is not None:
            setattr(self, self._OWNER_ATTR[self.provider_type], provider_id)

    __table_args__ = (
        # Unique per vertical AND per owner: a clinic "Front Desk" and a
        # hospital "Front Desk" are different roles over different modules,
        # and one clinic's own "Front Desk" mustn't collide with the
        # tenant-wide one or with another clinic's. NULLS NOT DISTINCT makes
        # the tenant-wide row (all owners null) collide with itself as
        # intended — without it Postgres treats every NULL as unique and the
        # constraint would never fire for shared roles.
        db.Index('uq_provider_role_name', 'tenant_id', 'provider_type', 'name',
                 'owner_doctor_id', 'owner_clinic_id', 'owner_hospital_id',
                 unique=True, postgresql_nulls_not_distinct=True,
                 postgresql_where=text('is_deleted = FALSE')),
        db.CheckConstraint(
            'num_nonnulls(owner_doctor_id, owner_clinic_id, owner_hospital_id) <= 1',
            name='ck_provider_role_one_owner'),
        # An owned role's owner column has to be the one provider_type names,
        # or a clinic could own a role that reads as a doctor role.
        db.CheckConstraint(
            "num_nonnulls(owner_doctor_id, owner_clinic_id, owner_hospital_id) = 0 OR "
            "(provider_type = 'DOCTOR' AND owner_doctor_id IS NOT NULL) OR "
            "(provider_type = 'CLINIC' AND owner_clinic_id IS NOT NULL) OR "
            "(provider_type = 'HOSPITAL' AND owner_hospital_id IS NOT NULL)",
            name='ck_provider_role_owner_matches_type'),
    )

    def to_dict(self, include_counts=False):
        owner = self.owner_id
        data = {
            'id': str(self.id),
            'provider_type': self.provider_type.value,
            'name': self.name,
            'description': self.description,
            'is_system': self.is_system,
            'is_active': self.is_active,
            'owner_id': str(owner) if owner else None,
            # What the UI keys "can I edit this?" off. A provider sees both
            # tiers and may only change its own.
            'is_shared': owner is None,
        }
        if include_counts:
            data['granted_module_count'] = len(self.permissions)
            data['staff_count'] = self.staff_assignments.filter_by(is_active=True).count()
        return data


# ============================================================================
# PROVIDER ROLE PERMISSION
# ============================================================================

class ProviderRolePermission(TenantMixin, TimestampMixin, db.Model):
    """One role's grant over one node of the provider module tree.

    ``module_key`` is the dotted path from the catalog
    (``profile.profile_details.bank_details``) — a string, because the tree is
    configuration that changes with the product, not schema. It is validated
    against the catalog on write (see the service), so "string column" does not
    mean "anything goes"; it means the check lives where the catalog lives.

    Only LEAF nodes are ever stored. A branch's state is derived from its
    children, exactly as the UI derives it — persisting roll-ups as well would
    create two answers to "can they edit bank details?" and no rule for which
    one wins.

    A row's absence is the absence of a grant. An all-false row is never
    written, so the table stays proportional to what was actually granted.
    """
    __tablename__ = 'provider_role_permissions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
                   name='provider_permission_id')
    role_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('provider_roles.provider_role_id', ondelete='CASCADE'),
        nullable=False, index=True)

    module_key = db.Column(db.String(200), nullable=False, index=True)

    full_access = db.Column(db.Boolean, default=False, nullable=False)
    can_view = db.Column(db.Boolean, default=False, nullable=False)
    can_create = db.Column(db.Boolean, default=False, nullable=False)
    can_edit = db.Column(db.Boolean, default=False, nullable=False)
    can_update = db.Column(db.Boolean, default=False, nullable=False)
    can_delete = db.Column(db.Boolean, default=False, nullable=False)
    can_l1_verify = db.Column(db.Boolean, default=False, nullable=False)
    can_l2_verify = db.Column(db.Boolean, default=False, nullable=False)
    can_l3_verify = db.Column(db.Boolean, default=False, nullable=False)
    can_lock = db.Column(db.Boolean, default=False, nullable=False)
    can_unlock = db.Column(db.Boolean, default=False, nullable=False)

    data_range = db.Column(db.Enum(DataRange), default=DataRange.ALL, nullable=False)

    role = db.relationship('ProviderRole', back_populates='permissions')

    __table_args__ = (
        db.UniqueConstraint('role_id', 'module_key', name='uq_provider_role_module'),
    )

    def to_dict(self):
        data = {'module': self.module_key, 'data_range': self.data_range.name}
        for column in GRANT_COLUMNS:
            data[column] = getattr(self, column)
        return data


# ============================================================================
# STAFF ↔ ROLE
# ============================================================================

class ProviderStaffRole(TenantMixin, db.Model):
    """Which roles a staff member holds.

    Many-to-many, mirroring ``SubAdminRole``: a clinic's office manager is
    plausibly both "Front Desk" and "Billing", and the alternative — one role
    per person — forces an admin to invent a combined role for every pairing.
    Effective access is the union of the held roles.

    Unassigning deactivates rather than deletes, so "who could see this last
    month" survives the answer changing.
    """
    __tablename__ = 'provider_staff_roles'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    staff_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('provider_staff.staff_id', ondelete='CASCADE'),
        nullable=False, index=True)
    role_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('provider_roles.provider_role_id', ondelete='CASCADE'),
        nullable=False, index=True)

    assigned_by_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True)
    assigned_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False, index=True)
    deactivated_at = db.Column(db.DateTime(timezone=True), nullable=True)

    staff = db.relationship('ProviderStaff', back_populates='role_assignments')
    role = db.relationship('ProviderRole', back_populates='staff_assignments')

    __table_args__ = (
        db.UniqueConstraint('staff_id', 'role_id', name='uq_provider_staff_role'),
    )


# ============================================================================
# STAFF ↔ BRANCH  (granular per-branch access for a clinic's support staff)
# ============================================================================

class ProviderStaffBranchScope(TenantMixin, db.Model):
    """Which BRANCH clinics a support-staff member may act on.

    Orthogonal to the staff member's single provider anchor: a clinic's staff
    row anchors to the MAIN clinic (the one-anchor CHECK forbids one row
    spanning clinics), and THIS table lists which of that clinic's branches the
    person may switch into. Their module grants (via ``ProviderStaffRole``)
    still decide WHAT they may do; this decides WHERE — "granular per branch,
    not all at once", one row per branch granted. Owner-assigned only.
    """
    __tablename__ = 'provider_staff_branch_scopes'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    staff_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('provider_staff.staff_id', ondelete='CASCADE'),
        nullable=False, index=True)
    # The BRANCH clinic this staff member may act on (a ``clinics`` row whose
    # ``parent_clinic_id`` is the staff member's own clinic).
    clinic_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('clinics.id', ondelete='CASCADE'),
        nullable=False, index=True)

    granted_by_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True)
    granted_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    staff = db.relationship(
        'ProviderStaff',
        backref=db.backref('branch_scopes', cascade='all, delete-orphan', lazy='selectin'),
    )

    __table_args__ = (
        db.UniqueConstraint('staff_id', 'clinic_id', name='uq_provider_staff_branch'),
    )
