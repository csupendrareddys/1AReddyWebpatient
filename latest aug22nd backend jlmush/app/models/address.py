"""
Address model.

Keeps original table name 'addresses', all column names, and FK references.
Adds TenantMixin. DateTime columns use timezone=True.
"""
import uuid

from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin
from app.models._enums import AddressType


class Address(TenantMixin, TimestampMixin, db.Model):
    """User addresses for delivery / home visits."""
    __tablename__ = 'addresses'

    id      = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='address_id')
    user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    address_type  = db.Column(db.Enum(AddressType), nullable=False, index=True)
    address_line1 = db.Column(db.String(300), nullable=False)
    address_line2 = db.Column(db.String(300), nullable=True)
    landmark      = db.Column(db.String(200), nullable=True)
    city          = db.Column(db.String(100), nullable=False, index=True)
    state         = db.Column(db.String(100), nullable=False)
    pincode       = db.Column(db.String(10),  nullable=False, index=True)
    country       = db.Column(db.String(100), default='India', nullable=False)
    latitude      = db.Column(db.Numeric(10, 8), nullable=True)
    longitude     = db.Column(db.Numeric(11, 8), nullable=True)

    is_default = db.Column(db.Boolean, default=False, nullable=False)
    is_active  = db.Column(db.Boolean, default=True,  nullable=False, index=True)

    # Relationships
    user = db.relationship('User', back_populates='addresses')

    __table_args__ = (
        Index('ix_address_tenant_user', 'tenant_id', 'user_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'address_type': self.address_type.value,
            'address_line1': self.address_line1,
            'city': self.city,
            'pincode': self.pincode,
            'is_default': self.is_default,
        }

    def __repr__(self):
        return f"<Address {self.city} - {self.address_type.value}>"
