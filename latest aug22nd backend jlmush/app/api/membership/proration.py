"""Membership plan-change pricing — the single source of truth for what a
plan-based provider pays when they activate, renew, upgrade or downgrade a
membership tier.

Rules (see the product spec):

* A billing cycle is a fixed number of DAYS, not a calendar month, so the
  per-day rate is deterministic: ``daily = period_price / CYCLE_DAYS[period]``.
  Monthly is 30 days by definition here.

* Activating (from trial / pending / a lapsed or held subscription) costs the
  full chosen-period price and starts a fresh period ``[now, now + cycle]``.

* Upgrading mid-cycle (the new tier's monthly price is higher) is prorated:
  the unused portion of what was paid for the current period is credited, and
  the provider pays ``new_period_price - credit``. The new period restarts
  fresh from today. Days are counted inclusively — the activation day is day 1,
  and a change any time before midnight of day N counts as N days used.

* Downgrading mid-cycle (lower monthly price) is NOT allowed — a downgrade
  happens at renewal, when the current period has lapsed and the provider pays
  for the lower tier fresh. That path is an ordinary activation, so nothing
  special is needed here beyond refusing the mid-cycle downgrade.

Pure and side-effect free: callers pass models in, get numbers out. No DB
writes, no ``datetime.now`` baked in (the caller passes ``now`` so this stays
testable and so the appointment-completion-style "never write" discipline is
easy to keep).
"""
from datetime import timedelta

# Period key -> cycle length in days. Monthly is 30 by product definition;
# the rest are 30-day multiples so the per-day rate is consistent across tiers.
CYCLE_DAYS = {
    'monthly': 30,
    'quarterly': 90,
    'semi_annual': 180,
    'annual': 360,
    'biennial': 720,
    'triennial': 1080,
}

# A price of -1 in the pricing blob means "Custom / contact us" — not payable.
_CUSTOM = -1


class PlanChangeError(ValueError):
    """A requested plan change is not payable (bad period, custom price, or a
    disallowed mid-cycle downgrade). Carries a human message for the API."""


def period_price(plan, period):
    """The plan's price for one billing period, or ``None`` if the plan does
    not offer that period (or prices it as Custom)."""
    if period not in CYCLE_DAYS:
        return None
    raw = (plan.pricing or {}).get(f'price_inr_{period}')
    if raw is None:
        return None
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    if val == _CUSTOM:
        return None
    return val


def monthly_rank(plan):
    """A tier's rank for upgrade/downgrade comparison — its monthly price.

    Falls back to the smallest offered period price when a plan is not priced
    monthly, so tiers priced only quarterly/annually still compare sensibly.
    Returns ``None`` only when the plan has no payable period at all.
    """
    monthly = period_price(plan, 'monthly')
    if monthly is not None:
        return monthly
    offered = [period_price(plan, p) for p in CYCLE_DAYS]
    offered = [p for p in offered if p is not None]
    return min(offered) if offered else None


def days_used(period_start, now):
    """Inclusive day count since the period started — activation day is day 1.

    A change at any time before midnight of day N counts as N days used, which
    is what "counts as 3 days" means in the spec.
    """
    if period_start is None:
        return 0
    delta = (now.date() - period_start.date()).days
    return max(1, delta + 1)


def remaining_credit(subscription, now):
    """Unused rupee value of the CURRENT paid period, credited toward an
    upgrade. Zero unless the subscription is a live, paid ACTIVE period — a
    trial or lapsed/held member has paid nothing to credit.
    """
    from app.models._enums import MembershipSubscriptionStatus as S

    if subscription is None or subscription.status != S.ACTIVE:
        return 0.0
    start = subscription.current_period_start
    end = subscription.current_period_end
    if not start or not end or end <= now:
        return 0.0  # no live paid period to credit

    plan = subscription.plan
    period = (getattr(subscription, 'plan_period', None) or 'monthly')
    paid = period_price(plan, period)
    if not paid or paid <= 0:
        return 0.0

    cycle = CYCLE_DAYS.get(period, 30)
    used = min(days_used(start, now), cycle)
    remaining = max(0, cycle - used)
    return round(paid * remaining / cycle, 2)


def quote_change(subscription, new_plan, period, now):
    """What the provider pays to move ``subscription`` onto ``new_plan`` for
    ``period``, and the resulting period window.

    Returns a dict:
      ``{kind, amount_inr, credit_inr, base_price_inr, days_used,
         new_period_start, new_period_end}``
    where ``kind`` is 'activate' | 'renew' | 'upgrade'.

    Raises ``PlanChangeError`` when the change isn't payable: the plan doesn't
    offer the period, or it's a disallowed mid-cycle downgrade.
    """
    from app.models._enums import MembershipSubscriptionStatus as S

    base = period_price(new_plan, period)
    if base is None:
        raise PlanChangeError(
            f"This plan isn't available for {period.replace('_', '-')} billing."
        )

    cycle = CYCLE_DAYS[period]
    new_start = now
    new_end = now + timedelta(days=cycle)

    # An ACTIVE, still-running paid period is the only case with a credit and
    # the only case where upgrade/downgrade direction matters.
    is_live_paid = (
        subscription is not None
        and subscription.status == S.ACTIVE
        and subscription.current_period_end
        and subscription.current_period_end > now
    )

    if not is_live_paid:
        # Trial, pending, lapsed or held → straight activation for the full price.
        return {
            'kind': 'activate',
            'amount_inr': round(base, 2),
            'credit_inr': 0.0,
            'base_price_inr': round(base, 2),
            'days_used': 0,
            'new_period_start': new_start,
            'new_period_end': new_end,
        }

    current_plan = subscription.plan
    same_plan = str(new_plan.id) == str(subscription.membership_plan_id)
    new_rank = monthly_rank(new_plan)
    cur_rank = monthly_rank(current_plan)

    # A strictly cheaper tier mid-cycle is a downgrade — not allowed until the
    # current period lapses and they renew onto it fresh.
    if not same_plan and new_rank is not None and cur_rank is not None \
            and new_rank < cur_rank:
        raise PlanChangeError(
            "Downgrades take effect at your next cycle. You can move to a "
            "lower tier once your current plan period ends."
        )

    credit = remaining_credit(subscription, now)
    amount = max(0.0, round(base - credit, 2))
    return {
        'kind': 'upgrade' if (not same_plan and new_rank and cur_rank
                              and new_rank > cur_rank) else 'renew',
        'amount_inr': amount,
        'credit_inr': round(credit, 2),
        'base_price_inr': round(base, 2),
        'days_used': min(days_used(subscription.current_period_start, now), cycle),
        'new_period_start': new_start,
        'new_period_end': new_end,
    }
