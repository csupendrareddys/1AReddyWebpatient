"""
Field-level approval request model.

Tracks field-level approval requests for doctor/admin profile changes.
When a doctor or sub-admin saves a field, the new value goes here as
'pending'. The current live value stays on the Doctor/Admin model until
approved by a super admin.

All original table names, column names, FK names, constraints, indexes,
and methods are preserved. Adds TenantMixin. DateTime columns use
timezone=True.
"""
import uuid

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin
from app.models._enums import FieldApprovalStatus


class FieldApprovalRequest(TenantMixin, TimestampMixin, db.Model):
    """
    Tracks field-level approval requests for doctor/admin profile changes.
    When a doctor or sub-admin saves a field, the new value goes here as
    'pending'. The current live value stays on the Doctor/Admin model until
    approved by super admin.
    """
    __tablename__ = 'field_approval_requests'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Who submitted the change
    submitted_by_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id'),
        nullable=False, index=True,
    )

    # Target entity
    entity_type = db.Column(db.String(20),   nullable=False)   # 'doctor' | 'admin'
    entity_id   = db.Column(UUID(as_uuid=True), nullable=False, index=True)

    # Field identification
    section    = db.Column(db.String(100), nullable=False)   # e.g. 'personal_details', 'signatures'
    field_name = db.Column(db.String(200), nullable=False)   # e.g. 'first_name', 'registration_number'

    # Values stored as JSON to handle any type
    old_value = db.Column(JSON, nullable=True)
    new_value = db.Column(JSON, nullable=True)

    # For file fields, store the S3 key of the proposed file
    is_file_field = db.Column(db.Boolean, default=False, nullable=False)

    # Status
    status = db.Column(
        db.Enum(
            FieldApprovalStatus,
            values_callable=lambda x: [e.value for e in x],
        ),
        default=FieldApprovalStatus.PENDING,
        nullable=False, index=True,
    )

    # Admin review
    reviewed_by_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id'), nullable=True)
    reviewed_at    = db.Column(db.DateTime(timezone=True), nullable=True)
    review_comment = db.Column(db.Text, nullable=True)

    # Relationships
    submitter = db.relationship('User', foreign_keys=[submitted_by_id], backref='submitted_field_approvals')
    reviewer  = db.relationship('User', foreign_keys=[reviewed_by_id],  backref='reviewed_field_approvals')

    __table_args__ = (
        Index('ix_field_approval_tenant_entity',        'tenant_id', 'entity_type', 'entity_id'),
        Index('ix_field_approval_tenant_status_entity', 'tenant_id', 'status', 'entity_type', 'entity_id'),
        Index('ix_field_approval_tenant',               'tenant_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'submitted_by_id': str(self.submitted_by_id),
            'entity_type': self.entity_type,
            'entity_id': str(self.entity_id),
            'section': self.section,
            'field_name': self.field_name,
            'old_value': self.old_value,
            'new_value': self.new_value,
            'is_file_field': self.is_file_field,
            'status': self.status.value,
            'reviewed_by_id': str(self.reviewed_by_id) if self.reviewed_by_id else None,
            'reviewed_at': self.reviewed_at.isoformat() if self.reviewed_at else None,
            'review_comment': self.review_comment,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'submitter_name': self.submitter.full_name if self.submitter else None,
            'reviewer_name': self.reviewer.full_name if self.reviewer else None,
        }

    def __repr__(self):
        return (
            f"<FieldApprovalRequest entity={self.entity_type}/{self.entity_id} "
            f"field={self.field_name} status={self.status.value}>"
        )
