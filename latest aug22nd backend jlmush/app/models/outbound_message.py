"""Transactional outbox for provider sends (SMS / email / device push).

The delivery-durability rail: instead of calling Combirds/SendClean/Expo
inside the request (10s timeouts that block workers, failures that are
log lines at best), notification-class sends become ROWS — written in
the caller's transaction where possible, attempted immediately after
commit by a background thread, and retried with exponential backoff by
the scheduler sweep until they send, expire, or dead-letter. Failures
are queryable data:

    SELECT * FROM outbound_messages WHERE status IN ('failed','dead');

Deliberately NOT queued: OTP sends where a user is waiting at a form —
those stay synchronous and fail-closed (the whole point is the user
retries NOW, not in a backoff window). OTP-carrying *emails* that are
secondary channels (reset_pw_email) do queue, with ``expires_at`` so a
stale code is never delivered after it stopped working.

Like ``notifications`` (its closest cousin) this is TenantMixin-only —
plus TimestampMixin because the claim protocol uses ``updated_at`` to
recover rows stuck in 'sending' after a crash. No RLS policy: the sweep
reads across tenants by design; writes always set tenant_id explicitly.
"""
import uuid

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.extensions import db
from app.models._base import TenantMixin, TimestampMixin, utcnow


# Status machine: pending → sending → sent
#                              ↘ failed (retry later) → sending → …
#                                        ↘ dead (gave up / expired)
OUTBOX_PENDING = 'pending'
OUTBOX_SENDING = 'sending'   # claimed by a deliverer right now
OUTBOX_SENT = 'sent'
OUTBOX_FAILED = 'failed'     # will retry at next_attempt_at
OUTBOX_DEAD = 'dead'         # max attempts or expired — needs a human


class OutboundMessage(TenantMixin, db.Model, TimestampMixin):
    __tablename__ = 'outbound_messages'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    channel = db.Column(db.String(10), nullable=False)   # sms | email | push
    # Phone number / email address; for push, the target user id (the
    # deliverer resolves device tokens at send time — tokens rot).
    recipient = db.Column(db.String(320), nullable=False)
    # notification_templates purpose (sms/email) or notification type (push).
    purpose = db.Column(db.String(80), nullable=False)
    # Channel-specific call arguments, replayable at delivery time:
    #   sms:   {variables: {...}}
    #   email: {recipient_name: ..., variables: {...}}
    #   push:  {user_id: ..., title: ..., body: ..., data: {...}}
    payload = db.Column(JSONB, nullable=False, default=dict)

    status = db.Column(db.String(10), nullable=False,
                       default=OUTBOX_PENDING, server_default='pending',
                       index=True)
    attempts = db.Column(db.SmallInteger, nullable=False, default=0,
                         server_default='0')
    next_attempt_at = db.Column(db.DateTime(timezone=True), nullable=False,
                                default=utcnow, index=True)
    # OTP/token-carrying messages stop being worth delivering; NULL = no expiry.
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_error = db.Column(db.Text, nullable=True)
    sent_at = db.Column(db.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        db.CheckConstraint("channel IN ('sms','email','push')",
                           name='ck_outbound_messages_channel'),
        db.CheckConstraint(
            "status IN ('pending','sending','sent','failed','dead')",
            name='ck_outbound_messages_status'),
        # The sweep's working set — everything not in a terminal state.
        Index('ix_outbound_messages_due', 'next_attempt_at',
              postgresql_where=text(
                  "status IN ('pending','failed','sending')")),
    )

    def to_dict(self):
        return {
            'id': str(self.id),
            'tenant_id': str(self.tenant_id) if self.tenant_id else None,
            'channel': self.channel,
            'recipient': self.recipient,
            'purpose': self.purpose,
            'status': self.status,
            'attempts': self.attempts,
            'next_attempt_at': (self.next_attempt_at.isoformat()
                                if self.next_attempt_at else None),
            'expires_at': (self.expires_at.isoformat()
                           if self.expires_at else None),
            'last_error': self.last_error,
            'sent_at': self.sent_at.isoformat() if self.sent_at else None,
            'created_at': (self.created_at.isoformat()
                           if self.created_at else None),
        }

    def __repr__(self):
        return (f"<OutboundMessage {self.channel}:{self.purpose} "
                f"to={self.recipient} status={self.status}>")
