"""Per-tenant payment gateway credentials.

Two rails, deliberately separate:

  * **Collection** (patient → tenant): the tenant's own Razorpay account.
    There is NO platform-key fallback — a tenant without keys cannot take
    marketplace payments at all. Tenant money must never land in the
    platform's Razorpay account.
  * **Payout** (tenant → doctor): the tenant's own Cashfree Payouts account.
    Unconfigured tenants keep the manual-settle behaviour.

The SaaS vendor's own Razorpay account (subscription billing, i.e. tenant →
vendor) stays on env vars and never reads this table — see
``PaymentResolver.vendor_gateway``.

Secrets are encrypted at rest with the same ``app.common.encryption``
primitives as ``User.email`` / ``User.phone_number``. ``*_key_id`` /
``*_client_id`` are public identifiers and stay plain.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID

from app.extensions import db
from app.models._base import (
    TenantMixin, TimestampMixin, SoftDeleteMixin, AuditMixin,
)


def _mask(value):
    """``rzp_test_a1b2c3d4`` → ``rzp_…c3d4`` — enough to recognise, useless
    to replay."""
    if not value:
        return None
    if len(value) <= 8:
        return value[:2] + '…'
    return value[:4] + '…' + value[-4:]


class TenantPaymentConfig(TenantMixin, db.Model, TimestampMixin,
                          SoftDeleteMixin, AuditMixin):
    """One row per tenant (partial-unique on ``tenant_id``)."""
    __tablename__ = 'tenant_payment_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # ── Razorpay (collection) ────────────────────────────────────────
    razorpay_key_id = db.Column(db.String(100), nullable=True)
    _razorpay_key_secret_encrypted = db.Column(db.Text, nullable=True)
    _razorpay_webhook_secret_encrypted = db.Column(db.Text, nullable=True)

    # ── Cashfree Payouts (disbursal) ─────────────────────────────────
    cashfree_env = db.Column(db.String(20), nullable=False, default='sandbox',
                             server_default='sandbox')
    cashfree_client_id = db.Column(db.String(100), nullable=True)
    _cashfree_client_secret_encrypted = db.Column(db.Text, nullable=True)

    is_active = db.Column(db.Boolean, nullable=False, default=True,
                          server_default=db.text('true'))
    collection_verified_at = db.Column(db.DateTime(timezone=True), nullable=True)
    payout_verified_at = db.Column(db.DateTime(timezone=True), nullable=True)

    __table_args__ = (
        db.Index(
            'ux_tenant_payment_configs_tenant',
            'tenant_id',
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
    def razorpay_key_secret(self):
        return self._decrypt(self._razorpay_key_secret_encrypted)

    @razorpay_key_secret.setter
    def razorpay_key_secret(self, value):
        self._razorpay_key_secret_encrypted = self._encrypt(value)

    @property
    def razorpay_webhook_secret(self):
        return self._decrypt(self._razorpay_webhook_secret_encrypted)

    @razorpay_webhook_secret.setter
    def razorpay_webhook_secret(self, value):
        self._razorpay_webhook_secret_encrypted = self._encrypt(value)

    @property
    def cashfree_client_secret(self):
        return self._decrypt(self._cashfree_client_secret_encrypted)

    @cashfree_client_secret.setter
    def cashfree_client_secret(self, value):
        self._cashfree_client_secret_encrypted = self._encrypt(value)

    # ── Readiness ────────────────────────────────────────────────────

    @property
    def collection_ready(self) -> bool:
        """Can this tenant take Razorpay payments?"""
        return bool(
            self.is_active
            and self.razorpay_key_id
            and self._razorpay_key_secret_encrypted
        )

    @property
    def payout_ready(self) -> bool:
        """Can this tenant disburse via Cashfree Payouts?"""
        return bool(
            self.is_active
            and self.cashfree_client_id
            and self._cashfree_client_secret_encrypted
        )

    @classmethod
    def for_tenant(cls, tenant_id):
        """The tenant's live config row, or None."""
        if not tenant_id:
            return None
        return cls.query.filter_by(
            tenant_id=tenant_id, is_deleted=False, is_active=True,
        ).first()

    def to_dict(self):
        """Admin-facing shape. Secrets NEVER leave the server — only masked
        identifiers and has-* booleans."""
        return {
            'id': str(self.id),
            'is_active': self.is_active,
            'razorpay': {
                'key_id': self.razorpay_key_id,
                'key_secret_masked': _mask(self.razorpay_key_secret),
                'has_key_secret': bool(self._razorpay_key_secret_encrypted),
                'has_webhook_secret': bool(self._razorpay_webhook_secret_encrypted),
                'ready': self.collection_ready,
                'verified_at': (
                    self.collection_verified_at.isoformat()
                    if self.collection_verified_at else None
                ),
            },
            'cashfree': {
                'env': self.cashfree_env,
                'client_id': self.cashfree_client_id,
                'has_client_secret': bool(self._cashfree_client_secret_encrypted),
                'ready': self.payout_ready,
                'verified_at': (
                    self.payout_verified_at.isoformat()
                    if self.payout_verified_at else None
                ),
            },
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f"<TenantPaymentConfig tenant={self.tenant_id} active={self.is_active}>"
