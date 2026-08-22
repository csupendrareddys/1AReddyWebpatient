"""Per-tenant DLT / SMS configuration.

By default every tenant sends SMS through the VENDOR's DLT registration:
the common ``notification_templates`` registry (vendor's sender header +
vendor-approved template ids) over the platform Combirds API key, with the
tenant's display name interpolated into ``{company_name}``.

A tenant whose plan grants ``communication.custom_sms`` may instead bring
their OWN DLT account: their sender header, their Combirds API key, and
their own DLT-approved template ids/bodies per purpose. Purposes they
haven't configured fall back to the common rail (a body approved under the
vendor's principal entity can't legally ship under the tenant's header, so
partial configs degrade to the vendor rail per-purpose, loudly logged).

Secrets are encrypted at rest like every other tenant credential.
"""
import uuid

from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.extensions import db
from app.models._base import (
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin,
)


class TenantSmsConfig(TenantMixin, db.Model, TimestampMixin,
                      SoftDeleteMixin, AuditMixin):
    """One row per tenant (partial-unique on ``tenant_id``)."""
    __tablename__ = 'tenant_sms_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # The tenant's opt-in. Plan-gated at read time — flipping the plan off
    # silently returns the tenant to the common rail without data loss.
    use_own_dlt = db.Column(db.Boolean, nullable=False, default=False,
                            server_default=db.text('false'))

    # DLT-approved sender header of the tenant's own principal entity.
    sender_id = db.Column(db.String(20), nullable=True)

    _combirds_api_key_encrypted = db.Column(db.Text, nullable=True)
    # Optional endpoint override; NULL → platform ``COMBIRDS_SMS_URL``.
    combirds_sms_url = db.Column(db.String(300), nullable=True)

    # Per-purpose overrides:
    #   { "<purpose>": { "template_id": "...", "body_template": "...",
    #                    "variable_names": ["otp", ...] } }
    # Purposes absent here fall back to the common registry (vendor rail).
    templates = db.Column(JSONB, nullable=True)

    is_active = db.Column(db.Boolean, nullable=False, default=True,
                          server_default=db.text('true'))

    __table_args__ = (
        db.Index(
            'ux_tenant_sms_configs_tenant',
            'tenant_id',
            unique=True,
            postgresql_where=db.text('is_deleted = false'),
        ),
    )

    @property
    def combirds_api_key(self):
        if not self._combirds_api_key_encrypted:
            return None
        try:
            from app.common.encryption import decrypt
            return decrypt(self._combirds_api_key_encrypted)
        except Exception:  # pragma: no cover — bad key / corrupt blob
            return None

    @combirds_api_key.setter
    def combirds_api_key(self, value):
        if not value:
            self._combirds_api_key_encrypted = None
            return
        from app.common.encryption import encrypt
        self._combirds_api_key_encrypted = encrypt(value)

    @property
    def own_dlt_ready(self) -> bool:
        """Structurally able to send on the tenant's own DLT account.
        (The plan gate is checked separately at send time.)"""
        return bool(
            self.is_active
            and self.use_own_dlt
            and self.sender_id
            and self._combirds_api_key_encrypted
        )

    @classmethod
    def for_tenant(cls, tenant_id):
        if not tenant_id:
            return None
        return cls.query.filter_by(
            tenant_id=tenant_id, is_deleted=False,
        ).first()

    def to_dict(self):
        """Admin-facing shape — the API key never leaves the server."""
        return {
            'id': str(self.id),
            'is_active': self.is_active,
            'use_own_dlt': self.use_own_dlt,
            'sender_id': self.sender_id,
            'has_api_key': bool(self._combirds_api_key_encrypted),
            'combirds_sms_url': self.combirds_sms_url,
            'templates': self.templates or {},
            'ready': self.own_dlt_ready,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return (f"<TenantSmsConfig tenant={self.tenant_id} "
                f"own_dlt={self.use_own_dlt}>")
