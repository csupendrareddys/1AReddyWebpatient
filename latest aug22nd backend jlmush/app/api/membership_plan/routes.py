"""Tenant-scoped membership-plan CRUD.

Mirrors ``tenant_provider_plan.routes`` but for the marketplace
membership catalog. Callers:

  * A tenant ``SUPER_ADMIN`` authoring their own tenant's tiers.
  * The ``PLATFORM_OWNER`` authoring on the apex (default tenant) — same
    endpoint, tenant resolved from the request host (default tenant on
    the apex).

Every query is filtered on the resolved ``current_tenant_id`` in addition
to RLS, because in dev the app connects as a Postgres superuser that
bypasses RLS — the explicit filter keeps tenants isolated locally too.
"""
from __future__ import annotations

from flask import request
from flask_jwt_extended import current_user, jwt_required

from app.api.membership_plan import membership_plan_bp
from app.api.platform.membership_validators import MembershipPlanValidator
from app.api.pricing.service import FeatureGate
from app.common.decorators import role_required
from app.common.responses import (
    created_response, error_response, no_content_response,
    not_found_response, success_response, validation_error_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models._base import utcnow
from app.models._enums import MembershipPlanStatus, MembershipTier, UserRole


# Billing periods carried on the payload — each has a ``price_inr_*`` and
# a "no discount" ``og_price_inr_*`` twin. Mirrors ``_create_pricing_dict``
# in the (legacy) platform route.
_PRICING_PERIODS = (
    'monthly', 'quarterly', 'semi_annual', 'annual', 'biennial', 'triennial',
)

# Vertical code → the per-vertical membership feature path (provider verticals).
# Receiver (patient) verticals may author plans without a provider entitlement —
# see the is_receiver bypass in ``_entitlement_error``.
_MEMBERSHIP_FEATURE = {
    'doctor': 'tenant.can_create_membership_doctor_plans',
    'clinic': 'tenant.can_create_membership_clinic_plans',
    'hospital': 'tenant.can_create_membership_hospital_plans',
}

# PLATFORM_OWNER is here so it can author on the apex (default tenant);
# the feature gate itself is bypassed for the default tenant.
_MANAGE_ROLES = [UserRole.SUPER_ADMIN, UserRole.PLATFORM_OWNER]
_VIEW_ROLES = [UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN, UserRole.PLATFORM_OWNER]


def _pricing_dict(data: dict) -> dict:
    """Collect ``price_inr_<period>`` / ``og_price_inr_<period>`` into the
    JSON ``pricing`` blob. Keeps ``-1`` (Custom) and ``0`` (free — a price the
    admin typed, rendered as "Free" on the card); drops only blank/absent,
    which is what "period not offered" means."""
    pricing: dict = {}
    for period in _PRICING_PERIODS:
        for prefix in ('price_inr_', 'og_price_inr_'):
            key = f'{prefix}{period}'
            if data.get(key) not in (None, ''):
                pricing[key] = float(data[key])
    return pricing


def _mentions_pricing(data: dict) -> bool:
    """Whether this payload is speaking about prices at all.

    ``pricing`` is rebuilt wholesale from the payload on update, which is right
    for the admin dialog — it renders every period, so an omitted one genuinely
    means "no longer offered". It is catastrophic for any other caller: a PUT
    carrying one unrelated field would rebuild the blob from nothing and silently
    delete every price on the plan. That is not hypothetical; it wiped four
    plans' pricing while this feature was being verified.

    So the wholesale rebuild now needs the payload to mention at least one price
    field. Editing something else leaves prices alone; the dialog is unaffected
    because it always sends them.
    """
    return any(
        f'{prefix}{period}' in data
        for period in _PRICING_PERIODS
        for prefix in ('price_inr_', 'og_price_inr_')
    )


def _charge_kwargs(data: dict) -> dict:
    """The three relocated platform-charge fields present in the payload.

    Only keys actually supplied are returned, so the model's column
    defaults ('Platform Fee' / 'percentage' / 0 …) fill in anything the
    create payload omits — matching the pre-move BillingConfig defaults.
    """
    kwargs = {}
    for n in (1, 2, 3):
        for suffix in ('name', 'type', 'value', 'tax_type', 'tax_value'):
            key = f'charge{n}_{suffix}'
            if key in data:
                kwargs[key] = data[key]
    return kwargs


# The two capacity caps. Kept next to the charge helper because they share its
# rule: a key that isn't in the payload is left alone, so a partial update from
# a form that doesn't render these fields can't blank them.
_LIMIT_FIELDS = ('max_support_staff', 'max_link_connections')


def _normalise_limit(value):
    """A cap as it should be stored: ``None`` for unlimited, else a whole int.

    Three inputs mean unlimited and all of them arrive in practice — an absent
    key, a cleared field (``''`` / ``None``), and the ``-1`` an operator types
    out of habit from the SaaS plan form. They collapse here so the column has
    a single spelling; otherwise every card, meter and comparison downstream
    would have to know all three.
    """
    if value in (None, '', -1, '-1'):
        return None
    return int(value)


def _limit_kwargs(data: dict) -> dict:
    """Normalised caps for the keys actually present in ``data``."""
    return {
        field_name: _normalise_limit(data[field_name])
        for field_name in _LIMIT_FIELDS
        if field_name in data
    }


def _vertical_code(vertical_plan_type_id):
    """The vertical's ``code``, resolved WITHIN the caller's tenant.

    Tenant-scoped lookup (not ``.get()``) since ``vertical_plan_types`` is
    per-tenant: a payload naming another tenant's vertical id must resolve to
    None here, so the entitlement check below rejects it rather than letting a
    plan point across the tenant boundary.
    """
    from app.models.membership import VerticalPlanType
    if not vertical_plan_type_id:
        return None
    vpt = VerticalPlanType.query.filter_by(
        id=vertical_plan_type_id, tenant_id=current_tenant_id_strict(),
    ).first()
    return vpt.code if vpt else None


def _is_receiver_vertical(vertical_plan_type_id) -> bool:
    """Whether a vertical id points at a service-RECEIVER vertical.

    Tenant-scoped like ``_vertical_code``: an id belonging to another tenant
    resolves to None and therefore to False, so it can't be used to smuggle a
    member discount onto a provider tier.
    """
    from app.models.membership import VerticalPlanType
    if not vertical_plan_type_id:
        return False
    vpt = VerticalPlanType.query.filter_by(
        id=vertical_plan_type_id, tenant_id=current_tenant_id_strict(),
    ).first()
    return bool(vpt and vpt.is_receiver)


def _member_discount_for(vertical_plan_type_id, data, current=0):
    """The member discount to store — always 0 on a provider vertical.

    Zeroed rather than rejected with a 400: the field is hidden in the admin
    dialog for provider tiers, so a non-zero value arriving on one is a stale
    form or an older payload, not an operator decision worth failing a save
    over. Only receivers (patients) get a discount — see
    ``app.common.member_discount.is_receiver_plan`` for why.
    """
    if not _is_receiver_vertical(vertical_plan_type_id):
        return 0
    if 'member_discount_pct' not in data:
        return current
    return data.get('member_discount_pct') or 0


def _entitlement_error(tenant_id, vertical_code):
    """Return an error response if this tenant may not author membership
    plans for ``vertical_code``, else ``None``.

    * Unknown / non-provider vertical → 400.
    * Provider vertical without the per-vertical feature → 403.

    The apex/default tenant passes automatically (FeatureGate is_default
    bypass), so the platform owner is never blocked on the apex.
    """
    from app.models.membership import VerticalPlanType

    # Receiver (patient) verticals may author plans freely — there is no
    # per-vertical provider entitlement for them.
    vpt = VerticalPlanType.query.filter_by(
        code=vertical_code, tenant_id=current_tenant_id_strict(),
    ).first()
    if vpt is not None and vpt.is_receiver:
        return None

    path = _MEMBERSHIP_FEATURE.get(vertical_code)
    if path is None:
        return error_response(
            'Membership plans are only available for provider verticals '
            '(doctor / clinic / hospital) or a receiver (patient) vertical.',
            status_code=400,
        )
    if not FeatureGate.is_enabled(tenant_id, path):
        return error_response(
            f'This tenant is not entitled to author {vertical_code} '
            'membership plans.',
            status_code=403,
        )
    return None


# ── Patient Family quotas carried ON the plan ────────────────────────────────
# A minor / linked member never buys their own plan — the OWNER's (receiver)
# plan governs how many they may have. So the quotas are configured on the plan
# itself (create/edit dialog), not a separate page. Stored in PatientFamilyPolicy;
# these two helpers read it into, and write it out of, the plan payload.

def _family_policy_dict(plan):
    """Current Patient Family quotas for a RECEIVER plan (``None`` otherwise, so
    the editor only shows the fields where they apply)."""
    from app.models import PatientFamilyPolicy
    vpt = plan.vertical_plan_type
    if not (vpt and vpt.is_receiver):
        return None
    pol = PatientFamilyPolicy.query.filter_by(
        tenant_id=plan.tenant_id, plan_id=plan.id).first()
    return {
        'max_minor_subaccounts': pol.max_minor_subaccounts if pol else 0,
        'max_family_links': pol.max_family_links if pol else 0,
        'max_patient_roles': pol.max_patient_roles if pol else 0,
        'is_active': pol.is_active if pol else True,
    }


def _apply_family_policy(plan, data):
    """Upsert the plan's Patient Family quotas from the payload — receiver plans
    only, and only when a quota field is present. -1 = unlimited, 0 = none.
    Caller commits."""
    from app.models import PatientFamilyPolicy
    vpt = plan.vertical_plan_type
    if not (vpt and vpt.is_receiver):
        return
    keys = ('max_minor_subaccounts', 'max_family_links', 'max_patient_roles')
    if not any(k in data for k in keys) and 'family_quota_active' not in data:
        return
    pol = PatientFamilyPolicy.query.filter_by(
        tenant_id=plan.tenant_id, plan_id=plan.id).first()
    if pol is None:
        pol = PatientFamilyPolicy(tenant_id=plan.tenant_id, plan_id=plan.id)
        db.session.add(pol)
    for k in keys:
        if k in data and data[k] is not None:
            try:
                pol_val = int(data[k])
            except (TypeError, ValueError):
                pol_val = 0
            setattr(pol, k, max(-1, pol_val))
    if 'family_quota_active' in data:
        pol.is_active = bool(data['family_quota_active'])


def _plan_row(plan):
    """Plan dict + its receiver family quotas (for the admin list/editor)."""
    return {**plan.to_dict(), 'family_policy': _family_policy_dict(plan)}


@membership_plan_bp.route('', methods=['GET'])
@jwt_required()
@role_required(_VIEW_ROLES)
def list_membership_plans():
    """Every non-deleted plan for the current tenant, any status (admin
    view — Draft / Active / Archived all show)."""
    from app.models import MembershipPlan
    tenant_id = current_tenant_id_strict()
    plans = (
        MembershipPlan.query
        .filter_by(tenant_id=tenant_id, is_deleted=False)
        .order_by(
            MembershipPlan.sort_order.asc(),
            MembershipPlan.tier.asc(),
            MembershipPlan.created_at.asc(),
        )
        .all()
    )
    return success_response([_plan_row(p) for p in plans])


@membership_plan_bp.route('/<code>', methods=['GET'])
@jwt_required()
@role_required(_VIEW_ROLES)
def get_membership_plan(code):
    from app.models import MembershipPlan
    tenant_id = current_tenant_id_strict()
    plan = MembershipPlan.query.filter_by(
        tenant_id=tenant_id, code=code, is_deleted=False,
    ).first()
    if not plan:
        return not_found_response('MembershipPlan')
    return success_response(plan.to_dict())


@membership_plan_bp.route('', methods=['POST'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def create_membership_plan():
    from app.models import MembershipPlan
    tenant_id = current_tenant_id_strict()
    data = request.get_json() or {}

    errors = MembershipPlanValidator.validate_create(data)
    if errors:
        return validation_error_response(errors)

    gate = _entitlement_error(
        tenant_id, _vertical_code(data.get('vertical_plan_type_id')),
    )
    if gate is not None:
        return gate

    # Code is unique WITHIN the tenant.
    if MembershipPlan.query.filter_by(
        tenant_id=tenant_id, code=data['code'], is_deleted=False,
    ).first():
        return error_response(
            f'Membership plan with code "{data["code"]}" already exists',
            status_code=409,
        )

    plan = MembershipPlan(
        tenant_id=tenant_id,
        code=data['code'],
        name=data['name'],
        description=data.get('description'),
        vertical_plan_type_id=data['vertical_plan_type_id'],
        tier=MembershipTier(data['tier']),
        pricing=_pricing_dict(data),
        trial_days=data.get('trial_days', 0),
        commission_pct=data.get('commission_pct'),
        platform_fee_inr=data.get('platform_fee_inr'),
        member_discount_pct=_member_discount_for(
            data.get('vertical_plan_type_id'), data,
        ),
        **_charge_kwargs(data),
        **_limit_kwargs(data),
        status=MembershipPlanStatus(data.get('status', 'draft')),
        holding_enabled=bool(data.get('holding_enabled', True)),
        is_featured=bool(data.get('is_featured', False)),
        is_legacy=bool(data.get('is_legacy', False)),
        publish_on_landing=bool(data.get('publish_on_landing', False)),
        features=data.get('features') or {},
        sort_order=data.get('sort_order', 0),
        benefits=data.get('benefits') or [],
        created_by_id=current_user.id,
    )
    db.session.add(plan)
    db.session.commit()
    # Family quotas live on the plan for receiver tiers — persist them together.
    _apply_family_policy(plan, data)
    db.session.commit()
    return created_response(_plan_row(plan), message='Membership plan created')


@membership_plan_bp.route('/<code>', methods=['PUT'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def update_membership_plan(code):
    from app.models import MembershipPlan
    tenant_id = current_tenant_id_strict()
    plan = MembershipPlan.query.filter_by(
        tenant_id=tenant_id, code=code, is_deleted=False,
    ).first()
    if not plan:
        return not_found_response('MembershipPlan')

    data = request.get_json() or {}
    errors = MembershipPlanValidator.validate_update(data)
    if errors:
        return validation_error_response(errors)

    # Re-check entitlement against the (possibly changed) vertical.
    new_vpt = data.get('vertical_plan_type_id', plan.vertical_plan_type_id)
    gate = _entitlement_error(tenant_id, _vertical_code(new_vpt))
    if gate is not None:
        return gate

    for field_name in (
        'name', 'description', 'trial_days', 'commission_pct',
        'platform_fee_inr', 'is_featured', 'is_legacy', 'publish_on_landing', 'features',
        'benefits', 'sort_order', 'vertical_plan_type_id', 'holding_enabled',
        # The three relocated platform charges (name/type/value + per-charge tax).
        'charge1_name', 'charge1_type', 'charge1_value', 'charge1_tax_type', 'charge1_tax_value',
        'charge2_name', 'charge2_type', 'charge2_value', 'charge2_tax_type', 'charge2_tax_value',
        'charge3_name', 'charge3_type', 'charge3_value', 'charge3_tax_type', 'charge3_tax_value',
    ):
        if field_name in data:
            setattr(plan, field_name, data[field_name])
    # Normalised, not set straight through — "" and -1 both have to reach the
    # column as NULL. Absent keys stay absent, so a caller that doesn't know
    # about caps can't clear them.
    for field_name, value in _limit_kwargs(data).items():
        setattr(plan, field_name, value)
    if _mentions_pricing(data):
        plan.pricing = _pricing_dict(data)
    # Re-derived on every save against the (possibly changed) vertical, so
    # repointing a receiver tier at a provider vertical drops its discount
    # instead of leaving an orphaned one behind.
    plan.member_discount_pct = _member_discount_for(
        new_vpt, data, current=plan.member_discount_pct or 0,
    )

    if 'tier' in data:
        plan.tier = MembershipTier(data['tier'])
    if 'status' in data:
        plan.status = MembershipPlanStatus(data['status'])

    plan.updated_by_id = current_user.id
    _apply_family_policy(plan, data)
    db.session.commit()
    return success_response(_plan_row(plan), message='Membership plan updated')


@membership_plan_bp.route('/<code>', methods=['DELETE'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def archive_membership_plan(code):
    """Archive a plan (close it to NEW subscribers) — never remove one that
    members are still on.

    Grandfather semantics, the way every SaaS handles a retired plan:

    * With live members (PENDING / TRIAL / ACTIVE / PAST_DUE) the plan is set
      ARCHIVED but NOT soft-deleted, so it stays fully intact for those members
      (their ``subscription.plan`` keeps resolving, its vertical, pricing and
      charges are unchanged). It just stops being offered to new subscribers —
      every "assignable plan" list already filters to ``active`` status.
    * With no live members the plan is genuinely removed (ARCHIVED + soft-
      deleted).
    """
    from app.models import MembershipPlan, MembershipSubscription
    from app.models._enums import MembershipSubscriptionStatus
    tenant_id = current_tenant_id_strict()
    plan = MembershipPlan.query.filter_by(
        tenant_id=tenant_id, code=code, is_deleted=False,
    ).first()
    if not plan:
        return not_found_response('MembershipPlan')

    live_members = MembershipSubscription.query.filter(
        MembershipSubscription.tenant_id == tenant_id,
        MembershipSubscription.membership_plan_id == plan.id,
        MembershipSubscription.is_deleted.is_(False),
        MembershipSubscription.status.in_([
            MembershipSubscriptionStatus.PENDING,
            MembershipSubscriptionStatus.TRIAL,
            MembershipSubscriptionStatus.ACTIVE,
            MembershipSubscriptionStatus.PAST_DUE,
        ]),
    ).count()

    # Archive is a REVERSIBLE "on hold" — it never soft-deletes the plan, so it
    # keeps showing in the admin catalog (as "archived") and can be revived any
    # time by flipping its status back to Active. It just stops being offered to
    # new subscribers (every "assignable plan" list filters to active status),
    # while existing members keep it fully intact.
    plan.status = MembershipPlanStatus.ARCHIVED
    plan.updated_by_id = current_user.id
    db.session.commit()
    detail = (f' {live_members} existing member(s) keep it unchanged.'
              if live_members else '')
    return success_response(plan.to_dict(), message=(
        'Plan archived — closed to new subscribers.' + detail
        + ' You can revive it any time by setting it Active.'))


# ── Health-credit policies ────────────────────────────────────────────────────
# The credit GRANT + per-offering redemption caps for each plan, managed on their
# OWN admin surface (not the plan dialog). Edits here take effect immediately for
# every subscriber — ``credit_service`` reads the live policy by ``plan_id`` at
# grant / quote time, so nothing waits on a plan re-version or a renewal.

def _plan_credit_row(plan, policy):
    """Compact plan + its credit policy for the admin Credits page."""
    vpt = plan.vertical_plan_type
    return {
        'plan_id': str(plan.id),
        'code': plan.code,
        'name': plan.name,
        'tier': plan.tier.value,
        'status': plan.status.value,
        'vertical_code': vpt.code if vpt else None,
        'vertical_label': (vpt.name or vpt.code) if vpt else None,
        'is_receiver': bool(vpt.is_receiver) if vpt else False,
        'policy': policy.to_dict() if policy else {
            'plan_id': str(plan.id), 'grant_amount': 0.0,
            'scopes': {}, 'is_active': True, 'validity_days': None,
            'second_opinion_grant': 0.0, 'second_opinion_redeem_threshold': 0.0,
            'second_opinion_grants': {}, 'second_opinion_pct': 0.0,
            'second_opinion_pcts': {},
        },
    }


def _sanitize_scopes(raw):
    """Normalise a client scopes map to ``{scope: {allowed, max_pct, max_amount}}``.

    Drops junk keys, coerces the caps to numbers (or None), and keeps only the
    three recognised fields so a malformed payload can't poison the quote math.
    """
    out = {}
    if not isinstance(raw, dict):
        return out

    def _num(v):
        if v in (None, ''):
            return None
        try:
            n = float(v)
        except (TypeError, ValueError):
            return None
        return n if n >= 0 else None

    for scope, cfg in raw.items():
        if not isinstance(cfg, dict):
            continue
        out[str(scope)] = {
            'allowed': bool(cfg.get('allowed')),
            'max_pct': _num(cfg.get('max_pct')),
            'max_amount': _num(cfg.get('max_amount')),
        }
    return out


@membership_plan_bp.route('/credit-policies', methods=['GET'])
@jwt_required()
@role_required(_VIEW_ROLES)
def list_credit_policies():
    """Every non-deleted plan for this tenant with its (live) credit policy."""
    from app.models import MembershipPlan, CreditPolicy
    tenant_id = current_tenant_id_strict()
    plans = (
        MembershipPlan.query
        .filter_by(tenant_id=tenant_id, is_deleted=False)
        .order_by(
            MembershipPlan.sort_order.asc(),
            MembershipPlan.tier.asc(),
            MembershipPlan.created_at.asc(),
        )
        .all()
    )
    policies = {
        p.plan_id: p for p in
        CreditPolicy.query.filter_by(tenant_id=tenant_id).all()
    }
    return success_response([
        _plan_credit_row(p, policies.get(p.id)) for p in plans
    ])


@membership_plan_bp.route('/<plan_id>/credit-policy', methods=['PUT'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def upsert_credit_policy(plan_id):
    """Create / update the credit policy for a plan.

    Body: ``{grant_amount, scopes: {scope: {allowed, max_pct, max_amount}},
    is_active}``. Takes effect immediately for all current subscribers.
    """
    from app.models import MembershipPlan, CreditPolicy
    tenant_id = current_tenant_id_strict()
    plan = MembershipPlan.query.filter_by(
        id=plan_id, tenant_id=tenant_id, is_deleted=False,
    ).first()
    if not plan:
        return not_found_response('MembershipPlan')

    data = request.get_json() or {}
    try:
        grant = float(data.get('grant_amount') or 0)
    except (TypeError, ValueError):
        return error_response('grant_amount must be a number', status_code=400)
    if grant < 0:
        return error_response('grant_amount cannot be negative', status_code=400)

    # Credit validity window (days). Empty / null clears the override so
    # grants fall back to the subscription's billing-period end. 0 is not a
    # meaningful expiry, so treat it as "clear".
    validity_days = None
    if 'validity_days' in data:
        raw = data.get('validity_days')
        if raw not in (None, ''):
            try:
                validity_days = int(raw)
            except (TypeError, ValueError):
                return error_response('validity_days must be a whole number', status_code=400)
            if validity_days < 0:
                return error_response('validity_days cannot be negative', status_code=400)
            if validity_days == 0:
                validity_days = None

    policy = CreditPolicy.query.filter_by(
        tenant_id=tenant_id, plan_id=plan.id,
    ).first()
    if policy is None:
        policy = CreditPolicy(tenant_id=tenant_id, plan_id=plan.id)
        db.session.add(policy)

    policy.grant_amount = grant
    policy.scopes = _sanitize_scopes(data.get('scopes'))
    if 'is_active' in data:
        policy.is_active = bool(data.get('is_active'))
    if 'validity_days' in data:
        policy.validity_days = validity_days

    # Family-doctor second-opinion commission config (non-negative).
    for key in ('second_opinion_grant', 'second_opinion_redeem_threshold'):
        if key in data:
            try:
                val = float(data.get(key) or 0)
            except (TypeError, ValueError):
                return error_response(f'{key} must be a number', status_code=400)
            if val < 0:
                return error_response(f'{key} cannot be negative', status_code=400)
            setattr(policy, key, val)
    if 'second_opinion_pct' in data:
        try:
            pv = float(data.get('second_opinion_pct') or 0)
        except (TypeError, ValueError):
            return error_response('second_opinion_pct must be a number', status_code=400)
        if pv < 0:
            return error_response('second_opinion_pct cannot be negative', status_code=400)
        policy.second_opinion_pct = pv

    # Per-type flat grants + per-type percentages {consultation, service, group};
    # blank clears a type (falls back to the corresponding default).
    def _clean_per_type(field, label):
        raw = data.get(field) or {}
        clean = {}
        for k in ('consultation', 'service', 'group'):
            v = raw.get(k)
            if v in (None, ''):
                continue
            try:
                fv = float(v)
            except (TypeError, ValueError):
                raise ValueError(f'{label}.{k} must be a number')
            if fv < 0:
                raise ValueError(f'{label}.{k} cannot be negative')
            clean[k] = fv
        return clean

    try:
        if 'second_opinion_grants' in data:
            policy.second_opinion_grants = _clean_per_type('second_opinion_grants', 'second_opinion_grants')
        if 'second_opinion_pcts' in data:
            policy.second_opinion_pcts = _clean_per_type('second_opinion_pcts', 'second_opinion_pcts')
    except ValueError as exc:
        return error_response(str(exc), status_code=400)

    # Apply the new expiry to every current wallet on this plan right away,
    # so an expiration change takes effect immediately for all members.
    if 'validity_days' in data and validity_days:
        from app.api.membership import credit_service
        credit_service.apply_validity_to_plan_wallets(
            tenant_id, plan.id, validity_days,
        )

    db.session.commit()
    return success_response(
        _plan_credit_row(plan, policy),
        message='Credit policy saved — live for all current members.',
    )


# ── Patient Family quotas ─────────────────────────────────────────────────────
# How many minors / linked adults / roles a PATIENT (receiver) plan lets an
# owner create. Members never buy their own plan, so the owner's plan caps them.
# Kept on a side table (PatientFamilyPolicy) so caps retune live by plan_id at
# every create site. Sentinels: -1 unlimited, 0 deny.

def _plan_family_row(plan, policy):
    """Compact plan + its family policy for the admin Family Quotas page."""
    vpt = plan.vertical_plan_type
    return {
        'plan_id': str(plan.id),
        'code': plan.code,
        'name': plan.name,
        'tier': plan.tier.value,
        'status': plan.status.value,
        'vertical_code': vpt.code if vpt else None,
        'vertical_label': (vpt.name or vpt.code) if vpt else None,
        'is_receiver': bool(vpt.is_receiver) if vpt else False,
        'policy': policy.to_dict() if policy else {
            'plan_id': str(plan.id),
            'max_minor_subaccounts': 0, 'max_family_links': 0,
            'max_patient_roles': 0, 'is_active': True,
        },
    }


@membership_plan_bp.route('/family-policies', methods=['GET'])
@jwt_required()
@role_required(_VIEW_ROLES)
def list_family_policies():
    """Every non-deleted plan for this tenant with its Patient Family quota
    policy. The frontend filters to receiver (patient) plans — quotas only bind
    a patient owner — but all plans are returned so the flag is authoritative."""
    from app.models import MembershipPlan, PatientFamilyPolicy
    tenant_id = current_tenant_id_strict()
    plans = (
        MembershipPlan.query
        .filter_by(tenant_id=tenant_id, is_deleted=False)
        .order_by(
            MembershipPlan.sort_order.asc(),
            MembershipPlan.tier.asc(),
            MembershipPlan.created_at.asc(),
        )
        .all()
    )
    policies = {
        p.plan_id: p for p in
        PatientFamilyPolicy.query.filter_by(tenant_id=tenant_id).all()
    }
    return success_response([
        _plan_family_row(p, policies.get(p.id)) for p in plans
    ])


@membership_plan_bp.route('/<plan_id>/family-policy', methods=['PUT'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def upsert_family_policy(plan_id):
    """Create / update the Patient Family quota policy for a plan.

    Body: ``{max_minor_subaccounts, max_family_links, max_patient_roles,
    is_active}``. Each cap is a whole number ≥ -1 (-1 unlimited, 0 deny). Takes
    effect on the next create for every owner on this plan."""
    from app.models import MembershipPlan, PatientFamilyPolicy
    tenant_id = current_tenant_id_strict()
    plan = MembershipPlan.query.filter_by(
        id=plan_id, tenant_id=tenant_id, is_deleted=False,
    ).first()
    if not plan:
        return not_found_response('MembershipPlan')

    data = request.get_json() or {}

    def _cap(field):
        raw = data.get(field, 0)
        try:
            val = int(raw)
        except (TypeError, ValueError):
            raise ValueError(f'{field} must be a whole number')
        if val < -1:
            raise ValueError(f'{field} cannot be below -1')
        return val

    try:
        caps = {f: _cap(f) for f in (
            'max_minor_subaccounts', 'max_family_links', 'max_patient_roles')}
    except ValueError as exc:
        return error_response(str(exc), status_code=400)

    policy = PatientFamilyPolicy.query.filter_by(
        tenant_id=tenant_id, plan_id=plan.id,
    ).first()
    if policy is None:
        policy = PatientFamilyPolicy(tenant_id=tenant_id, plan_id=plan.id)
        db.session.add(policy)
    for f, v in caps.items():
        setattr(policy, f, v)
    if 'is_active' in data:
        policy.is_active = bool(data.get('is_active'))

    db.session.commit()
    return success_response(
        _plan_family_row(plan, policy),
        message='Family quotas saved — apply on the next create.',
    )


# ── Charge (platform-fee) policies ────────────────────────────────────────────
# The three platform charges (c1/c2/c3 + per-charge tax) billed to a doctor on
# every payout, managed on their OWN admin surface (not the plan dialog). Edits
# take effect on the very next payout — ``billing_service`` reads the live policy
# by the doctor's active ``plan_id`` at payout time; existing payouts keep their
# snapshotted amounts.

def _plan_charge_row(plan, policy):
    """Compact plan + its charge policy for the admin Charges page."""
    vpt = plan.vertical_plan_type
    default = {
        'plan_id': str(plan.id), 'is_active': True,
        'charge1_name': 'Platform Fee', 'charge1_type': 'percentage', 'charge1_value': 0.0,
        'charge1_tax_type': 'percentage', 'charge1_tax_value': 0.0,
        'charge2_name': 'Service Fee', 'charge2_type': 'percentage', 'charge2_value': 0.0,
        'charge2_tax_type': 'percentage', 'charge2_tax_value': 0.0,
        'charge3_name': 'Processing Fee', 'charge3_type': 'percentage', 'charge3_value': 0.0,
        'charge3_tax_type': 'percentage', 'charge3_tax_value': 0.0,
    }
    return {
        'plan_id': str(plan.id),
        'code': plan.code,
        'name': plan.name,
        'tier': plan.tier.value,
        'status': plan.status.value,
        'vertical_code': vpt.code if vpt else None,
        'vertical_label': (vpt.name or vpt.code) if vpt else None,
        'policy': policy.to_dict() if policy else default,
    }


def _sanitize_charges(data):
    """Coerce a client charge payload into the model's columns, clamping types
    to ``percentage|fixed`` and values to non-negative numbers."""
    def _num(v):
        try:
            n = float(v)
        except (TypeError, ValueError):
            return 0.0
        return n if n >= 0 else 0.0

    def _kind(v):
        return v if v in ('percentage', 'fixed') else 'percentage'

    out = {}
    for i in (1, 2, 3):
        out[f'charge{i}_name'] = str(data.get(f'charge{i}_name') or f'Charge {i}')[:100]
        out[f'charge{i}_type'] = _kind(data.get(f'charge{i}_type'))
        out[f'charge{i}_value'] = _num(data.get(f'charge{i}_value'))
        out[f'charge{i}_tax_type'] = _kind(data.get(f'charge{i}_tax_type'))
        out[f'charge{i}_tax_value'] = _num(data.get(f'charge{i}_tax_value'))
    return out


@membership_plan_bp.route('/charge-policies', methods=['GET'])
@jwt_required()
@role_required(_VIEW_ROLES)
def list_charge_policies():
    """Every non-deleted plan for this tenant with its (live) charge policy."""
    from app.models import MembershipPlan, ChargePolicy
    tenant_id = current_tenant_id_strict()
    plans = (
        MembershipPlan.query
        .filter_by(tenant_id=tenant_id, is_deleted=False)
        .order_by(
            MembershipPlan.sort_order.asc(),
            MembershipPlan.tier.asc(),
            MembershipPlan.created_at.asc(),
        )
        .all()
    )
    policies = {
        p.plan_id: p for p in
        ChargePolicy.query.filter_by(tenant_id=tenant_id).all()
    }
    return success_response([
        _plan_charge_row(p, policies.get(p.id)) for p in plans
    ])


@membership_plan_bp.route('/<plan_id>/charge-policy', methods=['PUT'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def upsert_charge_policy(plan_id):
    """Create / update the charge policy for a plan. Body: the charge columns
    (``charge{1,2,3}_{name,type,value,tax_type,tax_value}``) + ``is_active``.
    Takes effect on the next payout for every doctor on this plan."""
    from app.models import MembershipPlan, ChargePolicy
    tenant_id = current_tenant_id_strict()
    plan = MembershipPlan.query.filter_by(
        id=plan_id, tenant_id=tenant_id, is_deleted=False,
    ).first()
    if not plan:
        return not_found_response('MembershipPlan')

    data = request.get_json() or {}
    policy = ChargePolicy.query.filter_by(
        tenant_id=tenant_id, plan_id=plan.id,
    ).first()
    if policy is None:
        policy = ChargePolicy(tenant_id=tenant_id, plan_id=plan.id)
        db.session.add(policy)

    for col, val in _sanitize_charges(data).items():
        setattr(policy, col, val)
    if 'is_active' in data:
        policy.is_active = bool(data.get('is_active'))
    db.session.commit()
    return success_response(
        _plan_charge_row(plan, policy),
        message='Charge policy saved — live on the next payout for all doctors on this plan.',
    )


@membership_plan_bp.route('/credit-grants', methods=['POST'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def manual_credit_grant():
    """Admin: add health credits to a specific user's wallet ad-hoc.

    Body: ``{user_id, amount, note?}``. Independent of any plan grant — a
    goodwill / correction top-up. Returns the updated wallet balance.
    """
    from app.models import User
    from app.api.membership import credit_service
    tenant_id = current_tenant_id_strict()
    data = request.get_json() or {}
    user_id = data.get('user_id')
    try:
        amount = float(data.get('amount') or 0)
    except (TypeError, ValueError):
        return error_response('amount must be a number', status_code=400)
    if not user_id or amount <= 0:
        return error_response('user_id and a positive amount are required', status_code=400)

    # Confine the grant to a user in THIS tenant (RLS is bypassed by the dev
    # superuser connection, so filter explicitly).
    user = User.query.filter_by(
        id=user_id, tenant_id=tenant_id, is_deleted=False).first()
    if not user:
        return not_found_response('User')

    wallet = credit_service.manual_grant(
        tenant_id, user_id, amount, note=data.get('note'))
    db.session.commit()
    return success_response(
        data={'wallet': wallet.to_dict() if wallet else None,
              'available': wallet.available() if wallet else 0.0},
        message=f'Added ₹{amount:.0f} credits.',
    )
