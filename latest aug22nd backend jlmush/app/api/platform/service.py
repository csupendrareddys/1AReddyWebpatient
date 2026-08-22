"""Service layer for platform (owner) operations.

Tenant CRUD + per-tenant permission allocation that gates the
landing-page editor modules each tenant's SUPER_ADMIN can use.

PLATFORM_OWNER is the only caller — authorisation is enforced at the
route level via ``@role_required(UserRole.PLATFORM_OWNER)``.
"""
from flask_jwt_extended import current_user

from app.extensions import db
from app.common.tenant_context import with_tenant_context
from app.models import (
    Tenant, TenantStatus, TenantPermissionAllocation,
    LandingConfig, LandingModule, LandingFeature, ConfigStatus,
    User, UserRole,
)
from app.services.cloudflare_dns import (
    CloudflareDnsService, DNS_PENDING,
)
from app.services.domain_verification import DomainVerificationService
from app.services.cloudflare_saas import (
    CloudflareSaasService, CloudflareNotConfigured,
    is_configured as cloudflare_saas_is_configured,
)


from app.api.landing_page_config.default_fields import (
    get_default_hero, get_default_modules,
)


class PlatformTenantService:
    @staticmethod
    def list_tenants(include_deleted=False):
        # CUSTOMER tenants only. The vendor row (is_platform=True) is the
        # SaaS seller itself: it authors plans, never subscribes to one, and
        # owns no product data — showing it in the tenants console produced
        # a nonsense row ("no subscription", "CF: not provisioned") and
        # invited managing the vendor through customer-tenant flows. The
        # vendor manages its own domain/branding via its own self-service
        # surfaces, not this list. Every tenant returned here is expected
        # to carry a subscription.
        query = Tenant.query.filter_by(is_platform=False)
        if not include_deleted:
            query = query.filter_by(is_deleted=False)
        return query.order_by(Tenant.created_at.desc()).all()

    @staticmethod
    def get_tenant(tenant_id, include_deleted=False):
        query = Tenant.query.filter_by(id=tenant_id)
        if not include_deleted:
            query = query.filter_by(is_deleted=False)
        return query.first()

    @staticmethod
    def create_tenant(payload):
        # ── Identifier resolution ────────────────────────────────
        # Either ``slug`` or ``domain`` (or both) must be supplied.
        # When only ``domain`` is given, derive a slug from it so the
        # rest of the system (JWT claims, internal lookups, log lines)
        # has a stable short identifier without having to make ``slug``
        # nullable at the DB level.
        slug = (payload.get('slug') or '').strip().lower() or None
        domain = (payload.get('domain') or '').strip().lower() or None
        if not slug and not domain:
            raise ValueError(
                'Provide a slug, a custom domain, or both — at least one is required.'
            )
        if not slug:
            slug = PlatformTenantService._slug_from_domain(domain)

        # ── Duplicate check, with soft-delete-aware free-up ──────
        # The DB has ``unique=True`` on both ``slug`` and ``domain``.
        # A soft-deleted row keeps occupying the value, so the
        # operator hits "already exists" even after deleting. Rename
        # the dead row out of the way to free the value.
        PlatformTenantService._free_or_reject('slug', slug)
        if domain:
            PlatformTenantService._free_or_reject('domain', domain)

        # Resolve Plan up-front (before INSERT) so a bad plan_code is a
        # clean 4xx rather than a partial create. Falls back to the
        # ``is_default=True`` plan when none is supplied — keeps the
        # legacy "create without plan" call path working without
        # leaving the tenant subscription-less (PlanService.resolve
        # raises NoActiveSubscription otherwise).
        #
        # ``_plan`` (a resolved Plan object) short-circuits resolution —
        # used by the reseller child-create path, whose plan lives in the
        # APEX owner's namespace, not the vendor catalog this resolver
        # is pinned to.
        plan = payload.get('_plan') or PlatformTenantService._resolve_plan_for_create(
            payload.get('plan_code'),
        )

        tenant = Tenant(
            name=payload['name'],
            slug=slug,
            domain=domain,
            logo_url=payload.get('logo_url'),
            settings=payload.get('settings'),
            status=TenantStatus.ACTIVE,
            # Reseller parentage — set ONLY by the reseller child-create
            # service (which validated apex-ness + quota first); the
            # platform console never sends it and update_tenant denylists it.
            parent_tenant_id=payload.get('parent_tenant_id'),
            # Optimistic DNS state — flipped by sync_tenant below.
            dns_status=DNS_PENDING,
            # Honour the operator's choice when supplied; column default
            # (True) covers omitted/legacy callers.
            auto_subdomain=payload.get('auto_subdomain', True),
        )
        db.session.add(tenant)
        db.session.flush()
        _seed_tenant_landing(tenant.id)

        if plan is not None:
            PlatformTenantService._create_subscription(
                tenant_id=tenant.id, plan=plan,
                cycle_str=payload.get('billing_cycle', 'monthly'),
            )

        # When a custom domain was supplied, issue the TXT challenge in
        # the same transaction. Without this the operator would see the
        # DNS dialog pop up with an empty token and the Verify button
        # would 400 with "No pending domain verification — call
        # set_domain first." (which is exactly the bug we're fixing).
        # ``set_pending`` commits internally, which also commits the
        # tenant + landing seed + subscription — that's fine and is the
        # same pattern the public-signup path uses.
        #
        # We intentionally do NOT call ``CloudflareSaasService.create_or_update``
        # here. Pages Custom Domain slots are capped per project (100 on
        # the free tier) — burning a slot before ownership is proven
        # means a bad-actor sign-up flow could exhaust the cap. The CF
        # binding happens in ``verify_domain`` once the TXT proves the
        # operator/tenant actually owns the domain.
        if domain:
            DomainVerificationService.set_pending(tenant, domain)
        else:
            db.session.commit()

        # Provision DNS as a post-commit side effect. Failures are
        # captured on the tenant row (``dns_status='failed'`` +
        # ``dns_error``) and can be retried via the platform retry
        # endpoint; the tenant row itself is never rolled back.
        CloudflareDnsService.sync_tenant(tenant)
        return tenant

    @staticmethod
    def notify_tenant_ready(tenant, user):
        """Best-effort "your workspace is live" email + SMS to a freshly
        created tenant admin. Shared by the platform console's
        create-super-admin route and the reseller child-create service.

        ``company_name`` is passed explicitly because the request runs
        under the CREATOR's tenant context (platform owner / apex admin),
        not the new tenant's — the default resolver would pick the wrong
        name. Never raises.
        """
        try:
            from flask import current_app as _ca
            from app.services.email_service import EmailService
            from app.services.sms_service import SMSService
            from app.services.cloudflare_dns import public_host_for
            # P4: a reseller child on its apex's connected zone must be
            # pointed at ``<slug>.<apex-zone>``, not the platform zone.
            host = public_host_for(tenant)
            if host:
                dashboard_url = f"https://{host}/admin"
            else:
                dashboard_url = (
                    _ca.config.get('FRONTEND_URL', '').rstrip('/') + '/admin'
                )
            company_name = tenant.name or tenant.slug
            EmailService._send_safe(
                'tenant_ready', user,
                dashboard_url=dashboard_url,
                company_name=company_name,
            )
            SMSService.send_tenant_ready_sms(user, company_name=company_name)
        except Exception as e:  # noqa: BLE001 — notification is best-effort
            logger.warning('[TENANT_READY] notification failed: %s', e)

    @staticmethod
    def _slug_from_domain(domain):
        """Derive a slug from a custom domain when the operator didn't
        supply one. ``vedanthzen.com`` -> ``vedanthzen``,
        ``clinic.example.com`` -> ``clinic``,
        ``www.ishazen.com`` -> ``ishazen``. Sanitised + suffixed on
        collision so the operator never has to think about clashes.

        Special-cases a leading ``www.`` prefix — the slug should reflect
        the brand (``ishazen``), not the literal first label (``www``).
        Tenants who explicitly entered ``www.<apex>`` because we recommend
        registering the www variant as the canonical Custom Hostname (no
        wildcard support on the lower SSL-for-SaaS tiers) would otherwise
        end up with ``slug=www``, which collides across every other apex
        tenant.
        """
        import re
        clean = (domain or '').strip('.').lower()
        if clean.startswith('www.') and clean.count('.') >= 2:
            # Strip the ``www.`` so the slug reflects the brand label.
            clean = clean[4:]
        first = clean.split('.')[0]
        candidate = re.sub(r'[^a-z0-9-]+', '-', first.lower())
        candidate = re.sub(r'-+', '-', candidate).strip('-')
        if not candidate or len(candidate) < 2:
            candidate = 'tenant'
        # Suffix until unique against live + soft-deleted rows. Soft-
        # deleted rows are renamed by ``_free_or_reject`` later — but
        # only if the caller asked for that exact value. Auto-derived
        # slugs should not stomp on a soft-deleted row of the same
        # name, so we suffix here.
        base = candidate
        n = 1
        while Tenant.query.filter_by(slug=candidate).first():
            n += 1
            candidate = f'{base}-{n}'
        return candidate

    @staticmethod
    def _free_or_reject(field, value):
        """If a tenant already has ``field=value``:
          * raise ValueError when it's a live row (regular conflict);
          * rename it (suffix ``__deleted-<8hex>``) when it's a soft-
            deleted row, so the operator can re-create with the same
            slug/domain. Renaming is safe — nothing FKs to slug or
            domain, and DNS for the dead row was already torn down on
            the original delete.
        """
        existing = Tenant.query.filter_by(**{field: value}).first()
        if not existing:
            return
        if not existing.is_deleted:
            label = 'slug' if field == 'slug' else 'domain'
            raise ValueError(f'A tenant with {label} "{value}" already exists')
        # Rename the dead row out of the way. Use a stable suffix so
        # repeat-renames are deterministic / readable in audit logs.
        suffix = f'__deleted-{str(existing.id)[:8]}'
        new_value = f'{value}{suffix}'
        # Truncate to fit the column width (slug=100, domain=255).
        max_len = 100 if field == 'slug' else 255
        if len(new_value) > max_len:
            new_value = new_value[:max_len]
        setattr(existing, field, new_value)
        db.session.flush()

    @staticmethod
    def _resolve_plan_for_create(plan_code):
        """Look up the Plan row for ``create_tenant``.

        Order:
          1. Explicit ``plan_code`` from the payload.
          2. The platform's ``is_default=True`` Plan (if seeded).
          3. ``None`` — caller will skip subscription create.

        Mirrors what the public-signup path does; without a subscription,
        every PlanService gate raises ``NoActiveSubscription``.
        """
        from app.models import Plan
        # Vendor catalog only (owner IS NULL): the platform console creates
        # top-level tenants, whose subscriptions must never point at an
        # apex reseller's plans (invariant I1), and with per-owner code
        # namespaces an unscoped code lookup could resolve a foreign row.
        if plan_code:
            plan = Plan.query.filter_by(code=plan_code, is_deleted=False,
                                        owner_tenant_id=None).first()
            if not plan:
                raise ValueError(f'Plan "{plan_code}" not found.')
            return plan
        return Plan.query.filter_by(is_default=True, is_deleted=False,
                                    owner_tenant_id=None).first()

    @staticmethod
    def _create_subscription(tenant_id, plan, cycle_str):
        """Create the tenant's first ``TenantSubscription`` row.

        Pulled into a helper so create_tenant stays compact. Mirrors the
        TRIAL/ACTIVE branching used by the public-signup path
        (app/api/public/service.py) and the platform pricing route
        (app/api/platform/pricing_routes.py:assign_tenant_subscription).
        """
        from datetime import timedelta
        from app.models import TenantSubscription
        from app.models._enums import BillingCycle, SubscriptionStatus
        from app.models._base import utcnow
        from app.common.tenant_context import with_tenant_context

        cycle = BillingCycle(cycle_str or 'monthly')
        now = utcnow()
        period_end = now + timedelta(
            days=365 if cycle == BillingCycle.ANNUAL else 30
        )
        actor_id = current_user.id if current_user else None

        with with_tenant_context(tenant_id):
            from app.api.pricing.plan_catalog_service import build_plan_snapshot
            sub = TenantSubscription(
                tenant_id=tenant_id,
                plan_id=plan.id,
                plan_snapshot=build_plan_snapshot(plan),
                status=(
                    SubscriptionStatus.TRIAL
                    if plan.trial_days and plan.trial_days > 0
                    else SubscriptionStatus.ACTIVE
                ),
                billing_cycle=cycle,
                trial_ends_at=(
                    now + timedelta(days=plan.trial_days)
                    if plan.trial_days and plan.trial_days > 0 else None
                ),
                current_period_start=now,
                current_period_end=period_end,
                activated_by_id=actor_id,
                created_by_id=actor_id,
            )
            db.session.add(sub)
            db.session.flush()
        return sub

    @staticmethod
    def update_tenant(tenant_id, payload):
        tenant = PlatformTenantService.get_tenant(tenant_id)
        if not tenant:
            raise ValueError('Tenant not found')

        old_slug = tenant.slug
        old_domain = tenant.domain
        old_status = tenant.status

        # Structural columns a generic payload must NEVER write: identity,
        # the single-vendor/fallback flags, and reseller parentage (only
        # the reseller child-create service sets parent_tenant_id).
        _DENYLIST = {'id', 'is_platform', 'is_default', 'parent_tenant_id'}
        for key, value in payload.items():
            if key in _DENYLIST:
                continue
            if key == 'status' and isinstance(value, str):
                tenant.status = TenantStatus(value)
            elif hasattr(tenant, key):
                setattr(tenant, key, value)
        db.session.commit()

        # Re-sync DNS when any of the fields that affect the FQDN changed.
        slug_changed = tenant.slug != old_slug
        domain_changed = tenant.domain != old_domain
        status_changed = tenant.status != old_status
        if slug_changed or domain_changed or status_changed:
            if tenant.status == TenantStatus.ACTIVE:
                CloudflareDnsService.sync_tenant(tenant)
            else:
                # Non-active tenants shouldn't be reachable; strip DNS.
                CloudflareDnsService.deprovision_tenant(tenant)

        return tenant

    @staticmethod
    def resync_dns(tenant_id, scope='all'):
        """Retry DNS provisioning for an existing tenant. Used by the
        platform retry endpoint after fixing Cloudflare env vars or a
        transient API failure.

        ``scope`` is forwarded to :meth:`CloudflareDnsService.sync_tenant`:
          * ``'all'`` (default) — full sync.
          * ``'subdomain'`` — only the slug subdomain CNAME.
          * ``'custom'`` — only the custom-domain CNAME.
        """
        tenant = PlatformTenantService.get_tenant(tenant_id)
        if not tenant:
            raise ValueError('Tenant not found')
        CloudflareDnsService.sync_tenant(tenant, scope=scope)
        return tenant

    # ── Plan / billing tier ─────────────────────────────────────────
    # Stored under ``Tenant.settings['plan']`` so we don't need a
    # column migration. Adopt a real column when billing integration
    # lands. Free-form string today; the frontend constrains it to a
    # known list (free / starter / pro / enterprise).
    @staticmethod
    def get_plan(tenant):
        if not tenant.settings:
            return 'starter'
        return (tenant.settings or {}).get('plan', 'starter')

    @staticmethod
    def set_plan(tenant_id, plan):
        tenant = PlatformTenantService.get_tenant(tenant_id)
        if not tenant:
            raise ValueError('Tenant not found')
        if plan not in ('free', 'starter', 'pro', 'enterprise'):
            raise ValueError(
                f'Invalid plan "{plan}". Allowed: free, starter, pro, enterprise.'
            )
        # JSON column update — replace the dict so SQLAlchemy detects the change.
        new_settings = dict(tenant.settings or {})
        new_settings['plan'] = plan
        tenant.settings = new_settings
        db.session.commit()
        return tenant

    @staticmethod
    def set_pages_project(tenant_id, project_name):
        """Pin (or clear) the Cloudflare Pages project that serves this
        tenant's frontend.

        Setting ``project_name`` routes this tenant's verified custom domain
        to a dedicated Pages project (e.g. a client running a customized
        frontend build) instead of the shared default — consumed by
        ``cloudflare_saas._project_for_tenant``. Pass a falsy value to clear
        the pin and fall back to the shared project.

        Merges into ``settings`` (never overwrites sibling keys like
        ``plan``) so it is safe to call on a live, already-paying tenant with
        no data loss.
        """
        tenant = PlatformTenantService.get_tenant(tenant_id)
        if not tenant:
            raise ValueError('Tenant not found')
        new_settings = dict(tenant.settings or {})
        cleaned = (project_name or '').strip()
        if cleaned:
            new_settings['cf_pages_project'] = cleaned
        else:
            new_settings.pop('cf_pages_project', None)
        tenant.settings = new_settings
        db.session.commit()
        return tenant

    @staticmethod
    def delete_tenant(tenant_id, hard=False):
        """Remove a tenant.

        Best-practice flow:
          1. Refuse to delete either anchor row — ``is_platform`` (the
             vendor's control plane) or ``is_default`` (where anonymous
             requests land). Losing either breaks the whole install.
          2. Best-effort deprovision Cloudflare DNS so the subdomain
             stops resolving immediately.
          3. Soft-delete by default (``SoftDeleteMixin.is_deleted``): the
             row stays so related foreign keys (users, appointments,
             payments) don't cascade-break. Records are excluded from
             the Tenants list via ``is_deleted=False``.
             Pass ``hard=True`` only in dev to physically ``DELETE``; the
             DB's ``ON DELETE CASCADE`` on the tenant FK will drop all
             dependent rows.
        """
        from datetime import datetime, timezone
        from app.models._base import soft_delete_record

        tenant = PlatformTenantService.get_tenant(tenant_id)
        if not tenant:
            raise ValueError('Tenant not found')
        if tenant.is_platform:
            raise ValueError('The SaaS vendor tenant cannot be deleted.')
        if tenant.is_default:
            raise ValueError(
                'The default (anonymous-fallback) tenant cannot be deleted. '
                'Point is_default at another tenant first.'
            )

        # Tear down the Cloudflare Custom Hostname (if any) before DNS
        # so the domain stops resolving at our origin first. Best-effort
        # — we never block tenant delete on Cloudflare being reachable.
        if cloudflare_saas_is_configured() and tenant.domain:
            try:
                CloudflareSaasService.delete(tenant)
            except Exception:  # noqa: BLE001 — best-effort
                pass
        CloudflareDnsService.deprovision_tenant(tenant)

        if hard:
            db.session.delete(tenant)
        else:
            soft_delete_record(tenant)
            tenant.status = TenantStatus.INACTIVE
        db.session.commit()
        return tenant_id


class PlatformDomainService:
    """Custom-domain ownership + DNS-provisioning workflow.

    Wraps :class:`DomainVerificationService` (TXT-record challenge) and
    :class:`CloudflareDnsService` (CNAME provisioning). Every method is
    PLATFORM_OWNER-driven; tenant-side self-service can re-use these
    same primitives later.
    """

    @staticmethod
    def _validate_domain(domain, tenant_id):
        """Reject obviously invalid / forbidden domain claims."""
        import re
        from flask import current_app

        clean = (domain or '').strip().lower()
        if not clean:
            raise ValueError('Domain is required.')
        # No protocol, no path, no port — pure hostname.
        if '/' in clean or ':' in clean or ' ' in clean:
            raise ValueError(
                'Domain must be a bare hostname '
                '(no protocol, port, or path).'
            )
        # Standard hostname regex (RFC 1123, simplified).
        if not re.match(r'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$', clean):
            raise ValueError(f'"{clean}" is not a valid domain name.')
        # Refuse any apex/subdomain inside our own managed zone — those
        # have to go through the slug-subdomain path, not the custom-
        # domain path (which is for tenant-owned external zones).
        base = (current_app.config.get('CLOUDFLARE_BASE_DOMAIN') or '').strip().lower()
        if base and (clean == base or clean.endswith('.' + base)):
            raise ValueError(
                f'"{clean}" is inside our managed zone "{base}". '
                'Use the slug subdomain instead of a custom domain.'
            )
        # No other tenant may already claim this exact domain.
        clash = Tenant.query.filter(
            Tenant.domain == clean,
            Tenant.id != tenant_id,
            Tenant.is_deleted.is_(False),
        ).first()
        if clash:
            raise ValueError(f'Domain "{clean}" is already claimed by another tenant.')
        return clean

    @staticmethod
    def set_domain(tenant_id, domain):
        """Issue a fresh TXT challenge for the tenant's chosen domain.

        Stops short of provisioning DNS — that only happens after
        ``verify_domain`` succeeds. Deferring the Cloudflare Pages
        binding to post-verification keeps unverified domains from
        consuming Pages Custom Domain slots (100-cap on the free tier).
        """
        tenant = PlatformTenantService.get_tenant(tenant_id)
        if not tenant:
            raise ValueError('Tenant not found')
        if tenant.is_platform:
            raise ValueError('The SaaS vendor tenant has no custom domain.')

        clean = PlatformDomainService._validate_domain(domain, tenant.id)

        # If a verified custom-domain CNAME already exists in Cloudflare,
        # tear it down — the new domain may be different and we don't
        # want stale routing to keep working.
        if tenant.custom_domain_record_id:
            CloudflareDnsService.delete_custom_domain(tenant)

        return DomainVerificationService.set_pending(tenant, clean)

    @staticmethod
    def verify_domain(tenant_id):
        """Resolve the TXT record and, on success, provision DNS.

        Returns a dict the route can return as-is. DNS provisioning
        failures don't fail the verification result — they're surfaced
        on ``dns_synced``/``dns_error`` so the operator knows to retry.
        """
        tenant = PlatformTenantService.get_tenant(tenant_id)
        if not tenant:
            raise ValueError('Tenant not found')
        if not tenant.domain or not tenant.domain_verification_token:
            raise ValueError(
                'No pending domain verification — call set_domain first.'
            )

        ok = DomainVerificationService.verify(tenant)
        result = {
            'verified': ok,
            'status': tenant.domain_verification_status,
            'domain': tenant.domain,
            'verified_at': (
                tenant.domain_verified_at.isoformat()
                if tenant.domain_verified_at else None
            ),
            'dns_synced': False,
            'dns_error': None,
        }
        if ok:
            try:
                CloudflareDnsService.sync_tenant(tenant)
                # ``sync_tenant`` writes its own dns_status/dns_error.
                result['dns_synced'] = (tenant.dns_status == 'active')
                result['dns_error'] = tenant.dns_error
            except Exception as exc:  # noqa: BLE001
                result['dns_error'] = str(exc)[:300]
            # Cloudflare Custom Hostname auto-association: register the
            # verified domain so the edge stops 403'ing on the new Host
            # header. Best-effort — failures surface on ``cf_error`` so
            # the operator can retry from the UI without re-running verify.
            if cloudflare_saas_is_configured():
                try:
                    CloudflareSaasService.create_or_update(tenant)
                    result['cf_hostname_status'] = tenant.cf_hostname_status
                    result['cf_ssl_status'] = tenant.cf_ssl_status
                    result['cf_ownership_verification'] = (
                        tenant.cf_ownership_verification
                    )
                except CloudflareNotConfigured:
                    pass  # silent skip — same as ``is_configured`` says
                except Exception as exc:  # noqa: BLE001
                    result['cf_error'] = str(exc)[:300]
        return result

    @staticmethod
    def clear_domain(tenant_id):
        """Unset the custom domain + revoke any CNAME we created."""
        tenant = PlatformTenantService.get_tenant(tenant_id)
        if not tenant:
            raise ValueError('Tenant not found')
        # Tear down the Cloudflare Custom Hostname first so the domain
        # is deassociated before we lose the ``tenant.domain`` value
        # (delete needs it). Best-effort — clear shouldn't fail because CF is down.
        if cloudflare_saas_is_configured():
            try:
                CloudflareSaasService.delete(tenant)
            except Exception:  # noqa: BLE001 — best-effort
                pass
        # Then the Cloudflare custom-domain CNAME (if any). Even if
        # CF delete fails we still null the token so the operator can
        # re-issue.
        try:
            CloudflareDnsService.delete_custom_domain(tenant)
        except Exception:  # noqa: BLE001 — never let CF errors block clear
            pass
        DomainVerificationService.clear(tenant)
        return tenant


class PlatformAdminsService:
    """Manage admins inside a tenant, for the PLATFORM_OWNER console.

    All operations require the tenant_id to be passed explicitly.
    Role-gating is enforced at the HTTP route layer (PLATFORM_OWNER only).
    """

    _ADMIN_ROLES = (UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN)

    @staticmethod
    def list_admins(tenant_id, role=None):
        """Return the list of admin users in the given tenant. Uses
        :func:`with_tenant_context` so RLS resolves rows under the target
        tenant even though the caller's session is pinned to the platform
        tenant."""
        roles = (role,) if role else PlatformAdminsService._ADMIN_ROLES
        with with_tenant_context(tenant_id):
            return User.query.filter(
                User.tenant_id == tenant_id,
                User.role.in_(roles),
                User.is_deleted.is_(False),
            ).order_by(User.created_at.asc()).all()

    @staticmethod
    def get_admin(tenant_id, user_id):
        """Look up one admin scoped to the tenant. Returns None if the
        user doesn't exist OR belongs to a different tenant — never leak
        cross-tenant existence."""
        with with_tenant_context(tenant_id):
            return User.query.filter(
                User.id == user_id,
                User.tenant_id == tenant_id,
                User.role.in_(PlatformAdminsService._ADMIN_ROLES),
                User.is_deleted.is_(False),
            ).first()

    @staticmethod
    def set_admin_status(tenant_id, user_id, status):
        """Block / unblock / activate an admin.

        Status values map to :class:`UserStatus`. Blocking immediately
        invalidates active sessions because session checks read
        ``user.status`` on every refresh.
        """
        with with_tenant_context(tenant_id):
            admin = PlatformAdminsService.get_admin(tenant_id, user_id)
            if not admin:
                raise ValueError('Admin not found in this tenant.')
            try:
                admin.status = UserStatus(status)
            except ValueError:
                raise ValueError(
                    f'Invalid status "{status}". Must be one of: '
                    + ', '.join(s.value for s in UserStatus)
                )
            db.session.commit()
            return admin

    @staticmethod
    def soft_delete_admin(tenant_id, user_id):
        """Soft-delete the admin. Sessions die immediately because
        ``is_deleted=True`` excludes the user from every query."""
        from app.models._base import soft_delete_record
        with with_tenant_context(tenant_id):
            admin = PlatformAdminsService.get_admin(tenant_id, user_id)
            if not admin:
                raise ValueError('Admin not found in this tenant.')
            # Refuse to leave a tenant with zero super-admins — would lock
            # out the tenant from self-administration.
            if admin.role == UserRole.SUPER_ADMIN:
                remaining = User.query.filter(
                    User.tenant_id == tenant_id,
                    User.role == UserRole.SUPER_ADMIN,
                    User.is_deleted.is_(False),
                    User.id != admin.id,
                ).count()
                if remaining == 0:
                    raise ValueError(
                        'Cannot delete the only super-admin of this tenant. '
                        'Create another super-admin first, then delete this one.'
                    )
            soft_delete_record(admin)
            admin.status = UserStatus.INACTIVE
            db.session.commit()
            return admin

    @staticmethod
    def count_admins(tenant_id):
        """Return ``{'super_admin': n, 'sub_admin': m, 'total': n+m}`` for
        the given tenant. Used by the Tenants table to show an at-a-glance
        admin count without a second round-trip per row."""
        with with_tenant_context(tenant_id):
            rows = db.session.query(
                User.role, db.func.count(User.id)
            ).filter(
                User.tenant_id == tenant_id,
                User.role.in_(PlatformAdminsService._ADMIN_ROLES),
                User.is_deleted.is_(False),
            ).group_by(User.role).all()
        counts = {r.value: 0 for r in PlatformAdminsService._ADMIN_ROLES}
        total = 0
        for role, n in rows:
            counts[role.value] = int(n)
            total += int(n)
        counts['total'] = total
        return counts


class PlatformPermissionService:
    @staticmethod
    def list_allocations(tenant_id):
        with with_tenant_context(tenant_id):
            return TenantPermissionAllocation.query.filter_by(
                tenant_id=tenant_id
            ).order_by(
                TenantPermissionAllocation.module.asc(),
                TenantPermissionAllocation.action.asc(),
            ).all()

    @staticmethod
    def set_allocations(tenant_id, allocations):
        """Upsert the ``(module, action)`` rows. Does NOT delete rows not in
        the payload — platform owner has to flip ``allowed=False`` explicitly
        to revoke."""
        allocator_id = str(current_user.id) if current_user else None
        with with_tenant_context(tenant_id):
            for item in allocations:
                module = item['module']
                action = item['action']
                allowed = bool(item.get('allowed', True))
                row = TenantPermissionAllocation.query.filter_by(
                    tenant_id=tenant_id, module=module, action=action,
                ).first()
                if row:
                    row.allowed = allowed
                    row.allocated_by_id = allocator_id
                else:
                    db.session.add(TenantPermissionAllocation(
                        tenant_id=tenant_id,
                        module=module, action=action, allowed=allowed,
                        allocated_by_id=allocator_id,
                    ))
            db.session.commit()
            return TenantPermissionAllocation.query.filter_by(
                tenant_id=tenant_id
            ).order_by(
                TenantPermissionAllocation.module.asc(),
                TenantPermissionAllocation.action.asc(),
            ).all()


_LANDING_CONFIG_FIELDS = (
    'hero_title', 'hero_subtitle', 'hero_cta_label', 'hero_cta_href',
    'hero_image_asset_id',
    'theme_preset', 'primary_color', 'secondary_color', 'accent_color',
    'background_color', 'hero_style',
    'marketing_tagline', 'footer_text', 'meta',
    # Brand + contact + trust-badge + CTA-band — added in x4s5t6u7v8w9.
    # Used by platform-owner's "seed a tenant from default-template"
    # path so the new tenant inherits the apex's brand defaults.
    'brand_name', 'support_email', 'trust_badge_text',
    'cta_band_title', 'cta_band_subtitle',
    'cta_band_label', 'cta_band_href',
    # Logo + sub-tagline + section headings + repeating JSON arrays —
    # added in y5t6u7v8w9x0.
    'brand_logo_url', 'brand_sub_tagline',
    'hero_body_text', 'hero_search_placeholder',
    'why_section_title', 'why_section_subtitle',
    'testimonials_section_title', 'testimonials_section_subtitle',
    'stats', 'testimonials', 'hero_partners',
    # Remaining section copy + JSON arrays — added in z6u7v8w9x0y1.
    'services_section_title', 'services_section_subtitle',
    'categories_section_title', 'categories_section_subtitle',
    'ready_cta_title', 'ready_cta_subtitle',
    'ready_cta_label', 'ready_cta_href',
    'faq_section_title', 'faq_section_subtitle',
    'why_features', 'faqs',
    'section_visibility',
    'doctors_section_title', 'reviews_section_title', 'brands_section_title',
    'translations', 'published_languages',
)
_LANDING_MODULE_FIELDS = (
    'slug', 'name', 'icon_key', 'description', 'logo_asset_id',
    'display_order', 'is_visible', 'faq_json', 'sections_enabled_json',
    'translations',
)
_LANDING_FEATURE_FIELDS = (
    'slug', 'title', 'description', 'logo_asset_id',
    'starting_price', 'timeline', 'rating', 'what_is',
    'requirements', 'documents', 'benefits', 'disadvantages', 'process',
    'who_should_join', 'whats_included', 'expected_outcomes',
    'book_cta_label', 'sections_enabled_json', 'translations',
    'display_order', 'is_visible',
)
_LANDING_RECOGNITION_FIELDS = (
    'title', 'subtitle', 'description', 'logo_asset_id',
    'display_order', 'is_visible',
)
_LANDING_VIDEO_FIELDS = (
    'title', 'description', 'video_url', 'video_asset_id',
    'thumbnail_asset_id', 'category', 'display_order', 'is_visible',
)


def _seed_tenant_landing(tenant_id):
    """Create the new tenant's landing rows from the platform-owner-curated
    DEFAULT_TEMPLATE.

    Lookup order:
      1. ``platform_landing_*`` rows where ``scope == DEFAULT_TEMPLATE``.
         If present, every field/module/feature/recognition/video is
         copied into the new tenant's RLS-scoped ``landing_*`` tables.
      2. Fallback to the hardcoded ``get_default_hero()`` /
         ``get_default_modules()`` seed (paranoia for fresh installs
         where the migration hasn't seeded a template yet).

    Wrapped in :func:`with_tenant_context` so the INSERT into RLS-
    enabled ``landing_configs`` / ``landing_modules`` / ``landing_features``
    passes the insert policy even though the outer request is pinned
    to the platform tenant.
    """
    from app.models import (
        LandingRecognition, LandingVideo,
        PlatformLandingConfig, PlatformLandingFeature,
        PlatformLandingModule, PlatformLandingRecognition,
        PlatformLandingScope, PlatformLandingVideo,
    )

    template = (
        PlatformLandingConfig.query
        .filter_by(scope=PlatformLandingScope.DEFAULT_TEMPLATE,
                   status=ConfigStatus.LIVE)
        .first()
    )

    with with_tenant_context(tenant_id):
        if template:
            # Copy hero / theme / marketing from the template config.
            cfg_kwargs = {
                k: getattr(template, k) for k in _LANDING_CONFIG_FIELDS
                if hasattr(LandingConfig, k)
            }
            config = LandingConfig(
                tenant_id=tenant_id,
                status=ConfigStatus.LIVE,
                version=1,
                **cfg_kwargs,
            )
            # Belt-and-suspenders defaults so brand-new tenants always
            # render even if the template happens to have null translation
            # bookkeeping.
            config.translations = config.translations or {}
            config.published_languages = config.published_languages or ['en']
            db.session.add(config)
            db.session.flush()

            # Modules + features (copy via FK from template hierarchy).
            tpl_modules = (
                PlatformLandingModule.query
                .filter_by(landing_config_id=template.id)
                .order_by(PlatformLandingModule.display_order.asc())
                .all()
            )
            for tm in tpl_modules:
                m_kwargs = {
                    k: getattr(tm, k) for k in _LANDING_MODULE_FIELDS
                    if hasattr(LandingModule, k)
                }
                module = LandingModule(
                    tenant_id=tenant_id,
                    landing_config_id=config.id,
                    **m_kwargs,
                )
                db.session.add(module)
                db.session.flush()

                tpl_features = (
                    PlatformLandingFeature.query
                    .filter_by(module_id=tm.id)
                    .order_by(PlatformLandingFeature.display_order.asc())
                    .all()
                )
                for tf in tpl_features:
                    f_kwargs = {
                        k: getattr(tf, k) for k in _LANDING_FEATURE_FIELDS
                        if hasattr(LandingFeature, k)
                    }
                    db.session.add(LandingFeature(
                        tenant_id=tenant_id,
                        module_id=module.id,
                        **f_kwargs,
                    ))

            # Recognitions (certificates carousel).
            for tr in PlatformLandingRecognition.query.filter_by(
                scope=PlatformLandingScope.DEFAULT_TEMPLATE,
            ).order_by(PlatformLandingRecognition.display_order.asc()).all():
                r_kwargs = {
                    k: getattr(tr, k) for k in _LANDING_RECOGNITION_FIELDS
                    if hasattr(LandingRecognition, k)
                }
                db.session.add(LandingRecognition(
                    tenant_id=tenant_id, **r_kwargs,
                ))

            # Videos (gallery).
            for tv in PlatformLandingVideo.query.filter_by(
                scope=PlatformLandingScope.DEFAULT_TEMPLATE,
            ).order_by(PlatformLandingVideo.display_order.asc()).all():
                v_kwargs = {
                    k: getattr(tv, k) for k in _LANDING_VIDEO_FIELDS
                    if hasattr(LandingVideo, k)
                }
                db.session.add(LandingVideo(
                    tenant_id=tenant_id, **v_kwargs,
                ))

            # Trusted brands (logo strip — partner pharmacies / labs /
            # accreditations). Unlike doctors and reviews — which are
            # inherently tenant-specific (a new clinic can't inherit
            # another clinic's doctor roster or testimonials) — brands
            # are typically platform-wide partners that every tenant
            # benefits from showing. Copy them from the DEFAULT tenant's
            # collection (which the platform_owner curates via the
            # /dashboard/platform/landing-config editor; the editor
            # writes to per-tenant tables under the default tenant's
            # context, so those rows ARE the platform-wide template).
            #
            # We don't model platform_landing_trusted_brands as a
            # separate table — the default tenant's brand list IS the
            # template. New tenants get a copy at creation time and
            # can then add/remove their own.
            from app.models import LandingTrustedBrand, Tenant
            default_tenant_row = Tenant.query.filter_by(
                is_platform=True, is_deleted=False,
            ).first()
            if default_tenant_row is not None:
                # Step out of the new tenant's RLS context to read the
                # default tenant's brands, then come back in to insert.
                default_brands = []
                with with_tenant_context(default_tenant_row.id):
                    default_brands = (
                        LandingTrustedBrand.query
                        .order_by(LandingTrustedBrand.display_order.asc())
                        .all()
                    )
                    # Detach so we can read fields after the context switch.
                    brand_snapshots = [
                        {
                            'name': b.name,
                            'logo_asset_id': b.logo_asset_id,
                            'link_url': b.link_url,
                            'display_order': b.display_order,
                            'is_visible': b.is_visible,
                        }
                        for b in default_brands
                    ]
                for snap in brand_snapshots:
                    db.session.add(LandingTrustedBrand(
                        tenant_id=tenant_id, **snap,
                    ))
            return

        # ── Fallback: hardcoded defaults (no template seeded) ──────
        hero = get_default_hero()
        config = LandingConfig(
            tenant_id=tenant_id,
            status=ConfigStatus.LIVE,
            version=1,
            translations={},
            published_languages=['en'],
            **{k: v for k, v in hero.items() if hasattr(LandingConfig, k)},
        )
        db.session.add(config)
        db.session.flush()

        for module_seed in get_default_modules():
            feature_seeds = module_seed.pop('features', [])
            module = LandingModule(
                tenant_id=tenant_id,
                landing_config_id=config.id,
                **{k: v for k, v in module_seed.items() if hasattr(LandingModule, k)},
            )
            db.session.add(module)
            db.session.flush()
            for feat_seed in feature_seeds:
                db.session.add(LandingFeature(
                    tenant_id=tenant_id,
                    module_id=module.id,
                    **{k: v for k, v in feat_seed.items() if hasattr(LandingFeature, k)},
                ))
