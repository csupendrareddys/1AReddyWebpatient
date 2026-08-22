"""Tenant-scoped provider-plan HTTP routes.

Three audiences served from this one module:

  * **Tenant super-admin** (``/api/tenant-provider-plans/...``) — CRUD on
    plans the tenant authored for their own providers. Auth: JWT +
    SUPER_ADMIN. Feature-gated per vertical on
    ``tenant.can_create_<vertical>_plans``.
  * **Anonymous signup picker** (``/api/tenant-provider-plans/public/...``) —
    read-only listing of a tenant's ACTIVE plans by vertical, used by
    the in-tenant doctor/clinic/hospital signup forms before the user
    has any credentials. Resolves the tenant from the current host /
    subdomain via the existing ``g.current_tenant_id``.
  * **Tenant provider** (``/api/tenant-provider-plans/me``) — read-only
    "what plan am I on?" for the provider's own dashboard inside the
    tenant.

Platform-owner author-on-behalf lives on the ``platform`` blueprint —
see ``app/api/platform/routes.py`` (or wherever the tenant ops surface
is — wired separately).
"""
from __future__ import annotations

from flask import g, jsonify, request
from flask_jwt_extended import current_user, jwt_required

from app.api.tenant_provider_plan import tenant_provider_plan_bp
from app.api.tenant_provider_plan.service import (
    FeatureNotEntitled,
    PlanCodeConflict,
    PlanNotFound,
    ProviderQuotaExceeded,
    SubscriptionExists,
    TenantProviderPlanError,
    TenantProviderPlanService,
    TenantProviderSubscriptionService,
    WrongVertical,
)
from app.common.decorators import permission_required, role_required
from app.common.responses import (
    created_response, error_response, not_found_response, success_response,
    validation_error_response,
)
from app.models import (
    MembershipPlanStatus, MembershipVertical, UserRole,
)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _parse_vertical(raw: str | None):
    if not raw:
        return None
    try:
        return MembershipVertical(raw.lower())
    except ValueError:
        return None


def _validate_payload(data: dict, *, partial: bool = False) -> dict:
    """Light hand-rolled validator. Matches the project's convention of
    not depending on Marshmallow for new endpoints — keep the shape
    obvious and the errors flat."""
    errors: dict = {}
    if not isinstance(data, dict):
        return {'body': 'Must be a JSON object.'}

    if not partial:
        for field in ('code', 'name', 'vertical'):
            if not data.get(field):
                errors.setdefault('missing', []).append(field)

    if 'vertical' in data:
        if _parse_vertical(data['vertical']) is None:
            errors['vertical'] = 'Must be one of doctor / clinic / hospital.'

    if 'status' in data and data['status'] is not None:
        try:
            MembershipPlanStatus(data['status'])
        except ValueError:
            errors['status'] = 'Must be one of draft / active / archived.'

    for f in ('trial_days', 'sort_order'):
        if f in data and data[f] is not None:
            if not isinstance(data[f], int) or isinstance(data[f], bool):
                errors.setdefault('non_integer', []).append(f)
            elif data[f] < 0:
                errors.setdefault('non_negative', []).append(f)

    for f in ('price_inr_monthly', 'price_inr_annual', 'og_price_inr_monthly'):
        if f in data and data[f] is not None:
            if not isinstance(data[f], (int, float)):
                errors.setdefault('non_numeric', []).append(f)
            elif data[f] < 0:
                errors.setdefault('non_negative', []).append(f)

    if 'features' in data and data['features'] is not None:
        if not isinstance(data['features'], dict):
            errors['features'] = 'Must be an object.'
        else:
            errors.update(_validate_billing_features(data['features']))

    return errors


def _validate_billing_features(features: dict) -> dict:
    """Validate the plan-driven billing keys inside ``features`` (Phase A).
    Other (marketing) keys are left untouched. Flat error keys under
    ``features.*`` so the UI can point at the offending field."""
    errors: dict = {}
    hd = features.get('payout_hold_days')
    if hd not in (None, ''):
        if not isinstance(hd, int) or isinstance(hd, bool) or hd < 0:
            errors['features.payout_hold_days'] = 'Must be an integer >= 0.'
    for key in ('per_patient_fee', 'salary_deduction'):
        fee = features.get(key)
        if fee in (None, ''):
            continue
        if not isinstance(fee, dict):
            errors[f'features.{key}'] = 'Must be an object {mode, value}.'
            continue
        mode = fee.get('mode') or 'none'
        if mode not in ('percentage', 'flat', 'none'):
            errors[f'features.{key}.mode'] = 'Must be percentage / flat / none.'
        val = fee.get('value')
        if mode in ('percentage', 'flat') and val not in (None, ''):
            if not isinstance(val, (int, float)) or isinstance(val, bool) or val < 0:
                errors[f'features.{key}.value'] = 'Must be a number >= 0.'
            elif mode == 'percentage' and val > 100:
                errors[f'features.{key}.value'] = 'Percentage must be <= 100.'

    # Employment terms (Item 2A)
    emp = features.get('employment')
    if emp is not None:
        if not isinstance(emp, dict):
            errors['features.employment'] = 'Must be an object.'
        else:
            for k in ('min_hours_per_day', 'min_hours_per_week', 'min_hours_per_month',
                      'default_monthly_salary', 'default_base_retainer'):
                v = emp.get(k)
                if v not in (None, '') and (not isinstance(v, (int, float)) or isinstance(v, bool) or v < 0):
                    errors[f'features.employment.{k}'] = 'Must be a number >= 0.'
            for k in ('payment_cadence', 'retainer_cadence'):
                v = emp.get(k)
                if v and v not in ('monthly', 'fortnightly'):
                    errors[f'features.employment.{k}'] = 'Must be monthly or fortnightly.'
            fm = emp.get('platform_fee_mode')
            if fm and fm not in ('zero', 'plan', 'custom'):
                errors['features.employment.platform_fee_mode'] = 'Must be zero / plan / custom.'
    oct_ = features.get('offered_consultation_types')
    if oct_ is not None and not isinstance(oct_, list):
        errors['features.offered_consultation_types'] = 'Must be a list.'
    return errors


def _translate(exc: TenantProviderPlanError):
    """Translate domain errors to HTTP responses.

    NOTE: ``error_response`` takes the machine-readable code under the
    ``code=`` keyword, NOT ``error_code=``. The latter is a TypeError
    that turns every domain rejection into a 500 — which is exactly
    what was happening to hospital plan creation when the tenant
    didn't have ``tenant.can_create_hospital_plans`` flipped on:
    ``FeatureNotEntitled`` was raised correctly, ``_translate`` got
    hit, then TypeError'd before it could emit the proper 403.
    """
    if isinstance(exc, FeatureNotEntitled):
        return error_response(
            f"Your tenant doesn't have the add-on required to author "
            f"{exc.vertical.value} plans. Ask the platform owner to "
            f"attach the relevant capability.",
            status_code=403,
            code='feature_not_entitled',
        )
    if isinstance(exc, PlanCodeConflict):
        return error_response(
            'A plan with this code already exists in your tenant.',
            status_code=409, code='plan_code_conflict',
        )
    if isinstance(exc, PlanNotFound):
        return not_found_response('TenantProviderPlan')
    if isinstance(exc, WrongVertical):
        return error_response(str(exc), status_code=400,
                              code='wrong_vertical')
    if isinstance(exc, ProviderQuotaExceeded):
        return error_response(
            str(exc), status_code=402, code='provider_quota_exceeded',
        )
    if isinstance(exc, SubscriptionExists):
        return error_response(str(exc), status_code=409,
                              code='subscription_exists')
    return error_response(str(exc), status_code=400)


def _current_tenant_id():
    """Resolve the tenant_id for the current request. SUPER_ADMIN's
    JWT carries ``current_user.tenant_id`` directly; the value is also
    available via ``g.current_tenant_id`` (set by the request hook).
    """
    return getattr(g, 'current_tenant_id', None) or current_user.tenant_id


# --------------------------------------------------------------------------- #
# Tenant super-admin CRUD
# --------------------------------------------------------------------------- #

@tenant_provider_plan_bp.route('', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def list_plans():
    """List the tenant's authored provider plans. Optional ?vertical
    filter (doctor / clinic / hospital)."""
    vertical = _parse_vertical(request.args.get('vertical'))
    plans = TenantProviderPlanService.list_for_tenant(
        tenant_id=_current_tenant_id(),
        vertical=vertical,
    )
    return success_response(data=[p.to_dict() for p in plans])


@tenant_provider_plan_bp.route('', methods=['POST'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def create_plan():
    """Author a new provider plan in the current tenant."""
    data = request.get_json() or {}
    errors = _validate_payload(data)
    if errors:
        return validation_error_response(errors)
    try:
        plan = TenantProviderPlanService.create(
            tenant_id=_current_tenant_id(),
            author_user_id=current_user.id,
            vertical=_parse_vertical(data['vertical']),
            code=data['code'],
            name=data['name'],
            description=data.get('description'),
            price_inr_monthly=data.get('price_inr_monthly'),
            price_inr_annual=data.get('price_inr_annual'),
            trial_days=data.get('trial_days', 0),
            features=data.get('features'),
            sort_order=data.get('sort_order', 0),
            status=data.get('status', 'draft'),
        )
    except TenantProviderPlanError as exc:
        return _translate(exc)
    return created_response(plan.to_dict(), message='Plan created')


@tenant_provider_plan_bp.route('/<plan_id>', methods=['PATCH'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def update_plan(plan_id):
    data = request.get_json() or {}
    errors = _validate_payload(data, partial=True)
    if errors:
        return validation_error_response(errors)

    # Hand the route's flat dict through, but transform string enum
    # values into the typed enums the service expects.
    payload = dict(data)
    if 'status' in payload and isinstance(payload['status'], str):
        payload['status'] = MembershipPlanStatus(payload['status'])

    try:
        plan = TenantProviderPlanService.update(
            plan_id=plan_id,
            tenant_id=_current_tenant_id(),
            editor_user_id=current_user.id,
            fields=payload,
        )
    except TenantProviderPlanError as exc:
        return _translate(exc)
    return success_response(plan.to_dict(), message='Plan updated')


@tenant_provider_plan_bp.route('/<plan_id>', methods=['DELETE'])
@jwt_required()
@role_required(UserRole.SUPER_ADMIN)
def archive_plan(plan_id):
    """Soft-archive a plan. Live subscriptions are untouched; the plan
    just disappears from the signup picker."""
    try:
        plan = TenantProviderPlanService.archive(
            plan_id=plan_id,
            tenant_id=_current_tenant_id(),
            editor_user_id=current_user.id,
        )
    except TenantProviderPlanError as exc:
        return _translate(exc)
    return success_response(plan.to_dict(), message='Plan archived')


# --------------------------------------------------------------------------- #
# Anonymous signup-time picker
# --------------------------------------------------------------------------- #

@tenant_provider_plan_bp.route('/public/<vertical>', methods=['GET'])
def list_active_for_signup(vertical):
    """Return the tenant's ACTIVE plans for a given vertical, plus a
    ``selection_required`` flag the signup form uses to decide whether
    plan choice is mandatory.

    Tenant is resolved from the current request context. The
    ``before_request`` hook in ``app/__init__.py`` populates
    ``g.tenant_id`` from the Host header (subdomain / custom-domain
    routing). On the apex itself we still return an empty list —
    in-tenant plans don't apply at the apex; apex visitors see the
    platform-wide marketplace catalog at
    ``/api/public/membership-plans`` instead.

    Earlier versions read ``g.current_tenant_id`` (an attribute set
    only by the platform admin routes via ``set_tenant_context``),
    which meant subdomain visitors silently got an empty list and
    the frontend fell back to the apex catalog — leaking the apex
    marketplace plans into every subscriber tenant. Reading the
    canonical ``g.tenant_id`` set by before_request is the fix.
    """
    tenant_id = getattr(g, 'tenant_id', None) or getattr(g, 'current_tenant_id', None)
    parsed = _parse_vertical(vertical)
    if parsed is None:
        return error_response(
            'Unknown vertical.', status_code=400,
        )
    if tenant_id is None:
        return success_response(data={
            'plans': [],
            'selection_required': False,
        })

    # Marketplace bypass: in-tenant plans do not apply on a tenant
    # that runs the public marketplace — its visitors get the
    # marketplace catalog from /api/public/membership-plans instead.
    # Was keyed on ``is_default``; that flag no longer identifies the
    # marketplace after the vendor split. Returning empty here is the
    # same shape the route returned pre-fix when g.tenant_id was
    # None — frontend already handles it.
    from app.api.pricing.service import MarketplacePolicy
    if MarketplacePolicy.runs_marketplace(tenant_id, parsed):
        return success_response(data={
            'plans': [],
            'selection_required': False,
        })
    plans = TenantProviderPlanService.list_active_for_signup(
        tenant_id=tenant_id, vertical=parsed,
    )
    required = TenantProviderPlanService.is_plan_selection_required(
        tenant_id=tenant_id, vertical=parsed,
    )
    return success_response(data={
        'plans': [p.to_dict() for p in plans],
        'selection_required': required,
    })


# --------------------------------------------------------------------------- #
# Provider's own "what plan am I on?" read
# --------------------------------------------------------------------------- #

# --------------------------------------------------------------------------- #
# Feature-paths whitelist (for the structured FeatureTreeEditor)
# --------------------------------------------------------------------------- #

@tenant_provider_plan_bp.route('/feature-paths', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
def list_feature_paths_for_tenant():
    """Return the whitelist of dotted feature paths so the tenant-admin
    ``FeatureTreeEditor`` (reused from the platform-owner pricing UI)
    renders the right set of toggles.

    Accepts an optional ``?vertical=doctor|clinic|hospital`` query
    parameter — when present, returns the vertical-scoped subset
    appropriate for in-tenant provider plans (no subdomain, no
    landing builder, no apex-marketplace listings — those are tenant-
    level features, not provider-of-tenant features). When omitted,
    falls back to the full platform whitelist so existing callers
    (none in the frontend after this commit, but kept for safety) do
    not break.

    Auth: SUPER_ADMIN / SUB_ADMIN. Whitelist is non-sensitive (just
    dotted strings), so exposing it to tenants is fine.
    """
    from app.api.pricing.service import (
        ALLOWED_FEATURE_PATHS, PROVIDER_FEATURE_PATHS_BY_VERTICAL,
    )
    vertical = (request.args.get('vertical') or '').strip().lower()
    if vertical:
        subset = PROVIDER_FEATURE_PATHS_BY_VERTICAL.get(vertical)
        if subset is None:
            return error_response(
                f'Unknown vertical "{vertical}". Must be one of: '
                f'{sorted(PROVIDER_FEATURE_PATHS_BY_VERTICAL.keys())}.',
                status_code=400,
            )
        return success_response(sorted(subset))
    # Legacy / no-vertical caller — full whitelist.
    return success_response(sorted(ALLOWED_FEATURE_PATHS))


@tenant_provider_plan_bp.route('/me', methods=['GET'])
@jwt_required()
def get_my_tenant_membership():
    """Tenant provider's current in-tenant subscription. 404 when the
    caller has no PENDING/TRIAL/ACTIVE row (e.g. they registered before
    the tenant authored any plans)."""
    sub = TenantProviderSubscriptionService.get_active_for_user(
        tenant_id=_current_tenant_id(),
        user_id=current_user.id,
    )
    if sub is None:
        return not_found_response('TenantProviderSubscription')
    return success_response(data={
        'subscription': sub.to_dict(),
        'plan': sub.plan.to_dict() if sub.plan else None,
    })


@tenant_provider_plan_bp.route('/me/request', methods=['POST'])
@jwt_required()
def request_my_tenant_plan():
    """Doctor self-requests a plan; a super/sub-admin approves it later
    (Phase A5). Records a pending request — the doctor's live plan is
    unchanged until approval. Body: ``{"plan_id": "<uuid>"}``."""
    from app.models import Doctor, MembershipVertical
    from app.api.tenant_provider_plan.service import (
        TenantProviderSubscriptionService,
    )
    data = request.get_json() or {}
    plan_id = data.get('plan_id')
    if not plan_id:
        return error_response('plan_id is required', status_code=400)
    doctor = Doctor.query.filter_by(
        tenant_id=_current_tenant_id(), user_id=current_user.id,
        is_deleted=False,
    ).first()
    if doctor is None:
        return error_response(
            'Only doctors can request a plan here.', status_code=403,
        )
    try:
        sub = TenantProviderSubscriptionService.request_plan(
            tenant_id=_current_tenant_id(),
            vertical=MembershipVertical.DOCTOR,
            provider_id=doctor.id,
            user_id=current_user.id,
            plan_id=plan_id,
        )
    except TenantProviderPlanError as exc:
        return _translate(exc)
    return success_response(
        data=sub.to_dict(),
        message='Plan requested — pending admin approval',
    )


# --------------------------------------------------------------------------- #
# Round 10 — tenant SUPER_ADMIN manages all provider subscriptions in their
# tenant. Mounted on the SAME blueprint (the URL prefix is
# ``/api/tenant-provider-plans``) — the routes below are under the sibling
# ``/api/tenant-provider-subscriptions`` prefix; see __init__.py for how the
# second blueprint registration handles that. Service-layer methods enforce
# tenant-scoping with a redundant filter even though RLS would already
# reject cross-tenant reads/writes.
# --------------------------------------------------------------------------- #

from app.api.tenant_provider_plan import tenant_provider_subscription_bp
from app.models import AdminPermission, MembershipSubscriptionStatus


def _provider_display_name(sub):
    """Best-effort resolution of a human label for a subscription row.

    Resolves via the bound ``User`` row (joined via ``user_id``).
    The TenantProviderSubscription model exposes ``user_id`` (FK)
    but no SQLAlchemy ``user`` relationship — earlier versions of
    this helper assumed there was one and 500'd with
    ``AttributeError: 'TenantProviderSubscription' object has no
    attribute 'user'`` the first time anyone GET'd the listing.

    Query is O(N) per page render which is fine for current
    table sizes (a tenant has tens, not thousands, of providers).
    If it becomes a hotspot, the route can pre-fetch all unique
    user_ids in one query and pass a lookup map down.
    """
    from app.models import User
    if not getattr(sub, 'user_id', None):
        return f'Provider {sub.id}'
    u = User.query.get(sub.user_id)
    if u is None:
        return f'Provider {sub.id}'
    fn = (u.first_name or '').strip()
    ln = (u.last_name or '').strip()
    label = f'{fn} {ln}'.strip()
    return label or f'Provider {sub.id}'


def _serialize_subscription(sub):
    """Subscription + plan + provider label, ready for the admin table."""
    plan = sub.plan if sub.plan else None
    return {
        **sub.to_dict(),
        'plan_code': plan.code if plan else None,
        'plan_name': plan.name if plan else None,
        'provider_display_name': _provider_display_name(sub),
    }


@tenant_provider_subscription_bp.route('', methods=['GET'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.VIEW_PROVIDER_SUBSCRIPTIONS)
def list_tenant_provider_subscriptions():
    """All in-tenant provider subscriptions for the caller's tenant.

    Optional filters: ``?vertical=doctor|clinic|hospital``,
    ``?status=pending|trial|active|past_due|cancelled|suspended``.
    Tenant scope is implicit (resolved from the caller's JWT
    ``tenant_id`` claim via ``current_tenant_id_strict``); no caller
    can ever see another tenant's rows here.
    """
    tid = _current_tenant_id()
    vertical_raw = (request.args.get('vertical') or '').strip().lower()
    status_raw = (request.args.get('status') or '').strip().lower()

    vertical = None
    if vertical_raw:
        vertical = _parse_vertical(vertical_raw)
        if vertical is None:
            return error_response(
                f'Unknown vertical "{vertical_raw}".', status_code=400,
            )
    status = None
    if status_raw:
        try:
            status = MembershipSubscriptionStatus(status_raw)
        except ValueError:
            return error_response(
                f'Unknown status "{status_raw}".', status_code=400,
            )

    subs = TenantProviderSubscriptionService.list_for_tenant(
        tenant_id=tid, vertical=vertical, status=status,
    )
    return success_response(data={
        'subscriptions': [_serialize_subscription(s) for s in subs],
    })


@tenant_provider_subscription_bp.route(
    '/<subscription_id>', methods=['PATCH'],
)
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_PROVIDER_SUBSCRIPTIONS)
def change_tenant_provider_subscription_plan(subscription_id):
    """Move a provider's subscription to a different plan in the same
    tenant + same vertical. Body: ``{plan_id: <new-plan-uuid>}``.

    Service enforces both checks (subscription belongs to tenant + new
    plan belongs to tenant + verticals match). Cross-tenant writes are
    impossible by construction here — the tenant_id is resolved from
    the caller's JWT, never from the request body.
    """
    body = request.get_json(silent=True) or {}
    new_plan_id = body.get('plan_id')
    if not new_plan_id:
        return validation_error_response({'plan_id': 'required'})

    try:
        sub = TenantProviderSubscriptionService.change_plan(
            tenant_id=_current_tenant_id(),
            subscription_id=subscription_id,
            new_plan_id=new_plan_id,
            actor_user_id=current_user.id,
        )
    except PlanNotFound:
        return not_found_response('TenantProviderSubscription')
    except WrongVertical as exc:
        return error_response(str(exc), status_code=400,
                              code='wrong_vertical')
    except TenantProviderPlanError as exc:
        return error_response(str(exc), status_code=400)
    return success_response(
        data=_serialize_subscription(sub),
        message='Subscription plan updated',
    )


@tenant_provider_subscription_bp.route(
    '/unsubscribed-providers', methods=['GET'],
)
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_PROVIDER_SUBSCRIPTIONS)
def list_unsubscribed_providers():
    """List providers in this tenant that don't have a live
    subscription. Powers the "Subscribe Provider" picker so the
    super_admin can attach a plan retroactively (used after Round 9
    fixed the plan-attach bug — existing providers from before the
    fix have no subscription row).

    Required ``?vertical=doctor|clinic|hospital``.
    """
    tid = _current_tenant_id()
    vertical_raw = (request.args.get('vertical') or '').strip().lower()
    if not vertical_raw:
        return validation_error_response({'vertical': 'required'})
    vertical = _parse_vertical(vertical_raw)
    if vertical is None:
        return error_response(
            f'Unknown vertical "{vertical_raw}".', status_code=400,
        )
    providers = TenantProviderSubscriptionService.list_unsubscribed_providers(
        tenant_id=tid, vertical=vertical,
    )
    return success_response(data={'providers': providers})


@tenant_provider_subscription_bp.route('', methods=['POST'])
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_PROVIDER_SUBSCRIPTIONS)
def create_tenant_provider_subscription():
    """Attach a provider in this tenant to one of the tenant's
    authored plans, in PENDING state.

    Body: ``{vertical, provider_id, user_id, plan_id}``. All four
    are required. Reuses ``create_pending_for_provider`` — same
    invariants apply (tenant scope on the plan, vertical match,
    quota check, one-live-subscription-per-provider).
    """
    body = request.get_json(silent=True) or {}
    errs = {}
    for k in ('vertical', 'provider_id', 'user_id', 'plan_id'):
        if not body.get(k):
            errs[k] = 'required'
    if errs:
        return validation_error_response(errs)

    vertical = _parse_vertical(body['vertical'])
    if vertical is None:
        return error_response(
            f'Unknown vertical "{body["vertical"]}".', status_code=400,
        )

    try:
        sub = TenantProviderSubscriptionService.create_pending_for_provider(
            tenant_id=_current_tenant_id(),
            vertical=vertical,
            provider_id=body['provider_id'],
            user_id=body['user_id'],
            plan_id=body['plan_id'],
        )
    except PlanNotFound:
        return not_found_response('TenantProviderPlan')
    except WrongVertical as exc:
        return error_response(
            str(exc), status_code=400, code='wrong_vertical',
        )
    except SubscriptionExists as exc:
        return error_response(
            str(exc), status_code=409, code='subscription_exists',
        )
    except ProviderQuotaExceeded as exc:
        return error_response(
            str(exc), status_code=402, code='provider_quota_exceeded',
        )
    except TenantProviderPlanError as exc:
        return error_response(str(exc), status_code=400)
    return created_response(
        _serialize_subscription(sub),
        message='Subscription created',
    )


@tenant_provider_subscription_bp.route(
    '/<subscription_id>/activate', methods=['POST'],
)
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_PROVIDER_SUBSCRIPTIONS)
def activate_tenant_provider_subscription(subscription_id):
    """Flip a PENDING / TRIAL subscription to ACTIVE.

    Used when the verification-approval auto-trigger didn't fire
    (rare — e.g. the provider was Subscribe-Provider-backfilled
    after being verified). Idempotent on already-ACTIVE rows;
    refuses to re-activate CANCELLED rows.
    """
    try:
        sub = TenantProviderSubscriptionService.activate(
            tenant_id=_current_tenant_id(),
            subscription_id=subscription_id,
            actor_user_id=current_user.id,
        )
    except PlanNotFound:
        return not_found_response('TenantProviderSubscription')
    except TenantProviderPlanError as exc:
        return error_response(str(exc), status_code=400)
    return success_response(
        data=_serialize_subscription(sub),
        message='Subscription activated',
    )


@tenant_provider_subscription_bp.route(
    '/<subscription_id>/approve-request', methods=['POST'],
)
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_PROVIDER_SUBSCRIPTIONS)
def approve_tenant_provider_subscription_request(subscription_id):
    """Approve a provider's plan request (Phase A5): apply a pending
    plan-change request (then clear it), or activate a PENDING signup
    request. Idempotent when there's nothing to approve."""
    try:
        sub = TenantProviderSubscriptionService.approve_request(
            tenant_id=_current_tenant_id(),
            subscription_id=subscription_id,
            actor_user_id=current_user.id,
        )
    except PlanNotFound:
        return not_found_response('TenantProviderSubscription')
    except TenantProviderPlanError as exc:
        return error_response(str(exc), status_code=400)
    return success_response(
        data=_serialize_subscription(sub),
        message='Request approved',
    )


@tenant_provider_subscription_bp.route(
    '/<subscription_id>', methods=['DELETE'],
)
@jwt_required()
@role_required([UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN])
@permission_required(AdminPermission.MANAGE_PROVIDER_SUBSCRIPTIONS)
def cancel_tenant_provider_subscription(subscription_id):
    """Soft-cancel a provider's subscription. The row stays for audit;
    status flips to CANCELLED. Re-subscribing later creates a new row.
    Idempotent."""
    try:
        sub = TenantProviderSubscriptionService.cancel(
            tenant_id=_current_tenant_id(),
            subscription_id=subscription_id,
            actor_user_id=current_user.id,
        )
    except PlanNotFound:
        return not_found_response('TenantProviderSubscription')
    return success_response(
        data=_serialize_subscription(sub),
        message='Subscription cancelled',
    )
