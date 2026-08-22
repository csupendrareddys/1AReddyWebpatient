"""Device push tokens — the mobile leg of the notification system.

A phone registers its push token after login (POST
/api/notifications/devices) and removes it at logout. ``push_notification``
fans out to every registered device of the recipient AFTER the row commit
and socket emit — so a backgrounded mobile app still hears about the
event, with zero polling.

Provider-agnostic by column: today ``provider='expo'`` (the Expo Push
Service — plain HTTPS, no Firebase account needed for the backend);
a direct-FCM/APNs sender can be added later without touching the hooks.

Privacy: healthcare content must never ride a push payload in detail —
callers keep titles/bodies generic ("You have a new update"), and the
real content loads over the authenticated API when the user taps.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import TenantMixin, utcnow


class DevicePushToken(TenantMixin, db.Model):
    __tablename__ = 'device_push_tokens'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    # ExponentPushToken[...] today; FCM/APNs tokens later. Globally unique:
    # a device that logs into a different account moves WITH its token
    # (upsert re-points user_id), so pushes never reach a previous user.
    token = db.Column(db.String(512), nullable=False, unique=True)
    platform = db.Column(db.String(20), nullable=False, default='unknown')
    provider = db.Column(db.String(20), nullable=False, default='expo')

    created_at = db.Column(db.DateTime(timezone=True), default=utcnow,
                           nullable=False)
    last_seen_at = db.Column(db.DateTime(timezone=True), default=utcnow,
                             nullable=False)

    def to_dict(self):
        return {
            'id': str(self.id),
            'platform': self.platform,
            'provider': self.provider,
            'last_seen_at': (
                self.last_seen_at.isoformat() if self.last_seen_at else None
            ),
        }

    def __repr__(self):
        return f"<DevicePushToken user={self.user_id} {self.platform}>"
