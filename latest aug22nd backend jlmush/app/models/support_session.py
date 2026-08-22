"""SupportSession — a time-boxed grant letting the vendor reach one tenant.

Before this, ``PLATFORM_OWNER`` bypassed every authorization decorator
unconditionally, so the vendor could read any customer's data at any time
with no record that it happened. For a platform sold to clinics and law
firms that is not a defensible position: the customers' own regulators ask
who looked at what.

The rule is now: the vendor's role gets them the **control plane**
(``/api/platform/*`` — tenants, plans, subscriptions, entitlements). To
touch a customer's **business** data they must open a session naming the
tenant and the reason, and it stops working on its own.

Deliberately NOT ``TenantMixin``: a grant is about the relationship
between the vendor and one tenant, so scoping it to a tenant's own RLS
context would mean the tenant could not be shown who accessed them, and
the vendor could not list their own outstanding grants.

This table IS the audit trail. Rows are never deleted or reused —
``revoke()`` stamps ``revoked_at`` rather than removing anything, and
``touch()`` records that a grant was actually exercised, so an unused
grant is distinguishable from one that read a hundred records.
(``RolePermissionAuditLog`` was considered and rejected: it requires a
``role_id`` + ``module`` and models RBAC edits, not access.)
"""
import uuid
from datetime import timedelta

from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import utcnow, TimestampMixin

# A grant is for looking at one problem, not for standing access.
DEFAULT_TTL_MINUTES = 60
MAX_TTL_MINUTES = 60 * 8


class SupportSession(db.Model, TimestampMixin):
    __tablename__ = 'support_sessions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    platform_user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    target_tenant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('tenants.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    # Free text on purpose: a dropdown of canned reasons gets clicked
    # through without thought. Required by the API.
    reason = db.Column(db.Text, nullable=False)

    granted_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utcnow, index=True,
    )
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False, index=True)
    revoked_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Was the grant actually used? An opened-but-unused session is a very
    # different thing from one that touched data, and only one of them
    # needs explaining.
    last_used_at = db.Column(db.DateTime(timezone=True), nullable=True)
    use_count = db.Column(db.Integer, nullable=False, default=0)

    platform_user = db.relationship('User', foreign_keys=[platform_user_id])
    target_tenant = db.relationship('Tenant', foreign_keys=[target_tenant_id])

    __table_args__ = (
        db.Index(
            'ix_support_sessions_lookup',
            'platform_user_id', 'target_tenant_id', 'expires_at',
        ),
    )

    # ------------------------------------------------------------------ #

    @property
    def is_active(self) -> bool:
        if self.revoked_at is not None:
            return False
        return self.expires_at > utcnow()

    @property
    def status(self) -> str:
        if self.revoked_at is not None:
            return 'revoked'
        return 'active' if self.expires_at > utcnow() else 'expired'

    @staticmethod
    def clamp_ttl(minutes) -> int:
        try:
            minutes = int(minutes)
        except (TypeError, ValueError):
            minutes = DEFAULT_TTL_MINUTES
        return max(1, min(minutes, MAX_TTL_MINUTES))

    @classmethod
    def open(cls, *, platform_user_id, target_tenant_id, reason, minutes=None):
        ttl = cls.clamp_ttl(minutes if minutes is not None else DEFAULT_TTL_MINUTES)
        now = utcnow()
        return cls(
            platform_user_id=platform_user_id,
            target_tenant_id=target_tenant_id,
            reason=(reason or '').strip(),
            granted_at=now,
            expires_at=now + timedelta(minutes=ttl),
        )

    @classmethod
    def active_for(cls, platform_user_id, target_tenant_id):
        """The live grant for this pair, or None.

        Hot path — called on every gated request made by a platform owner
        against a customer tenant, hence the covering index above.
        """
        if not platform_user_id or not target_tenant_id:
            return None
        return (
            cls.query
            .filter(
                cls.platform_user_id == platform_user_id,
                cls.target_tenant_id == target_tenant_id,
                cls.revoked_at.is_(None),
                cls.expires_at > utcnow(),
            )
            .order_by(cls.expires_at.desc())
            .first()
        )

    def touch(self):
        self.last_used_at = utcnow()
        self.use_count = (self.use_count or 0) + 1

    def revoke(self):
        if self.revoked_at is None:
            self.revoked_at = utcnow()

    def to_dict(self):
        return {
            'id': str(self.id),
            'platform_user_id': str(self.platform_user_id),
            'target_tenant_id': str(self.target_tenant_id),
            'target_tenant_slug': (
                self.target_tenant.slug if self.target_tenant else None
            ),
            'reason': self.reason,
            'status': self.status,
            'granted_at': self.granted_at.isoformat() if self.granted_at else None,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'revoked_at': self.revoked_at.isoformat() if self.revoked_at else None,
            'last_used_at': (
                self.last_used_at.isoformat() if self.last_used_at else None
            ),
            'use_count': self.use_count or 0,
        }
