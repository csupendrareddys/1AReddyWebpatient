"""
NotificationTemplate
====================
Platform-wide registry of DLT-approved (and future email/WhatsApp) message
templates, keyed by ``purpose`` (e.g. ``login_otp``, ``signup_otp``,
``appointment_reminder``).

Why a table, not env vars
-------------------------
A SaaS healthcare platform routinely needs hundreds of transactional
templates (OTPs, billing, appointments, prescriptions, follow-ups, …).
Holding each one's DLT template ID + body in ``.env`` makes the env
unmaintainable and forces a redeploy every time a template changes — DLT
re-approvals happen frequently as wording is tweaked.

This table is the source of truth for "given a purpose, what should the
message body, sender header, and DLT template ID be?". Rows are seeded
via Alembic for the core auth flows; new ones can be added at runtime
through an admin endpoint without a redeploy.

Caching
-------
Reads are 1× per outbound message — too hot to hit Postgres each time.
The ``SMSService`` caches lookups in Redis (``sms_template:<purpose>``,
5-minute TTL) and invalidates the entry whenever a row is updated.

Tenant scope
------------
Templates are PLATFORM-LEVEL, not tenant-scoped. The DLT Principal Entity
is registered to LARAZN; all tenants share that single approval surface.
The tenant's display name is interpolated into the body via the
``{company_name}`` variable at send time — that's how the SaaS abstraction
holds without re-registering templates per tenant.
"""
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import expression
import uuid

from app.extensions import db
from app.models._base import TimestampMixin, utcnow


class NotificationTemplate(db.Model, TimestampMixin):
    __tablename__ = 'notification_templates'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Stable machine-key (e.g. ``login_otp``). Application code looks up
    # templates by this string — never by display name or DB id.
    # NOTE: purpose is unique only WITHIN a channel — the same purpose
    # (e.g. ``reset_pw``) can have one row for SMS and another for email,
    # rendered differently. The composite unique on (channel, purpose)
    # is created in the migration.
    purpose = db.Column(db.String(80), nullable=False, index=True)

    # Human-readable label for the admin UI.
    name = db.Column(db.String(200), nullable=False)

    # 'sms' for SMS via Combirds, 'email' for email via SendClean.
    # 'whatsapp' is a future extension point.
    channel = db.Column(db.String(20), nullable=False, default='sms', index=True)

    # DLT-approved template id (the long digit string from the DLT portal).
    # Required for SMS; emit/empty for non-SMS channels that don't need one.
    template_id = db.Column(db.String(100), nullable=True)

    # DLT-approved sender header / Principal Entity (e.g. ``LARAZN``).
    # For email rows this doubles as the from-name fallback when env
    # ``SENDCLEAN_FROM_NAME`` is unset.
    sender_id = db.Column(db.String(20), nullable=False, default='LARAZN')

    # Email subject line (with ``{var}`` placeholders). NULL for SMS.
    subject = db.Column(db.Text, nullable=True)

    # Python ``str.format``-style body. Variables are referenced by name:
    # ``"{otp} is your OTP to log in to {company_name}. ..."``. Names
    # listed in ``variable_names`` MUST match the placeholders here, in
    # the same order as the ``{#var#}`` slots in the DLT-approved body
    # (for SMS) or the merge fields used by your email designer.
    # SMS rows hold plain text; email rows hold HTML.
    body_template = db.Column(db.Text, nullable=False)

    # Ordered list of variable names. Documents what the caller is
    # expected to pass and what order DLT approved the variables in.
    # Stored as JSON array of strings: ``["otp", "company_name"]``.
    variable_names = db.Column(JSONB, nullable=False, default=list)

    # Soft on/off switch — preferred over deleting rows so we keep
    # history of what was approved when.
    is_active = db.Column(
        db.Boolean, nullable=False, server_default=expression.true(), index=True
    )

    # Free-form note for the admin UI (e.g. "DLT approval pending —
    # do not enable until template_id is filled").
    notes = db.Column(db.Text, nullable=True)

    __table_args__ = (
        db.Index('ix_notification_templates_channel_active', 'channel', 'is_active'),
        # Composite unique — same purpose can have one SMS + one email row,
        # but not two of the same channel. Migration f6a7b8c9d0e1 creates
        # the constraint via Alembic; this entry mirrors it on the model so
        # ``db.create_all()`` (used in the bootstrap path) builds an
        # equivalent schema. Required for ``ON CONFLICT (channel, purpose)``
        # in seed scripts to work on freshly-bootstrapped DBs.
        db.UniqueConstraint(
            'channel', 'purpose',
            name='uq_notification_templates_channel_purpose',
        ),
    )

    def __repr__(self):
        return f"<NotificationTemplate {self.purpose} channel={self.channel}>"

    def to_dict(self):
        return {
            'id': str(self.id),
            'purpose': self.purpose,
            'name': self.name,
            'channel': self.channel,
            'template_id': self.template_id,
            'sender_id': self.sender_id,
            'subject': self.subject,
            'body_template': self.body_template,
            'variable_names': self.variable_names or [],
            'is_active': self.is_active,
            'notes': self.notes,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
