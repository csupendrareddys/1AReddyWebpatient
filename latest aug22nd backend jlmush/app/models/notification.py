"""In-app notifications — one row per (recipient, event).

Postgres is the source of truth (persist-first, same rule as the chat
layer): the row is committed, THEN best-effort broadcast over the
existing Socket.IO user room so open pages update without a refresh.
A client that missed the socket (tab closed, reconnect) simply reads
the table — the bell's REST list is always authoritative.

``data`` carries the deep-link payload the frontend acts on:
``{kind: 'appointment', appointment_id: …, url: '/dashboard/...'}`` —
``kind`` also tells the client which RTK-Query tags to invalidate so the
page under the toast refreshes live.
"""
import uuid

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.extensions import db
from app.models._base import TenantMixin, utcnow


class Notification(TenantMixin, db.Model):
    __tablename__ = 'notifications'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.user_id', ondelete='CASCADE'),
        nullable=False, index=True,
    )

    # Machine key, e.g. 'appointment_confirmed', 'appointment_booked',
    # 'doctor_approved'. The frontend maps unknown types to a generic card,
    # so new types need no client release.
    type = db.Column(db.String(50), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    body = db.Column(db.Text, nullable=True)
    data = db.Column(JSONB, nullable=True)

    read_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow,
                           nullable=False)

    __table_args__ = (
        # The bell's two hot queries: newest-first list, and unread count.
        Index('ix_notifications_user_created',
              'tenant_id', 'user_id', 'created_at'),
        Index('ix_notifications_user_unread', 'tenant_id', 'user_id',
              postgresql_where=text('read_at IS NULL')),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'type': self.type,
            'title': self.title,
            'body': self.body,
            'data': self.data or {},
            'read_at': self.read_at.isoformat() if self.read_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<Notification {self.type} user={self.user_id}>"
