"""SaaS subscription billing — the VENDOR rail (tenant pays us).

Phase 5 of the vendor/tenant separation: self-serve purchase with payment.
A tenant's SUPER_ADMIN pays for one period at a time (Razorpay one-time
order, the vendor's own keys via ``PaymentResolver.vendor_gateway``);
success extends ``TenantSubscription.current_period_end``.

Deliberately NOT a state machine of its own: status stays within the
existing ``SubscriptionStatus`` lifecycle, and suspension reuses the
``suspend_after`` column + daily sweep that the over-limit machinery
already runs.

Period math
-----------
* Early renewal while ACTIVE and un-lapsed: the new period stacks onto the
  current one (``end += period``) — paying twice buys two periods.
* Anything else (TRIAL, PAST_DUE, SUSPENDED, or a lapsed ACTIVE): the paid
  period starts NOW. Paying mid-trial converts immediately — remaining
  trial days are consumed by choice, matching the membership rail.
"""
from __future__ import annotations

import logging

from app.extensions import db
from app.models import (AddonSubscriptionStatus, BillingCycle, SubscriptionStatus, Tenant, TenantSubscription,)
from app.models._base import utcnow

logger = logging.getLogger(__name__)

# Periods purchasable online. Must stay in step with ``BillingCycle`` —
# the subscription row records the cycle it was last paid on.
# Allowed renewal periods. The day counts are DISPLAY/estimate values
# only — actual period advancement is calendar-aware via
# :func:`period_delta` (a "monthly" period bought on Jan 31 ends on the
# last day of February, not 30 days later).
PERIOD_DAYS = {
    'monthly': 30,
    'quarterly': 91,
    'semi_annual': 182,
    'annual': 365,
    'biennial': 730,
    'triennial': 1095,
}

PERIOD_MONTHS = {
    'monthly': 1,
    'quarterly': 3,
    'semi_annual': 6,
    'annual': 12,
    'biennial': 24,
    'triennial': 36,
}


def add_period(dt, period):
    """``dt`` advanced by one calendar ``period`` (month-arithmetic:
    Jan 31 + monthly = Feb 28/29 — never a skipped month)."""
    from dateutil.relativedelta import relativedelta
    return dt + relativedelta(months=PERIOD_MONTHS[period])


class SubscriptionBillingError(ValueError):
    pass


def get_subscription(tenant_id) -> TenantSubscription:
    sub = TenantSubscription.query.filter_by(
        tenant_id=tenant_id, is_deleted=False,
    ).first()
    if sub is None:
        raise SubscriptionBillingError('Tenant has no subscription.')
    return sub


def assert_billable_tenant(tenant_id):
    """The vendor doesn't pay itself."""
    tenant = Tenant.query.get(tenant_id)
    if tenant is not None and getattr(tenant, 'is_platform', False):
        raise SubscriptionBillingError(
            'The vendor tenant has no subscription to pay.')


def price_for(plan, period) -> float | None:
    """The plan's price for ``period`` in INR, or None when that period
    isn't offered. ``-1`` (contact-sales sentinel) is returned as-is —
    callers must refuse online payment for it."""
    if period not in PERIOD_DAYS:
        return None
    key = f'price_inr_{period}'
    pricing = plan.pricing or {}
    if key in pricing:
        try:
            return float(pricing[key])
        except (TypeError, ValueError):
            return None
    # Fall back to the scalar columns for plans predating the JSONB
    # shape. Only monthly/annual ever had columns, so the other four
    # periods are JSONB-only — an old plan simply isn't offered on them.
    scalar = {
        'monthly': plan.price_inr_monthly,
        'annual': plan.price_inr_annual,
    }.get(period)
    return float(scalar) if scalar is not None else None


def quote(sub: TenantSubscription, period: str) -> dict:
    """Server-side price for one period of the tenant's CURRENT plan.
    Never trusts a client amount."""
    if period not in PERIOD_DAYS:
        raise SubscriptionBillingError(
            f"period must be one of {sorted(PERIOD_DAYS)}.")
    amount = price_for(sub.plan, period)
    if amount is None:
        raise SubscriptionBillingError(
            f'Your plan is not offered {period}. Contact support.')
    if amount < 0:
        raise SubscriptionBillingError(
            'Your plan is priced individually — contact support to renew.')
    return {'period': period, 'amount_inr': float(amount),
            'plan_code': sub.plan.code}


def apply_paid_period(sub: TenantSubscription, period: str, *,
                      actor_user_id=None, now=None) -> TenantSubscription:
    """Record one successfully-paid period. Does NOT commit — the caller
    owns the transaction (webhook and verify both already do)."""
    if period not in PERIOD_DAYS:
        raise SubscriptionBillingError(f'Unknown period {period!r}.')
    now = now or utcnow()

    current_end = sub.current_period_end
    if current_end is not None and current_end.tzinfo is None:
        from datetime import timezone
        current_end = current_end.replace(tzinfo=timezone.utc)

    if (sub.status == SubscriptionStatus.ACTIVE
            and current_end is not None and current_end > now):
        # Early renewal — stack onto the running paid period.
        sub.current_period_end = add_period(current_end, period)
    else:
        sub.current_period_start = now
        sub.current_period_end = add_period(now, period)

    sub.status = SubscriptionStatus.ACTIVE
    sub.billing_cycle = BillingCycle(period)
    sub.trial_ends_at = None  # a payment consumes any remaining trial
    sub.cancelled_at = None
    # Clear the BILLING suspension timer. The over-limit machinery owns
    # ``suspend_after`` only while ``over_limit_since`` is set — leave it
    # alone in that case and let ``recompute_over_limit`` re-derive it.
    if sub.over_limit_since is None:
        sub.suspend_after = None
    # A payment ends the retention countdown: the tenant is no longer
    # headed for the archive-and-purge sweep.
    sub.data_purge_after = None
    # Held add-ons: revive the still-paid ones, collapse the lapsed.
    revive_or_collapse_addons(sub.tenant_id, now=now)
    # New paid period → dunning notices start over.
    sub.billing_state = None
    if actor_user_id is not None:
        sub.updated_by_id = actor_user_id

    # A payment fixes non-payment, not seat overage — re-flag immediately
    # if the tenant is still over its plan limits.
    from app.api.pricing.service import PlanService
    PlanService.recompute_over_limit(sub)

    logger.info(
        '[SAAS-BILLING] tenant=%s paid %s → status=%s period_end=%s',
        sub.tenant_id, period, sub.status.value, sub.current_period_end,
    )
    return sub


# --------------------------------------------------------------------------- #
# Dunning sweep — daily, alongside the over-limit sweep
# --------------------------------------------------------------------------- #

def _aware(dt):
    if dt is not None and dt.tzinfo is None:
        from datetime import timezone
        return dt.replace(tzinfo=timezone.utc)
    return dt


# Bell copy per billing purpose. Bodies stay short — the email carries
# the detail; the in-app item is the "look at billing NOW" nudge.
_INAPP_BILLING_COPY = {
    'saas_trial_ending': ('Trial ending soon',
                          'Your {plan} trial is ending. Add a payment before it expires.'),
    'saas_trial_expired': ('Trial expired',
                           'Your {plan} trial has expired. Pay now to avoid suspension.'),
    'saas_payment_due': ('Subscription payment due',
                         'Your {plan} subscription period has ended. Payment is due.'),
    'saas_suspended': ('Workspace suspended',
                       'Your {plan} subscription is suspended for non-payment.'),
    'saas_payment_received': ('Payment received',
                              'Your {plan} subscription is active. Thank you!'),
}


def _notify_tenant_admins(sub, purpose, inapp_queue=None, **variables):
    """Email every active SUPER_ADMIN of the subscription's tenant.
    Best-effort — a template or SendClean failure must never abort the
    sweep. Returns how many sends succeeded.

    ``inapp_queue``: the seller->tenant in-app leg. push_notification
    commits, and the sweep calls this MID-transaction — so instead of
    sending here, the intent is queued and the sweep flushes it after
    its own commit (see ``_flush_inapp``).
    """
    from app.models import User, UserRole
    from app.services.email_service import EmailService

    if inapp_queue is not None and purpose in _INAPP_BILLING_COPY:
        inapp_queue.append((str(sub.tenant_id), purpose,
                            variables.get('plan_name') or 'your'))

    sent = 0
    try:
        admins = User.query.filter_by(
            tenant_id=sub.tenant_id, role=UserRole.SUPER_ADMIN,
            is_deleted=False,
        ).all()
        for admin in admins:
            if EmailService._send_safe(purpose, admin, **variables):
                sent += 1
    except Exception:  # noqa: BLE001
        logger.exception('[SAAS-BILLING] notify %s failed for tenant %s',
                         purpose, sub.tenant_id)
    return sent


def _flush_inapp(queue):
    """Deliver the queued seller->tenant bell notifications. Runs AFTER
    the sweep's commit (push_notification commits per row)."""
    from app.common.notify import notify_tenant_admins

    for tenant_id, purpose, plan_name in queue:
        title, body = _INAPP_BILLING_COPY[purpose]
        try:
            notify_tenant_admins(
                tenant_id, type=purpose, title=title,
                body=body.format(plan=plan_name),
                data={'kind': 'subscription',
                      'url': '/dashboard/admin/subscription/my'},
            )
        except Exception:  # noqa: BLE001
            logger.exception('[SAAS-BILLING] in-app notify failed tenant=%s',
                             tenant_id)


def _record_notice(sub, key, now):
    """Mark ``key`` as sent in ``billing_state`` (reassigned, not mutated,
    so SQLAlchemy sees the JSONB change)."""
    state = dict(sub.billing_state or {})
    notices = dict(state.get('notices') or {})
    notices[key] = now.isoformat()
    state['notices'] = notices
    sub.billing_state = state


def sweep_billing_periods(*, only_tenant_id=None) -> dict:
    """Daily dunning reconciliation (idempotent):

    * TRIAL ending in ≤3 / ≤1 days → one reminder each (deduped via
      ``billing_state``).
    * TRIAL past ``trial_ends_at`` → PAST_DUE, suspension timer armed from
      the plan's ``grace_period_days``.
    * ACTIVE past ``current_period_end`` → PAST_DUE, same timer.
    * PAST_DUE past ``suspend_after`` → SUSPENDED (FeatureGate then answers
      False for every path until a payment lands).

    The vendor tenant is skipped — it has nothing to pay. ``only_tenant_id``
    narrows the sweep for targeted runs (local verification, support).
    """
    from datetime import timedelta as _td
    from app.common.tenant_context import with_tenant_context

    now = utcnow()
    stats = {'checked': 0, 'reminded': 0, 'past_due': 0, 'suspended': 0}
    inapp_queue = []

    platform_ids = {
        str(t.id) for t in Tenant.query.filter_by(is_platform=True).all()
    }

    query = TenantSubscription.query.filter_by(is_deleted=False)
    if only_tenant_id:
        query = query.filter_by(tenant_id=only_tenant_id)

    for sub in query.all():
        if str(sub.tenant_id) in platform_ids:
            continue
        stats['checked'] += 1
        with with_tenant_context(sub.tenant_id):
            plan = sub.plan
            grace = _td(days=(plan.grace_period_days if plan else 0) or 0)
            notices = (sub.billing_state or {}).get('notices') or {}
            trial_end = _aware(sub.trial_ends_at)
            period_end = _aware(sub.current_period_end)

            if sub.status == SubscriptionStatus.TRIAL and trial_end:
                if trial_end <= now:
                    sub.status = SubscriptionStatus.PAST_DUE
                    sub.suspend_after = now + grace
                    _record_notice(sub, 'trial_expired', now)
                    stats['past_due'] += 1
                    _notify_tenant_admins(
                        sub, 'saas_trial_expired', inapp_queue=inapp_queue,
                        plan_name=plan.name if plan else '',
                        grace_days=grace.days,
                    )
                else:
                    days_left = (trial_end - now).days
                    key = None
                    if days_left < 1 and 'trial_ending_1d' not in notices:
                        key = 'trial_ending_1d'
                    elif days_left < 3 and 'trial_ending_3d' not in notices:
                        key = 'trial_ending_3d'
                    if key:
                        _record_notice(sub, key, now)
                        stats['reminded'] += 1
                        _notify_tenant_admins(
                            sub, 'saas_trial_ending', inapp_queue=inapp_queue,
                            plan_name=plan.name if plan else '',
                            days_left=max(days_left, 0) + 1,
                            trial_end=trial_end.strftime('%d %b %Y'),
                        )

            elif sub.status == SubscriptionStatus.ACTIVE and period_end \
                    and period_end <= now:
                sub.status = SubscriptionStatus.PAST_DUE
                sub.suspend_after = now + grace
                _record_notice(sub, 'period_lapsed', now)
                stats['past_due'] += 1
                _notify_tenant_admins(
                    sub, 'saas_payment_due', inapp_queue=inapp_queue,
                    plan_name=plan.name if plan else '',
                    period_end=period_end.strftime('%d %b %Y'),
                    grace_days=grace.days,
                )

            elif sub.status == SubscriptionStatus.PAST_DUE:
                suspend_after = _aware(sub.suspend_after)
                if suspend_after is None:
                    # Legacy PAST_DUE row from before the sweep existed —
                    # arm the timer now instead of suspending instantly.
                    sub.suspend_after = now + grace
                elif suspend_after <= now:
                    sub.status = SubscriptionStatus.SUSPENDED
                    # Second clock starts: the plan's data_retention_days
                    # window keeps the data in the DB (holding page up,
                    # admin can pay); past it the retention sweep archives
                    # to S3 and hard-deletes, freeing subdomain + slug.
                    sub.data_purge_after = now + _td(
                        days=_retention_days(sub, plan))
                    # Add-ons go ON HOLD with the plan: not applying, not
                    # lost. Reactivation (apply_paid_period) revives the
                    # ones whose own paid window still runs; the rest
                    # collapse and must be repurchased.
                    _hold_addons(sub.tenant_id)
                    _record_notice(sub, 'suspended', now)
                    stats['suspended'] += 1
                    # The custom domain is freed at suspension so the
                    # tenant can point it elsewhere; the subdomain stays
                    # and serves the holding page until the purge.
                    _release_custom_domain(sub.tenant_id)
                    _notify_tenant_admins(
                        sub, 'saas_suspended', inapp_queue=inapp_queue,
                        plan_name=plan.name if plan else '',
                    )

    db.session.commit()
    _flush_inapp(inapp_queue)
    return stats


def _retention_days(sub, plan):
    """Snapshot-first data_retention_days; 180 when nothing sensible."""
    snap = sub.plan_snapshot if isinstance(sub.plan_snapshot, dict) else {}
    val = snap.get('data_retention_days')
    if val is None and plan is not None:
        val = getattr(plan, 'data_retention_days', None)
    try:
        return max(int(val), 1)
    except (TypeError, ValueError):
        return 180


def _release_custom_domain(tenant_id):
    """Best-effort: unset the tenant's custom domain + tear down its
    routing so the domain is theirs to use elsewhere. Never blocks the
    sweep — a CF hiccup shouldn't stop the suspension itself."""
    try:
        from app.models import Tenant
        tenant = Tenant.query.filter_by(id=tenant_id).first()
        if tenant is None or not tenant.domain:
            return
        from app.api.platform.service import PlatformDomainService
        PlatformDomainService.clear_domain(str(tenant_id))
        logger.warning('[BILLING] released custom domain for suspended '
                       'tenant %s', tenant_id)
    except Exception:  # noqa: BLE001 — sweep must survive provider errors
        logger.exception('[BILLING] custom-domain release failed tenant=%s',
                         tenant_id)


def _plan_addon_terms(sub, addon_code):
    """The buyer's PLAN-level terms for one add-on, snapshot-first
    (grandfathering: catalog edits never change a subscriber's add-on
    prices). Three-valued: a dict = use these terms; False = the plan
    explicitly does not offer this add-on; None = plan says nothing,
    fall through to the add-on's own tier."""
    if sub is None:
        return None
    snap = sub.plan_snapshot if isinstance(sub.plan_snapshot, dict) else {}
    terms = snap.get('addon_terms')
    if not isinstance(terms, dict):
        plan = getattr(sub, 'plan', None)
        terms = getattr(plan, 'addon_terms', None)
    if not isinstance(terms, dict) or addon_code not in terms:
        return None
    t = terms.get(addon_code)
    if not isinstance(t, dict) or not t.get('active', True):
        return False
    return {
        'units': int(t.get('units') or 1),
        'price_inr': t.get('price_inr'),
        'og_price_inr': t.get('og_price_inr'),
        'min_qty': int(t.get('min_qty') or 1),
        'max_qty': (int(t['max_qty'])
                    if t.get('max_qty') not in (None, '') else None),
        'billing_cycle': t.get('billing_cycle') or 'monthly',
    }


def resolve_addon_terms(addon, period, tier_key='main', sub=None):
    """The commercial terms governing one purchase, in priority order:
    the buyer's PLAN terms (different plans, different add-on price and
    capacity — snapshot-first), else the add-on's tier for this buyer
    kind, else the legacy shape where ``period`` decides the cycle.
    Raises when the add-on isn't offered to this buyer."""
    et = _plan_addon_terms(sub, addon.code)
    if et is False:
        raise SubscriptionBillingError(
            'This add-on is not offered on your plan.')
    if et is None:
        et = addon.effective_tier(tier_key)
    if et is None:
        raise SubscriptionBillingError(
            'This add-on is not offered for this buyer.')
    cycle = et['billing_cycle']
    if cycle is None:                       # legacy: buyer picks
        if period not in PERIOD_DAYS:
            raise SubscriptionBillingError(f'Unknown period {period!r}.')
        cycle = period
    elif cycle != 'one_time' and cycle not in PERIOD_DAYS:
        raise SubscriptionBillingError(
            f'Add-on has an unknown billing cycle {cycle!r}.')
    return {**et, 'billing_cycle': cycle}


def check_addon_quantity(addon, terms, existing_live_qty, quantity):
    """Enforce the tier's cumulative purchase bounds: after this
    purchase the tenant's total must sit in [min_qty, max_qty]."""
    total = int(existing_live_qty or 0) + int(quantity)
    if total < terms['min_qty']:
        raise SubscriptionBillingError(
            f"{addon.name} must be bought at least "
            f"{terms['min_qty']} at a time.")
    if terms['max_qty'] is not None and total > terms['max_qty']:
        raise SubscriptionBillingError(
            f"{addon.name} is capped at {terms['max_qty']} for your "
            f"tenant; you already hold {existing_live_qty}.")


def apply_addon_purchase(tenant_id, addon, period, quantity,
                         actor_user_id=None, now=None, tier_key='main'):
    """Record one PAID add-on purchase. Does NOT commit — the caller
    owns the transaction (free-activation path and payment confirm).

    Buyer-favorable single rule: every purchase adds the bought
    quantity on top of whatever is still active, and pushes the paid
    window out by one period from whichever is later — now, or the
    current window's end. A lapsed/cancelled row restarts fresh with
    just the bought quantity. A ``one_time`` tier writes NO window at
    all (``current_period_end IS NULL``): the add-on then lives and
    dies with the main plan.
    """
    from app.models import TenantAddon

    now = now or utcnow()
    quantity = max(int(quantity or 1), 1)
    target_sub = TenantSubscription.query.filter_by(
        tenant_id=tenant_id, is_deleted=False).first()
    terms = resolve_addon_terms(addon, period, tier_key, sub=target_sub)
    cycle = terms['billing_cycle']
    one_time = cycle == 'one_time'

    row = TenantAddon.query.filter_by(
        tenant_id=tenant_id, addon_id=addon.id, is_deleted=False,
    ).first()
    # "Still paid for" — NOT "currently applying". A HELD add-on (plan
    # suspended) whose own window has not lapsed is still owned: buying
    # more must ADD to it and extend from its end, never reset it. Only
    # a CANCELLED row, or one whose window has lapsed, starts fresh.
    # A NULL window (one_time) never lapses on its own.
    end = _aware(row.current_period_end) if row is not None else None
    live = (row is not None
            and row.status != AddonSubscriptionStatus.CANCELLED
            and (row.current_period_end is None or
                 (end is not None and end > now)))
    check_addon_quantity(addon, terms,
                         (row.quantity or 0) if live else 0, quantity)

    if row is None:
        row = TenantAddon(
            tenant_id=tenant_id, addon_id=addon.id,
            quantity=quantity,
            status=AddonSubscriptionStatus.ACTIVE,
            billing_cycle=BillingCycle(cycle),
            activated_at=now,
            current_period_start=now,
            current_period_end=(
                None if one_time else add_period(now, cycle)),
            activated_by_id=actor_user_id,
            tier=tier_key,
            units=terms['units'],
        )
        db.session.add(row)
    else:
        start_from = end if (live and end is not None) else now
        row.quantity = ((row.quantity or 1) if live else 0) + quantity
        row.status = AddonSubscriptionStatus.ACTIVE
        row.billing_cycle = BillingCycle(cycle)
        if not live:
            row.current_period_start = now
            row.activated_at = now
        row.current_period_end = (
            None if one_time else add_period(start_from, cycle))
        row.cancelled_at = None
        row.tier = tier_key
        # Snapshot the CURRENT units for the whole row: quantities merge
        # into one row, so one multiplier must govern them all.
        row.units = terms['units']
        if actor_user_id is not None:
            row.activated_by_id = actor_user_id
    db.session.flush()
    return row


def attach_signup_addons(sub, requests, actor_user_id=None):
    """Grant signup-time seat add-ons for the TRIAL window only.

    The buyer picked "additional team members" on the plan card before
    paying anything, so the grant must die with the trial: rows are
    written ACTIVE but capped at ``trial_ends_at`` — the expiry sweep
    collapses them unless they are actually bought from the shop when
    the trial converts. A plan without a trial attaches nothing (the
    card hides the steppers there).

    Returns (attached_codes, skipped) — skipped entries carry a reason
    and never abort the signup: a bad add-on pick must not cost the
    visitor the workspace they just verified a phone for.
    """
    from app.models import Addon, AddonStatus, TenantAddon

    attached, skipped = [], []
    trial_end = _aware(getattr(sub, 'trial_ends_at', None))
    if not requests:
        return attached, skipped
    if trial_end is None or trial_end <= utcnow():
        return attached, [{'code': r.get('code'), 'reason': 'no_trial'}
                          for r in requests]

    now = utcnow()
    for req in requests[:20]:
        code = (req.get('code') or '').strip()
        try:
            quantity = max(int(req.get('quantity') or 0), 0)
        except (TypeError, ValueError):
            quantity = 0
        if not code or quantity < 1:
            continue
        addon = Addon.query.filter_by(
            code=code, is_deleted=False,
            status=AddonStatus.ACTIVE).first()
        if addon is None:
            skipped.append({'code': code, 'reason': 'unknown_addon'})
            continue
        try:
            terms = resolve_addon_terms(addon, 'monthly', 'main', sub=sub)
            check_addon_quantity(addon, terms, 0, quantity)
        except SubscriptionBillingError as e:
            skipped.append({'code': code, 'reason': str(e)})
            continue
        db.session.add(TenantAddon(
            tenant_id=sub.tenant_id, addon_id=addon.id,
            quantity=quantity,
            status=AddonSubscriptionStatus.ACTIVE,
            billing_cycle=BillingCycle(
                terms['billing_cycle']
                if terms['billing_cycle'] in PERIOD_DAYS
                or terms['billing_cycle'] == 'one_time'
                else 'monthly'),
            activated_at=now,
            current_period_start=now,
            current_period_end=trial_end,
            activated_by_id=actor_user_id,
            tier='main',
            units=terms['units'],
        ))
        attached.append(code)
    db.session.flush()
    return attached, skipped


def resale_pool(apex_id, addon):
    """How much of ``addon`` an apex has bought to sell on, how much its
    children already hold, and what is left.

    This is the "you can only sell what you bought" rule: an apex buys
    units from the vendor at a child-tier price (stock), and every child
    purchase draws the pool down. Without it a reseller could sell
    capacity the vendor was never paid for.
    """
    from app.models import Tenant, TenantAddon
    from app.models._base import utcnow
    from app.models._enums import AddonSubscriptionStatus

    now = utcnow()

    def _live(row):
        if row.status != AddonSubscriptionStatus.ACTIVE:
            return False
        end = _aware(row.current_period_end)
        return row.current_period_end is None or (end is not None
                                                  and end > now)

    stock_rows = TenantAddon.query.filter_by(
        tenant_id=apex_id, addon_id=addon.id,
        is_stock=True, is_deleted=False).all()
    bought = sum(
        max(int(r.quantity or 0), 0)
        * (r.units if isinstance(r.units, int) and r.units > 0 else 1)
        for r in stock_rows if _live(r))

    child_ids = [t.id for t in Tenant.query.filter_by(
        parent_tenant_id=apex_id, is_deleted=False).all()]
    allocated = 0
    if child_ids:
        for r in TenantAddon.query.filter(
                TenantAddon.tenant_id.in_(child_ids),
                TenantAddon.addon_id == addon.id,
                TenantAddon.is_stock.is_(False),
                TenantAddon.is_deleted.is_(False)).all():
            if _live(r):
                allocated += (max(int(r.quantity or 0), 0)
                              * (r.units if isinstance(r.units, int)
                                 and r.units > 0 else 1))
    return {'bought': bought, 'allocated': allocated,
            'free': max(bought - allocated, 0)}


def grant_resale_stock(apex_id, addon, tier_key, quantity,
                       actor_user_id=None, now=None):
    """Add paid units to an apex's resale pool. One stock row per
    (apex, add-on); repeat purchases accumulate."""
    from app.models import TenantAddon

    now = now or utcnow()
    terms = resolve_addon_terms(addon, 'monthly', tier_key, sub=None)
    cycle = terms['billing_cycle']
    one_time = cycle == 'one_time'
    end = None if one_time else add_period(now, cycle)
    quantity = max(int(quantity or 1), 1)

    row = TenantAddon.query.filter_by(
        tenant_id=apex_id, addon_id=addon.id,
        is_stock=True, is_deleted=False).first()
    if row is None:
        row = TenantAddon(
            tenant_id=apex_id, addon_id=addon.id, quantity=quantity,
            status=AddonSubscriptionStatus.ACTIVE,
            billing_cycle=BillingCycle(cycle), activated_at=now,
            current_period_start=now, current_period_end=end,
            activated_by_id=actor_user_id, tier=tier_key,
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


def assert_resale_stock(apex_id, addon, units_wanted):
    """Refuse a child purchase the apex has no stock for."""
    pool = resale_pool(apex_id, addon)
    if units_wanted > pool['free']:
        raise SubscriptionBillingError(
            '%s is sold out from your provider — they hold %d unit(s), '
            '%d already in use. Ask them to add more.'
            % (addon.name, pool['bought'], pool['allocated']))
    return pool


def _hold_addons(tenant_id):
    """ACTIVE -> SUSPENDED for every add-on of a freshly-suspended
    tenant. Held add-ons neither apply nor bill."""
    from app.models import TenantAddon
    TenantAddon.query.filter_by(
        tenant_id=tenant_id, is_deleted=False,
        status=AddonSubscriptionStatus.ACTIVE,
    ).update({'status': AddonSubscriptionStatus.SUSPENDED})


def revive_or_collapse_addons(tenant_id, now=None):
    """Called on plan reactivation: held add-ons whose own paid window
    still runs come back ACTIVE; lapsed ones collapse (CANCELLED) — a
    new add-on has to be taken. Returns (revived, collapsed)."""
    from app.models import TenantAddon
    now = now or utcnow()
    revived = collapsed = 0
    rows = TenantAddon.query.filter_by(
        tenant_id=tenant_id, is_deleted=False,
        status=AddonSubscriptionStatus.SUSPENDED,
    ).all()
    for ta in rows:
        end = _aware(ta.current_period_end)
        # NULL end = one_time purchase: no window of its own, so a plan
        # reactivation always brings it back.
        if ta.current_period_end is None or (end is not None and end > now):
            ta.status = AddonSubscriptionStatus.ACTIVE
            revived += 1
        else:
            ta.status = AddonSubscriptionStatus.CANCELLED
            ta.cancelled_at = now
            collapsed += 1
    return revived, collapsed


def sweep_addon_periods(only_tenant_id=None):
    """Natural add-on expiry, independent of the plan: an ACTIVE or held
    add-on past its own ``current_period_end`` collapses to CANCELLED."""
    from app.models import TenantAddon
    now = utcnow()
    stats = {'expired': 0}
    query = TenantAddon.query.filter(
        TenantAddon.is_deleted.is_(False),
        TenantAddon.status.in_((AddonSubscriptionStatus.ACTIVE,
                                AddonSubscriptionStatus.SUSPENDED)),
        TenantAddon.current_period_end < now,
    )
    if only_tenant_id:
        query = query.filter_by(tenant_id=only_tenant_id)
    for ta in query.all():
        ta.status = AddonSubscriptionStatus.CANCELLED
        ta.cancelled_at = now
        stats['expired'] += 1
    db.session.commit()
    return stats


def _billing_suspended(sub):
    """True only for a DUNNING suspension (non-payment past grace).

    The purge pipeline must never key on status==SUSPENDED alone: the
    over-limit machinery also suspends (seat overage on a possibly
    fully-PAID tenant) without ever recording the 'suspended' dunning
    notice — those tenants are NOT headed for deletion.
    """
    notices = (sub.billing_state or {}).get('notices') or {}
    return 'suspended' in notices


_PURGE_RETRY_BACKOFF_DAYS = 3


def _aware_str(value):
    """Parse an isoformat string to an aware datetime, or None."""
    if not value:
        return None
    from datetime import datetime, timezone
    try:
        dt = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _purge_blockers(tenant):
    """Reasons this tenant cannot be hard-deleted, checked BEFORE the
    expensive archive so a doomed attempt does not re-upload the whole
    dataset every day. RESTRICT foreign keys make these hard stops."""
    blockers = []
    if Tenant.query.filter_by(parent_tenant_id=tenant.id,
                              is_deleted=False).count():
        blockers.append('has child tenants')
    from app.models.plan import Plan
    if Plan.query.filter_by(owner_tenant_id=tenant.id,
                            is_deleted=False).count():
        blockers.append('owns plans')
    return blockers


def sweep_data_retention(only_tenant_id=None):
    """Archive-and-purge pass for BILLING-suspended tenants past
    ``data_purge_after``.

    Ordering rules, all non-negotiable:
    * only dunning suspensions are ever marched toward deletion — an
      over-limit suspension (possibly fully paid) is skipped;
    * the subscription is re-read right before archiving AND between
      archive and delete, so a payment landing mid-sweep wins;
    * the S3 archive must fully succeed before the hard delete runs;
    * a failed purge parks with a backoff instead of re-archiving the
      whole tenant every day.
    Hard delete frees the subdomain and slug (tenant row + DNS go too).
    """
    from datetime import timedelta as _td

    now = utcnow()
    stats = {'checked': 0, 'armed': 0, 'purged': 0, 'failed': 0,
             'skipped': 0}
    platform_ids = {
        str(t.id) for t in Tenant.query.filter_by(is_platform=True).all()
    }
    query = TenantSubscription.query.filter_by(
        is_deleted=False, status=SubscriptionStatus.SUSPENDED)
    if only_tenant_id:
        query = query.filter_by(tenant_id=only_tenant_id)
    candidate_ids = [row.id for row in query.with_entities(
        TenantSubscription.id).all()]

    for sub_id in candidate_ids:
        # Fresh read per candidate — the sweep can run for a long time
        # and a payment (status -> ACTIVE, purge timer cleared) must be
        # seen, not the snapshot from sweep start.
        sub = TenantSubscription.query.filter_by(
            id=sub_id, is_deleted=False,
            status=SubscriptionStatus.SUSPENDED).first()
        if sub is None or str(sub.tenant_id) in platform_ids:
            continue
        stats['checked'] += 1
        if not _billing_suspended(sub):
            stats['skipped'] += 1
            continue
        purge_after = _aware(sub.data_purge_after)
        if purge_after is None:
            # Dunning-suspended before the retention clock existed —
            # arm now, committed immediately so a later iteration's
            # failure cannot roll it back.
            sub.data_purge_after = now + _td(
                days=_retention_days(sub, sub.plan))
            db.session.commit()
            stats['armed'] += 1
            continue
        if purge_after > now:
            continue

        state = dict(sub.billing_state or {})
        failed_at = _aware_str(state.get('purge_failed_at'))
        if failed_at is not None and (
                failed_at > now - _td(days=_PURGE_RETRY_BACKOFF_DAYS)):
            stats['skipped'] += 1
            continue

        tenant_id = str(sub.tenant_id)
        tenant = Tenant.query.filter_by(
            id=tenant_id, is_deleted=False).first()
        if tenant is None:
            stats['skipped'] += 1
            continue
        blockers = _purge_blockers(tenant)
        if blockers:
            logger.warning('[BILLING] tenant %s purge parked (%s) — '
                           'resolve before it can be archived+deleted',
                           tenant_id, ', '.join(blockers))
            stats['skipped'] += 1
            continue

        try:
            from app.services.tenant_archive_service import (
                TenantArchiveService,
            )
            archive = TenantArchiveService.archive_tenant(tenant_id)

            # Post-archive re-check: did a payment land while we were
            # uploading? Only a still-SUSPENDED, still-armed, still-due
            # subscription may be deleted.
            db.session.expire_all()
            recheck = TenantSubscription.query.filter_by(
                id=sub_id, is_deleted=False,
                status=SubscriptionStatus.SUSPENDED).first()
            recheck_due = (recheck is not None
                           and _aware(recheck.data_purge_after) is not None
                           and _aware(recheck.data_purge_after) <= utcnow())
            if not recheck_due:
                logger.warning('[BILLING] tenant %s revived during '
                               'archive — purge aborted', tenant_id)
                stats['skipped'] += 1
                continue

            # media_assets carries a plain (no ondelete) FK to tenants;
            # its rows are in the archive already, so clear them or the
            # hard delete below dies on ForeignKeyViolation.
            from app.models.media_asset import MediaAsset
            MediaAsset.query.filter_by(tenant_id=tenant_id).delete(
                synchronize_session=False)

            from app.api.platform.service import PlatformTenantService
            PlatformTenantService.delete_tenant(tenant_id, hard=True)
            stats['purged'] += 1
            logger.warning('[BILLING] tenant %s purged after retention; '
                           'archive at s3://%s/%s', tenant_id,
                           archive['bucket'], archive['prefix'])
        except Exception:  # noqa: BLE001 — park with backoff
            db.session.rollback()
            stats['failed'] += 1
            logger.exception('[BILLING] retention purge failed tenant=%s',
                             tenant_id)
            try:
                fresh = TenantSubscription.query.filter_by(
                    id=sub_id, is_deleted=False).first()
                if fresh is not None:
                    fstate = dict(fresh.billing_state or {})
                    fstate['purge_failed_at'] = utcnow().isoformat()
                    fresh.billing_state = fstate
                    db.session.commit()
            except Exception:  # noqa: BLE001
                db.session.rollback()
    db.session.commit()
    return stats


# --------------------------------------------------------------------------- #
# Scheduler entrypoint (APScheduler job — see app/__init__._start_scheduler)
# --------------------------------------------------------------------------- #

def run_daily_subscription_sweeps(app):
    """Daily reconciliation: over-limit pass + billing/dunning pass.
    Same work as ``scripts/sweep_over_limit.py`` — wired into the in-app
    scheduler so production needs no external crontab."""
    with app.app_context():
        try:
            from app.api.pricing.service import PlanService
            over = PlanService.sweep_over_limit_subscriptions()
            billing = sweep_billing_periods()
            addons = sweep_addon_periods()
            retention = sweep_data_retention()
            logger.info(
                '[SCHED] subscription sweeps: over-limit %s | billing %s'
                ' | addons %s | retention %s',
                over, billing, addons, retention,
            )
        except Exception:  # noqa: BLE001 — a failed sweep must not kill the scheduler
            logger.exception('[SCHED] subscription sweeps failed')
