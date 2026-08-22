"""Apex reseller console — /api/v1/admin/reseller/*.

An APEX tenant's SUPER_ADMIN authors its own SaaS plans and operates its
child tenants here. Twin of the vendor's /platform plan surface, running
the same ``PlanCatalogService`` with the owner scope pinned to the
calling tenant — and with the reseller rules hardened server-side:
``kind`` is FORCED 'normal', ``owner`` forced self, ``is_default``
forced False, whatever the payload claims.

Tenant identity always comes from ``current_tenant_id_strict()`` (the
admin self-serve pattern of app/api/admin/payment_gateway.py) — never
from the URL or payload; child ids in URLs are re-scoped against
``parent_tenant_id`` on every lookup, and misses answer 404 so foreign
ids leak nothing.
"""
import logging
import re
import uuid

from flask import request
from flask_jwt_extended import current_user, jwt_required

from app.api.admin.reseller import reseller_bp
from app.api.admin.reseller.service import ChildPlanNotFound, ResellerService
from app.api.pricing.plan_catalog_service import (
    InvalidPlanType, PlanCatalogService, PlanCodeExists,
    PlanHasActiveSubscriptions,
)
from app.api.pricing.service import (
    ALLOWED_FEATURE_PATHS, ChildQuotaExceeded, ResellerPolicy,
)
from app.api.pricing.validators import PlanValidator
from app.common.decorators import role_required, validate_json
from app.common.responses import (
    created_response, error_response, no_content_response,
    not_found_response, success_response, validation_error_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db, limiter
from app.models._enums import PlanKind, UserRole

logger = logging.getLogger(__name__)


def _apex_or_403():
    """(tenant_id, None) for a live apex tenant, else (None, response).

    Refuses the vendor (it has the platform console), every sub-tenant
    (``is_apex`` requires ``parent_tenant_id IS NULL``), and any tenant
    without a live apex-kind subscription — reselling is a plan
    entitlement, exactly like marketplace-ness.
    """
    tenant_id = current_tenant_id_strict()
    if not ResellerPolicy.is_apex(tenant_id):
        return None, error_response(
            'Reselling is not included in your plan.',
            status_code=403, code='not_apex_tenant',
        )
    return tenant_id, None


def _child_plan_violations(apex_tenant_id, data, existing_plan=None):
    """Field errors when a requested child plan exceeds what the apex
    itself holds: seat fields above the apex plan's per-child caps
    (``child_plan_caps``, snapshot-first), or feature leaves the apex's
    own resolved plan does not grant. The parent can only sell what it
    has access to.

    On UPDATE, ``existing_plan`` merges in: the EFFECTIVE values are
    validated, not just the touched fields — so a legacy over-cap plan
    cannot slip through by editing an unrelated field; any touch forces
    it back inside the ceiling."""
    from app.api.pricing.service import PlanService, _walk_to_leaf

    errors = {}
    try:
        resolved = PlanService.resolve(str(apex_tenant_id))
    except Exception:  # noqa: BLE001 — apex gate already ran
        return errors

    # Authoring is clamped to the LOOSEST track — a plan is authorable
    # when at least one kind of child could hold it. The per-child fit
    # (a subdomain-only child must not get a custom-domain-sized plan)
    # is enforced again at child creation with that child's own track.
    ceilings = ResellerService.track_ceilings(
        ResellerService.apex_child_caps(apex_tenant_id),
        ('subdomain', 'custom_domain'))
    for field_name, cap_key in ResellerService.CAP_FIELDS:
        cap = ceilings.get(cap_key)
        if cap is None:
            continue
        if field_name in data:
            raw = data.get(field_name)
        elif existing_plan is not None:
            raw = getattr(existing_plan, field_name, None)
        else:
            continue
        try:
            val = int(raw)
        except (TypeError, ValueError):
            continue
        if val == -1 or val > cap:
            shown = 'unlimited' if val == -1 else val
            errors[field_name] = (
                f'This grants {shown}; your plan allows at most {cap} '
                f'per tenant.')

    def _walk(tree, prefix=''):
        for k, v in (tree or {}).items():
            path = f'{prefix}.{k}' if prefix else k
            if isinstance(v, bool):
                if v:
                    yield path
            elif isinstance(v, dict) and 'enabled' in v:
                if v.get('enabled'):
                    yield path
            elif isinstance(v, dict):
                yield from _walk(v, path)

    requested_tree = data.get('features')
    if requested_tree is None and existing_plan is not None:
        requested_tree = existing_plan.features
    denied = sorted(p for p in _walk(requested_tree or {})
                    if not _walk_to_leaf(resolved.features, p))
    if denied:
        errors['features'] = ('Not included in your own plan: '
                              + ', '.join(denied[:10]))

    # Resale offer clamp: the apex may only put an add-on on a child
    # plan when it has that access itself — every feature leaf the
    # add-on toggles must be in the apex's resolved plan, and an
    # entity-granting add-on needs the vertical enabled for the apex.
    terms = data.get('addon_terms')
    if terms is None and existing_plan is not None:
        terms = existing_plan.addon_terms
    if isinstance(terms, dict) and terms:
        from app.models import Addon, AddonStatus
        entity_ok = {}
        for code, t in terms.items():
            if t is None:
                continue
            addon = Addon.query.filter_by(
                code=code, is_deleted=False,
                status=AddonStatus.ACTIVE).first()
            if addon is None:
                errors[f'addon_terms.{code}'] = 'Unknown add-on.'
                continue
            missing = sorted(pth for pth in _walk(addon.features or {})
                             if not _walk_to_leaf(resolved.features, pth))
            if missing:
                errors[f'addon_terms.{code}'] = (
                    'Your own plan lacks: ' + ', '.join(missing[:6]))
                continue
            for key in ('doctor', 'clinic', 'hospital'):
                delta = (addon.limits or {}).get(key)
                if not isinstance(delta, int) or delta <= 0:
                    continue
                if key not in entity_ok:
                    from app.api.tenant_provider_plan.service import (
                        _resolve_quota_cap,
                    )
                    from app.models._enums import MembershipVertical
                    vertical = {
                        'doctor': MembershipVertical.DOCTOR,
                        'clinic': MembershipVertical.CLINIC,
                        'hospital': MembershipVertical.HOSPITAL,
                    }[key]
                    entity_ok[key] = _resolve_quota_cap(
                        str(apex_tenant_id), vertical) != 0
                if not entity_ok[key]:
                    errors[f'addon_terms.{code}'] = (
                        f'The {key} vertical is not enabled on your '
                        f'own plan.')
                    break
    return errors


# ── Read-only catalogs the plan dialog needs ────────────────────────────────

@reseller_bp.route('/feature-paths', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_feature_paths():
    _tenant_id, err = _apex_or_403()
    if err:
        return err
    return success_response(sorted(ALLOWED_FEATURE_PATHS))


@reseller_bp.route('/plan-types', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_plan_types():
    _tenant_id, err = _apex_or_403()
    if err:
        return err
    from app.models.plan import SAASPlanType
    return success_response(
        [pt.to_dict() for pt in SAASPlanType.query.all()])


# ── Quota / overview ────────────────────────────────────────────────────────

@reseller_bp.route('/quota', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_quota():
    tenant_id, err = _apex_or_403()
    if err:
        return err
    return success_response(ResellerService.quota_summary(tenant_id))


# ── Storefront presentation settings ────────────────────────────────────────
# Label-level knobs for the apex's public selling site. These change what
# the nav SHOWS, never what works: the storefront routes stay reachable
# and child tenants are untouched.

@reseller_bp.route('/storefront', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_storefront_settings():
    tenant_id, err = _apex_or_403()
    if err:
        return err
    from app.models import Tenant
    tenant = Tenant.query.get(tenant_id)
    settings = tenant.settings or {}
    return success_response({
        'show_pricing_nav': bool(settings.get('storefront_pricing_nav', True)),
    })


@reseller_bp.route('/storefront', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_update_storefront_settings():
    tenant_id, err = _apex_or_403()
    if err:
        return err
    data = request.get_json() or {}
    if 'show_pricing_nav' not in data:
        return error_response(
            'show_pricing_nav is required', status_code=400)
    from app.extensions import db
    from app.models import Tenant
    tenant = Tenant.query.get(tenant_id)
    # Copy-then-assign: in-place mutation of a JSON column is invisible
    # to SQLAlchemy's change tracking and silently never persists.
    settings = dict(tenant.settings or {})
    settings['storefront_pricing_nav'] = bool(data['show_pricing_nav'])
    tenant.settings = settings
    db.session.commit()
    return success_response({
        'show_pricing_nav': settings['storefront_pricing_nav'],
    }, message='Storefront settings updated')


# ── My SaaS plans (owner-scoped catalog) ────────────────────────────────────

@reseller_bp.route('/plans', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_list_plans():
    tenant_id, err = _apex_or_403()
    if err:
        return err
    plans = PlanCatalogService.list_plans(owner_tenant_id=tenant_id)
    from sqlalchemy import func as _f
    from app.models import TenantSubscription
    counts = dict(
        db.session.query(TenantSubscription.plan_id,
                         _f.count(TenantSubscription.id))
        .filter(TenantSubscription.plan_id.in_([p.id for p in plans])
                if plans else False,
                TenantSubscription.is_deleted.is_(False))
        .group_by(TenantSubscription.plan_id).all()
    ) if plans else {}
    out = []
    for p in plans:
        row = p.to_dict()
        row['subscriber_count'] = int(counts.get(p.id, 0))
        out.append(row)
    return success_response(out)


@reseller_bp.route('/plans', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_create_plan():
    tenant_id, err = _apex_or_403()
    if err:
        return err
    data = dict(request.get_json() or {})
    if data.get('kind') == PlanKind.APEX:
        return error_response(
            'Only the platform authors apex plans.',
            status_code=403, code='apex_plan_vendor_only',
        )
    # Forced server-side regardless of payload claims. default_addons is
    # stripped too: the add-on catalog is the VENDOR's.
    data.pop('kind', None)
    data.pop('owner_tenant_id', None)
    data.pop('max_child_subdomains', None)
    data.pop('max_child_custom_domains', None)
    data.pop('default_addons', None)
    errors = PlanValidator.validate_create(data)
    errors.update(_child_plan_violations(tenant_id, data))
    if errors:
        return validation_error_response(errors)
    try:
        plan = PlanCatalogService.create_plan(
            data, owner_tenant_id=tenant_id, kind=PlanKind.NORMAL,
            created_by_id=current_user.id, is_default=False,
        )
    except PlanCodeExists:
        return error_response(
            f'You already have a plan with code "{data["code"]}".',
            status_code=409, code='plan_code_taken',
        )
    except InvalidPlanType:
        return error_response('Invalid plan type', status_code=400)
    return created_response(plan.to_dict(), message='Plan created')


@reseller_bp.route('/plans/<code>', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_get_plan(code):
    tenant_id, err = _apex_or_403()
    if err:
        return err
    plan = PlanCatalogService.get_plan(code, owner_tenant_id=tenant_id)
    if not plan:
        return not_found_response('Plan')
    return success_response(plan.to_dict())


@reseller_bp.route('/plans/<code>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_update_plan(code):
    tenant_id, err = _apex_or_403()
    if err:
        return err
    plan = PlanCatalogService.get_plan(code, owner_tenant_id=tenant_id)
    if not plan:
        return not_found_response('Plan')
    data = dict(request.get_json() or {})
    for forced in ('kind', 'owner_tenant_id', 'is_default',
                   'max_child_subdomains', 'max_child_custom_domains',
                   'default_addons'):
        data.pop(forced, None)
    errors = PlanValidator.validate_update(data)
    errors.update(_child_plan_violations(tenant_id, data,
                                         existing_plan=plan))
    if errors:
        return validation_error_response(errors)
    try:
        PlanCatalogService.update_plan(
            plan, data, updated_by_id=current_user.id,
            allow_vendor_fields=False,
        )
    except InvalidPlanType:
        return error_response('Invalid plan type', status_code=400)
    return success_response(plan.to_dict(), message='Plan updated')


@reseller_bp.route('/plans/<code>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_archive_plan(code):
    tenant_id, err = _apex_or_403()
    if err:
        return err
    plan = PlanCatalogService.get_plan(code, owner_tenant_id=tenant_id)
    if not plan:
        return not_found_response('Plan')
    try:
        PlanCatalogService.archive_plan(plan, updated_by_id=current_user.id)
    except PlanHasActiveSubscriptions:
        return error_response(
            'A tenant still subscribes to this plan. Move them first.',
            status_code=409, code='plan_has_subscriptions',
        )
    return no_content_response()


# ── My tenants (children) ───────────────────────────────────────────────────

@reseller_bp.route('/tenants', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_list_tenants():
    tenant_id, err = _apex_or_403()
    if err:
        return err
    return success_response(ResellerService.child_rows(tenant_id))


@reseller_bp.route('/tenants', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
# Same DNS-provider-protection rationale as the platform mutation limit.
@limiter.limit('5 per minute')
# 'admin' is deliberately NOT in the declared list: it is a nested
# object, and validate_json refuses non-scalar values for declared
# fields (the dict-crash guard). The route body validates its shape.
@validate_json(['name', 'slug', 'plan_code'])
def reseller_create_tenant():
    tenant_id, err = _apex_or_403()
    if err:
        return err
    from app.api.admin.super_admin.service import FieldValidationError
    from app.api.pricing.service import PlanLimitExceeded

    payload = request.get_json() or {}
    admin = payload.get('admin')
    if not isinstance(admin, dict) or not admin.get('email') \
            or not admin.get('password'):
        return validation_error_response(
            {'admin': 'Provide admin {email, password, first_name, ...}.'})

    try:
        tenant, user, _adm = ResellerService.create_child_tenant(
            tenant_id, payload, created_by_user=current_user)
    except ChildPlanNotFound:
        return not_found_response('Plan')
    except ChildQuotaExceeded as e:
        return error_response(
            'Your plan has no free tenant slots left.',
            status_code=402, code='child_quota_exceeded',
            data={'limit': e.limit, 'used': e.used, 'allowed': e.allowed},
        )
    except FieldValidationError as e:
        return validation_error_response(e.as_errors_dict())
    except PlanLimitExceeded as e:
        return error_response(
            'Admin seat limit reached on the assigned plan.',
            status_code=402, code='plan_limit_exceeded',
            data={'limit': e.limit, 'current': e.current,
                  'max': e.max_allowed},
        )
    except ValueError as e:
        return error_response(str(e), status_code=409,
                              code='slug_unavailable')

    row = tenant.to_dict()
    return created_response({
        'tenant': row,
        'admin': {'id': str(user.id), 'email': user.email},
    }, message=f'Tenant "{tenant.slug}" created')


@reseller_bp.route('/tenants/<uuid:child_id>', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_get_tenant(child_id):
    tenant_id, err = _apex_or_403()
    if err:
        return err
    rows = [r for r in ResellerService.child_rows(tenant_id)
            if r['id'] == str(child_id)]
    if not rows:
        return not_found_response('Tenant')
    return success_response(rows[0])


@reseller_bp.route('/tenants/<uuid:child_id>', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_update_tenant(child_id):
    tenant_id, err = _apex_or_403()
    if err:
        return err
    payload = request.get_json() or {}
    if 'status' in payload and payload['status'] not in ('active', 'inactive'):
        return validation_error_response(
            {'status': "Must be 'active' or 'inactive'."})
    from app.api.admin.super_admin.service import FieldValidationError
    try:
        child = ResellerService.update_child(tenant_id, str(child_id), payload)
    except ChildPlanNotFound:
        return not_found_response('Plan')
    except FieldValidationError as e:
        return validation_error_response(e.as_errors_dict())
    if child is None:
        return not_found_response('Tenant')
    return success_response(child.to_dict(), message='Tenant updated')


@reseller_bp.route('/plans/<code>/resync-subscribers', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
@limiter.limit('10 per minute')
def reseller_resync_plan_subscribers(code):
    """Push this child plan's CURRENT terms — limits, features, and the
    resale add-on offers — to every child already on it. Grandfathering
    means edits otherwise reach new subscriptions only; this is the
    apex's deliberate opt-in to migrate its children."""
    from app.api.pricing.plan_catalog_service import build_plan_snapshot
    from app.api.pricing.service import PlanService
    from app.models import TenantSubscription

    tenant_id, err = _apex_or_403()
    if err:
        return err
    plan = PlanCatalogService.get_plan(code, owner_tenant_id=tenant_id)
    if not plan:
        return not_found_response('Plan')
    subs = (TenantSubscription.query
            .filter_by(plan_id=plan.id, is_deleted=False).all())
    for sub in subs:
        sub.plan_snapshot = build_plan_snapshot(plan)
        PlanService.recompute_over_limit(sub)
    db.session.commit()
    from app.common.notify import notify_tenant_admins
    for sub in subs:
        notify_tenant_admins(
            str(sub.tenant_id), type='subscription_terms_updated',
            title='Plan terms updated',
            body=('Your "%s" plan now follows its current features, '
                  'limits and add-on offers.') % plan.name,
            data={'kind': 'subscription', 'url': '/dashboard/admin/billing'},
        )
    return success_response({'resynced': len(subs)},
                            message='Pushed to %d tenant(s).' % len(subs))


@reseller_bp.route('/addon-stock', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
@limiter.limit('20 per minute')
def reseller_buy_addon_stock():
    """Buy resale STOCK: units the apex holds to sell on to its children.

    Priced at the vendor's child tier (subdomain by default — pass
    ``tier`` for the custom-domain price). The units land in the apex's
    pool, granting the apex itself nothing; children draw from it when
    they buy. Free stock is granted immediately, paid stock goes through
    the vendor rail like any other purchase.
    """
    from app.api.common.payment.routes import _gateway_meta, _razorpay_client
    from app.api.pricing import subscription_billing as sbill
    from app.api.pricing.service import PaymentResolver
    from app.models import (
        Addon, AddonStatus, Payment, TenantAddon, TenantSubscription,
    )
    from app.models._base import utcnow
    from app.models._enums import (
        AddonSubscriptionStatus, BillingCycle, PaymentStatus,
    )

    tenant_id, err = _apex_or_403()
    if err:
        return err
    data = request.get_json() or {}
    code = (data.get('addon_code') or '').strip()
    tier_key = data.get('tier') or 'subdomain_child'
    if tier_key not in ('subdomain_child', 'custom_domain_child'):
        return error_response('tier must be a child tier.', status_code=400)
    try:
        quantity = max(int(data.get('quantity', 1)), 1)
    except (TypeError, ValueError):
        return error_response('quantity must be a number', status_code=400)
    if quantity > 999:
        return error_response('quantity too large', status_code=400)

    addon = Addon.query.filter_by(
        code=code, is_deleted=False, status=AddonStatus.ACTIVE).first()
    if addon is None:
        return not_found_response('Addon')
    try:
        terms = sbill.resolve_addon_terms(addon, 'monthly', tier_key, sub=None)
    except sbill.SubscriptionBillingError as e:
        return error_response(str(e), status_code=400, code='addon_terms')

    amount = float(terms['price_inr'] or 0) * quantity
    now = utcnow()
    cycle = terms['billing_cycle']
    one_time = cycle == 'one_time'

    def _grant():
        row = TenantAddon.query.filter_by(
            tenant_id=tenant_id, addon_id=addon.id,
            is_stock=True, is_deleted=False).first()
        end = None if one_time else sbill.add_period(now, cycle)
        if row is None:
            row = TenantAddon(
                tenant_id=tenant_id, addon_id=addon.id, quantity=quantity,
                status=AddonSubscriptionStatus.ACTIVE,
                billing_cycle=BillingCycle(cycle), activated_at=now,
                current_period_start=now, current_period_end=end,
                activated_by_id=current_user.id, tier=tier_key,
                units=terms['units'], is_stock=True)
            db.session.add(row)
        else:
            row.quantity = (row.quantity or 0) + quantity
            row.status = AddonSubscriptionStatus.ACTIVE
            row.current_period_end = end
            row.units = terms['units']
            row.tier = tier_key
        db.session.flush()
        return row

    if amount <= 0:
        row = _grant()
        db.session.commit()
        return success_response(
            {'no_payment_needed': True, 'amount': 0,
             'stock': sbill.resale_pool(tenant_id, addon)},
            message='Stock added.')

    apex_sub = TenantSubscription.query.filter_by(
        tenant_id=tenant_id, is_deleted=False).first()
    if apex_sub is None:
        return error_response('No active subscription.', status_code=400)
    try:
        binding = PaymentResolver.vendor_gateway()
        client = _razorpay_client(binding)
        rz_order = client.order.create({
            'amount': int(round(amount * 100)), 'currency': 'INR',
            'receipt': str(apex_sub.id)[:40],
            'notes': {'tenant_id': str(tenant_id), 'addon_code': code,
                      'quantity': str(quantity), 'resale_stock': 'true',
                      'tier_key': tier_key},
        })
    except RuntimeError as e:
        return error_response(str(e), status_code=503)
    except Exception as e:  # noqa: BLE001
        logger.exception('Razorpay order creation failed (resale stock)')
        return error_response(f'Payment gateway error: {str(e)}',
                              status_code=502)

    payment = Payment(
        tenant_subscription_id=apex_sub.id, user_id=current_user.id,
        amount=amount, currency='INR', payment_gateway='razorpay',
        gateway_order_id=rz_order['id'], status=PaymentStatus.CREATED,
        payment_metadata={
            'razorpay_order': rz_order,
            'gateway': _gateway_meta(binding, owner_tenant_id=None),
            'saas_addon': {
                'code': code, 'period': 'monthly', 'quantity': quantity,
                'amount_inr': amount, 'tier_key': tier_key,
                'resale_stock': True,
            },
        },
    )
    db.session.add(payment)
    db.session.commit()
    return success_response(message='Payment order created', data={
        'razorpay_order_id': rz_order['id'],
        'amount': int(round(amount * 100)), 'currency': 'INR',
        'key_id': binding.key_id, 'payment_id': str(payment.id),
    })


@reseller_bp.route('/resale-ledger', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_resale_ledger():
    """Cost vs sell vs margin for every add-on the apex resells: one row
    per (child plan, add-on offer) with the vendor's child-tier cost,
    the apex's price, per-unit margin, and how many units its children
    currently hold on that plan."""
    from app.models import (
        Addon, AddonSubscriptionStatus, TenantAddon, TenantSubscription,
    )

    tenant_id, err = _apex_or_403()
    if err:
        return err
    plans = PlanCatalogService.list_plans(owner_tenant_id=tenant_id)
    addons = {a.code: a for a in Addon.query.filter_by(
        is_deleted=False).all()}

    rows = []
    for plan in plans:
        terms = plan.addon_terms if isinstance(plan.addon_terms, dict) else {}
        offered = {c: t for c, t in terms.items() if isinstance(t, dict)
                   and t.get('active', True)}
        if not offered:
            continue
        sub_ids = [s.tenant_id for s in TenantSubscription.query.filter_by(
            plan_id=plan.id, is_deleted=False).all()]
        for code, t in offered.items():
            addon = addons.get(code)
            if addon is None:
                continue
            sub_cost = addon.effective_tier('subdomain_child')
            dom_cost = addon.effective_tier('custom_domain_child')
            held = 0
            if sub_ids:
                for ta in TenantAddon.query.filter(
                        TenantAddon.tenant_id.in_(sub_ids),
                        TenantAddon.addon_id == addon.id,
                        TenantAddon.is_deleted.is_(False),
                        TenantAddon.status ==
                        AddonSubscriptionStatus.ACTIVE).all():
                    held += (ta.quantity or 0)
            price = t.get('price_inr')
            cost = (sub_cost or {}).get('price_inr')
            # Inventory: what this apex bought to sell on, how much its
            # children hold, what is left to sell.
            from app.api.pricing.subscription_billing import resale_pool
            pool = resale_pool(tenant_id, addon)
            rows.append({
                'stock_bought': pool['bought'],
                'stock_allocated': pool['allocated'],
                'stock_free': pool['free'],
                'plan_code': plan.code,
                'plan_name': plan.name,
                'addon_code': code,
                'addon_name': addon.name,
                'billing_cycle': t.get('billing_cycle') or 'monthly',
                'you_charge': price,
                'cost_subdomain': cost,
                'cost_custom_domain': (dom_cost or {}).get('price_inr'),
                'margin_per_unit': (
                    float(price) - float(cost)
                    if price is not None and cost is not None else None),
                'units_held_by_children': held,
            })
    return success_response(data=rows)


# ── My DNS zone (apex-owned Cloudflare, P4) ─────────────────────────────────
#
# The apex connects its OWN Cloudflare zone; once ready, NEW children
# provision inside it and existing ones move via the explicit migration
# (scripts/migrate_children_to_apex_zone.py or per-child resync). Same
# write-only-secret contract as /admin/payment-gateway: token absent =
# keep, '' = clear, value = rotate.

# Zone apexes are dotted lowercase DNS names: label(.label)+ — at least
# one dot (a single label like 'localhost' is the PLATFORM's own base).
_BASE_DOMAIN_RE = re.compile(
    r'^(?=.{4,255}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?'
    r'(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')


def _validate_dns_payload(data):
    """Field errors for the PUT payload, {} when clean."""
    errors = {}
    base = (data.get('base_domain') or '').strip().lower()
    if 'base_domain' in data:
        if not base or not _BASE_DOMAIN_RE.match(base):
            errors['base_domain'] = (
                'Must be a dotted lowercase domain (e.g. example.in).')
        else:
            from flask import current_app
            platform_base = (current_app.config.get(
                'CLOUDFLARE_BASE_DOMAIN') or '').strip().lower()
            if platform_base and base == platform_base:
                errors['base_domain'] = (
                    'That zone is the platform base domain.')
    if 'zone_id' in data:
        zid = (data.get('zone_id') or '').strip()
        if not zid or len(zid) > 64 or not zid.replace('-', '').isalnum():
            errors['zone_id'] = 'Must be a Cloudflare zone id.'
    if 'ingress_target' in data and data.get('ingress_target'):
        tgt = str(data['ingress_target']).strip()
        if len(tgt) > 255:
            errors['ingress_target'] = 'Too long.'
    if 'proxied' in data and not isinstance(data.get('proxied'), bool):
        errors['proxied'] = 'Must be true or false.'
    return errors


def _dns_payload(tenant_id, cfg):
    """GET/PUT response body: the config + where children live today."""
    from flask import current_app
    from app.models import Tenant

    platform_base = (current_app.config.get(
        'CLOUDFLARE_BASE_DOMAIN') or '').strip().lower() or None
    ready = bool(cfg is not None and cfg.dns_ready)
    children = (Tenant.query
                .filter_by(parent_tenant_id=tenant_id, is_deleted=False)
                .all())
    # ``fqdn`` reflects what DNS provisioning actually achieved — a
    # child whose record still lives in the platform zone (or was never
    # provisioned: local dev, failed sync) shows under platform_zone.
    on_apex, on_platform = [], []
    for child in children:
        if ready and child.fqdn and child.fqdn.endswith('.' + cfg.base_domain):
            on_apex.append(child.slug)
        else:
            on_platform.append(child.slug)
    return {
        'config': cfg.to_dict() if cfg is not None else None,
        'ready': ready,
        # What the child-create dialog should show after the slug field.
        'effective_child_base': (cfg.base_domain if ready else platform_base),
        'platform_base_domain': platform_base,
        'children_zones': {
            'apex_zone': sorted(on_apex),
            'platform_zone': sorted(on_platform),
        },
    }


@reseller_bp.route('/dns', methods=['GET'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_get_dns():
    tenant_id, err = _apex_or_403()
    if err:
        return err
    from app.models import TenantDnsConfig
    cfg = TenantDnsConfig.query.filter_by(
        tenant_id=tenant_id, is_deleted=False).first()
    return success_response(_dns_payload(tenant_id, cfg))


@reseller_bp.route('/dns', methods=['PUT'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_save_dns():
    tenant_id, err = _apex_or_403()
    if err:
        return err
    from sqlalchemy.exc import IntegrityError
    from app.extensions import db
    from app.models import TenantDnsConfig

    data = request.get_json() or {}
    errors = _validate_dns_payload(data)
    if errors:
        return validation_error_response(errors)

    cfg = TenantDnsConfig.query.filter_by(
        tenant_id=tenant_id, is_deleted=False).first()
    if cfg is None:
        cfg = TenantDnsConfig(tenant_id=tenant_id)
        db.session.add(cfg)

    identity_changed = False
    if 'base_domain' in data:
        new_base = data['base_domain'].strip().lower()
        identity_changed = identity_changed or new_base != cfg.base_domain
        cfg.base_domain = new_base
    if 'zone_id' in data:
        new_zone = data['zone_id'].strip()
        identity_changed = identity_changed or new_zone != cfg.zone_id
        cfg.zone_id = new_zone
    if 'ingress_target' in data:
        cfg.ingress_target = (str(data['ingress_target']).strip()
                              or None) if data.get('ingress_target') else None
    if 'proxied' in data:
        cfg.proxied = bool(data['proxied'])
    # Write-only token: absent = keep, '' = clear, value = rotate.
    if 'api_token' in data:
        token = data.get('api_token')
        cfg.api_token = token or None
        identity_changed = True
    if identity_changed:
        cfg.verified_at = None
    cfg.is_active = True

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return error_response(
            'Another reseller already connected that zone.',
            status_code=409, code='base_domain_taken')
    return success_response(_dns_payload(tenant_id, cfg),
                            message='DNS settings saved')


@reseller_bp.route('/dns/test', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
@limiter.limit('10 per minute')
def reseller_test_dns():
    """Live read-only probe: fetch the zone by id with the stored token
    and check its name matches ``base_domain``. Success stamps
    ``verified_at``; failures surface Cloudflare's message verbatim
    (server-internal detail is fine here — the reseller OWNS this zone).
    """
    tenant_id, err = _apex_or_403()
    if err:
        return err
    from app.extensions import db
    from app.models import TenantDnsConfig
    from app.models._base import utcnow
    from app.services.cloudflare_dns import CloudflareDnsService

    cfg = TenantDnsConfig.query.filter_by(
        tenant_id=tenant_id, is_deleted=False).first()
    if cfg is None or not cfg.dns_ready:
        return error_response(
            'Save base domain, zone id and API token first.',
            status_code=400, code='dns_not_configured')
    try:
        zone = CloudflareDnsService.check_zone(cfg.api_token, cfg.zone_id)
    except Exception as e:  # noqa: BLE001 — surface CF error to the owner
        return error_response(
            f'Cloudflare rejected the credentials: {str(e)[:300]}',
            status_code=400, code='dns_test_failed')
    zone_name = (zone or {}).get('name', '')
    if zone_name.lower() != (cfg.base_domain or '').lower():
        return error_response(
            f'Zone id resolves to "{zone_name}", not "{cfg.base_domain}". '
            'Check the zone id.',
            status_code=400, code='dns_zone_mismatch')
    cfg.verified_at = utcnow()
    db.session.commit()
    return success_response(_dns_payload(tenant_id, cfg),
                            message=f'Connected to zone "{zone_name}"')


@reseller_bp.route('/dns', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def reseller_disconnect_dns():
    """Deactivate the zone. Children whose records live in the apex zone
    STOP resolving through it (host matching requires an active config)
    — the console warns before offering this. Credentials stay encrypted
    at rest for a re-connect."""
    tenant_id, err = _apex_or_403()
    if err:
        return err
    from app.extensions import db
    from app.models import TenantDnsConfig
    cfg = TenantDnsConfig.query.filter_by(
        tenant_id=tenant_id, is_deleted=False).first()
    if cfg is None:
        return not_found_response('DNS config')
    cfg.is_active = False
    db.session.commit()
    return success_response(_dns_payload(tenant_id, cfg),
                            message='Zone disconnected')


# ── Announcements to my tenants ─────────────────────────────────────────────

@reseller_bp.route('/announcements', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
@limiter.limit('10 per minute')
def reseller_announce_to_tenants():
    """One bell message to the admins of all (or selected) children.

    Twin of the vendor's ``/platform/announcements`` with the authority
    set pinned to ``parent_tenant_id = me`` — a foreign id neither
    errors nor leaks, it just lands in ``skipped``.
    """
    tenant_id, err = _apex_or_403()
    if err:
        return err
    from app.common.announcements import (
        send_announcement, split_targets, validate_announcement_payload,
    )
    from app.models import Tenant

    data = request.get_json() or {}
    errors, title, body, audience, raw_ids = \
        validate_announcement_payload(data)
    if errors:
        return validation_error_response(errors)

    children = (Tenant.query
                .filter_by(parent_tenant_id=tenant_id, is_deleted=False)
                .with_entities(Tenant.id).all())
    targets, skipped = split_targets(
        (row.id for row in children), audience, raw_ids)
    tenants_n, admins_n = send_announcement(targets, title=title, body=body)
    return success_response(
        {'tenants_reached': tenants_n, 'admins_notified': admins_n,
         'skipped_ids': skipped},
        message=f'Announcement sent to {admins_n} admin(s) '
                f'across {tenants_n} tenant(s)',
    )


# ── Support inbox (my children's channels) ──────────────────────────────────
# The apex half of the seller-support CHANNEL — twin of the vendor's
# /platform/support/* with the authority set pinned to my children.
# SUPER_ADMIN passes; SUB_ADMIN needs the support_chat grant. The
# conversation itself rides /api/v1/service-communication with the
# child tenant's context.

@reseller_bp.route('/support/threads', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def reseller_support_threads():
    from app.api.admin.support_thread import (
        check_support_permission, support_channel_rows,
    )
    tenant_id, err = _apex_or_403()
    if err:
        return err
    err = check_support_permission('view')
    if err:
        return err
    from app.models import Tenant
    child_ids = [row.id for row in Tenant.query
                 .filter_by(parent_tenant_id=tenant_id, is_deleted=False)
                 .with_entities(Tenant.id).all()]
    return success_response(
        support_channel_rows(child_ids, current_user.id))


@reseller_bp.route('/support/tenants/<uuid:child_id>/open', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@limiter.limit('30 per minute')
def reseller_open_support_channel(child_id):
    from app.api.admin.support_thread import check_support_permission
    tenant_id, err = _apex_or_403()
    if err:
        return err
    err = check_support_permission('create')
    if err:
        return err
    from app.models import Tenant
    child = Tenant.query.filter_by(
        id=child_id, parent_tenant_id=tenant_id, is_deleted=False).first()
    if child is None:
        return not_found_response('Tenant')
    from app.api.service_communication.service import (
        SellerSupportChannelService,
    )
    from app.common.tenant_context import with_tenant_context
    from app.extensions import db as _db
    with with_tenant_context(child.id):
        channel = SellerSupportChannelService.get_or_create(child)
        SellerSupportChannelService.ensure_seller_participant(
            channel, current_user.id)
        _db.session.commit()
    return success_response({
        'channel_id': str(channel.id),
        'tenant_slug': child.slug,
        'tenant_name': child.name,
    })

# --------------------------------------------------------------------------- #
# Child add-ons — the apex buys VENDOR add-ons for its children at the
# child-tier price (the vendor charges the apex on the vendor rail; the
# grant lands on the child). Children cannot buy self-serve by design.
# --------------------------------------------------------------------------- #

def _child_tier_key(child):
    """Which commercial tier this child buys at: its own custom domain
    marks the custom_domain tier, otherwise the subdomain tier."""
    return ('custom_domain_child' if getattr(child, 'domain', None)
            else 'subdomain_child')


def _own_child_or_none(apex_id, child_id):
    from app.models import Tenant
    try:
        uuid.UUID(str(child_id))
    except (TypeError, ValueError):
        return None
    return Tenant.query.filter_by(
        id=child_id, parent_tenant_id=apex_id, is_deleted=False).first()


@reseller_bp.route('/addons', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def reseller_addon_catalogue():
    """Vendor add-ons purchasable for children: each with its two
    child-tier terms (a tier the vendor switched off is null)."""
    tenant_id, err = _apex_or_403()
    if err:
        return err
    from app.models import Addon, AddonStatus
    rows = (Addon.query
            .filter_by(is_deleted=False, status=AddonStatus.ACTIVE)
            .order_by(Addon.code).all())
    out = []
    for a in rows:
        sub_t = a.effective_tier('subdomain_child')
        dom_t = a.effective_tier('custom_domain_child')
        if sub_t is None and dom_t is None:
            continue                     # not sold for children at all
        out.append({
            'code': a.code, 'name': a.name,
            'description': a.description,
            'limits': a.limits, 'usage_deltas': a.usage_deltas,
            'subdomain_child': sub_t, 'custom_domain_child': dom_t,
        })
    return success_response(data=out)


@reseller_bp.route('/tenants/<child_id>/addons', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
def reseller_child_addons(child_id):
    """The child's current add-on rows, plus which tier it buys at."""
    tenant_id, err = _apex_or_403()
    if err:
        return err
    child = _own_child_or_none(tenant_id, child_id)
    if child is None:
        return not_found_response('Tenant')
    from app.models import TenantAddon
    rows = (TenantAddon.query
            .filter_by(tenant_id=child.id, is_deleted=False)
            .all())
    return success_response(data={
        'tier_key': _child_tier_key(child),
        'addons': [r.to_dict() for r in rows],
    })


@reseller_bp.route('/tenants/<child_id>/addon-order', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN])
@limiter.limit('20 per minute')
def reseller_child_addon_order(child_id):
    """Create the payment order (vendor rail, charged to the APEX) for
    one add-on purchase landing on the child. Free terms apply
    instantly. Mirrors the tenant's own addon-order endpoint."""
    from app.api.common.payment.routes import (
        _gateway_meta, _razorpay_client,
    )
    from app.api.pricing import subscription_billing as sbill
    from app.api.pricing.service import (
        AddonPrerequisiteMissing, PaymentResolver,
        assert_prerequisites_active,
    )
    from app.models import (
        Addon, AddonStatus, Payment, TenantAddon, TenantSubscription,
    )
    from app.models._enums import AddonSubscriptionStatus, PaymentStatus

    tenant_id, err = _apex_or_403()
    if err:
        return err
    child = _own_child_or_none(tenant_id, child_id)
    if child is None:
        return not_found_response('Tenant')

    data = request.get_json() or {}
    code = (data.get('addon_code') or '').strip()
    try:
        quantity = max(int(data.get('quantity', 1)), 1)
    except (TypeError, ValueError):
        return error_response('quantity must be a number', status_code=400)
    if quantity > 999:
        return error_response('quantity too large', status_code=400)

    addon = Addon.query.filter_by(
        code=code, is_deleted=False, status=AddonStatus.ACTIVE).first()
    if addon is None:
        return not_found_response('Addon')
    try:
        assert_prerequisites_active(str(child.id), addon)
    except AddonPrerequisiteMissing as e:
        return error_response(str(e), status_code=409,
                              code='prerequisite_missing',
                              data={'missing': e.missing})

    tier_key = _child_tier_key(child)
    try:
        # The apex is buying FROM THE VENDOR: price at the vendor's
        # child-tier terms. The child-plan addon_terms are the apex's
        # OWN resale prices and must not apply to this leg.
        terms = sbill.resolve_addon_terms(addon, 'monthly', tier_key,
                                          sub=None)
        existing = TenantAddon.query.filter_by(
            tenant_id=child.id, addon_id=addon.id, is_deleted=False,
        ).first()
        live_qty = 0
        if existing is not None and \
                existing.status != AddonSubscriptionStatus.CANCELLED:
            end = existing.current_period_end
            if end is None:
                live_qty = existing.quantity or 0
            else:
                if end.tzinfo is None:
                    from datetime import timezone as _tz
                    end = end.replace(tzinfo=_tz.utc)
                if end > sbill.utcnow():
                    live_qty = existing.quantity or 0
        sbill.check_addon_quantity(addon, terms, live_qty, quantity)
    except sbill.SubscriptionBillingError as e:
        return error_response(str(e), status_code=400, code='addon_terms')

    amount_rupees = float(terms['price_inr'] or 0) * quantity

    if amount_rupees <= 0:
        row = sbill.apply_addon_purchase(
            str(child.id), addon, 'monthly', quantity,
            actor_user_id=current_user.id, tier_key=tier_key)
        db.session.commit()
        return success_response(message='Add-on activated on the tenant.',
                                data={'no_payment_needed': True,
                                      'amount': 0,
                                      'addon': row.to_dict()})

    # Paid: charge the APEX on the vendor rail; the payment row hangs
    # off the APEX's subscription (it is the payer), the metadata
    # carries the child target.
    apex_sub = TenantSubscription.query.filter_by(
        tenant_id=tenant_id, is_deleted=False).first()
    if apex_sub is None:
        return error_response('No active subscription.', status_code=400)

    amount_paise = int(round(amount_rupees * 100))
    try:
        binding = PaymentResolver.vendor_gateway()
        client = _razorpay_client(binding)
        rz_order = client.order.create({
            'amount': amount_paise,
            'currency': 'INR',
            'receipt': str(apex_sub.id)[:40],
            'notes': {'tenant_id': str(tenant_id),
                      'target_tenant_id': str(child.id),
                      'addon_code': code, 'quantity': str(quantity),
                      'tier_key': tier_key},
        })
    except RuntimeError as e:
        return error_response(str(e), status_code=503)
    except Exception as e:  # noqa: BLE001 — gateway errors surface as 502
        logger.exception('Razorpay order creation failed (child addon)')
        return error_response(f'Payment gateway error: {str(e)}',
                              status_code=502)

    payment = Payment(
        tenant_subscription_id=apex_sub.id,
        user_id=current_user.id,
        amount=amount_rupees,
        currency='INR',
        payment_gateway='razorpay',
        gateway_order_id=rz_order['id'],
        status=PaymentStatus.CREATED,
        payment_metadata={
            'razorpay_order': rz_order,
            'gateway': _gateway_meta(binding, owner_tenant_id=None),
            'saas_addon': {
                'code': code, 'period': 'monthly', 'quantity': quantity,
                'amount_inr': amount_rupees,
                'target_tenant_id': str(child.id),
                'tier_key': tier_key,
            },
        },
    )
    db.session.add(payment)
    db.session.commit()
    return success_response(message='Payment order created', data={
        'razorpay_order_id': rz_order['id'],
        'amount': amount_paise,
        'currency': 'INR',
        'key_id': binding.key_id,
        'payment_id': str(payment.id),
    })

