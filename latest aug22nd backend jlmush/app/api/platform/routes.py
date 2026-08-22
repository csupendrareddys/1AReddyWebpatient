"""Platform API Routes (PLATFORM_OWNER only).

Cross-tenant operations: tenant CRUD + per-tenant permission allocation.
"""
import logging

from flask import request, current_app
from flask_jwt_extended import jwt_required
from marshmallow import ValidationError

from app.api.platform import platform_bp
from app.api.platform.service import (
    PlatformTenantService, PlatformPermissionService, PlatformAdminsService,
    PlatformDomainService,
)
from marshmallow import Schema, fields, validate
from app.api.platform.validators import (
    TenantCreateSchema, TenantUpdateSchema, PermissionAllocationSchema,
    TenantSuperAdminSchema,
)
from app.api.platform.access import platform_access
from app.common.decorators import role_required
from app.common.responses import (
    success_response, created_response, error_response,
    not_found_response, validation_error_response, no_content_response,
)
from app.extensions import limiter
from app.models import UserRole
from app.models._enums import PermissionAction, PermissionModule

# AWS Amplify ``CreateDomainAssociation`` is rate-limited at ~5 rps
# burst / ~25 rpm sustained per AWS account, plus a fuzzy account-
# wide concurrency cap on domain associations. When an operator
# clicks "Reset & retry" or "Create tenant" repeatedly through the
# UI, those clicks fan out to AWS one-for-one — and once AWS starts
# throttling, every additional retry extends the throttle window.
# We've seen this lock the entire account out for HOURS.
#
# Defense-in-depth: enforce a server-side rate limit of 5 requests
# per minute per IP on every endpoint that triggers an Amplify or
# tenant-mutation API call. Generous enough that a careful operator
# isn't blocked; tight enough that a stuck UI loop or impatient
# clicker can't drive the AWS throttle window.
#
# The limit is keyed by IP (Flask-Limiter's default ``get_remote_address``)
# rather than by user, because the typical platform-owner workflow
# is single-operator from a single workstation, and IP-keyed limits
# cap the abuse surface even if an attacker tries to brute-force
# one of these from outside.
_PLATFORM_MUTATION_LIMIT = '5 per minute'

# Platform-owner workflows during a tenant migration are bursty:
# refresh → retry → poll → cutover → rollback. The 5/min limit above
# was sized for Amplify's tight AWS-side throttle, but Cloudflare's
# Custom Hostnames quota (1200 req/5min/zone) is much higher, so the
# dominant constraint becomes operator-error protection rather than
# upstream API. 30/min keeps a stuck UI loop from runaway-spamming a
# provider while still letting a careful operator move quickly through
# the migration phase machine.
_PLATFORM_OWNER_MIGRATION_LIMIT = '30 per minute'

logger = logging.getLogger(__name__)


class _BadPayload(Exception):
    def __init__(self, errors):
        self.errors = errors


def _load(schema_cls, partial=False):
    try:
        return schema_cls().load(request.get_json() or {}, partial=partial)
    except ValidationError as exc:
        raise _BadPayload(exc.messages) from exc


# ---------------------------------------------------------------------------
# Tenants
# ---------------------------------------------------------------------------

@platform_bp.route('/tenants', methods=['GET'])
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.VIEW)
def list_tenants():
    """List every tenant + admin counts + subscription summary so the
    console can show plan / billing state per row without a round-trip
    per tenant. The subscription block is what the vendor actually
    manages — plan, lifecycle status, and when the paid period ends."""
    from app.models import TenantSubscription

    tenants = PlatformTenantService.list_tenants()
    subs = {
        str(s.tenant_id): s
        for s in TenantSubscription.query.filter_by(is_deleted=False).all()
    }
    out = []
    for t in tenants:
        row = t.to_dict()
        row['admin_counts'] = PlatformAdminsService.count_admins(t.id)
        s = subs.get(str(t.id))
        row['subscription'] = ({
            'plan_code': s.plan.code if s.plan else None,
            # 'apex' marks a reseller: apex-ness is a plan entitlement,
            # so the kind of the subscribed plan IS the answer.
            'plan_kind': s.plan.kind if s.plan else None,
            'status': s.status.value,
            'billing_cycle': s.billing_cycle.value,
            'trial_ends_at': s.trial_ends_at.isoformat() if s.trial_ends_at else None,
            'current_period_end': (
                s.current_period_end.isoformat() if s.current_period_end else None
            ),
        } if s is not None else None)
        out.append(row)
    return success_response(out)


@platform_bp.route('/tenants/<tenant_id>/dns', methods=['GET'])
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.VIEW)
def get_tenant_dns(tenant_id):
    """Return DNS-provisioning state plus the records the operator needs
    to publish at their registrar (for out-of-zone custom domains)."""
    from app.services.domain_verification import DomainVerificationService
    tenant = PlatformTenantService.get_tenant(tenant_id)
    if not tenant:
        return not_found_response('Tenant')
    cfg = current_app.config
    payload = tenant.to_dict()
    return success_response({
        'tenant_id': str(tenant.id),
        'slug': tenant.slug,
        'domain': tenant.domain,
        'fqdn': tenant.fqdn,
        'auto_subdomain': tenant.auto_subdomain,
        'dns_status': tenant.dns_status,
        'dns_error': tenant.dns_error,
        'dns_synced_at': tenant.dns_synced_at.isoformat() if tenant.dns_synced_at else None,
        'subdomain_routing': payload['subdomain_routing'],
        'custom_domain_routing': payload['custom_domain_routing'],
        # Records the operator may need to publish themselves:
        'ingress_target': cfg.get('CLOUDFLARE_INGRESS_TARGET'),
        'base_domain': cfg.get('CLOUDFLARE_BASE_DOMAIN'),
        'verification_token': tenant.domain_verification_token,
        # Authoritative TXT record host (e.g. ``_lz-verify.example.com``).
        # Frontend should display *this* — never reconstruct the prefix.
        'verification_record_name': (
            DomainVerificationService.record_name_for(tenant.domain)
            if tenant.domain else None
        ),
        'verification_status': tenant.domain_verification_status,
        # Cloudflare Pages — the only hosting provider after the
        # Amplify decommission. ``cloudflare_configured`` is True when
        # all three required env vars are set (API token + account id
        # + project name); the service refuses to add domains without
        # them. Frontend uses this to show "CF Pages not configured"
        # banner when the operator forgot to wire env vars.
        'cloudflare_configured': bool(
            (cfg.get('CLOUDFLARE_API_TOKEN') or '').strip()
            and (cfg.get('CLOUDFLARE_ACCOUNT_ID') or '').strip()
            and (cfg.get('CLOUDFLARE_PAGES_PROJECT_NAME') or '').strip()
        ),
        # The hostname tenants are told to CNAME their domain at —
        # surfaced here so the DnsInstructionsDialog can render the
        # routing record without reading env directly. Defaults to
        # ``<project>.pages.dev`` when ``CLOUDFLARE_PAGES_TARGET`` is
        # unset.
        'cloudflare_saas_fallback_origin': (
            (cfg.get('CLOUDFLARE_PAGES_TARGET') or '').strip()
            or (
                f"{(cfg.get('CLOUDFLARE_PAGES_PROJECT_NAME') or '').strip()}.pages.dev"
                if (cfg.get('CLOUDFLARE_PAGES_PROJECT_NAME') or '').strip()
                else None
            )
        ),
        'cf_hostname_id': tenant.cf_hostname_id,
        'cf_hostname_status': tenant.cf_hostname_status,
        'cf_ssl_status': tenant.cf_ssl_status,
        'cf_ownership_verification': tenant.cf_ownership_verification,
        'cf_ssl_validation_records': tenant.cf_ssl_validation_records or [],
        'cf_error': tenant.cf_error,
        'cf_synced_at': (
            tenant.cf_synced_at.isoformat() if tenant.cf_synced_at else None
        ),
    })


@platform_bp.route('/tenants/<tenant_id>/dns/resync', methods=['POST'])
@limiter.limit(_PLATFORM_MUTATION_LIMIT)
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.EDIT)
def resync_tenant_dns(tenant_id):
    """Retry Cloudflare provisioning for a tenant whose DNS is
    ``failed`` or ``pending``. Idempotent: no-ops on tenants that are
    already ``active`` and unchanged.

    Optional ``?scope=subdomain|custom|all`` (default ``all``) lets the
    UI refresh just one record without disturbing the other.
    """
    scope = (request.args.get('scope') or 'all').lower()
    if scope not in ('all', 'subdomain', 'custom'):
        return error_response(
            'Invalid scope. Use one of: all, subdomain, custom.',
            status_code=400,
        )
    try:
        tenant = PlatformTenantService.resync_dns(tenant_id, scope=scope)
    except ValueError:
        return not_found_response('Tenant')
    return success_response(tenant.to_dict(), message='DNS resync triggered')


@platform_bp.route('/tenants/<tenant_id>', methods=['DELETE'])
@limiter.limit(_PLATFORM_MUTATION_LIMIT)
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.DELETE)
def delete_tenant(tenant_id):
    """Soft-delete a tenant and strip its Cloudflare DNS.

    Pass ``?hard=true`` only in development — this physically deletes
    the row and cascades through every table's ``tenant_id`` FK. In
    production, always soft-delete so historical data stays queryable
    for audit / billing reconciliation.
    """
    hard = request.args.get('hard', 'false').lower() in ('true', '1', 'yes')
    try:
        PlatformTenantService.delete_tenant(tenant_id, hard=hard)
    except ValueError as e:
        if 'not found' in str(e).lower():
            return not_found_response('Tenant')
        return error_response(str(e), status_code=400)
    return no_content_response()


class _DomainSchema(Schema):
    domain = fields.Str(
        required=True,
        validate=validate.Length(min=4, max=253),
    )


# ---------------------------------------------------------------------------
# Custom-domain ownership verification (TXT challenge)
# ---------------------------------------------------------------------------

@platform_bp.route('/tenants/<tenant_id>/domain', methods=['POST'])
@limiter.limit(_PLATFORM_MUTATION_LIMIT)
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.EDIT)
def set_tenant_domain(tenant_id):
    """Issue a TXT-record challenge for a tenant's custom domain.

    Returns the exact record the tenant must publish at their DNS
    provider before the domain will route. No DNS is provisioned at this
    step — that only happens after ``/domain/verify`` succeeds.
    """
    try:
        payload = _load(_DomainSchema)
    except _BadPayload as bad:
        return validation_error_response(bad.errors)
    try:
        challenge = PlatformDomainService.set_domain(tenant_id, payload['domain'])
    except ValueError as e:
        msg = str(e)
        if 'not found' in msg.lower():
            return not_found_response('Tenant')
        return error_response(msg, status_code=400)
    challenge['ingress_target'] = current_app.config.get('CLOUDFLARE_INGRESS_TARGET')
    challenge['base_domain'] = current_app.config.get('CLOUDFLARE_BASE_DOMAIN')
    return created_response(challenge, message='Domain verification pending')


@platform_bp.route('/tenants/<tenant_id>/domain/verify', methods=['POST'])
@limiter.limit(_PLATFORM_MUTATION_LIMIT)
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.EDIT)
def verify_tenant_domain(tenant_id):
    """Resolve the TXT record and, on success, provision the CNAME.

    Returns ``verified: false`` (200) on a soft failure (NXDOMAIN, no
    matching value) so the operator can retry — they didn't supply
    bad input, they're waiting on DNS propagation.
    """
    try:
        result = PlatformDomainService.verify_domain(tenant_id)
    except ValueError as e:
        msg = str(e)
        if 'not found' in msg.lower():
            return not_found_response('Tenant')
        return error_response(msg, status_code=400)
    result['ingress_target'] = current_app.config.get('CLOUDFLARE_INGRESS_TARGET')
    return success_response(result, message=(
        'Domain verified' if result['verified']
        else 'TXT record not yet visible'
    ))


def _domain_state_payload(tenant) -> dict:
    """Common response shape for /domain/refresh + /domain/reset.

    Cloudflare for SaaS is now the only provider; this payload mirrors
    what the admin UI's CF block consumes.
    """
    return {
        'provider': 'cloudflare',
        'status': tenant.cf_hostname_status,
        'ssl_status': tenant.cf_ssl_status,
        'ownership_verification': tenant.cf_ownership_verification,
        'ssl_validation_records': tenant.cf_ssl_validation_records or [],
        'error': tenant.cf_error,
        'synced_at': (
            tenant.cf_synced_at.isoformat() if tenant.cf_synced_at else None
        ),
    }


def _do_refresh(tenant_id):
    """Re-poll Cloudflare for the current Custom Hostname state.

    On a brand-new tenant whose CF Custom Hostname hasn't been created
    yet, falls through to ``create_or_update`` so the UI's "Refresh"
    button doubles as "Connect" right after TXT verify.
    """
    from app.services.cloudflare_saas import (
        CloudflareSaasService, is_configured as cloudflare_is_configured,
    )
    tenant = PlatformTenantService.get_tenant(tenant_id)
    if not tenant:
        return not_found_response('Tenant')
    if not tenant.domain:
        return error_response('Tenant has no custom domain set.', status_code=400)
    if not cloudflare_is_configured():
        return error_response(
            'Cloudflare for SaaS is not configured.', status_code=400,
        )
    try:
        CloudflareSaasService.refresh(tenant)
        # First-call-after-verify: the row has no CF hostname yet because
        # nothing's been provisioned. Create on the fly.
        if not tenant.cf_hostname_id:
            CloudflareSaasService.create_or_update(tenant)
    except Exception as exc:  # noqa: BLE001 — surface the upstream error
        logger.exception(
            '[PLATFORM] CF refresh threw for tenant=%s', tenant_id,
        )
        return error_response(f'Cloudflare call failed: {exc}', status_code=502)

    payload = _domain_state_payload(tenant)
    return success_response(payload, message=(
        'Domain association is live.'
        if payload.get('status') == 'active' else (
            payload.get('error') or 'Status refreshed.'
        )
    ))


def _do_reset(tenant_id):
    """Tear down the CF Custom Hostname and recreate it. The documented
    unstick for a hostname whose DCV is wedged in a failed state."""
    from app.services.cloudflare_saas import (
        CloudflareSaasService, is_configured as cloudflare_is_configured,
    )
    tenant = PlatformTenantService.get_tenant(tenant_id)
    if not tenant:
        return not_found_response('Tenant')
    if not tenant.domain:
        return error_response('Tenant has no custom domain set.', status_code=400)
    if not cloudflare_is_configured():
        return error_response(
            'Cloudflare for SaaS is not configured.', status_code=400,
        )
    try:
        CloudflareSaasService.reset_and_retry(tenant)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            '[PLATFORM] CF reset threw for tenant=%s', tenant_id,
        )
        return error_response(f'Cloudflare reset failed: {exc}', status_code=502)

    payload = _domain_state_payload(tenant)
    return success_response(payload, message=(
        payload.get('error') or 'Association reset and recreated.'
    ))


# ── Cloudflare for SaaS — domain control plane routes ──────────────────

@platform_bp.route('/tenants/<tenant_id>/domain/refresh', methods=['POST'])
@limiter.limit(_PLATFORM_OWNER_MIGRATION_LIMIT)
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.EDIT)
def refresh_tenant_domain(tenant_id):
    """Re-poll the active provider for current state. Provider-agnostic
    front-door — dispatcher reads ``tenant.domain_provider``."""
    return _do_refresh(tenant_id)


@platform_bp.route('/tenants/<tenant_id>/domain/reset', methods=['POST'])
@limiter.limit(_PLATFORM_OWNER_MIGRATION_LIMIT)
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.EDIT)
def reset_tenant_domain(tenant_id):
    """Force a fresh provider-side association. Use when the existing
    one is stuck in a failed state. Provider-agnostic front-door."""
    return _do_reset(tenant_id)


@platform_bp.route('/tenants/<tenant_id>/domain/check-cname', methods=['POST'])
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.VIEW)
def check_tenant_domain_cname(tenant_id):
    """Probe public DNS for the tenant's custom-domain CNAME.

    Distinct from ``/domain/verify`` (which checks the TXT *ownership*
    record). After ownership is verified, this route confirms the
    operator also published the *routing* CNAME at their registrar —
    the only signal we have that out-of-zone traffic will land at our
    ingress, since we don't manage the tenant's zone.
    """
    from app.services.domain_verification import DomainVerificationService
    tenant = PlatformTenantService.get_tenant(tenant_id)
    if not tenant:
        return not_found_response('Tenant')
    if not tenant.domain:
        return error_response(
            'Tenant has no custom domain set.', status_code=400,
        )
    expected = current_app.config.get('CLOUDFLARE_INGRESS_TARGET')
    report = DomainVerificationService.check_routing_cname(
        tenant, expected_target=expected,
    )
    return success_response(report, message=(
        'CNAME points at our ingress.' if report.get('matches')
        else (report.get('reason') or 'CNAME does not point at our ingress yet.')
    ))


# Amplify-to-Cloudflare migration phase machine removed when Amplify
# was decommissioned. Cloudflare for SaaS is now the only provider —
# new tenants land on it directly via ``CloudflareSaasService.create_or_update``
# called during tenant create. See
# ``Backend/app/services/cloudflare_saas.py`` and the existing
# ``/domain/refresh`` + ``/domain/reset`` endpoints for the steady-state
# control plane. The ``tenant_domain_migration_audit`` table is kept
# because ``cloudflare_saas.py``'s audit decorator writes general CF op
# rows there (not just migrations).


@platform_bp.route('/tenants/<tenant_id>/domain', methods=['DELETE'])
@limiter.limit(_PLATFORM_MUTATION_LIMIT)
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.EDIT)
def clear_tenant_domain(tenant_id):
    """Unset the tenant's custom domain and tear down its CNAME."""
    try:
        PlatformDomainService.clear_domain(tenant_id)
    except ValueError as e:
        if 'not found' in str(e).lower():
            return not_found_response('Tenant')
        return error_response(str(e), status_code=400)
    return no_content_response()


class _AdminStatusSchema(Schema):
    status = fields.Str(
        required=True,
        validate=validate.OneOf(['active', 'inactive', 'pending', 'blocked']),
    )


class _PlanSchema(Schema):
    plan = fields.Str(
        required=True,
        validate=validate.OneOf(['free', 'starter', 'pro', 'enterprise']),
    )


@platform_bp.route('/tenants/<tenant_id>/admins/<user_id>', methods=['PUT'])
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.EDIT)
def update_tenant_admin_status(tenant_id, user_id):
    """Block / unblock / reactivate an admin in a tenant."""
    try:
        payload = _load(_AdminStatusSchema)
    except _BadPayload as bad:
        return validation_error_response(bad.errors)
    try:
        admin = PlatformAdminsService.set_admin_status(
            tenant_id, user_id, payload['status'],
        )
    except ValueError as e:
        msg = str(e)
        if 'not found' in msg.lower():
            return not_found_response('Admin')
        return error_response(msg, status_code=400)
    except Exception as exc:  # noqa: BLE001 — surface unexpected failures
        # Without this catch, the route 500s with no clue what went
        # wrong (RLS, FK constraint on User.status, dirty session, …).
        # Log + return a real message so the operator can fix it.
        logger.exception(
            '[PLATFORM] update_tenant_admin_status failed tenant=%s user=%s',
            tenant_id, user_id,
        )
        return error_response(
            f'Failed to update admin status: {exc}', status_code=500,
        )
    return success_response(admin.to_dict(), message='Admin status updated')


@platform_bp.route('/tenants/<tenant_id>/admins/<user_id>', methods=['DELETE'])
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.DELETE)
def delete_tenant_admin(tenant_id, user_id):
    """Soft-delete an admin. Refuses to remove the last super-admin of
    a tenant — would lock the tenant out of self-administration."""
    try:
        PlatformAdminsService.soft_delete_admin(tenant_id, user_id)
    except ValueError as e:
        msg = str(e)
        if 'not found' in msg.lower():
            return not_found_response('Admin')
        return error_response(msg, status_code=400)
    return no_content_response()


@platform_bp.route('/tenants/<tenant_id>/plan', methods=['PUT'])
@jwt_required()
@platform_access(PermissionModule.PLAN_SUBSCRIPTION, PermissionAction.EDIT)
def set_tenant_plan(tenant_id):
    """Set the tenant's billing plan tier. Stored under
    ``Tenant.settings['plan']`` — billing integration is future work."""
    try:
        payload = _load(_PlanSchema)
    except _BadPayload as bad:
        return validation_error_response(bad.errors)
    try:
        tenant = PlatformTenantService.set_plan(tenant_id, payload['plan'])
    except ValueError as e:
        msg = str(e)
        if 'not found' in msg.lower():
            return not_found_response('Tenant')
        return error_response(msg, status_code=400)
    return success_response(tenant.to_dict(), message='Plan updated')


@platform_bp.route('/tenants/<tenant_id>/admins', methods=['GET'])
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.VIEW)
def list_tenant_admins(tenant_id):
    """List admin users (super_admin + sub_admin) inside a specific tenant.

    Optional ``?role=super_admin`` filter returns just one kind.
    """
    tenant = PlatformTenantService.get_tenant(tenant_id)
    if not tenant:
        return not_found_response('Tenant')

    role_filter = request.args.get('role')
    role_enum = None
    if role_filter:
        try:
            role_enum = UserRole(role_filter)
        except ValueError:
            return error_response(
                f'Invalid role "{role_filter}". Use super_admin or sub_admin.',
                status_code=400,
            )

    admins = PlatformAdminsService.list_admins(tenant_id, role=role_enum)
    # ``User.to_dict()`` already omits password/encryption internals.
    return success_response([u.to_dict() for u in admins])


@platform_bp.route('/tenants', methods=['POST'])
@limiter.limit(_PLATFORM_MUTATION_LIMIT)
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.CREATE)
def create_tenant():
    try:
        payload = _load(TenantCreateSchema)
    except _BadPayload as bad:
        return validation_error_response(bad.errors)
    try:
        tenant = PlatformTenantService.create_tenant(payload)
    except ValueError as e:
        return error_response(str(e), status_code=409)
    return created_response(tenant.to_dict(), message='Tenant created')


@platform_bp.route('/tenants/<tenant_id>', methods=['GET'])
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.VIEW)
def get_tenant(tenant_id):
    tenant = PlatformTenantService.get_tenant(tenant_id)
    if not tenant:
        return not_found_response('Tenant')
    return success_response(tenant.to_dict())


@platform_bp.route('/tenants/<tenant_id>', methods=['PUT'])
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.EDIT)
def update_tenant(tenant_id):
    try:
        payload = _load(TenantUpdateSchema, partial=True)
    except _BadPayload as bad:
        return validation_error_response(bad.errors)
    try:
        tenant = PlatformTenantService.update_tenant(tenant_id, payload)
    except ValueError:
        return not_found_response('Tenant')
    return success_response(tenant.to_dict(), message='Tenant updated')


# ---------------------------------------------------------------------------
# Permission allocations per tenant
# ---------------------------------------------------------------------------

@platform_bp.route('/tenants/<tenant_id>/permissions', methods=['GET'])
@jwt_required()
@platform_access(PermissionModule.TENANT_PERMISSIONS, PermissionAction.VIEW)
def list_allocations(tenant_id):
    tenant = PlatformTenantService.get_tenant(tenant_id)
    if not tenant:
        return not_found_response('Tenant')
    rows = PlatformPermissionService.list_allocations(tenant_id)
    return success_response([r.to_dict() for r in rows])


@platform_bp.route('/tenants/<tenant_id>/permissions', methods=['PUT'])
@jwt_required()
@platform_access(PermissionModule.TENANT_PERMISSIONS, PermissionAction.EDIT)
def upsert_allocations(tenant_id):
    tenant = PlatformTenantService.get_tenant(tenant_id)
    if not tenant:
        return not_found_response('Tenant')
    try:
        payload = _load(PermissionAllocationSchema)
    except _BadPayload as bad:
        return validation_error_response(bad.errors)
    rows = PlatformPermissionService.set_allocations(tenant_id, payload['allocations'])
    return success_response(
        [r.to_dict() for r in rows],
        message='Allocations updated',
    )


# ---------------------------------------------------------------------------
# Tenant super-admin creation
# ---------------------------------------------------------------------------

@platform_bp.route('/tenants/<tenant_id>/super-admin', methods=['POST'])
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.CREATE)
def create_tenant_super_admin(tenant_id):
    """Create a SUPER_ADMIN scoped to the given tenant.

    A super_admin cannot exist without a tenant — this endpoint is the
    only platform-owner-driven way to bootstrap one for a newly-created
    tenant.
    """
    from flask_jwt_extended import current_user
    from app.api.admin.super_admin.service import (
        SuperAdminService, FieldValidationError,
    )

    tenant = PlatformTenantService.get_tenant(tenant_id)
    if not tenant:
        return not_found_response('Tenant')

    try:
        payload = _load(TenantSuperAdminSchema)
    except _BadPayload as bad:
        return validation_error_response(bad.errors)

    from flask import jsonify
    from app.api.pricing.service import PlanLimitExceeded

    payload['role'] = 'super_admin'
    try:
        user, admin = SuperAdminService.create_admin(
            payload, created_by_user=current_user, tenant_id=tenant.id
        )
    except FieldValidationError as e:
        # 422 with field-keyed ``errors`` so the dialog highlights the
        # offending input (matches Marshmallow's shape).
        return validation_error_response(e.as_errors_dict())
    except PlanLimitExceeded as e:
        return jsonify({
            'success': False,
            'error': 'plan_limit_exceeded',
            'limit': e.limit,
            'current': e.current,
            'max': e.max_allowed,
        }), 402
    except ValueError as e:
        return error_response(str(e), status_code=409)

    # Workspace is fully provisioned (tenant row + DNS + first super_admin) —
    # shared best-effort notify (also used by the reseller child-create).
    PlatformTenantService.notify_tenant_ready(tenant, user)

    return created_response(
        {
            'user_id': str(user.id),
            'admin_id': str(admin.id),
            'tenant_id': str(tenant.id),
            'tenant_slug': tenant.slug,
            'role': user.role.value,
            'phone_number': user.phone_number,
            'email': user.email,
            'full_name': user.full_name,
        },
        message=f'Super admin created for tenant "{tenant.slug}"',
    )


# --------------------------------------------------------------------------- #
# Announcements — vendor broadcast to customer-tenant admins
# --------------------------------------------------------------------------- #

@platform_bp.route('/announcements', methods=['POST'])
@jwt_required()
@platform_access(PermissionModule.TENANT_MANAGEMENT, PermissionAction.CREATE)
@limiter.limit('10 per minute')
def announce_to_tenants():
    """One bell message to the admins of all (or selected) tenants.

    The vendor's channel reaches its DIRECT tenants only (parent IS
    NULL): announcements follow the seller relationship exactly like
    billing bells, so an apex's children hear from the apex, never from
    us. Selected ids outside that set come back in ``skipped`` instead
    of erroring — the composer warns, the rest still sends.
    """
    from app.common.announcements import (
        send_announcement, split_targets, validate_announcement_payload,
    )
    from app.models import Tenant

    data = request.get_json() or {}
    errors, title, body, audience, raw_ids = \
        validate_announcement_payload(data)
    if errors:
        return validation_error_response(errors)

    direct = (Tenant.query
              .filter_by(is_platform=False, is_deleted=False,
                         parent_tenant_id=None)
              .with_entities(Tenant.id).all())
    targets, skipped = split_targets(
        (row.id for row in direct), audience, raw_ids)
    tenants_n, admins_n = send_announcement(targets, title=title, body=body)
    return success_response(
        {'tenants_reached': tenants_n, 'admins_notified': admins_n,
         'skipped_ids': skipped},
        message=f'Announcement sent to {admins_n} admin(s) '
                f'across {tenants_n} tenant(s)',
    )
