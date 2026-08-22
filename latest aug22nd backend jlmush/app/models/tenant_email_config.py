"""Per-tenant email configuration — sender identity + template overrides.

The email twin of :mod:`app.models.tenant_sms_config`, and deliberately its
mirror image so the two rails read the same way. By default every tenant's
mail goes out on the VENDOR's identity: the common ``notification_templates``
registry under ``channel='email'``, from the platform's configured
``SENDCLEAN_FROM_EMAIL``/``SENDCLEAN_FROM_NAME``, with the tenant's display
name interpolated into ``{company_name}``.

A tenant whose plan grants ``communication.custom_email`` may instead send
under their OWN identity and wording. Purposes they haven't customised fall
back to the common registry per-purpose, so a partial config degrades
gracefully rather than leaving a purpose with no body at all.

Where this deliberately DIVERGES from the SMS twin
--------------------------------------------------
SMS is DLT-locked: a body is legally bound to the principal entity whose
header ships it, so the SMS rail needs the tenant's own Combirds account and
API key before it may send anything. Email has no such registration — the
same SendClean credentials send from any verified domain, and
``from_email``/``from_name`` are already per-message parameters. So:

* there is NO encrypted credential here — nothing per-tenant to hold;
* readiness is about the sending DOMAIN being verified with the provider,
  which happens in SendClean's portal, not in this table. ``from_email`` is
  therefore an operator-confirmed value, and sending falls back to the vendor
  identity whenever it is absent.

That asymmetry is the point: tenant email is cheap to switch on, tenant SMS
is not.
"""
import uuid

from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.extensions import db
from app.models._base import (
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin,
)


class TenantEmailConfig(TenantMixin, db.Model, TimestampMixin,
                        SoftDeleteMixin, AuditMixin):
    """One row per tenant (partial-unique on ``tenant_id``)."""
    __tablename__ = 'tenant_email_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # The tenant's opt-in. Plan-gated at read time — flipping the plan off
    # silently returns the tenant to the vendor rail without data loss.
    use_own_email = db.Column(db.Boolean, nullable=False, default=False,
                              server_default=db.text('false'))

    # Sender identity. Both are per-message parameters on the SendClean
    # payload, so no extra credentials are needed — but the domain of
    # ``from_email`` MUST be verified in SendClean or the provider rejects
    # the send, which is why ``domain_verified`` is recorded explicitly
    # rather than inferred from the address.
    from_email = db.Column(db.String(255), nullable=True)
    from_name = db.Column(db.String(120), nullable=True)
    reply_to = db.Column(db.String(255), nullable=True)

    # Operator-confirmed: the sending domain is Verified (Domain/DKIM/SPF)
    # in the SendClean portal. False here means "configured but not proven",
    # and the rail stays on the vendor identity.
    domain_verified = db.Column(db.Boolean, nullable=False, default=False,
                                server_default=db.text('false'))

    # Per-purpose overrides, mirroring TenantSmsConfig.templates:
    #   { "<purpose>": { "subject": "...", "body_template": "...",
    #                    "variable_names": ["otp", ...] } }
    # Purposes absent here fall back to the common registry.
    templates = db.Column(JSONB, nullable=True)

    is_active = db.Column(db.Boolean, nullable=False, default=True,
                          server_default=db.text('true'))

    __table_args__ = (
        db.Index(
            'ux_tenant_email_configs_tenant',
            'tenant_id',
            unique=True,
            postgresql_where=db.text('is_deleted = false'),
        ),
    )

    @property
    def own_sender_ready(self) -> bool:
        """Structurally able to send under the tenant's own identity.
        (The plan gate is checked separately at send time.)

        Requires ``domain_verified`` because an unverified sending domain is
        rejected by the provider — sending anyway would turn a cosmetic
        setting into undelivered mail.
        """
        return bool(
            self.is_active
            and self.use_own_email
            and self.from_email
            and self.domain_verified
        )

    @property
    def has_template_overrides(self) -> bool:
        return bool(self.is_active and self.templates)

    @classmethod
    def for_tenant(cls, tenant_id):
        if not tenant_id:
            return None
        return cls.query.filter_by(
            tenant_id=tenant_id, is_deleted=False,
        ).first()

    def to_dict(self):
        return {
            'id': str(self.id),
            'is_active': self.is_active,
            'use_own_email': self.use_own_email,
            'from_email': self.from_email,
            'from_name': self.from_name,
            'reply_to': self.reply_to,
            'domain_verified': self.domain_verified,
            'templates': self.templates or {},
            'ready': self.own_sender_ready,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return (f"<TenantEmailConfig tenant={self.tenant_id} "
                f"own_email={self.use_own_email}>")
