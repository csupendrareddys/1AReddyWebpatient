"""
House Group models: HouseGroupMember, HouseGroupRequest.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, utcnow
from app.models._enums import Gender, BloodGroup, HouseGroupRequestStatus


class HouseGroupMember(TenantMixin, db.Model):
    """Family members linked to a patient profile (House Group)."""
    __tablename__ = 'house_group_members'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='member_id')
    patient_id = db.Column(UUID(as_uuid=True), db.ForeignKey('patients.patient_id', ondelete='CASCADE'), nullable=False, index=True)

    relation = db.Column(db.String(50), nullable=False)
    first_name = db.Column(db.String(100), nullable=False)
    last_name = db.Column(db.String(100), nullable=False)
    gender = db.Column(db.Enum(Gender), nullable=True)
    dob = db.Column(db.Date, nullable=True)
    blood_group = db.Column(db.Enum(BloodGroup), nullable=True)

    phone_number = db.Column(db.String(20), nullable=True)
    email = db.Column(db.String(254), nullable=True)
    profile_image = db.Column(db.String(500), nullable=True)

    group_type = db.Column(db.String(20), default='family', nullable=False)
    linked_user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)
    linked_patient_id = db.Column(UUID(as_uuid=True), db.ForeignKey('patients.patient_id', ondelete='SET NULL'), nullable=True)
    permissions = db.Column(JSON, nullable=True)
    is_child_account = db.Column(db.Boolean, default=False, nullable=False)
    # The PatientRole this LINKED ADULT member holds over the owner's (patient_id)
    # data — what they may view/do on-behalf-of. NULL falls back to the legacy
    # ``permissions`` JSON. Not used for minors (guardians have full access).
    role_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('patient_roles.patient_role_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    invite_code = db.Column(db.String(20), nullable=True)

    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    patient = db.relationship('Patient', back_populates='house_group', foreign_keys=[patient_id])
    linked_user = db.relationship('User', foreign_keys=[linked_user_id])

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'invite_code', name='uq_house_group_member_tenant_invite_code'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'relation': self.relation,
            'full_name': f"{self.first_name} {self.last_name}",
            'first_name': self.first_name,
            'last_name': self.last_name,
            'gender': self.gender.value if self.gender else None,
            'dob': self.dob.isoformat() if self.dob else None,
            'blood_group': self.blood_group.value if self.blood_group else None,
            'phone_number': self.phone_number,
            'email': self.email,
            'profile_image': self.profile_image,
            'group_type': self.group_type,
            'linked_user_id': str(self.linked_user_id) if self.linked_user_id else None,
            'permissions': self.permissions or {'visible': True, 'appointments': 'view', 'prescriptions': 'view'},
            'is_child_account': self.is_child_account,
            'invite_code': self.invite_code,
            'is_active': self.is_active,
        }

    def __repr__(self):
        return f"<HouseGroupMember {self.first_name} ({self.relation})>"


class HouseGroupRequest(TenantMixin, db.Model):
    """Requests to join or invite members to a house/family group."""
    __tablename__ = 'house_group_requests'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requester_patient_id = db.Column(UUID(as_uuid=True), db.ForeignKey('patients.patient_id', ondelete='CASCADE'), nullable=False, index=True)
    target_user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)
    target_phone = db.Column(db.String(20), nullable=True)
    target_name = db.Column(db.String(200), nullable=True)
    target_last_name = db.Column(db.String(100), nullable=True)
    receiver_relation = db.Column(db.String(50), nullable=True)
    invite_code = db.Column(db.String(20), nullable=True, index=True)
    relation = db.Column(db.String(50), nullable=False)
    group_type = db.Column(db.String(20), default='family', nullable=False)
    status = db.Column(db.Enum(HouseGroupRequestStatus), default=HouseGroupRequestStatus.PENDING, nullable=False, index=True)
    permissions = db.Column(JSON, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now())
    updated_at = db.Column(db.DateTime(timezone=True), server_default=db.func.now(), onupdate=db.func.now())
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True)

    requester = db.relationship('Patient', foreign_keys=[requester_patient_id], backref=db.backref('sent_group_requests', lazy='dynamic'))
    target_user = db.relationship('User', foreign_keys=[target_user_id], backref=db.backref('received_group_requests', lazy='dynamic'))

    def to_dict(self):
        return {
            'id': str(self.id),
            'requester_patient_id': str(self.requester_patient_id),
            'requester_name': self.requester.full_name if self.requester else None,
            'target_user_id': str(self.target_user_id) if self.target_user_id else None,
            'target_phone': self.target_phone,
            'target_name': self.target_name,
            'target_last_name': self.target_last_name,
            'receiver_relation': self.receiver_relation,
            'invite_code': self.invite_code,
            'relation': self.relation,
            'group_type': self.group_type,
            'status': self.status.value,
            'permissions': self.permissions,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
        }

    def __repr__(self):
        return f"<HouseGroupRequest {self.id} [{self.status.value}]>"
