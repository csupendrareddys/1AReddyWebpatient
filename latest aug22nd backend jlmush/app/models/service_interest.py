"""A doctor's expression of INTEREST in an admin catalog service / group plan.

Doctors no longer create group offerings themselves — an admin assigns the plan.
From the catalog a doctor can only register interest here; the admin reviews the
list and assigns accordingly. One row per (doctor, product) — re-expressing
interest updates the note/timestamp rather than duplicating.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin


class ServiceInterest(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = 'service_interests'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='interest_id')
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    product_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctor_products.product_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    note = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), nullable=False, default='new')  # new | reviewed

    __table_args__ = (
        db.UniqueConstraint('tenant_id', 'doctor_id', 'product_id', name='uq_service_interest'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id),
            'product_id': str(self.product_id),
            'note': self.note,
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
