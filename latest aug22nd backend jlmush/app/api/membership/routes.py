"""Provider-facing membership routes + the tenant-admin subscriber roster.

Two audiences on one blueprint:

  * ``/me`` — read-only lookup so a logged-in provider's dashboard can
    render their current marketplace tier, status, and trial countdown.
  * ``/subscriptions`` — the tenant admin's roster of everyone holding
    one of the tenant's membership tiers, plus the action to move a
    subscriber onto a different tier. Mirrors what
    ``tenant_provider_subscriptions`` does for the in-tenant provider
    plan line.

Catalog CRUD lives in ``app.api.membership_plan.routes`` (tenant-scoped)
and ``app.api.platform.membership_routes`` (legacy platform surface);
anonymous catalog reads live in ``app.api.public.routes``.
"""
from __future__ import annotations

from flask import jsonify, request
from flask_jwt_extended import jwt_required, current_user

from app.api.membership import membership_bp
from app.api.membership.service import (
    MembershipPlanInactive,
    MembershipPlanNotFound,
    MembershipPlanWrongVertical,
    MembershipSubscriptionCancelled,
    MembershipSubscriptionNotFound,
    MembershipSubscriptionService,
)
from app.common.decorators import role_required
from app.common.provider_access import delegated_user

# The catalog leaf a practice's staff need to see their employer's membership.
# The same screen sits under Billing for a facility and under Practice for a
# doctor, so both paths open it.
M_MEMBERSHIP = ('billing.membership', 'practice.membership')
from app.common.responses import (
    error_response, not_found_response, success_response,
    validation_error_response,
)
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models._enums import MembershipSubscriptionStatus, UserRole


# Same gating as the membership-plan catalog routes: PLATFORM_OWNER is in
# the list so it can work the apex (default tenant) through the identical
# endpoint, with the tenant resolved from the request host.
_VIEW_ROLES = [UserRole.SUPER_ADMIN, UserRole.SUB_ADMIN, UserRole.PLATFORM_OWNER]
_MANAGE_ROLES = [UserRole.SUPER_ADMIN, UserRole.PLATFORM_OWNER]


@membership_bp.route('/me', methods=['GET'])
@jwt_required()
def get_my_membership():
    """Return the caller's current marketplace membership + plan.

    404 when the caller has no PENDING / TRIAL / ACTIVE subscription —
    the dashboard tile + sidebar entry hide cleanly in that case
    rather than rendering an empty card.

    Response shape mirrors the SaaS ``/api/pricing/me`` philosophy:
    the lifecycle row and the plan row are returned as siblings so
    the client doesn't have to know which fields live on which row.
    """
    # A practice's staff see the PRACTICE's membership, not their own — they
    # have no subscription of their own, and showing them that emptiness would
    # read as "your clinic isn't a member". Every other caller is unchanged.
    user, err = delegated_user(M_MEMBERSHIP)
    if err:
        return err

    # Include a lapsed subscription so an expired member still sees their tile +
    # a reactivate path (the pay panel decides whether payment is due).
    sub = MembershipSubscriptionService.get_current_or_lapsed_for_user(user.id)
    if not sub:
        return not_found_response('MembershipSubscription')

    return success_response(data={
        'subscription': sub.to_dict(),
        'plan': sub.plan.to_dict() if sub.plan else None,
    })


@membership_bp.route('/me/limits', methods=['GET'])
@jwt_required()
def get_my_plan_limits():
    """What the caller's practice may still add: support staff, My Link links.

    Both meters in one response because both render on My Link, and two
    endpoints would let them disagree by a refetch. Every number here comes
    from ``limits``, the same module that refuses the write — a meter computed
    separately would eventually say 4 of 5 while the server said no, and the
    number on screen is what people stop trusting.

    Resolved through ``current_principal`` rather than the JWT user, so a
    practice's staff see the PRACTICE's capacity. They are the ones adding
    colleagues; the ceiling belongs to their employer's plan, not to them.
    """
    from app.api.membership import limits
    from app.common.provider_access import ProviderAccessError, current_principal

    try:
        principal = current_principal()
    except ProviderAccessError:
        # Nobody else has either of these — a patient holds no staff and no
        # affiliations. 404 rather than 403: there is no capacity to report,
        # which is not the same as being refused a look at it.
        return not_found_response('Your provider profile')

    return success_response(
        data=limits.snapshot(principal.provider_type, principal.provider.id),
    )


@membership_bp.route('/me/credits', methods=['GET'])
@jwt_required()
def get_my_credits():
    """The caller's health-credit wallet — for ANY member vertical (patient or a
    provider such as a doctor). Same shape as the patient ``/credits`` endpoint,
    so one frontend hook serves every role."""
    from app.common.tenant_context import current_tenant_id_or_default
    from app.api.membership import credit_service
    from app.models import HealthCreditLedger
    user, err = delegated_user(M_MEMBERSHIP)
    if err:
        return err
    tid = current_tenant_id_or_default()
    wallet = credit_service.get_wallet(tid, user.id)
    ledger = []
    if wallet is not None:
        ledger = [x.to_dict() for x in (
            HealthCreditLedger.query
            .filter_by(tenant_id=tid, user_id=user.id)
            .order_by(HealthCreditLedger.created_at.desc())
            .limit(20).all())]
    return success_response(data={
        'wallet': wallet.to_dict() if wallet else None,
        'available': wallet.available() if wallet else 0.0,
        'ledger': ledger,
    })


@membership_bp.route('/me/credits/quote', methods=['GET'])
@jwt_required()
def quote_my_credits():
    """How many credits the caller may redeem on ``price`` for an ``offering``
    scope — incl. ``membership`` (a provider spending credits on their renewal)."""
    from app.common.tenant_context import current_tenant_id_or_default
    from app.api.membership import credit_service
    tid = current_tenant_id_or_default()
    offering = (request.args.get('offering') or '').strip()
    try:
        price = float(request.args.get('price') or 0)
    except (TypeError, ValueError):
        price = 0.0
    q = credit_service.quote_redeemable(tid, current_user.id, offering, price)
    return success_response(data=q)


@membership_bp.route('/my-benefits', methods=['GET'])
@jwt_required()
def get_my_membership_benefits():
    """The caller's member discount, as a always-200 read.

    Deliberately not folded into ``/me``: that endpoint 404s when there is no
    subscription, which is the right answer for a dashboard tile but the wrong
    one for the doctor tiles, service cards and booking summary that ask this.
    Those render for every patient, member or not, and would each have to
    special-case a 404 to conclude "0%". Here "no membership" is a plain
    ``0`` and the caller has one code path.
    """
    from app.common.member_discount import member_discount_pct

    sub = MembershipSubscriptionService.get_active_for_user(current_user.id)
    plan = sub.plan if sub else None
    return success_response(data={
        'member_discount_pct': float(member_discount_pct(current_user.id)),
        'plan_code': plan.code if plan else None,
        'plan_name': plan.name if plan else None,
    })


# --------------------------------------------------------------------------- #
# Tenant-admin subscriber roster
# --------------------------------------------------------------------------- #

def _subscriber_display_name(sub):
    """Best-effort human label for a subscription row, via the bound
    ``User``. ``MembershipSubscription`` carries a ``user_id`` FK but no
    SQLAlchemy relationship, so this is a lookup per row — O(N) per page
    render, same trade-off already taken by ``_provider_display_name`` in
    the tenant-provider roster. Fine at tens-to-hundreds of subscribers;
    if it becomes a hotspot, pre-fetch the distinct user_ids into a map.
    """
    from app.models import User
    if not getattr(sub, 'user_id', None):
        return f'Subscriber {sub.id}'
    u = User.query.get(sub.user_id)
    if u is None:
        return f'Subscriber {sub.id}'
    label = f"{(u.first_name or '').strip()} {(u.last_name or '').strip()}".strip()
    return label or u.email or f'Subscriber {sub.id}'


def _subscription_display_state(sub, plan):
    """The effective state to show in a status chip, one source of truth for
    every membership view: ``held`` (admin disciplinary hold), ``free`` (a
    price-0 tier — never expires), ``expired`` (a paid period / trial that ran
    out), or the raw lifecycle status (``trial`` / ``active`` / ``pending`` /
    ``cancelled`` / ``past_due`` / ``suspended``).

    Precedence mirrors the holding logic: an admin hold wins over everything, a
    free plan can still be held but never "expires", and only a paid lapse reads
    as expired."""
    from app.api.service_provider.doctor.holding_routes import _is_free_plan
    from app.models._base import utcnow
    st = getattr(sub.status, 'value', sub.status)
    if getattr(sub, 'on_hold', False):
        return 'held'
    if plan is not None and _is_free_plan(plan):
        return 'free'
    if st == 'cancelled':
        return 'cancelled'
    now = utcnow()
    period_end = getattr(sub, 'current_period_end', None)
    trial_end = getattr(sub, 'trial_ends_at', None)
    if st == 'active' and period_end is not None and period_end <= now:
        return 'expired'
    if st == 'trial' and trial_end is not None and trial_end <= now:
        return 'expired'
    if st in ('past_due', 'suspended'):
        return 'expired'
    return st


def _serialize_subscription(sub):
    """Subscription + plan + vertical + subscriber label, ready for the
    admin table."""
    plan = sub.plan
    # Resolve the vertical robustly — the plan's own, or (when orphaned) the
    # one matching the fixed provider_type — so a subscriber on a plan whose
    # vertical was deleted still shows under their real vertical, not a raw
    # ``provider_type`` fallback.
    vpt = MembershipSubscriptionService.resolve_subscription_vertical(
        sub, current_tenant_id_strict())
    return {
        **sub.to_dict(),
        'plan_name': plan.name if plan else None,
        'plan_tier': plan.tier.value if plan else None,
        'is_free_plan': _is_free_plan_safe(plan),
        'display_state': _subscription_display_state(sub, plan),
        'vertical_plan_type': vpt.to_dict() if vpt else None,
        'subscriber_display_name': _subscriber_display_name(sub),
    }


def _is_free_plan_safe(plan):
    from app.api.service_provider.doctor.holding_routes import _is_free_plan
    return bool(plan is not None and _is_free_plan(plan))


@membership_bp.route('/subscriptions', methods=['GET'])
@jwt_required()
@role_required(_VIEW_ROLES)
def list_membership_subscriptions():
    """Everyone holding one of this tenant's membership tiers.

    Optional filters:
      * ``plan_type`` — a ``vertical_plan_types`` id or ``code``.
      * ``status``    — ``pending|trial|active|past_due|cancelled|suspended``.

    Tenant scope is implicit — resolved from the request via
    ``current_tenant_id_strict``, never from the query string, so no
    caller can read another tenant's roster.
    """
    plan_type = (request.args.get('plan_type') or '').strip() or None
    status_raw = (request.args.get('status') or '').strip().lower()

    status = None
    if status_raw:
        try:
            status = MembershipSubscriptionStatus(status_raw)
        except ValueError:
            return error_response(
                f'Unknown status "{status_raw}".', status_code=400,
            )

    subs = MembershipSubscriptionService.list_for_tenant(
        current_tenant_id_strict(),
        vertical_plan_type=plan_type,
        status=status,
    )
    return success_response(data={
        'subscriptions': [_serialize_subscription(s) for s in subs],
    })


@membership_bp.route('/subscriptions/<subscription_id>', methods=['PATCH'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def change_membership_subscription_plan(subscription_id):
    """Move a subscriber onto a different membership tier.

    Body: ``{membership_plan_id: <uuid>}``. The service enforces tenant
    scope on both rows and refuses a plan from a different vertical — see
    ``MembershipSubscriptionService.change_plan``.
    """
    body = request.get_json(silent=True) or {}
    new_plan_id = body.get('membership_plan_id')
    if not new_plan_id:
        return validation_error_response({'membership_plan_id': 'required'})

    try:
        sub = MembershipSubscriptionService.change_plan(
            current_tenant_id_strict(),
            subscription_id,
            new_plan_id,
            actor_user_id=current_user.id,
        )
    except MembershipSubscriptionNotFound:
        return not_found_response('MembershipSubscription')
    except MembershipPlanNotFound:
        return not_found_response('MembershipPlan')
    except MembershipPlanWrongVertical as exc:
        return error_response(
            str(exc), status_code=400, code='wrong_vertical',
        )
    except (MembershipPlanInactive, MembershipSubscriptionCancelled) as exc:
        return error_response(str(exc), status_code=400)

    return success_response(
        data=_serialize_subscription(sub),
        message='Membership plan updated',
    )


@membership_bp.route('/subscriptions/assign', methods=['POST'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def assign_membership_to_doctor():
    """Admin: put ANY vertical's entity onto a membership tier.

    Creates the subscription (starting its trial) when the entity has none, or
    swaps the tier when it does. Body:
      * ``{vertical, entity_id, membership_plan_id}`` — any vertical
        (``doctor``/``clinic``/``hospital``/``patient``), or
      * ``{doctor_id, membership_plan_id}`` — legacy doctor-only shape.
    """
    from app.models._enums import MembershipVertical
    body = request.get_json(silent=True) or {}
    plan_id = body.get('membership_plan_id')
    vertical_raw = (body.get('vertical') or '').strip().lower()
    entity_id = body.get('entity_id') or body.get('doctor_id')
    # Legacy shape defaults to the doctor vertical.
    if not vertical_raw and body.get('doctor_id'):
        vertical_raw = 'doctor'

    if not entity_id or not plan_id or not vertical_raw:
        return validation_error_response({
            'vertical': 'required', 'entity_id': 'required',
            'membership_plan_id': 'required'})
    try:
        vertical = MembershipVertical(vertical_raw)
    except ValueError:
        return error_response(
            f'Unknown vertical "{vertical_raw}".', status_code=400)

    try:
        sub = MembershipSubscriptionService.assign_plan_for_provider(
            current_tenant_id_strict(), vertical, entity_id, plan_id,
            actor_user_id=current_user.id)
    except MembershipPlanNotFound:
        return not_found_response('MembershipPlan')
    except MembershipSubscriptionNotFound as exc:
        return error_response(str(exc), status_code=404)
    except MembershipPlanWrongVertical as exc:
        return error_response(str(exc), status_code=400, code='wrong_vertical')
    except (MembershipPlanInactive, MembershipSubscriptionCancelled) as exc:
        return error_response(str(exc), status_code=400)
    except Exception as exc:  # e.g. MembershipAlreadyExists edge
        return error_response(str(exc), status_code=400)
    return success_response(
        data=_serialize_subscription(sub),
        message=f'{vertical.value.title()} assigned to membership tier')


@membership_bp.route('/me/plans', methods=['GET'])
@jwt_required()
def list_my_membership_plans():
    """Active tiers the caller can move onto — same vertical as their current
    subscription — each tagged upgrade/downgrade/current relative to it.

    404 when the caller has no subscription (nothing to compare against).
    """
    from app.api.membership import proration
    from app.models import MembershipPlan, MembershipPlanStatus
    from app.models.membership import VerticalPlanType

    user, err = delegated_user(M_MEMBERSHIP)
    if err:
        return err

    # Include a lapsed subscription (PAST_DUE / expired) — a member whose trial
    # was ended or whose period expired must still be offered their tier to pay
    # and reactivate (this powers the holding-page pay panel).
    sub = MembershipSubscriptionService.get_current_or_lapsed_for_user(user.id)
    if not sub:
        return not_found_response('MembershipSubscription')

    tid = current_tenant_id_strict()
    cur_plan = sub.plan
    cur_rank = proration.monthly_rank(cur_plan) if cur_plan else None

    # Constrain to the caller's OWN vertical so a doctor only ever sees
    # doctor-vertical tiers, never hospital / clinic / patient ones (and never
    # ALL plans, which is what happened when the current tier had a null
    # vertical). Verticals are tenant-authored and dynamic, so the authoritative
    # source is the current plan's vertical — that transparently handles a
    # custom doctor vertical (e.g. "Specialists"). Only when the current tier
    # carries NO vertical (legacy plan) do we fall back to matching the fixed
    # provider type against a vertical ``code``.
    target_vertical = cur_plan.vertical_plan_type_id if cur_plan else None
    if target_vertical is None:
        vpt = VerticalPlanType.query.filter(
            VerticalPlanType.tenant_id == tid,
            db.func.lower(VerticalPlanType.code) == sub.provider_type.value.lower(),
        ).first()
        target_vertical = vpt.id if vpt else None

    q = MembershipPlan.query.filter_by(
        tenant_id=tid, status=MembershipPlanStatus.ACTIVE, is_deleted=False)
    if target_vertical:
        q = q.filter_by(vertical_plan_type_id=target_vertical)
    else:
        # Never fall through to every vertical — show only the current tier.
        q = q.filter_by(id=sub.membership_plan_id)

    out = []
    for p in q.all():
        rank = proration.monthly_rank(p)
        rel = 'current' if str(p.id) == str(sub.membership_plan_id) else (
            'upgrade' if (rank is not None and cur_rank is not None and rank > cur_rank)
            else 'downgrade' if (rank is not None and cur_rank is not None and rank < cur_rank)
            else 'lateral')
        periods = {per: proration.period_price(p, per)
                   for per in proration.CYCLE_DAYS
                   if proration.period_price(p, per) is not None}
        out.append({**p.to_dict(), 'relation': rel, 'periods': periods})

    return success_response(data={
        'subscription': sub.to_dict(),
        'current_plan_id': str(sub.membership_plan_id),
        'plans': out,
    })


@membership_bp.route('/me/quote', methods=['POST'])
@jwt_required()
def quote_my_membership_change():
    """Price an activate / renew / upgrade for the caller before checkout.

    Body: ``{membership_plan_id, period}``. Returns the payable amount, the
    credit applied, and the change kind — or a 400 for a disallowed move
    (mid-cycle downgrade / unavailable period)."""
    from app.api.membership import proration

    sub = MembershipSubscriptionService.get_active_for_user(current_user.id)
    if not sub:
        return not_found_response('MembershipSubscription')
    body = request.get_json(silent=True) or {}
    plan_id = body.get('membership_plan_id')
    period = body.get('period') or 'monthly'
    if not plan_id:
        return validation_error_response({'membership_plan_id': 'required'})
    try:
        _s, plan, quote = MembershipSubscriptionService.quote_change(
            current_tenant_id_strict(), sub.id, plan_id, period)
    except proration.PlanChangeError as exc:
        return error_response(str(exc), status_code=400, code='not_payable')
    except MembershipPlanNotFound:
        return not_found_response('MembershipPlan')
    except (MembershipPlanInactive, MembershipSubscriptionCancelled) as exc:
        return error_response(str(exc), status_code=400)
    return success_response(data={
        'plan_id': str(plan.id), 'plan_name': plan.name, 'period': period,
        'kind': quote['kind'], 'amount_inr': quote['amount_inr'],
        'credit_inr': quote['credit_inr'], 'base_price_inr': quote['base_price_inr'],
    })


def _get_subscription_or_404(subscription_id):
    from app.models import MembershipSubscription
    return MembershipSubscription.query.filter_by(
        id=subscription_id, tenant_id=current_tenant_id_strict(), is_deleted=False,
    ).first()


@membership_bp.route('/subscriptions/<subscription_id>/hold', methods=['POST'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def set_subscription_hold(subscription_id):
    """Disciplinary hold: put a member on the holding page (or lift it),
    independent of their subscription/trial status. Body: ``{on_hold: bool}``."""
    sub = _get_subscription_or_404(subscription_id)
    if not sub:
        return not_found_response('MembershipSubscription')
    body = request.get_json(silent=True) or {}
    sub.on_hold = bool(body.get('on_hold', True))
    sub.updated_by_id = current_user.id
    db.session.commit()
    return success_response(
        data=_serialize_subscription(sub),
        message='Member placed on hold' if sub.on_hold else 'Hold lifted',
    )


@membership_bp.route('/subscriptions/<subscription_id>/extend-trial', methods=['POST'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def extend_subscription_trial(subscription_id):
    """Extend (or restart) a member's free trial by ``days``. Pushes the trial
    end past now — lifting the holding page for a trial-expired member — and
    puts the subscription back on TRIAL. Body: ``{days: int}``."""
    from datetime import timedelta
    from app.models._base import utcnow
    from app.models import MembershipSubscriptionStatus
    sub = _get_subscription_or_404(subscription_id)
    if not sub:
        return not_found_response('MembershipSubscription')
    body = request.get_json(silent=True) or {}
    try:
        days = int(body.get('days', 0))
    except (TypeError, ValueError):
        days = 0
    if days <= 0:
        return error_response('days must be a positive number.', status_code=400)

    now = utcnow()
    base = sub.trial_ends_at if (sub.trial_ends_at and sub.trial_ends_at > now) else now
    sub.trial_ends_at = base + timedelta(days=days)
    sub.status = MembershipSubscriptionStatus.TRIAL
    sub.updated_by_id = current_user.id
    db.session.commit()
    return success_response(
        data=_serialize_subscription(sub),
        message=f'Trial extended by {days} day(s)',
    )


@membership_bp.route('/subscriptions/<subscription_id>/end-trial', methods=['POST'])
@jwt_required()
@role_required(_MANAGE_ROLES)
def end_subscription_trial(subscription_id):
    """End a member's free trial now — the trial clock is set to now so the
    holding page (if the plan enables it) kicks in immediately."""
    from app.models._base import utcnow
    from app.models import MembershipSubscriptionStatus
    sub = _get_subscription_or_404(subscription_id)
    if not sub:
        return not_found_response('MembershipSubscription')
    if sub.status != MembershipSubscriptionStatus.TRIAL:
        return error_response('This member is not on a trial.', status_code=400)
    sub.trial_ends_at = utcnow()
    sub.status = MembershipSubscriptionStatus.PAST_DUE
    sub.updated_by_id = current_user.id
    db.session.commit()
    return success_response(
        data=_serialize_subscription(sub),
        message='Trial ended',
    )
