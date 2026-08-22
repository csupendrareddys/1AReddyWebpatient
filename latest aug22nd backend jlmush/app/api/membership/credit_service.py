"""Health-credit wallet service — grant (per period, no rollover), quote the
redeemable amount for an offering, redeem at checkout, and refund on cancel.

1 credit = ₹1. A grant RESETS the wallet to the plan's ``CreditPolicy.grant_amount``
and its expiry to the subscription's period end (unused credits never roll over).
The policy (grant + per-offering caps) is read LIVE by ``plan_id`` at grant/quote
time, so an admin edit reflects immediately — no plan re-version, no renewal.
"""
import logging
import math

from app.extensions import db
from app.models._base import utcnow

logger = logging.getLogger(__name__)


def _get_wallet(tenant_id, user_id):
    from app.models import HealthCreditWallet
    return HealthCreditWallet.query.filter_by(
        tenant_id=tenant_id, user_id=user_id).first()


def get_wallet(tenant_id, user_id):
    return _get_wallet(tenant_id, user_id)


def _policy_for_plan(tenant_id, plan_id):
    """The live :class:`CreditPolicy` for a plan (or ``None``).

    This is the single source of truth for the grant amount + per-offering
    redemption caps, read fresh at grant / quote time so an admin's edit takes
    effect immediately — no plan re-version, no renewal.
    """
    if not plan_id:
        return None
    from app.models import CreditPolicy
    return CreditPolicy.query.filter_by(
        tenant_id=tenant_id, plan_id=plan_id).first()


def grant_for_subscription(subscription):
    """Reset the subscriber's wallet to the plan's per-period credit grant.

    Called on first activation and each paid renewal. No-op when the plan grants
    no credits. Idempotent per period isn't required — a re-grant simply resets
    to the same amount for the same period end.
    """
    from app.models import HealthCreditWallet, HealthCreditLedger, MembershipPlan

    tenant_id = subscription.tenant_id
    plan_id = subscription.membership_plan_id
    # Load by id (authoritative) — the relationship can be stale right after a
    # plan swap in apply_paid_activation.
    plan = (MembershipPlan.query.get(plan_id) if plan_id
            else getattr(subscription, 'plan', None))
    policy = _policy_for_plan(tenant_id, plan_id or (plan.id if plan else None))
    grant = float(getattr(policy, 'grant_amount', 0) or 0) if policy else 0
    if not plan or grant <= 0:
        return None

    user_id = subscription.user_id
    if not user_id:
        return None

    wallet = _get_wallet(tenant_id, user_id)
    if wallet is None:
        wallet = HealthCreditWallet(tenant_id=tenant_id, user_id=user_id)
        db.session.add(wallet)
        db.session.flush()             # materialise wallet.id for the ledger FK

    wallet.balance = grant                     # reset — no rollover
    # Expiry: the plan's admin-set validity window if configured (days from
    # now), else the subscription's billing-period end (original behaviour).
    validity_days = getattr(policy, 'validity_days', None) if policy else None
    if validity_days:
        from datetime import timedelta
        wallet.period_end = utcnow() + timedelta(days=int(validity_days))
    else:
        wallet.period_end = subscription.current_period_end
    wallet.plan_id = plan.id
    db.session.add(HealthCreditLedger(
        tenant_id=tenant_id, wallet_id=wallet.id,
        user_id=user_id, amount=grant, kind='grant',
        note=f'{plan.name} period grant',
    ))
    db.session.flush()
    logger.info('[CREDIT] granted %s to user=%s plan=%s until=%s',
                grant, user_id, plan.code, subscription.current_period_end)
    return wallet


def apply_validity_to_plan_wallets(tenant_id, plan_id, validity_days, now=None):
    """Re-stamp the expiry of every live wallet on a plan when an admin
    changes the plan's credit ``validity_days``. Effect is immediate:
    each wallet's ``period_end`` becomes ``now + validity_days``.

    ``validity_days`` of ``None``/0 clears the override — existing wallets
    are left untouched (future grants revert to the subscription's
    billing-period end). Returns the count of wallets updated.
    """
    if not validity_days:
        return 0
    from datetime import timedelta
    from app.models import HealthCreditWallet
    now = now or utcnow()
    new_end = now + timedelta(days=int(validity_days))
    wallets = HealthCreditWallet.query.filter_by(
        tenant_id=tenant_id, plan_id=plan_id,
    ).all()
    for w in wallets:
        w.period_end = new_end
    if wallets:
        logger.info('[CREDIT] re-stamped %d wallet(s) on plan=%s to expire %s',
                    len(wallets), plan_id, new_end)
    return len(wallets)


def manual_grant(tenant_id, user_id, amount, note=None, now=None,
                 ref_type='manual', ref_id=None):
    """Admin: add credits to a user's wallet ad-hoc (a goodwill / correction
    top-up), independent of any plan grant.

    Adds to the current balance when the grant is still live; if the wallet is
    absent or its grant has expired, starts a fresh balance. Manual credits get a
    1-year life (or keep the wallet's existing, still-valid expiry). Records a
    ``grant`` ledger row noting it was manual. Returns the wallet, or None on a
    non-positive amount.
    """
    from datetime import timedelta
    from app.models import HealthCreditWallet, HealthCreditLedger
    amount = float(amount or 0)
    if amount <= 0 or not user_id:
        return None
    now = now or utcnow()

    wallet = _get_wallet(tenant_id, user_id)
    if wallet is None:
        wallet = HealthCreditWallet(tenant_id=tenant_id, user_id=user_id, balance=0)
        db.session.add(wallet)
        db.session.flush()             # materialise wallet.id for the ledger FK

    # An expired grant is worth 0 — don't let a manual top-up silently revive
    # stale credits. available() returns 0 past period_end.
    base = wallet.available(now)
    wallet.balance = base + amount
    if wallet.period_end is None or wallet.period_end < now:
        wallet.period_end = now + timedelta(days=365)

    label = (note if ref_type != 'manual' else
             (f'Manual grant — {note}' if note else 'Manual grant'))
    db.session.add(HealthCreditLedger(
        tenant_id=tenant_id, wallet_id=wallet.id, user_id=user_id,
        amount=amount, kind='grant', ref_type=ref_type, ref_id=ref_id,
        note=(label or '')[:200],
    ))
    db.session.flush()
    logger.info('[CREDIT] manual grant %s to user=%s (%s)', amount, user_id, note)
    return wallet


def quote_redeemable(tenant_id, user_id, offering_scope, price, now=None):
    """How many credits the user may spend on a booking of ``price`` for this
    offering scope, honouring the plan's per-offering caps (% and ₹) + balance."""
    now = now or utcnow()
    price = float(price or 0)
    wallet = _get_wallet(tenant_id, user_id)
    out = {
        'available': 0.0, 'allowed': False, 'max_redeemable': 0.0,
        'max_pct': None, 'max_amount': None, 'currency': 'INR',
    }
    if wallet is None:
        return out
    avail = wallet.available(now)
    out['available'] = avail
    if avail <= 0 or price <= 0 or not wallet.plan_id:
        return out
    policy = _policy_for_plan(tenant_id, wallet.plan_id)
    cfg = policy.scope(offering_scope) if policy else {}
    if not cfg.get('allowed'):
        return out

    max_pct = cfg.get('max_pct')
    max_amount = cfg.get('max_amount')
    caps = [avail, price]
    if max_pct not in (None, ''):
        caps.append(price * float(max_pct) / 100.0)
    if max_amount not in (None, ''):
        caps.append(float(max_amount))
    # Whole rupees only.
    redeemable = math.floor(min(caps))
    out.update({
        'allowed': True,
        'max_pct': max_pct,
        'max_amount': max_amount,
        'max_redeemable': float(max(0, redeemable)),
    })
    return out


def redeem(tenant_id, user_id, offering_scope, price, requested,
           ref_type=None, ref_id=None, now=None):
    """Spend up to ``requested`` credits on a booking, capped by
    :func:`quote_redeemable`. Returns the amount actually applied (0 if none)."""
    from app.models import HealthCreditLedger
    requested = float(requested or 0)
    if requested <= 0:
        return 0.0
    q = quote_redeemable(tenant_id, user_id, offering_scope, price, now=now)
    amount = min(requested, q['max_redeemable'])
    if amount <= 0:
        return 0.0
    wallet = _get_wallet(tenant_id, user_id)
    wallet.balance = float(wallet.balance or 0) - amount
    db.session.add(HealthCreditLedger(
        tenant_id=tenant_id, wallet_id=wallet.id, user_id=user_id,
        amount=-amount, kind='spend', ref_type=ref_type, ref_id=ref_id,
        note=f'Redeemed on {offering_scope}',
    ))
    db.session.flush()
    logger.info('[CREDIT] user=%s spent %s on %s ref=%s',
                user_id, amount, offering_scope, ref_id)
    return float(amount)


def refund(tenant_id, user_id, amount, ref_type=None, ref_id=None, now=None):
    """Return spent credits to the wallet (e.g. on a cancelled booking), only
    while the granting period is still current."""
    from app.models import HealthCreditLedger
    amount = float(amount or 0)
    if amount <= 0:
        return 0.0
    wallet = _get_wallet(tenant_id, user_id)
    if wallet is None:
        return 0.0
    now = now or utcnow()
    if wallet.period_end is not None and wallet.period_end < now:
        return 0.0  # grant already expired — nothing to refund into
    wallet.balance = float(wallet.balance or 0) + amount
    db.session.add(HealthCreditLedger(
        tenant_id=tenant_id, wallet_id=wallet.id, user_id=user_id,
        amount=amount, kind='refund', ref_type=ref_type, ref_id=ref_id,
        note='Booking cancelled',
    ))
    db.session.flush()
    return amount


def refund_for_ref(tenant_id, user_id, ref_type, ref_id, now=None):
    """Refund the still-outstanding credits spent on a given booking (spend
    minus any prior refund), e.g. when it's cancelled. Idempotent."""
    from app.models import HealthCreditLedger
    rows = HealthCreditLedger.query.filter_by(
        tenant_id=tenant_id, user_id=user_id,
        ref_type=ref_type, ref_id=ref_id).all()
    spent = sum(-float(r.amount) for r in rows if r.kind == 'spend')
    refunded = sum(float(r.amount) for r in rows if r.kind == 'refund')
    outstanding = spent - refunded
    if outstanding <= 0:
        return 0.0
    return refund(tenant_id, user_id, outstanding,
                  ref_type=ref_type, ref_id=ref_id, now=now)
