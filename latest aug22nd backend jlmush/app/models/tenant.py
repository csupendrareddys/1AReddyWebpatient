"""
Tenant Model - Multi-tenant SaaS foundation.

Each tenant is a customer organisation, or the SaaS vendor itself.

Two distinct flags, deliberately NOT the same column:

* ``is_platform`` — the SaaS VENDOR tenant. It sells the product and
  consumes none of it, so it is the row that bypasses plan entitlement
  and seat limits.
* ``is_default``  — the tenant an anonymous request falls back to when
  the request host does not resolve to anything.

They may point at the same row, but they answer different questions.
Conflating them is what let the apex tenant be both the seller and a
fully-exempt customer at the same time.
"""
import uuid

from sqlalchemy.dialects.postgresql import UUID, JSON
from sqlalchemy.orm import validates
from app.extensions import db
from app.models._base import utcnow, TimestampMixin, SoftDeleteMixin
from app.models._enums import TenantStatus


class Tenant(db.Model, TimestampMixin, SoftDeleteMixin):
    """
    Root entity for multi-tenant isolation.

    - slug: subdomain identifier (e.g., ``clinic-xyz`` -> ``clinic-xyz.main.in``)
    - domain: custom domain (e.g., ``clinicxyz.in``), nullable
    - is_platform: exactly one row is True (the SaaS vendor tenant)
    - is_default: exactly one row is True (anonymous-request fallback)
    - settings: JSON for feature flags, config overrides per tenant
    - DNS fields: track Cloudflare-provisioned records so we can
      add/update/delete them in lockstep with the tenant row.
    """
    __tablename__ = 'tenants'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = db.Column(db.String(300), nullable=False)
    slug = db.Column(db.String(100), unique=True, nullable=False, index=True)
    domain = db.Column(db.String(255), unique=True, nullable=True)
    logo_url = db.Column(db.String(500), nullable=True)
    status = db.Column(
        db.Enum(TenantStatus, name='tenantstatus'),
        nullable=False,
        default=TenantStatus.ACTIVE,
        index=True,
    )
    settings = db.Column(JSON, nullable=True)
    is_default = db.Column(db.Boolean, nullable=False, default=False)

    # The SaaS vendor's own tenant row. Distinct from ``is_default``
    # above: ``is_default`` only answers "where does an unresolved
    # anonymous request land", whereas ``is_platform`` answers "who is
    # the seller". Entitlement bypasses (``FeatureGate.is_enabled``,
    # ``PlanService.require_within_limit``) key on THIS flag, so an
    # ordinary customer tenant that happens to be the fallback is still
    # fully plan-gated.
    is_platform = db.Column(
        db.Boolean, nullable=False, server_default='false', default=False,
    )

    # ── Reseller hierarchy ──────────────────────────────────────────────
    # NULL = a direct customer of the vendor (level 1, or a plain tenant).
    # Set = a SUB-TENANT created by an apex reseller (level 2). Whether a
    # tenant MAY resell is a plan entitlement (plan.kind='apex', see
    # ResellerPolicy) — never a flag here. Depth is capped at 2 by
    # construction: the only writer (the reseller child-create service)
    # requires the creator to be apex, and being apex requires
    # ``parent_tenant_id IS NULL`` — so a child can never become a parent.
    # NEVER writable through generic update payloads
    # (PlatformTenantService.update_tenant denylists it).
    parent_tenant_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('tenants.id', ondelete='RESTRICT',
                      name='fk_tenants_parent_tenant_id'),
        nullable=True, index=True,
    )

    # ── DNS provisioning state (populated by CloudflareDnsService) ──────
    # Full FQDN actually served to browsers, e.g. ``acme.jlmush.com``.
    # Null when DNS is disabled for this tenant (e.g. is_default).
    fqdn = db.Column(db.String(255), nullable=True, index=True)
    # Cloudflare record id for the ``slug`` subdomain CNAME.
    dns_record_id = db.Column(db.String(100), nullable=True)
    # Cloudflare record id for the custom ``domain`` CNAME (if any).
    custom_domain_record_id = db.Column(db.String(100), nullable=True)
    # pending | active | failed | disabled. Kept out of a proper enum to
    # avoid another DB-level enum migration; values are controlled in
    # :mod:`app.services.cloudflare_dns`.
    dns_status = db.Column(db.String(20), nullable=True, index=True)
    dns_error = db.Column(db.Text, nullable=True)
    dns_synced_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # When False, sync_tenant() will NOT create the
    # ``<slug>.<base_domain>`` CNAME — used when a tenant only wants to be
    # reachable via their custom domain. Defaults to True for backward
    # compatibility with every tenant created before this column existed.
    auto_subdomain = db.Column(
        db.Boolean, nullable=False, server_default='true', default=True,
    )

    # ── Custom-domain ownership verification ───────────────────────────
    # Before we will route traffic for a tenant's custom domain (e.g.
    # ``ishazen.com``), the tenant must prove they control the DNS for
    # it by adding a TXT record. Same model as Vercel/Netlify/Cloudflare-
    # for-SaaS — prevents an attacker from claiming a domain they don't
    # own and intercepting its traffic via our routing layer.
    #
    # Lifecycle:
    #   pending  → token issued, waiting for verify() to find the TXT
    #   verified → TXT record matched; cloudflare_dns.sync_tenant() may
    #              now provision the custom-domain CNAME
    #   failed   → most recent verify() check did not find a matching
    #              TXT record (NXDOMAIN, no matching value, timeout)
    #   revoked  → previously verified but a periodic re-check could no
    #              longer find the record (domain takeover protection)
    domain_verification_token = db.Column(db.String(80), nullable=True)
    domain_verification_status = db.Column(db.String(20), nullable=True, index=True)
    domain_verified_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # ── Cloudflare for SaaS / Custom Hostnames ─────────────────────────
    # The only custom-domain provisioning provider — Amplify was retired
    # when the SPA moved to Cloudflare Pages.
    #
    # Cloudflare for SaaS Custom Hostname id (UUID-shaped, scoped to a
    # zone). Populated by the first successful POST /custom_hostnames;
    # used as the path segment for every subsequent GET/PATCH/DELETE.
    cf_hostname_id = db.Column(db.String(64), nullable=True)

    # CF Custom Hostname ``status``: pending | active | pending_deployment
    # | pending_blocked | pending_migration | blocked | moved | deleted.
    # Persisted verbatim so the admin UI can render exactly what CF
    # returned (no in-between mapping that drifts as CF adds states).
    cf_hostname_status = db.Column(db.String(40), nullable=True, index=True)

    # CF SSL substatus on the same Custom Hostname row:
    # pending_validation | pending_issuance | pending_deployment |
    # active | expired | deleted | pending_deletion. Tracked separately
    # from cf_hostname_status because a hostname can be 'active' while
    # the cert is still 'pending_issuance' — admins need to see both.
    cf_ssl_status = db.Column(db.String(40), nullable=True)

    # Ownership-verification record CF asks the tenant to publish:
    # {"type":"txt","name":"_cf-custom-hostname.<dom>","value":"<token>"}.
    # Persisted verbatim from the CF API response so the DnsInstructionsDialog
    # can render it without reconstruction. Same authoritative-record
    # discipline as domain_verification_token / verification_record_name.
    cf_ownership_verification = db.Column(JSON, nullable=True)

    # SSL DCV validation records, list of:
    #   [{"txt_name": "_acme-challenge....", "txt_value": "...",
    #     "http_url": "...", "http_body": "..."}].
    # We use method='txt' so the txt_* pair is what the tenant publishes;
    # http_* are kept around for future DCV-delegation work.
    cf_ssl_validation_records = db.Column(JSON, nullable=True)

    cf_synced_at = db.Column(db.DateTime(timezone=True), nullable=True)
    cf_error = db.Column(db.Text, nullable=True)

    __table_args__ = (
        # At most one vendor row and at most one fallback row. Partial
        # uniques rather than a CHECK so the DB refuses a second
        # ``is_platform`` tenant outright — a silent duplicate here
        # would hand a customer the entitlement bypass.
        db.Index(
            'ux_tenants_single_platform', 'is_platform',
            unique=True, postgresql_where=db.text('is_platform IS TRUE'),
        ),
        db.Index(
            'ux_tenants_single_default', 'is_default',
            unique=True, postgresql_where=db.text('is_default IS TRUE'),
        ),
        # A tenant can never be its own parent (cycles beyond self are
        # unreachable through the API — see parent_tenant_id comment).
        db.CheckConstraint(
            'parent_tenant_id IS NULL OR parent_tenant_id <> id',
            name='ck_tenants_not_own_parent',
        ),
    )

    parent = db.relationship('Tenant', remote_side='Tenant.id',
                             foreign_keys=[parent_tenant_id])

    @validates('domain')
    def _normalize_domain(self, _key, value):
        # DNS hostnames are case-insensitive, so the canonical form is
        # lowercase. The host resolver lowercases the incoming
        # ``X-Tenant-Host`` header before matching with ``IN (...)``,
        # which is case-sensitive in Postgres — a mixed-case value
        # stored here would silently miss and fall through to the
        # default-tenant fallback.
        if value is None:
            return None
        return value.strip().lower() or None

    def __repr__(self):
        return f"<Tenant {self.slug} ({self.name})>"

    def to_dict(self):
        # ``plan`` is stored under ``settings['plan']`` so we don't need
        # a column migration. Surface it at the top level so the
        # frontend can render it without digging into the JSON blob.
        plan = (self.settings or {}).get('plan', 'starter') if self.settings else 'starter'

        # Derive routing state for both records so the UI can render a
        # chip per record independent of the single ``dns_status`` field
        # (which only ever reflects the most recent ``sync_tenant`` run).
        # ``subdomain_routing`` — the platform-managed ``<slug>.<base>`` CNAME.
        if self.is_platform:
            subdomain_routing = 'platform'
        elif not self.auto_subdomain:
            subdomain_routing = 'disabled'
        elif self.dns_record_id:
            subdomain_routing = 'active'
        elif self.dns_status == 'failed':
            subdomain_routing = 'failed'
        else:
            subdomain_routing = 'pending'

        # ``custom_domain_routing`` — tenant-supplied custom domain.
        if not self.domain:
            custom_routing = 'none'
        elif self.domain_verification_status != 'verified':
            custom_routing = 'unverified'
        elif self.custom_domain_record_id:
            custom_routing = 'in_zone_active'   # we manage the CNAME
        else:
            custom_routing = 'out_of_zone_pending'  # tenant must add CNAME

        return {
            'id': str(self.id),
            'name': self.name,
            'slug': self.slug,
            'domain': self.domain,
            'logo_url': self.logo_url,
            'status': self.status.value,
            'settings': self.settings,
            'plan': plan,
            'is_default': self.is_default,
            'is_platform': self.is_platform,
            'parent_tenant_id': (str(self.parent_tenant_id)
                                 if self.parent_tenant_id else None),
            'auto_subdomain': self.auto_subdomain,
            # DNS surfaces so the PLATFORM_OWNER UI can show a tenant's
            # actual public URL and whether provisioning succeeded.
            'fqdn': self.fqdn,
            'dns_status': self.dns_status,
            'dns_error': self.dns_error,
            'dns_synced_at': self.dns_synced_at.isoformat() if self.dns_synced_at else None,
            'domain_verification_status': self.domain_verification_status,
            'domain_verification_token': self.domain_verification_token,
            'domain_verified_at': (
                self.domain_verified_at.isoformat()
                if self.domain_verified_at else None
            ),
            'dns_record_id': self.dns_record_id,
            'subdomain_routing': subdomain_routing,
            'custom_domain_record_id': self.custom_domain_record_id,
            'custom_domain_routing': custom_routing,
            # Cloudflare for SaaS surface — Amplify was retired, this is
            # the only hosting provider. Empty/None until a tenant's
            # domain has been provisioned via DomainVerificationService.
            'cf_hostname_id': self.cf_hostname_id,
            'cf_hostname_status': self.cf_hostname_status,
            'cf_ssl_status': self.cf_ssl_status,
            'cf_ownership_verification': self.cf_ownership_verification,
            'cf_ssl_validation_records': self.cf_ssl_validation_records or [],
            'cf_synced_at': self.cf_synced_at.isoformat() if self.cf_synced_at else None,
            'cf_error': self.cf_error,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
