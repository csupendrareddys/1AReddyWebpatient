"""
Doctor qualification and service models.

Models: DoctorQualificationDegree, DoctorQualificationSpecialization, DoctorService

All original table names, column names, FK names, and methods are preserved.
Adds TenantMixin to all models. DateTime columns use timezone=True.
"""
import uuid

from sqlalchemy import UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin
from app.models._enums import ServiceName


# DoctorQualificationDegree and DoctorQualificationSpecialization were PRUNED —
# replaced by ProfileEducationDegree / ProfileEducationSpecialization in
# app/models/profile_shared.py (see docs/profile-consolidation-target-design.md).
# The legacy doctor_qualification_degrees / _specializations tables are dropped
# by the phase-3 prune migration after their data is copied to the new tables.


class DoctorService(TenantMixin, TimestampMixin, db.Model):
    """Services offered by doctors (consultation types + pricing)."""
    __tablename__ = 'doctor_services'

    id        = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='service_id')
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    service_name     = db.Column(db.Enum(ServiceName), nullable=False, index=True)
    price            = db.Column(db.Numeric(10, 2), nullable=False)
    duration_minutes = db.Column(db.Integer,  nullable=True)
    description      = db.Column(db.Text,     nullable=True)
    is_available     = db.Column(db.Boolean, default=True, nullable=False, index=True)

    doctor       = db.relationship('Doctor',      back_populates='services')
    appointments = db.relationship('Appointment', back_populates='service', lazy='dynamic')

    __table_args__ = (
        Index('ix_doctor_service_tenant_doctor', 'tenant_id', 'doctor_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'service_name': self.service_name.value,
            'price': str(self.price),
            'duration_minutes': self.duration_minutes,
            'is_available': self.is_available,
        }

    def __repr__(self):
        return f"<DoctorService {self.service_name.value}>"
