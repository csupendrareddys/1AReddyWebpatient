"""
Audit Models - RolePermissionAuditLog.
Separated from rbac.py to avoid circular imports in the original design.
Now lives here as part of the modular model structure.
"""
import uuid

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID, JSON

from app.extensions import db
from app.models._base import TenantMixin, utcnow
from app.models._enums import PermissionModule


class RolePermissionAuditLog(TenantMixin, db.Model):
    """Tracks before/after snapshots of permission changes for audit trail."""
    __tablename__ = 'role_permission_audit_log'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, name='audit_id')
    role_permission_id = db.Column(UUID(as_uuid=True), nullable=False, index=True)
    role_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('roles.role_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    module = db.Column(db.Enum(PermissionModule, name='permissionmodule'), nullable=False, index=True)
    changed_by_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )
    action = db.Column(db.String(50), nullable=False)
    change_reason = db.Column(db.Text, nullable=True)
    before_snapshot = db.Column(JSON, nullable=True)
    after_snapshot = db.Column(JSON, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False, index=True)

    role = db.relationship('Role', backref=db.backref('permission_audit_log', lazy='dynamic'))
    changed_by = db.relationship('User', foreign_keys=[changed_by_id])

    __table_args__ = (
        Index('ix_audit_tenant_role_module', 'tenant_id', 'role_id', 'module'),
        Index('ix_audit_tenant_changed_by', 'tenant_id', 'changed_by_id', 'created_at'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'role_id': str(self.role_id),
            'role_name': self.role.name if self.role else None,
            'module': self.module.value,
            'action': self.action,
            'change_reason': self.change_reason,
            'changed_by_id': str(self.changed_by_id) if self.changed_by_id else None,
            'changed_by_name': (
                self.changed_by.admin_profile.full_name
                if self.changed_by and self.changed_by.admin_profile
                else 'System'
            ),
            'before': self.before_snapshot,
            'after': self.after_snapshot,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class OperationsAuditLog(TenantMixin, db.Model):
    """Audit trail for the super-admin **Operations** module.

    Every write performed on behalf of a member (profile edit, book-on-behalf,
    …) records who did it, to whom, and a small JSON summary — so IT-support
    actions are traceable and distinguishable from the member's own actions.
    """
    __tablename__ = 'operations_audit_logs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # The admin who performed the action (NULL only if the user was later deleted).
    actor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    target_type = db.Column(db.String(30), nullable=False)   # 'patient' | 'doctor' | 'admin'
    target_id = db.Column(UUID(as_uuid=True), nullable=False, index=True)
    action = db.Column(db.String(50), nullable=False)        # 'profile_edit' | 'book_on_behalf'
    summary = db.Column(JSON, nullable=True)                 # {section, fields} / {appointment_id, mark_as_paid}
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow, nullable=False, index=True)

    actor = db.relationship('User', foreign_keys=[actor_id])

    __table_args__ = (
        Index('ix_ops_audit_tenant_target', 'tenant_id', 'target_type', 'target_id'),
        Index('ix_ops_audit_tenant_actor', 'tenant_id', 'actor_id', 'created_at'),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'actor_id': str(self.actor_id) if self.actor_id else None,
            'target_type': self.target_type,
            'target_id': str(self.target_id),
            'action': self.action,
            'summary': self.summary,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class PlanAuditLog(db.Model):
    """Audit trail for the VENDOR's SaaS plan catalog.

    Deliberately NOT tenant-scoped: plans are vendor-global objects and
    their edits ripple across (new) subscribers, so the trail must be
    readable without a tenant context. One row per create / update /
    archive / resync-subscribers, with a compact ``changes`` diff — enough
    to answer "who turned those 61 features on, and when" without
    forensically reading JSON shapes.
    """
    __tablename__ = 'plan_audit_logs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True, index=True,
    )
    plan_id = db.Column(UUID(as_uuid=True), nullable=False, index=True)
    plan_code = db.Column(db.String(80), nullable=False, index=True)
    # 'create' | 'update' | 'archive' | 'resync_subscribers'
    action = db.Column(db.String(40), nullable=False)
    # update: {field: {'from': ..., 'to': ...}}, features as changed paths.
    # create: {'summary': {...}}. resync: {'subscribers': N}.
    changes = db.Column(JSON, nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True), default=utcnow, nullable=False, index=True)

    actor = db.relationship('User', foreign_keys=[actor_id])

    def to_dict(self):
        return {
            'id': str(self.id),
            'actor_id': str(self.actor_id) if self.actor_id else None,
            'plan_id': str(self.plan_id),
            'plan_code': self.plan_code,
            'action': self.action,
            'changes': self.changes,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


def record_plan_action(actor_id, plan, action, changes=None):
    """Add a :class:`PlanAuditLog` row to the session (caller commits)."""
    log = PlanAuditLog(
        actor_id=actor_id,
        plan_id=plan.id,
        plan_code=plan.code,
        action=action,
        changes=changes,
    )
    db.session.add(log)
    return log


def record_ops_action(actor_id, target_type, target_id, action, summary=None):
    """Add an :class:`OperationsAuditLog` row to the session (caller commits)."""
    log = OperationsAuditLog(
        actor_id=actor_id,
        target_type=target_type,
        target_id=target_id,
        action=action,
        summary=summary,
    )
    db.session.add(log)
    return log


def create_permission_audit(perm, action, changed_by_id, before_snapshot=None, reason=None):
    """Factory function to create and add an audit log entry to the session."""
    audit = RolePermissionAuditLog(
        role_permission_id=perm.id,
        role_id=perm.role_id,
        module=perm.module,
        changed_by_id=changed_by_id,
        action=action,
        change_reason=reason,
        before_snapshot=before_snapshot,
        after_snapshot=perm.to_dict() if action != 'delete' else None,
    )
    db.session.add(audit)
    return audit
