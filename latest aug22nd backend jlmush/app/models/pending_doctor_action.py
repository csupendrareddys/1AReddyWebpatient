"""A doctor-initiated action held pending admin approval.

When a doctor's effective mode for a gated action (appointment_cancel /
appointment_reschedule / payments) is ``manual``, the action is NOT applied —
a row is written here and surfaced in the admin queue. On approve the held
action is executed; on reject it is discarded. ``auto_accept`` applies the
action immediately (no row); ``auto_reject`` denies it outright (no row).

Kept deliberately generic (``kind`` + ``ref_type``/``ref_id`` + ``payload``)
so one table + one admin queue serves all three gates.
"""
import uuid

from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin

PENDING = 'pending'
APPROVED = 'approved'
REJECTED = 'rejected'


class PendingDoctorAction(TenantMixin, TimestampMixin, db.Model):
    __tablename__ = 'pending_doctor_actions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='action_id')
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    # 'appointment_cancel' | 'appointment_reschedule' | 'payments'
    kind = db.Column(db.String(40), nullable=False, index=True)
    ref_type = db.Column(db.String(30), nullable=True)   # 'appointment' | 'payout'
    ref_id = db.Column(UUID(as_uuid=True), nullable=True, index=True)
    payload = db.Column(JSONB, nullable=True)            # e.g. reschedule details / reason
    label = db.Column(db.String(200), nullable=True)     # human summary for the queue

    status = db.Column(db.String(20), nullable=False, default=PENDING, index=True)
    requested_by_id = db.Column(UUID(as_uuid=True), nullable=True)
    review_comment = db.Column(db.Text, nullable=True)
    reviewed_by_id = db.Column(UUID(as_uuid=True), nullable=True)
    reviewed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    def to_dict(self):
        return {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id),
            'kind': self.kind,
            'ref_type': self.ref_type,
            'ref_id': str(self.ref_id) if self.ref_id else None,
            'payload': self.payload or {},
            'label': self.label,
            'status': self.status,
            'review_comment': self.review_comment,
            'reviewed_at': self.reviewed_at.isoformat() if self.reviewed_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
