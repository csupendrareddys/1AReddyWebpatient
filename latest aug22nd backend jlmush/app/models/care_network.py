"""
Care Network models: a doctor's professional network of fellow doctors,
hospitals, and clinics.

Mirrors the patient House-Group linking pattern (``app/models/house_group.py``)
— link by invite code or phone+name with a request→accept flow — but for a
doctor's professional "care network". Doctor↔doctor connections require the
peer to accept; facility (hospital/clinic) connections are added directly by
the doctor (no facility-side accept UI exists yet).

The doctor↔doctor connections are what gate the group-service-offering
co-doctor picker: a doctor may only add co-doctors that are accepted
connections in their network.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, utcnow
from app.models._enums import HouseGroupRequestStatus


# Valid ``connection_type`` values (maps 1:1 to the three My Network tabs).
CONNECTION_TYPES = ('doctor', 'hospital', 'clinic')


class CareNetworkConnection(TenantMixin, db.Model):
    """An accepted connection from a doctor to another doctor / hospital / clinic."""
    __tablename__ = 'care_network_connections'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='connection_id')
    doctor_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    connection_type = db.Column(db.String(20), nullable=False, index=True)  # doctor|hospital|clinic

    # Which surface the connection belongs to:
    #   'network' — My Network (care/referral), classified by referral_type A/B/C
    #   'link'    — My Link (professional affiliation), by relationship_type
    context = db.Column(db.String(20), default='network', nullable=False, index=True)
    referral_type = db.Column(db.String(10), nullable=True)       # A | B | C  (network)
    relationship_type = db.Column(db.String(20), nullable=True)   # partner | associate | employee (link)

    target_doctor_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=True, index=True,
    )
    target_hospital_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('hospitals.hospital_id', ondelete='CASCADE'),
        nullable=True,
    )
    target_clinic_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('clinics.id', ondelete='CASCADE'),
        nullable=True,
    )

    status = db.Column(db.String(20), default='active', nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    doctor = db.relationship('Doctor', foreign_keys=[doctor_id])
    target_doctor = db.relationship('Doctor', foreign_keys=[target_doctor_id])
    target_hospital = db.relationship('Hospital', foreign_keys=[target_hospital_id])
    target_clinic = db.relationship('Clinic', foreign_keys=[target_clinic_id])

    __table_args__ = (
        # A doctor connects to a given target at most once per type per surface
        # (context) — so the same clinic can be both a My Network and My Link
        # connection.
        db.UniqueConstraint(
            'tenant_id', 'doctor_id', 'connection_type', 'context',
            'target_doctor_id', 'target_hospital_id', 'target_clinic_id',
            name='uq_care_network_connection',
        ),
    )

    def to_dict(self):
        name = specialization = contact = None
        target_id = None
        if self.connection_type == 'doctor' and self.target_doctor:
            td = self.target_doctor
            target_id = str(td.id)
            name = td.full_name
            contact = td.user.phone_number if td.user else None
        elif self.connection_type == 'hospital' and self.target_hospital:
            target_id = str(self.target_hospital.id)
            name = self.target_hospital.name
            contact = self.target_hospital.phone
        elif self.connection_type == 'clinic' and self.target_clinic:
            target_id = str(self.target_clinic.id)
            name = self.target_clinic.name
            contact = self.target_clinic.phone
        return {
            'id': str(self.id),
            'connection_type': self.connection_type,
            'target_id': target_id,
            'name': name,
            'specialization': specialization,
            'contact': contact,
            'status': self.status,
            'context': self.context,
            'referral_type': self.referral_type,
            'relationship_type': self.relationship_type,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f'<CareNetworkConnection doctor={self.doctor_id} {self.connection_type} {self.context}>'


class LinkRelationshipPolicy(TenantMixin, db.Model):
    """What one My Link ``relationship_type`` opens, per section of the doctor's
    practice — an administrator's override of the shipped ladder.

    The ladder itself lives in ``app/api/provider_link/authority.py`` and is
    what every tenant gets until somebody changes it. A row here is an
    exception to that, not a replacement: only the (relationship, section)
    pairs actually edited are stored, so an untouched tenant behaves exactly as
    the code says and a new section added in code appears everywhere without a
    data migration.

    **Sections, never paths.** ``access`` picks from the section's own path
    list; it cannot name an endpoint. That is the whole safety property — the
    exclusions that must hold regardless of configuration (a doctor's bank
    accounts, their payouts, joining a live call) are on no section's list, so
    no combination of settings here can reach them.
    """
    __tablename__ = 'link_relationship_policies'

    #: Access levels, weakest first. ``view`` intersects the section's methods
    #: with the safe verbs rather than naming a second GET-only path list — a
    #: hand-written copy is where a stray PUT survives a rename.
    ACCESS_NONE = 'none'
    ACCESS_VIEW = 'view'
    ACCESS_FULL = 'full'
    ACCESS_LEVELS = (ACCESS_NONE, ACCESS_VIEW, ACCESS_FULL)

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 'partner' | 'associate' | 'employee', lower-cased. Stored as text rather
    # than an enum because relationship_type on the connection is free text
    # too, and one of them being stricter than the other only invites drift.
    relationship = db.Column(db.String(20), nullable=False, index=True)
    # A key of ``authority.SECTION_PATHS``.
    section = db.Column(db.String(32), nullable=False)
    access = db.Column(db.String(10), nullable=False, default=ACCESS_NONE)

    updated_by_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    updated_by = db.relationship('User', foreign_keys=[updated_by_id])

    __table_args__ = (
        db.UniqueConstraint(
            'tenant_id', 'relationship', 'section',
            name='uq_link_relationship_policy',
        ),
    )

    def to_dict(self):
        return {
            'relationship': self.relationship,
            'section': self.section,
            'access': self.access,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return (f'<LinkRelationshipPolicy {self.relationship}.{self.section}'
                f'={self.access}>')


class CareNetworkRequest(TenantMixin, db.Model):
    """Pending request / invite to add a peer doctor to the care network.

    Mirrors ``HouseGroupRequest``. Resolved either by phone+name (the target
    doctor accepts) or by invite code (the joiner connects immediately).
    """
    __tablename__ = 'care_network_requests'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requester_doctor_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    connection_type = db.Column(db.String(20), nullable=False, default='doctor')

    # Surface + classification carried onto the connection when accepted.
    context = db.Column(db.String(20), default='network', nullable=False)
    referral_type = db.Column(db.String(10), nullable=True)       # A | B | C
    relationship_type = db.Column(db.String(20), nullable=True)   # partner | associate | employee

    target_user_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )
    target_phone = db.Column(db.String(20), nullable=True)
    target_name = db.Column(db.String(200), nullable=True)
    target_last_name = db.Column(db.String(100), nullable=True)
    # Facility requests (hospital/clinic) carry the target facility so accept
    # can build the doctor→facility connection. target_user_id points at the
    # facility's owner account (admin_user_id) — they accept.
    target_hospital_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('hospitals.hospital_id', ondelete='CASCADE'),
        nullable=True,
    )
    target_clinic_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('clinics.id', ondelete='CASCADE'),
        nullable=True,
    )
    invite_code = db.Column(db.String(20), nullable=True, index=True)

    status = db.Column(
        db.Enum(HouseGroupRequestStatus), default=HouseGroupRequestStatus.PENDING,
        nullable=False, index=True,
    )
    permissions = db.Column(JSON, nullable=True)  # reserved; unused for MVP
    created_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now())
    updated_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), onupdate=db.func.now())
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True)

    requester = db.relationship('Doctor', foreign_keys=[requester_doctor_id])
    target_user = db.relationship('User', foreign_keys=[target_user_id])
    target_hospital = db.relationship('Hospital', foreign_keys=[target_hospital_id])
    target_clinic = db.relationship('Clinic', foreign_keys=[target_clinic_id])

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'invite_code', name='uq_care_network_request_invite_code'),
    )

    @property
    def target_facility_name(self):
        if self.target_hospital:
            return self.target_hospital.name
        if self.target_clinic:
            return self.target_clinic.name
        return None

    def to_dict(self):
        return {
            'id': str(self.id),
            'requester_doctor_id': str(self.requester_doctor_id),
            'requester_name': self.requester.full_name if self.requester else None,
            'connection_type': self.connection_type,
            'context': self.context,
            'referral_type': self.referral_type,
            'relationship_type': self.relationship_type,
            'target_user_id': str(self.target_user_id) if self.target_user_id else None,
            'target_phone': self.target_phone,
            'target_name': self.target_name,
            'target_last_name': self.target_last_name,
            'target_hospital_id': str(self.target_hospital_id) if self.target_hospital_id else None,
            'target_clinic_id': str(self.target_clinic_id) if self.target_clinic_id else None,
            'target_facility_name': self.target_facility_name,
            'invite_code': self.invite_code,
            'status': self.status.value,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
        }

    def __repr__(self):
        return f'<CareNetworkRequest {self.id} [{self.status.value}]>'
