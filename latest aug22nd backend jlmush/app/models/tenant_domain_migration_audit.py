"""Audit trail for tenant custom-domain provider operations + the
Cloudflare migration phase machine.

One row written per provider operation (Amplify or Cloudflare) and per
phase transition / probe in PlatformDomainService.migrate_to_cloudflare.
Read by ``GET /api/platform/tenants/<id>/domain/migration-audit`` and
surfaced in the admin migration modal as a collapsible timeline so an
operator can see exactly which step failed (DNS probe? TLS handshake?
HTTP fetch? CF API call?).

Not tenant-scoped via TenantMixin because this table IS the tenant_id
key — every row already explicitly carries it and the platform-owner
endpoint reads across tenants for its dashboard views.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import utcnow


class TenantDomainMigrationAudit(db.Model):
    """One row per provider mutation or phase-machine event."""
    __tablename__ = 'tenant_domain_migration_audit'

    id = db.Column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    tenant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    # 'amplify' | 'cloudflare' — which side the op touched. The
    # migrate-to-cloudflare phase machine writes rows under BOTH
    # providers depending on which call it's recording.
    provider = db.Column(db.String(20), nullable=False)
    # Snapshot of settings['cf_migration']['phase'] at op start, or NULL
    # for ops outside the phase machine (steady-state refresh, etc.).
    phase = db.Column(db.String(20), nullable=True)
    # 'create_or_update' | 'refresh' | 'reset_and_retry' | 'delete' |
    # 'precutover_check.dns' | 'precutover_check.tls' |
    # 'precutover_check.http' | 'precutover_check.tenant_route' |
    # 'cutover' | 'teardown' | 'rollback' | 'migrate_start'.
    operation = db.Column(db.String(40), nullable=False)
    # 'success' | 'failure' | 'pending'.
    status = db.Column(db.String(20), nullable=False)
    duration_ms = db.Column(db.Integer, nullable=True)
    error = db.Column(db.Text, nullable=True)
    actor_user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='SET NULL'),
        nullable=True,
    )
    created_at = db.Column(
        db.DateTime(timezone=True), default=utcnow, nullable=False,
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'tenant_id': str(self.tenant_id),
            'provider': self.provider,
            'phase': self.phase,
            'operation': self.operation,
            'status': self.status,
            'duration_ms': self.duration_ms,
            'error': self.error,
            'actor_user_id': str(self.actor_user_id) if self.actor_user_id else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return (
            f"<TenantDomainMigrationAudit tenant={self.tenant_id} "
            f"provider={self.provider} op={self.operation} status={self.status}>"
        )
