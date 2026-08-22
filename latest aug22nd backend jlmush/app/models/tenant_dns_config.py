"""Per-apex-reseller Cloudflare zone credentials (reseller P4).

An APEX reseller brings its OWN Cloudflare zone: once this config is
ready, the reseller's child tenants provision their slug records inside
the apex's zone (``<child-slug>.<base_domain>``) using the apex's API
token — instead of the platform zone placeholder they launched with.

Opt-in by design: an apex without a ready config keeps getting platform
-zone children exactly as before, and existing children are moved only
by the explicit migration script / resync — connecting a zone must
never silently re-home live hostnames.

Unlike most tenant-scoped tables this one is read BEFORE the request's
tenant context exists (host→tenant resolution matches
``<slug>.<base_domain>`` against it), so it deliberately carries no RLS
policy; the admin API scopes access via ``current_tenant_id_strict``,
same boundary as ``TenantPaymentConfig``. The token is Fernet-encrypted
at rest with the same ``app.common.encryption`` primitives.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import (
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin,
)


class TenantDnsConfig(TenantMixin, db.Model, TimestampMixin,
                      SoftDeleteMixin, AuditMixin):
    """One live row per apex tenant; ``base_domain`` is globally unique
    among live rows — two resellers claiming one zone would make
    ``<slug>.<zone>`` host resolution ambiguous."""
    __tablename__ = 'tenant_dns_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # The zone apex children live under (``larazen.in``). Lowercased by
    # the admin API validator; DNS is case-insensitive.
    base_domain = db.Column(db.String(255), nullable=True)
    zone_id = db.Column(db.String(64), nullable=True)
    _api_token_encrypted = db.Column(db.Text, nullable=True)

    # Optional per-reseller ingress override. NULL → the platform's
    # CLOUDFLARE_INGRESS_TARGET (children ride the same edge either way;
    # the override exists for future dedicated-ingress setups).
    ingress_target = db.Column(db.String(255), nullable=True)
    proxied = db.Column(db.Boolean, nullable=False, default=False,
                        server_default=db.text('false'))

    is_active = db.Column(db.Boolean, nullable=False, default=True,
                          server_default=db.text('true'))
    verified_at = db.Column(db.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        db.Index(
            'ux_tenant_dns_configs_tenant',
            'tenant_id',
            unique=True,
            postgresql_where=db.text('is_deleted = false'),
        ),
        db.Index(
            'ux_tenant_dns_configs_base_domain',
            'base_domain',
            unique=True,
            postgresql_where=db.text('is_deleted = false'),
        ),
    )

    # ── Encrypted-secret accessors ───────────────────────────────────

    @staticmethod
    def _decrypt(blob):
        if not blob:
            return None
        try:
            from app.common.encryption import decrypt
            return decrypt(blob)
        except Exception:  # pragma: no cover — bad key / corrupt blob
            return None

    @staticmethod
    def _encrypt(value):
        if not value:
            return None
        from app.common.encryption import encrypt
        return encrypt(value)

    @property
    def api_token(self):
        return self._decrypt(self._api_token_encrypted)

    @api_token.setter
    def api_token(self, value):
        self._api_token_encrypted = self._encrypt(value)

    # ── Readiness ────────────────────────────────────────────────────

    @property
    def dns_ready(self) -> bool:
        """Can children provision under this zone?"""
        return bool(
            self.is_active
            and self.base_domain
            and self.zone_id
            and self._api_token_encrypted
        )

    @classmethod
    def for_tenant(cls, tenant_id):
        """The apex's live config row, or None."""
        if not tenant_id:
            return None
        return cls.query.filter_by(
            tenant_id=tenant_id, is_deleted=False, is_active=True,
        ).first()

    @classmethod
    def for_base_domain(cls, base_domain):
        """The live+active config owning this zone apex, or None. Used
        by host resolution and CORS — both run pre-tenant-context."""
        if not base_domain:
            return None
        return cls.query.filter_by(
            base_domain=base_domain.strip().lower(),
            is_deleted=False, is_active=True,
        ).first()

    def to_dict(self):
        """Admin-facing shape — the token never leaves the server."""
        return {
            'id': str(self.id),
            'is_active': self.is_active,
            'base_domain': self.base_domain,
            'zone_id': self.zone_id,
            'has_api_token': bool(self._api_token_encrypted),
            'ingress_target': self.ingress_target,
            'proxied': self.proxied,
            'ready': self.dns_ready,
            'verified_at': (
                self.verified_at.isoformat() if self.verified_at else None
            ),
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return (f"<TenantDnsConfig tenant={self.tenant_id} "
                f"zone={self.base_domain} active={self.is_active}>")
