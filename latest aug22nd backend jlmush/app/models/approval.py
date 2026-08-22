"""
Approval workflow models: ApprovalRequest, ApprovalAction.
"""
import uuid

from sqlalchemy import Index, CheckConstraint, text
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, utcnow
from app.models._enums import (
    ApprovalRequestStatus, ApprovalEntityType, ApprovalActionType,
)


class ApprovalRequest(TenantMixin, db.Model):
    """
    When a doctor (or patient) wants to update a sensitive profile field,
    it creates an ApprovalRequest instead of directly modifying the record.

    Flow:
    1. Doctor submits change → ApprovalRequest created (PENDING)
    2. Sub-admin with appropriate level reviews
    3. Admin can: approve (moves to next level), reject, or query
    4. Once all required levels approve → COMPLETED, changes applied
    """
    __tablename__ = 'approval_requests'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='request_id')

    requested_by_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='CASCADE'), nullable=False, index=True)

    entity_type = db.Column(db.Enum(ApprovalEntityType), nullable=False, index=True)
    entity_id = db.Column(UUID(as_uuid=True), nullable=False, index=True)

    # {"field_name": {"old_value": "...", "new_value": "..."}, ...}
    changes = db.Column(JSON, nullable=False)

    # [{"name": "...", "url": "...", "type": "..."}]
    attachments = db.Column(JSON, nullable=True)

    reason = db.Column(db.Text, nullable=True)

    status = db.Column(db.Enum(ApprovalRequestStatus), default=ApprovalRequestStatus.PENDING, nullable=False)

    required_level = db.Column(db.Integer, default=1, nullable=False)
    current_level = db.Column(db.Integer, default=0, nullable=False)

    # Optimistic locking: prevents race conditions when multiple admins approve simultaneously.
    version = db.Column(db.Integer, default=1, nullable=False)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Relationships
    requested_by = db.relationship('User', foreign_keys=[requested_by_id], backref='approval_requests')
    actions = db.relationship(
        'ApprovalAction',
        back_populates='request',
        cascade='all, delete-orphan',
        lazy='dynamic',
        order_by='ApprovalAction.created_at'
    )

    __table_args__ = (
        Index('ix_approval_requests_tenant_entity', 'tenant_id', 'entity_type', 'entity_id'),
        Index('ix_approval_requests_tenant_status', 'tenant_id', 'status', 'created_at'),
        CheckConstraint('required_level >= 1 AND required_level <= 3', name='check_required_level_range'),
        CheckConstraint('current_level >= 0 AND current_level <= required_level', name='check_current_level_range'),
    )

    def approve_level(self, admin_id, comments=None):
        """
        Thread-safe approval using optimistic locking.
        Returns (success: bool, error_message: str or None)

        Usage in your route:
            success, error = approval_request.approve_level(admin_id, comments)
            if not success:
                db.session.rollback()
                return jsonify({"error": error}), 409
            db.session.commit()
        """
        if self.status not in (ApprovalRequestStatus.PENDING, ApprovalRequestStatus.UNDER_REVIEW,
                               ApprovalRequestStatus.APPROVED_L1, ApprovalRequestStatus.APPROVED_L2):
            return False, f"Cannot approve request in status: {self.status.value}"

        if self.current_level >= self.required_level:
            return False, "All required levels already approved"

        next_level = self.current_level + 1
        expected_version = self.version

        # IMPORTANT: Use .name (uppercase) — PostgreSQL enum stores the member name, not the value
        new_status_value = (
            ApprovalRequestStatus.COMPLETED.name
            if next_level >= self.required_level
            else f'APPROVED_L{next_level}'
        )
        result = db.session.execute(
            db.text("""
                UPDATE approval_requests
                SET current_level = :next_level,
                    version = version + 1,
                    status = CAST(:new_status AS approvalrequeststatus),
                    updated_at = :now,
                    completed_at = CASE WHEN :next_level >= required_level THEN :now ELSE NULL END
                WHERE request_id = :request_id
                AND version = :expected_version
            """),
            {
                'next_level': next_level,
                'new_status': new_status_value,
                'now': utcnow(),
                'request_id': self.id,
                'expected_version': expected_version,
            }
        )

        if result.rowcount == 0:
            return False, "Concurrent modification detected. Another admin may have already acted on this request. Please refresh."

        # tenant_id has to be set explicitly here. ApprovalAction
        # inherits TenantMixin (tenant_id NOT NULL) and SQLAlchemy
        # doesn't auto-populate it on insert. Carrying it forward from
        # the parent ApprovalRequest keeps the action in the same
        # tenant scope as the request — important when PLATFORM_OWNER
        # approves a cross-tenant request from the apex (session
        # tenant ≠ request tenant), where leaving it to the RLS
        # context would either insert NULL (NotNullViolation, the
        # original 500) or stamp the wrong tenant.
        action = ApprovalAction(
            tenant_id=self.tenant_id,
            request_id=self.id,
            admin_id=admin_id,
            action=ApprovalActionType.APPROVE,
            level=next_level,
            comments=comments,
        )
        db.session.add(action)

        db.session.refresh(self)
        return True, None

    def to_dict(self, include_actions=False):
        requester_name = None
        if self.requested_by:
            user = self.requested_by
            if hasattr(user, 'doctor_profile') and user.doctor_profile:
                requester_name = user.doctor_profile.full_name
            elif user.first_name or user.last_name:
                requester_name = f"{user.first_name or ''} {user.last_name or ''}".strip()

        data = {
            'id': str(self.id),
            'requested_by_id': str(self.requested_by_id),
            'requested_by_name': requester_name,
            'entity_type': self.entity_type.value,
            'entity_id': str(self.entity_id),
            'changes': self.changes,
            'attachments': self.attachments,
            'reason': self.reason,
            'status': self.status.value,
            'required_level': self.required_level,
            'current_level': self.current_level,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
        }
        if include_actions:
            data['actions'] = [a.to_dict() for a in self.actions.all()]
        return data

    def __repr__(self):
        return f"<ApprovalRequest {self.id} [{self.status.value}]>"


class ApprovalAction(TenantMixin, db.Model):
    """Each review action taken on an ApprovalRequest — audit trail."""
    __tablename__ = 'approval_actions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='action_id')
    request_id = db.Column(UUID(as_uuid=True), db.ForeignKey('approval_requests.request_id', ondelete='CASCADE'), nullable=False, index=True)

    admin_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True, index=True)

    action = db.Column(db.Enum(ApprovalActionType), nullable=False)
    level = db.Column(db.Integer, nullable=False)

    comments = db.Column(db.Text, nullable=True)
    attachments = db.Column(JSON, nullable=True)

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False)

    # Relationships
    request = db.relationship('ApprovalRequest', back_populates='actions')
    admin = db.relationship('User', foreign_keys=[admin_id])

    def to_dict(self):
        return {
            'id': str(self.id),
            'request_id': str(self.request_id),
            'admin_id': str(self.admin_id) if self.admin_id else None,
            'admin_name': (self.admin.admin_profile.full_name
                          if self.admin and self.admin.admin_profile else 'System'),
            'action': self.action.value if self.action else None,
            'level': self.level,
            'comments': self.comments,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<ApprovalAction {self.action} L{self.level} on {self.request_id}>"
