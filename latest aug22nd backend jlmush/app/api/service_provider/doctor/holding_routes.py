"""Vendor holding-page endpoints.

A vendor whose account is (a) pending verification, (b) marked inactive by an
admin, or (c) past its trial period is "held": their app is replaced by a
single admin ↔ vendor chat channel (chat + documents both ways; only the admin
may schedule calls). These endpoints tell the frontend whether the vendor is
held and hand back the holding channel to converse in.
"""
import logging

from flask_jwt_extended import jwt_required, current_user

from app.api.service_provider.doctor import doctor_bp
from app.api.service_provider.doctor.service import DoctorService
from app.common.decorators import role_required
from app.common.provider_access import acting_doctor
from app.common.responses import success_response, not_found_response
from app.common.tenant_context import current_tenant_id_strict
from app.extensions import db
from app.models import UserRole

logger = logging.getLogger(__name__)


def hold_reason(doctor, user, tenant_id):
    """Why this vendor is held, or None. Precedence: inactive > disciplinary >
    pending verification > plan/trial lapse."""
    from app.models import UserStatus, UserVerificationStatus

    if user.status == UserStatus.INACTIVE:
        return 'inactive'
    # Admin disciplinary hold on the member's subscription — applies even to an
    # active member, regardless of the plan's holding toggle.
    if _subscription_on_hold(tenant_id, provider_id=doctor.id):
        return 'disciplinary'
    if (user.status == UserStatus.PENDING
            or doctor.verification_status == UserVerificationStatus.PENDING):
        return 'pending_verification'

    try:
        # Doctors also carry a provider-engagement subscription
        # (TenantProviderSubscription), so scan both stores by provider id.
        return _plan_hold_reason(tenant_id, provider_id=doctor.id,
                                 include_provider_subs=True)
    except Exception:  # noqa: BLE001 — subscription tables are best-effort here
        logger.exception('[HOLDING] trial-state check failed')
    return None


def _plan_hold_reason(tenant_id, *, provider_id=None, user_id=None,
                      include_provider_subs=False):
    """Shared plan-lapse hold logic for ANY vertical (doctor, clinic, hospital,
    corporate, patient). Returns ``'plan_expired'`` (a paid period ran out /
    was suspended), ``'trial_expired'`` (a free trial ended), or ``None``.

    Keyed by ``provider_id`` for a provider entity, or by ``user_id`` for a
    plain user — every subscription carries a ``user_id`` so the user key works
    across verticals. Held only when the member has a lapsed subscription, NO
    live one (a just-paid/active plan clears the hold), and the plan's holding
    page is turned on.
    """
    from app.models import MembershipSubscription, TenantProviderSubscription
    from app.models._base import utcnow

    now = utcnow()
    lapsed_kind = None   # 'plan' (paid period) dominates 'trial'
    has_live = False

    def _mark_lapsed(kind):
        nonlocal lapsed_kind
        if kind == 'plan' or lapsed_kind is None:
            lapsed_kind = kind

    def _scan(rows, is_membership):
        nonlocal has_live
        from app.models import MembershipPlan
        for s in rows:
            st = getattr(s.status, 'value', s.status)
            # A cancelled plan is an ENDED plan, not a lapse — the member chose
            # to leave it. It must never hold anyone (and a leftover cancelled
            # row must not keep an otherwise-active member held).
            if st == 'cancelled':
                continue
            trial_end = getattr(s, 'trial_ends_at', None)
            period_end = getattr(s, 'current_period_end', None)
            plan = None
            if is_membership and getattr(s, 'membership_plan_id', None):
                plan = MembershipPlan.query.get(s.membership_plan_id)
            # A free-forever plan (price 0) never lapses — it keeps the member
            # live regardless of any stale period end.
            if plan is not None and _is_free_plan(plan):
                has_live = True
                continue
            # A LIVE subscription — active with its paid period still open (or no
            # period set at all), on an unexpired trial, or pending activation.
            # Any live subscription keeps the member OFF the holding page, so a
            # paid renewal fixes a hold even if an older lapsed row lingers.
            # NB: a null ``plan_period`` does NOT mean live — a paid plan whose
            # period has passed is lapsed even when the period field is unset.
            is_live = (
                (st == 'active' and (period_end is None or period_end > now))
                or (st == 'trial' and (not trial_end or trial_end > now))
                or st == 'pending'
            )
            if is_live:
                has_live = True
                continue
            # Otherwise lapsed. On a membership lapse, first try to drop the
            # member onto a free (price-0) plan of the same vertical; only if
            # none exists is it a real lapse.
            if is_membership and _downgrade_to_free_plan(s, tenant_id, now):
                continue
            # An expired trial vs. a paid period that ran out (or past_due /
            # suspended) — the copy shown differs ("trial ended" vs "expired").
            _mark_lapsed('trial' if st == 'trial' else 'plan')

    mq = MembershipSubscription.query.filter_by(tenant_id=tenant_id)
    mq = mq.filter_by(provider_id=provider_id) if provider_id \
        else mq.filter_by(user_id=user_id)
    _scan(mq.all(), True)

    if include_provider_subs and provider_id:
        _scan(TenantProviderSubscription.query.filter_by(
            tenant_id=tenant_id, provider_id=provider_id).all(), False)

    if lapsed_kind and not has_live and _plan_holding_enabled(
            tenant_id, provider_id=provider_id, user_id=user_id):
        return 'plan_expired' if lapsed_kind == 'plan' else 'trial_expired'
    return None


def _is_free_plan(plan):
    """A plan is "free" when a defined price_inr_* period is 0 (the system's
    free-forever tier). There is no separate is_free flag — 0 is the signal
    (‑1 means 'custom/contact', so it is not free)."""
    for key, val in (plan.pricing or {}).items():
        if key.startswith('price_inr_'):
            try:
                if float(val) == 0:
                    return True
            except (TypeError, ValueError):
                continue
    return False


def _downgrade_to_free_plan(sub, tenant_id, now):
    """Move a lapsed membership subscription onto a free (price-0) ACTIVE plan of
    the same vertical, marking it ACTIVE. Returns True if downgraded so the
    member is NOT held. No-op (False) when no free plan exists."""
    from app.models import (
        MembershipPlan, MembershipPlanStatus, MembershipSubscriptionStatus,
    )
    vertical_id = None
    if sub.membership_plan_id:
        cur = MembershipPlan.query.get(sub.membership_plan_id)
        if cur is not None:
            vertical_id = cur.vertical_plan_type_id
            if _is_free_plan(cur):
                return False  # already on a free plan — nothing to downgrade to
    q = MembershipPlan.query.filter_by(
        tenant_id=tenant_id, status=MembershipPlanStatus.ACTIVE, is_deleted=False)
    if vertical_id:
        q = q.filter_by(vertical_plan_type_id=vertical_id)
    for plan in q.all():
        if plan.id != sub.membership_plan_id and _is_free_plan(plan):
            sub.membership_plan_id = plan.id
            sub.status = MembershipSubscriptionStatus.ACTIVE
            sub.trial_ends_at = None
            db.session.commit()
            logger.info('[HOLDING] lapsed member %s downgraded to free plan %s',
                        sub.provider_id, plan.id)
            return True
    return False


def hold_reason_for_user(user, tenant_id):
    """Hold reason for ANY user that is not a doctor — status-based plus a
    disciplinary hold on their own subscription. No provider trial logic."""
    from app.models import UserStatus, MembershipSubscription
    if user.status == UserStatus.INACTIVE:
        return 'inactive'
    if user.status == UserStatus.PENDING:
        return 'pending_verification'
    on_hold = db.session.query(
        MembershipSubscription.query.filter_by(
            tenant_id=tenant_id, user_id=user.id, on_hold=True, is_deleted=False,
        ).exists()
    ).scalar()
    if on_hold:
        return 'disciplinary'
    # Plan/trial lapse applies to EVERY vertical (clinic, hospital, corporate,
    # patient), not just doctors — keyed by the user id since every
    # subscription carries one.
    try:
        return _plan_hold_reason(tenant_id, user_id=user.id)
    except Exception:  # noqa: BLE001 — subscription tables are best-effort here
        logger.exception('[HOLDING] plan-state check failed for user %s', user.id)
    return None


def _subscription_on_hold(tenant_id, *, provider_id=None, user_id=None):
    """Whether an admin has placed a disciplinary hold on the member's
    subscription (keyed by provider entity or by user)."""
    from app.models import MembershipSubscription
    q = MembershipSubscription.query.filter_by(
        tenant_id=tenant_id, on_hold=True, is_deleted=False)
    q = q.filter_by(provider_id=provider_id) if provider_id \
        else q.filter_by(user_id=user_id)
    return db.session.query(q.exists()).scalar()


def _plan_holding_enabled(tenant_id, *, provider_id=None, user_id=None):
    """Whether the member's most recent subscription plan has the holding page
    turned on (defaults to on when there's no membership plan to read)."""
    from app.models import MembershipSubscription, MembershipPlan
    q = MembershipSubscription.query.filter_by(tenant_id=tenant_id)
    q = q.filter_by(provider_id=provider_id) if provider_id \
        else q.filter_by(user_id=user_id)
    sub = q.order_by(MembershipSubscription.created_at.desc()).first()
    if sub and getattr(sub, 'membership_plan_id', None):
        plan = MembershipPlan.query.get(sub.membership_plan_id)
        if plan is not None:
            return bool(plan.holding_enabled)
    return True


@doctor_bp.route('/account-state', methods=['GET'])
@jwt_required()
@role_required([UserRole.DOCTOR, UserRole.CLINIC, UserRole.HOSPITAL])
def account_state():
    """Whether the vendor is held (and why), plus the holding channel id to
    converse in. The frontend routes held vendors to the holding page."""
    from app.api.service_communication.service import HoldingChannelService

    doctor = acting_doctor()
    if not doctor:
        return not_found_response('Doctor')
    tid = current_tenant_id_strict()
    reason = hold_reason(doctor, current_user, tid)

    channel_id = None
    if reason:
        channel = HoldingChannelService.get_or_create(tid, doctor)
        db.session.commit()
        channel_id = str(channel.id)

    return success_response(data={
        'held': bool(reason),
        'reason': reason,
        'holding_channel_id': channel_id,
    })
