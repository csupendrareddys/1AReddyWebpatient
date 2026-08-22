"""
Pharmacy model.

Changes from original model.py:
- Inherits TenantMixin (adds tenant_id FK)
- license_number unique -> tenant-scoped UniqueConstraint
- All DateTime columns use timezone=True
"""
import uuid

from sqlalchemy import Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, utcnow
from app.models._enums import UserVerificationStatus


class Pharmacy(TenantMixin, db.Model):
    """Pharmacy profile extending the User model."""
    __tablename__ = 'pharmacies'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='pharmacy_id')
    user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='CASCADE'),
        unique=True,
        nullable=False,
        index=True
    )

    # Business info
    name = db.Column(db.String(300), nullable=False)
    license_number = db.Column(db.String(100), nullable=False, index=True)
    gst_number = db.Column(db.String(50), nullable=True)

    # Contact
    phone = db.Column(db.String(15), nullable=True)
    email = db.Column(db.String(254), nullable=True)

    # Address
    address = db.Column(db.Text, nullable=False)
    city = db.Column(db.String(100), nullable=False, index=True)
    state = db.Column(db.String(100), nullable=False)
    pincode = db.Column(db.String(10), nullable=False, index=True)

    # Operating hours
    operating_hours = db.Column(JSON, nullable=True)

    # Verification
    verification_status = db.Column(
        db.Enum(UserVerificationStatus),
        default=UserVerificationStatus.PENDING,
        nullable=False,
        index=True
    )

    # Timestamps
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    is_deleted = db.Column(db.Boolean, default=False, nullable=False, index=True)
    deleted_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Relationships
    user = db.relationship('User', back_populates='pharmacy_profile')

    __table_args__ = (
        UniqueConstraint('tenant_id', 'license_number', name='uq_pharmacies_tenant_license'),
        Index('ix_pharmacies_active', 'tenant_id', postgresql_where=text('is_deleted = FALSE')),
    )

    def to_dict(self, include_user=False):
        data = {
            'id': str(self.id),
            'name': self.name,
            'license_number': self.license_number,
            'city': self.city,
            'verification_status': self.verification_status.value,
        }
        if include_user and self.user:
            data['user_details'] = self.user.to_dict()
        return data

    def __repr__(self):
        return f"<Pharmacy {self.name}>"
