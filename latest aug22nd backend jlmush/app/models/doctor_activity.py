"""
Doctor activity / operational models.

Models: MetricOverride, DoctorAdminRequest, AssetLibraryUsage

All original table names, column names, FK names, constraints, and methods
are preserved. Adds TenantMixin to all models. DateTime columns use
timezone=True throughout.
"""
import uuid

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin
from app.models._enums import MetricOverrideStatus


class MetricOverride(TenantMixin, TimestampMixin, db.Model):
    """
    Doctor metric correction requests.
    Doctor can suggest a correction to a computed metric value.
    Admin must approve before it takes effect (display only).
    """
    __tablename__ = 'metric_overrides'

    id        = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    metric_type       = db.Column(db.String(100), nullable=False)   # e.g. 'auto_approved_total'
    period_start      = db.Column(db.Date,        nullable=False)
    period_end        = db.Column(db.Date,        nullable=False)
    consultation_type = db.Column(db.String(50),  nullable=True)    # null = all types
    original_value    = db.Column(db.Integer,     nullable=False)
    suggested_value   = db.Column(db.Integer,     nullable=False)
    reason            = db.Column(db.Text,        nullable=False)
    attachments       = db.Column(JSON,           nullable=True)    # [{ url, name, type }]

    status = db.Column(
        db.Enum(
            MetricOverrideStatus,
            values_callable=lambda e: [m.value for m in e],
            create_constraint=False,
        ),
        default=MetricOverrideStatus.PENDING,
        nullable=False,
    )

    admin_comment  = db.Column(db.Text, nullable=True)
    reviewed_by_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )
    reviewed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Relationships
    doctor      = db.relationship('Doctor', backref=db.backref('metric_overrides', lazy='dynamic'))
    reviewed_by = db.relationship('User', foreign_keys=[reviewed_by_id])

    __table_args__ = (
        Index('ix_metric_overrides_tenant_doctor_status', 'tenant_id', 'doctor_id', 'status'),
        Index('ix_metric_overrides_tenant_doctor', 'tenant_id', 'doctor_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id),
            'metric_type': self.metric_type,
            'period_start': self.period_start.isoformat(),
            'period_end': self.period_end.isoformat(),
            'consultation_type': self.consultation_type,
            'original_value': self.original_value,
            'suggested_value': self.suggested_value,
            'reason': self.reason,
            'attachments': self.attachments,
            'status': self.status.value,
            'admin_comment': self.admin_comment,
            'reviewed_by_id': str(self.reviewed_by_id) if self.reviewed_by_id else None,
            'reviewed_at': self.reviewed_at.isoformat() if self.reviewed_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f"<MetricOverride doctor={self.doctor_id} metric={self.metric_type} status={self.status.value}>"


class DoctorAdminRequest(TenantMixin, TimestampMixin, db.Model):
    """
    Doctor raises a request / complaint to admin.
    Used from the Account Status → Publish Status → Raise a Request form.
    Covers publish-status change requests, general queries, etc.
    """
    __tablename__ = 'doctor_admin_requests'

    id        = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doctor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    # Which consultation type(s) this request is about (null = all types)
    consultation_type = db.Column(db.String(50), nullable=True)

    # Free-text remarks from doctor
    remarks = db.Column(db.Text, nullable=False)

    # Attached file paths/URLs — list of strings
    attachments = db.Column(JSON, nullable=True)

    # 'pending' | 'reviewed' | 'resolved'
    status = db.Column(db.String(20), nullable=False, default='pending', index=True)

    # Admin response
    admin_response = db.Column(db.Text, nullable=True)
    reviewed_by_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )
    reviewed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    doctor      = db.relationship('Doctor', backref=db.backref('admin_requests', lazy='dynamic'))
    reviewed_by = db.relationship('User', foreign_keys=[reviewed_by_id])

    __table_args__ = (
        Index('ix_doctor_admin_request_tenant_doctor', 'tenant_id', 'doctor_id'),
        Index('ix_doctor_admin_request_tenant_status', 'tenant_id', 'status'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id),
            'consultation_type': self.consultation_type,
            'remarks': self.remarks,
            'attachments': self.attachments or [],
            'status': self.status,
            'admin_response': self.admin_response,
            'reviewed_by_id': str(self.reviewed_by_id) if self.reviewed_by_id else None,
            'reviewed_at': self.reviewed_at.isoformat() if self.reviewed_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f"<DoctorAdminRequest doctor={self.doctor_id} status={self.status}>"


class AssetLibraryUsage(TenantMixin, db.Model):
    """
    Tracks each time a doctor uses the asset library (image / video / document)
    to explain a process or issue during a consultation.
    """
    __tablename__ = 'asset_library_usages'

    id             = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doctor_id      = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('doctors.doctor_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    appointment_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('appointments.appointment_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )

    # Type of asset used: 'image' | 'video' | 'document'
    asset_type  = db.Column(db.String(20),  nullable=False)
    asset_url   = db.Column(db.String(500), nullable=True)
    asset_name  = db.Column(db.String(200), nullable=True)

    # Which consultation type was active when asset was used
    consultation_type = db.Column(db.String(50), nullable=True)

    used_at = db.Column(db.DateTime(timezone=True), nullable=False, index=True)

    doctor = db.relationship('Doctor', backref=db.backref('asset_library_usages', lazy='dynamic'))

    __table_args__ = (
        Index('ix_asset_library_usage_tenant_doctor', 'tenant_id', 'doctor_id'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'doctor_id': str(self.doctor_id),
            'appointment_id': str(self.appointment_id) if self.appointment_id else None,
            'asset_type': self.asset_type,
            'asset_url': self.asset_url,
            'asset_name': self.asset_name,
            'consultation_type': self.consultation_type,
            'used_at': self.used_at.isoformat() if self.used_at else None,
        }

    def __repr__(self):
        return f"<AssetLibraryUsage doctor={self.doctor_id} type={self.asset_type}>"
