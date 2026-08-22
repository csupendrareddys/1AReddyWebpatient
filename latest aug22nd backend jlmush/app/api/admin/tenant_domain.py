"""Tenant self-serve custom domain + first-run onboarding status.

Until now a tenant could not see, let alone change, its own routing: the
only domain endpoints lived under ``/api/platform/tenants/<id>/domain``
and were ``PLATFORM_OWNER``-only, so every customer domain change was a
support request, and a freshly provisioned tenant had no way to tell
whether its site was live.

These routes give a tenant's own SUPER_ADMIN the same operations scoped
to **their own tenant only** -- the tenant id always comes from
``current_tenant_id_strict()``, never from the URL or body, so there is
no id to tamper with.

  GET    /api/admin/tenant-domain            -> routing + DNS/SSL status
  PUT    /api/admin/tenant-domain            -> claim a custom domain
  POST   /api/admin/tenant-domain/verify     -> check the TXT challenge
  DELETE /api/admin/tenant-domain            -> release the custom domain
  GET    /api/admin/tenant-domain/onboarding -> status + setup checklist

Custom-domain writes are plan-gated on ``domain.custom_domain`` via
``DomainPolicy``; reads are not, so a tenant without the entitlement can
still see its subdomain status and be told to upgrade.
"""
from flask import Blueprint
from flask import request
from flask_jwt_extended import jwt_required

from app.common.decorators import role_required
from app.common.responses import success_response, error_response
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db, limiter
from app.models import UserRole, Tenant

tenant_domain_bp = Blueprint('tenant_domain_admin', __name__)


def _tenant_or_404():
    t = Tenant.query.get(current_tenant_id_strict())
    if not t:
        return None, error_response('Tenant not found', status_code=404)
    return t, None


def _base_domain():
    """The zone tenant subdomains live under, e.g. ``larazen.in``.

    Env var only, matching the request resolver's
    ``_platform_base_domain`` (app/__init__.py).

    This used to fall back to the default tenant's own domain, so that a
    deploy which stamped the apex onto the tenant row but forgot the env
    var still showed the customer a portal address rather than none.
    After the vendor/customer split the default tenant is the VENDOR,
    whose domain is its marketing site and not the zone -- so the
    fallback would tell a customer its portal is
    ``<slug>.<vendor-domain>``, which nothing serves.

    A wrong hostname is worse than a missing one here, because this is
    the address the tenant hands out. ``_domain_state`` renders
    ``fqdn: None`` when this is empty, which reads as "not configured
    yet" instead of as an address that simply fails.
    """
    from flask import current_app
    return (current_app.config.get('CLOUDFLARE_BASE_DOMAIN') or '').strip().lower()


def _domain_state(tenant):
    """Everything a tenant admin needs to understand its own routing.

    Includes the exact records to publish. The platform console already
    renders these from the same columns (``DnsInstructionsDialog``); this
    is the tenant-side view of the same truth, not a second source of it.
    """
    base = _base_domain()
    subdomain_fqdn = (
        '%s.%s' % (tenant.slug, base) if base and tenant.auto_subdomain else None
    )

    # Records the tenant must publish, if any. Kept verbatim from what
    # Cloudflare returned rather than reconstructed, so instructions
    # cannot drift from what verification actually checks.
    actions = []
    if tenant.domain and tenant.domain_verification_status != 'verified':
        if tenant.domain_verification_token:
            # Ask the service for the record name rather than building
            # it here: verify() resolves whatever record_name_for()
            # returns, so a locally reconstructed prefix would tell the
            # tenant to publish a record nothing ever reads.
            from app.services.domain_verification import (
                DomainVerificationService,
            )
            actions.append({
                'type': 'TXT',
                'name': DomainVerificationService.record_name_for(tenant.domain),
                'value': tenant.domain_verification_token,
                'why': 'proves you control this domain before we route it',
            })
    for rec in (tenant.cf_ssl_validation_records or []):
        actions.append({
            'type': 'TXT',
            'name': rec.get('txt_name'),
            'value': rec.get('txt_value'),
            'why': 'issues the TLS certificate for your domain',
        })
    ownership = tenant.cf_ownership_verification or None
    if ownership:
        actions.append({
            'type': (ownership.get('type') or 'TXT').upper(),
            'name': ownership.get('name'),
            'value': ownership.get('value'),
            'why': 'Cloudflare ownership check',
        })

    # The routing CNAME — the record that actually carries traffic.
    # Only for out-of-zone domains (``custom_domain_record_id`` set
    # means WE manage the record inside our zone), and kept in the
    # list even after verification: the tenant must leave it
    # published forever, and this was the row tenants never saw —
    # they verified ownership and then had nowhere to learn where to
    # point the domain. Same target derivation as the platform
    # console's ``cloudflare_saas_fallback_origin``.
    if tenant.domain and not tenant.custom_domain_record_id:
        from flask import current_app
        cfg = current_app.config
        target = (
            (cfg.get('CLOUDFLARE_PAGES_TARGET') or '').strip()
            or (
                '%s.pages.dev' % (
                    cfg.get('CLOUDFLARE_PAGES_PROJECT_NAME') or '').strip()
                if (cfg.get('CLOUDFLARE_PAGES_PROJECT_NAME') or '').strip()
                else None
            )
            or (cfg.get('CLOUDFLARE_INGRESS_TARGET') or '').strip() or None
        )
        if target:
            actions.append({
                'type': 'CNAME',
                'name': tenant.domain,
                'value': target,
                'why': 'routes visitors on your domain to your portal '
                       '(keep this record published permanently)',
            })

    return {
        'subdomain': {
            'slug': tenant.slug,
            'fqdn': subdomain_fqdn,
            # Reachability, which is what the tenant is actually asking.
            # NOT ``dns_status``: that tracks whether we provisioned a
            # per-tenant CNAME, and it reads ``disabled`` whenever
            # Cloudflare is unconfigured. The edge serves ``*.<base>`` as
            # a wildcard, so the subdomain resolves as soon as the tenant
            # exists either way -- surfacing ``disabled`` there told
            # customers their working portal was switched off.
            #
            # ``dns_status`` stays in the payload below for diagnostics.
            'status': (
                'disabled' if not tenant.auto_subdomain
                else ('failed' if tenant.dns_status == 'failed' else 'active')
            ),
            'dns_status': tenant.dns_status,
        },
        'custom_domain': {
            'domain': tenant.domain,
            'verification_status': tenant.domain_verification_status,
            'verified_at': (
                tenant.domain_verified_at.isoformat()
                if tenant.domain_verified_at else None
            ),
            'dns_status': tenant.dns_status,
            'ssl_status': tenant.cf_ssl_status,
            'hostname_status': tenant.cf_hostname_status,
            # A BOOLEAN, not the message. ``dns_error`` / ``cf_error`` hold
            # raw provider and configuration text -- e.g. "Cloudflare env
            # vars not set - CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID..."
            # -- which is our operational problem, not the customer's, and
            # names our infrastructure to them. The platform console reads
            # the raw fields from /api/platform/* where an operator can
            # actually act on them.
            'has_provisioning_issue': bool(tenant.dns_error or tenant.cf_error),
        },
        'records_to_publish': [a for a in actions if a.get('name')],
        'live_url': (
            'https://%s' % tenant.domain
            if tenant.domain and tenant.domain_verification_status == 'verified'
            else ('https://%s' % subdomain_fqdn
                  if subdomain_fqdn and tenant.auto_subdomain else None)
        ),
    }


@tenant_domain_bp.route('', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def get_domain():
    tenant, err = _tenant_or_404()
    if err:
        return err

    from app.api.pricing.service import DomainPolicy, DomainNotConfigurable
    try:
        DomainPolicy.assert_custom_domain_allowed(tenant.id)
        can_set_custom = True
    except DomainNotConfigurable:
        can_set_custom = False

    data = _domain_state(tenant)
    data['can_set_custom_domain'] = can_set_custom
    return success_response(data=data)


@tenant_domain_bp.route('', methods=['PUT'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def set_domain():
    """Claim a custom domain and get back the TXT record to publish."""
    tenant, err = _tenant_or_404()
    if err:
        return err

    from app.api.pricing.service import DomainPolicy, DomainNotConfigurable
    from app.api.platform.service import PlatformDomainService
    try:
        DomainPolicy.assert_custom_domain_allowed(tenant.id)
    except DomainNotConfigurable:
        return error_response(
            'Custom domains are not included in your plan.',
            status_code=403, code='feature_disabled',
        )

    domain = (request.get_json(silent=True) or {}).get('domain')
    try:
        # Reuses the platform-owner path wholesale: same validation,
        # same collision check against other tenants, same challenge
        # issuance. Only the caller and the tenant scoping differ.
        PlatformDomainService.set_domain(tenant.id, domain)
        db.session.commit()
    except ValueError as e:
        db.session.rollback()
        return error_response(str(e), status_code=400)
    except Exception as e:
        from app.api.pricing.service import ChildQuotaExceeded
        if isinstance(e, ChildQuotaExceeded):
            db.session.rollback()
            # This tenant is an apex reseller's child — the domain slot
            # comes from the PARENT's apex-plan quota.
            return error_response(
                "Your provider's plan has no custom-domain slots left.",
                status_code=402, code='child_quota_exceeded',
                data={'limit': e.limit, 'used': e.used, 'allowed': e.allowed},
            )
        raise

    return success_response(
        data=_domain_state(tenant),
        message='Publish the TXT record, then run verify.',
    )


@tenant_domain_bp.route('/check-cname', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
@limiter.limit('10 per minute')
def check_cname():
    """Probe public DNS for this tenant's routing CNAME — the same
    check the platform console offers, self-serve: after ownership is
    verified, this is the only signal the operator's registrar record
    actually routes traffic to us. Returns {matches, reason,
    resolved_chain} for the Domain page to render."""
    from flask import current_app
    from app.services.domain_verification import DomainVerificationService
    tenant, err = _tenant_or_404()
    if err:
        return err
    if not tenant.domain:
        return error_response('No custom domain set.', status_code=400)
    expected = current_app.config.get('CLOUDFLARE_INGRESS_TARGET')
    report = DomainVerificationService.check_routing_cname(
        tenant, expected_target=expected,
    )
    return success_response(report, message=(
        'Your domain points at us — routing looks good.'
        if report.get('matches')
        else (report.get('reason')
              or 'The routing record does not point at us yet.')
    ))


@tenant_domain_bp.route('/verify', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def verify_domain():
    """Resolve the TXT challenge; on success provision routing + TLS."""
    tenant, err = _tenant_or_404()
    if err:
        return err

    from app.api.pricing.service import DomainPolicy, DomainNotConfigurable
    from app.api.platform.service import PlatformDomainService
    try:
        DomainPolicy.assert_custom_domain_allowed(tenant.id)
    except DomainNotConfigurable:
        return error_response(
            'Custom domains are not included in your plan.',
            status_code=403, code='feature_disabled',
        )

    try:
        result = PlatformDomainService.verify_domain(tenant.id)
        db.session.commit()
    except ValueError as e:
        db.session.rollback()
        return error_response(str(e), status_code=400)

    return success_response(data={
        'result': result,
        **_domain_state(tenant),
    })


@tenant_domain_bp.route('', methods=['DELETE'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def clear_domain():
    """Release the custom domain. The subdomain keeps working."""
    tenant, err = _tenant_or_404()
    if err:
        return err

    from app.api.platform.service import PlatformDomainService
    try:
        PlatformDomainService.clear_domain(tenant.id)
        db.session.commit()
    except ValueError as e:
        db.session.rollback()
        return error_response(str(e), status_code=400)

    return success_response(
        data=_domain_state(tenant), message='Custom domain released.',
    )


@tenant_domain_bp.route('/onboarding', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def onboarding():
    """First-run state: is my site live, and what should I do next?

    Every item is derived from real rows, so the checklist self-completes
    as the tenant actually uses the product -- there is no separate
    "onboarding progress" table to drift out of sync.
    """
    tenant, err = _tenant_or_404()
    if err:
        return err

    from app.models import User
    from app.api.pricing.service import PlanService

    tid = tenant.id
    domain = _domain_state(tenant)

    def _count(model, **kw):
        try:
            q = model.query.filter_by(tenant_id=tid, **kw)
            if hasattr(model, 'is_deleted'):
                q = q.filter(model.is_deleted.is_(False))
            return q.count()
        except Exception:  # noqa: BLE001
            db.session.rollback()
            return 0

    admins = _count(User, role=UserRole.SUB_ADMIN) + _count(
        User, role=UserRole.SUPER_ADMIN,
    )
    providers = _count(User, role=UserRole.DOCTOR)

    try:
        resolved = PlanService.resolve(tid)
        plan = {
            'code': resolved.plan_code,
            'status': getattr(resolved, 'subscription_status', None),
            'limits': dict(resolved.limits or {}),
        }
    except Exception as e:  # noqa: BLE001
        db.session.rollback()
        plan = {'error': type(e).__name__}

    subdomain_live = domain['subdomain']['status'] in ('active', 'pending')
    custom_done = (
        tenant.domain is not None
        and tenant.domain_verification_status == 'verified'
    )

    steps = [
        {
            'key': 'site_live',
            'label': 'Your site is reachable',
            'done': bool(domain['live_url']) and subdomain_live,
            'detail': domain['live_url'],
        },
        {
            'key': 'branding',
            'label': 'Add your logo and organisation name',
            'done': bool(tenant.logo_url),
        },
        {
            'key': 'team',
            'label': 'Invite your team',
            'done': admins > 1,
            'detail': '%d admin(s)' % admins,
        },
        {
            'key': 'providers',
            'label': 'Add the people who deliver your service',
            'done': providers > 0,
            'detail': '%d added' % providers,
        },
        {
            'key': 'custom_domain',
            'label': 'Connect your own domain (optional)',
            'done': custom_done,
            'detail': tenant.domain,
        },
    ]

    return success_response(data={
        'tenant': {
            'id': str(tenant.id),
            'name': tenant.name,
            'slug': tenant.slug,
            'status': tenant.status.value,
        },
        'domain': domain,
        'plan': plan,
        'steps': steps,
        'complete': all(
            s['done'] for s in steps if s['key'] != 'custom_domain'
        ),
    })
