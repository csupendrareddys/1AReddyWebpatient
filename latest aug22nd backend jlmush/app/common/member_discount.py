"""The buyer-side discount: what a patient's own membership tier takes off.

Three reductions stack on a patient-facing price, and they are deliberately
resolved in different places because they answer different questions:

  1. ``DisplayPricingRule`` (see :mod:`app.common.display_pricing`) — the
     admin's markup + markdown for one doctor × offering. Same for everybody,
     so it is baked into the *displayed* price, and it is what the
     strikethrough on a card advertises.
  2. Vouchers / coupons — flat ₹ rows an admin attaches to that same rule.
     Also baked in, same reason.
  3. This module — what the *buyer's* own membership tier takes off. It
     cannot be baked into a display price because the price is quoted before
     we know who is looking, and two patients on different tiers see
     different totals for the same slot.

So the order is always: resolve the display price first, then apply this on
top. That ordering matters — applying the member % to the doctor's raw fee
would discount a number the patient never sees.

**``member_discount_pct`` is a ceiling, not a rate.** It used to be applied
flatly: every holder of a 20%-off tier got 20% off everything, whatever the
platform's margin on that particular offering happened to be. It is now the
maximum the tier can grant, and ``DisplayPricingRule.plan_discounts`` — a
``{plan_id: pct}`` map on each doctor × offering row — is where an admin dials
an individual offering below it. An offering with no entry for a plan grants
that plan's full ceiling, so the flat behaviour is still the default and a
newly created tier is honoured everywhere the moment it exists.

Two functions answer the two questions that follow from that:
:func:`plan_discount_caps` (what does each tier promise?) and
:func:`offering_discount_pct` (what does THIS offering actually grant the
buyer in front of us?). Every quote and every charge goes through the second
one, which is what keeps the number on the card and the number on the invoice
the same.

The provider's payout is unaffected by design: their fee is settled from the
doctor-side figure, and the platform absorbs the member discount out of its
own increment. Nothing here touches ``doctor_fee``.
"""
from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP

logger = logging.getLogger(__name__)


def plan_discount_pct(plan) -> Decimal:
    """The member discount a ``MembershipPlan`` grants, clamped to 0-100.

    Clamped rather than trusted: the column has a CHECK constraint, but this
    also runs against plan-shaped dicts from the API layer, and a price is not
    the place to discover a bad number.
    """
    raw = None
    if plan is not None:
        raw = plan.get('member_discount_pct') if isinstance(plan, dict) \
            else getattr(plan, 'member_discount_pct', None)
    try:
        pct = Decimal(str(raw or 0))
    except (TypeError, ValueError):
        return Decimal('0')
    return min(max(pct, Decimal('0')), Decimal('100'))


def is_receiver_plan(plan) -> bool:
    """True when ``plan`` belongs to a service-RECEIVER vertical.

    Only receivers get a member discount. A provider tier
    (doctor / clinic / hospital) is something a practice *sells its services
    through* — its levers on money are ``commission_pct`` and the three
    platform charges, all of which cut the provider's earnings. A discount
    there would mean the platform paying a doctor to be a member, which is
    the opposite of what the tier is for.

    Keyed off ``vertical_plan_type.is_receiver`` rather than a hardcoded
    ``vertical == 'patient'``: verticals are tenant-authored and extensible
    (the seeded receiver vertical is 'corporate' on some tenants), so the flag
    is the only thing that stays true as tenants add their own.
    """
    vertical = getattr(plan, 'vertical_plan_type', None) if plan is not None else None
    if vertical is None and isinstance(plan, dict):
        vertical = plan.get('vertical_plan_type')
    if vertical is None:
        # A plan pointing at a deleted vertical can't be shown to be a
        # receiver tier, and "no discount" is the safe way to be wrong.
        return False
    flag = vertical.get('is_receiver') if isinstance(vertical, dict) \
        else getattr(vertical, 'is_receiver', False)
    return bool(flag)


def member_discount_pct(user_id) -> Decimal:
    """The CEILING granted by ``user_id``'s current membership tier.

    The tier's headline promise — the most any single offering may take off
    for this buyer. What a given offering actually grants is
    :func:`offering_discount_pct`, which reads this and then lets the
    offering's own pricing rule dial it down. Callers wanting the number to
    charge want that one; this is the "up to N%" figure the tier advertises.

    ``Decimal('0')`` when the user holds no membership, when the membership is
    a provider (non-receiver) tier, when their tier grants none, or when the
    lookup fails — a discount lookup must never be able to break a booking, so
    every failure mode degrades to "no discount" rather than to an error.

    PENDING subscriptions count, because ``get_active_for_user`` treats them
    as current: a patient who picked a tier at registration is on it from the
    moment they book, not from whenever an admin gets round to approving.
    """
    return current_member_plan(user_id)[1]


def current_member_plan(user_id):
    """``(plan_id_str, ceiling)`` for ``user_id``'s current membership tier.

    ``(None, Decimal('0'))`` for anyone without one. The plan id comes back
    alongside the ceiling because both are needed together at every call site:
    the id selects this buyer's entry out of a rule's ``plan_discounts`` map,
    and the ceiling caps whatever that entry says.

    Memoised on ``flask.g`` for the life of the request. A marketplace listing
    prices dozens of rows and every one of them resolves the same buyer, so
    without this each card would re-run the subscription lookup.
    """
    if not user_id:
        return None, Decimal('0')
    cache_key = f'_member_plan_{user_id}'
    try:
        from flask import g, has_app_context

        if has_app_context() and hasattr(g, cache_key):
            return getattr(g, cache_key)

        from app.api.membership.service import MembershipSubscriptionService

        sub = MembershipSubscriptionService.get_active_for_user(user_id)
        plan = sub.plan if sub is not None else None
        # Belt and braces with the write-side guard in the plan routes: a
        # provider tier should never carry a non-zero discount in the first
        # place, but rows predating that guard still exist and this is the
        # read every price goes through.
        if plan is None or not is_receiver_plan(plan):
            resolved = (None, Decimal('0'))
        else:
            resolved = (str(plan.id), plan_discount_pct(plan))

        if has_app_context():
            setattr(g, cache_key, resolved)
        return resolved
    except Exception:
        logger.exception(
            '[MEMBER_DISCOUNT] lookup failed for user %s; charging full price',
            user_id,
        )
        return None, Decimal('0')


def plan_discount_caps(tenant_id=None):
    """``{plan_id_str: ceiling}`` for every receiver tier in the tenant.

    What the admin pricing table needs to render: one row per membership plan
    a patient could be on, each with the maximum an offering is allowed to
    grant it. Provider tiers are excluded for the reason in
    :func:`is_receiver_plan` — a discount there would mean paying a doctor to
    be a member.

    Empty dict on any failure, which reads as "no tier grants anything" and
    leaves the pricing table with nothing to configure rather than a 500.
    """
    try:
        # From the module, not the ``app.models`` package: ``VerticalPlanType``
        # is not re-exported there, and the ImportError would be swallowed by
        # the except below into "every tier grants nothing" — a silently
        # discount-free platform rather than a visible error.
        from app.models.membership import MembershipPlan, VerticalPlanType
        from app.common.tenant_context import current_tenant_id_or_default
        from app.extensions import db

        tid = tenant_id or current_tenant_id_or_default()
        query = db.session.query(
            MembershipPlan.id, MembershipPlan.member_discount_pct,
        ).join(
            VerticalPlanType,
            MembershipPlan.vertical_plan_type_id == VerticalPlanType.id,
        ).filter(
            VerticalPlanType.is_receiver == True,  # noqa: E712
            MembershipPlan.is_deleted == False,  # noqa: E712
        )
        if tid:
            query = query.filter(MembershipPlan.tenant_id == tid)

        caps = {}
        for plan_id, pct in query.all():
            try:
                value = Decimal(str(pct or 0))
            except (TypeError, ValueError):
                value = Decimal('0')
            caps[str(plan_id)] = min(max(value, Decimal('0')), Decimal('100'))
        return caps
    except Exception:
        logger.exception('[MEMBER_DISCOUNT] receiver plan lookup failed')
        return {}


def _rule_plan_discounts(rule):
    """The ``{plan_id: pct}`` override map off a rule, or ``{}``.

    Accepts an ORM row or a plain dict, same as the rest of the pricing
    helpers, so an admin previewing an unsaved row and the server pricing a
    saved one run the identical arithmetic.
    """
    if rule is None:
        return {}
    raw = rule.get('plan_discounts') if isinstance(rule, dict) \
        else getattr(rule, 'plan_discounts', None)
    return raw if isinstance(raw, dict) else {}


def offering_discount_pct(rule, user_id=None, plan_id=None, cap=None):
    """What ONE offering grants ONE buyer — the number that is charged.

    ``rule`` is the offering's :class:`DisplayPricingRule` (or ``None``, which
    means no overrides exist for it). The buyer is named either by ``user_id``
    or, when the caller has already resolved them once for a whole page, by
    ``plan_id`` + ``cap`` from :func:`current_member_plan`.

    The result is the rule's entry for that plan, or the plan's ceiling when
    it has none, and always clamped to the ceiling. Clamped at read time and
    not only on save: a plan's headline % can be lowered after a row was
    written, and the tier's advertised promise has to remain the bound.
    """
    if plan_id is None and cap is None:
        plan_id, cap = current_member_plan(user_id)
    if not plan_id:
        return Decimal('0')

    try:
        ceiling = min(max(Decimal(str(cap or 0)), Decimal('0')), Decimal('100'))
    except (TypeError, ValueError):
        return Decimal('0')
    if ceiling <= 0:
        return Decimal('0')

    raw = _rule_plan_discounts(rule).get(str(plan_id))
    if raw in (None, ''):
        return ceiling
    try:
        override = Decimal(str(raw))
    except (TypeError, ValueError):
        return ceiling
    return min(max(override, Decimal('0')), ceiling)


def _rule_plan_ids(rule, field, plan_id):
    """The voucher (or coupon) ids ``rule`` marks applicable to ``plan_id``.

    Same shape-tolerance as :func:`_rule_plan_discounts` — an ORM row or a
    plain dict, and anything that isn't a ``{plan_id: [id, ...]}`` map reads as
    "nothing selected" rather than raising inside a price.
    """
    if rule is None or not plan_id:
        return []
    raw = rule.get(field) if isinstance(rule, dict) else getattr(rule, field, None)
    if not isinstance(raw, dict):
        return []
    ids = raw.get(str(plan_id))
    return [str(i) for i in ids] if isinstance(ids, list) else []


def plan_offers(rule, user_id=None, plan_id=None, tenant_id=None):
    """The vouchers/coupons ``plan_id`` may REDEEM on this offering.

    ``[{'id', 'code', 'label', 'amount', 'kind'}]``, newest book order, empty
    for a buyer with no plan or an offering nobody configured.

    This is the redeemable set, not a discount: an admin picking a voucher for
    a tier on one doctor × offering makes it *available* to that tier's members
    there, and the buyer chooses at checkout whether to spend it. Nothing here
    is subtracted until :func:`redeemed_amount` is given the ids they picked.

    Inactive and deleted rows are dropped, so retiring a voucher takes it off
    every checkout immediately without an admin unpicking it from each rule.
    """
    if plan_id is None:
        plan_id, _cap = current_member_plan(user_id)
    if not plan_id:
        return []

    ids = [(i, 'voucher') for i in _rule_plan_ids(rule, 'plan_voucher_ids', plan_id)]
    ids += [(i, 'coupon') for i in _rule_plan_ids(rule, 'plan_coupon_ids', plan_id)]
    if not ids:
        return []

    try:
        from app.models import Coupon, Voucher
        from app.common.tenant_context import current_tenant_id_or_default

        tid = tenant_id or current_tenant_id_or_default()
        wanted = {i for i, _kind in ids}
        rows = {}
        for model in (Voucher, Coupon):
            query = model.query.filter(
                model.id.in_(wanted),
                model.is_active == True,  # noqa: E712
                model.is_deleted == False,  # noqa: E712
            )
            if tid:
                query = query.filter(model.tenant_id == tid)
            for row in query.all():
                rows[str(row.id)] = row

        out = []
        for raw_id, kind in ids:
            row = rows.get(raw_id)
            if row is None:
                continue
            out.append({
                'id': raw_id,
                'code': row.code,
                'label': row.label,
                'amount': float(row.amount or 0),
                'kind': kind,
            })
        return out
    except Exception:
        logger.exception('[MEMBER_DISCOUNT] offer lookup failed for plan %s', plan_id)
        return []


def redeemed_amount(rule, redeemed_ids, user_id=None, plan_id=None,
                    tenant_id=None):
    """Flat ₹ for the offers this buyer actually chose to spend.

    Every id is checked against :func:`plan_offers` for the same rule and the
    same buyer, so a client sending an id it was never offered — another
    tier's voucher, another offering's, a retired one — contributes nothing.
    The list the checkout renders and the sum the charge uses come from one
    function, which is what stops the two disagreeing.
    """
    if not redeemed_ids:
        return Decimal('0')
    offered = {o['id']: o['amount']
               for o in plan_offers(rule, user_id, plan_id, tenant_id)}
    total = Decimal('0')
    for raw_id in redeemed_ids:
        amount = offered.get(str(raw_id))
        if amount is None:
            logger.info('[MEMBER_DISCOUNT] ignoring unofferred discount %s', raw_id)
            continue
        total += Decimal(str(amount))
    return max(total, Decimal('0'))


def plan_discount_amount(rule, plan_id, discounts=None, tenant_id=None):
    """Flat ₹ the vouchers + coupons an admin picked for ``plan_id`` take off.

    The per-plan sibling of the rule's plain ``voucher_ids`` / ``coupon_ids``,
    resolved through the very same book
    (:func:`app.common.display_pricing.discount_amounts`) so a voucher's amount,
    and the fact that deactivating it stops it applying, mean one thing
    platform-wide. The only difference is the audience: the plain lists reduce
    the price for everybody and are baked into it, these reduce it only for
    holders of one membership plan and therefore cannot be — the price is
    quoted before we know who is looking.

    ``Decimal('0')`` for a buyer with no plan, a rule with no selection for
    theirs, or ids that no longer resolve. A retired voucher contributes
    nothing rather than raising, exactly as it does on the display side.
    """
    ids = _rule_plan_ids(rule, 'plan_voucher_ids', plan_id) \
        + _rule_plan_ids(rule, 'plan_coupon_ids', plan_id)
    if not ids:
        return Decimal('0')
    try:
        if discounts is None:
            from app.common.display_pricing import discount_amounts
            discounts = discount_amounts(tenant_id)
        total = Decimal('0')
        for raw_id in ids:
            total += discounts.get(str(raw_id), Decimal('0'))
        return max(total, Decimal('0'))
    except Exception:
        logger.exception(
            '[MEMBER_DISCOUNT] per-plan voucher lookup failed for plan %s; '
            'charging without it', plan_id,
        )
        return Decimal('0')


def apply_member_discount(amount, pct):
    """``amount`` less ``pct``%, rounded to 2dp and floored at 0.

    ``None`` in, ``None`` out — an unpriced offering stays unpriced rather
    than becoming a free one.
    """
    if amount is None:
        return None
    try:
        base = Decimal(str(amount))
    except (TypeError, ValueError):
        return amount
    try:
        percent = Decimal(str(pct or 0))
    except (TypeError, ValueError):
        percent = Decimal('0')
    if percent <= 0:
        return float(base.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))

    net = base - (base * percent / 100)
    net = max(net, Decimal('0'))
    return float(net.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


def member_deduction(rule, user_id=None, plan_id=None, cap=None,
                     discounts=None, tenant_id=None):
    """``(pct, flat)`` — everything the buyer's membership takes off ``rule``.

    The two halves of a plan's benefit on one offering, resolved together
    because every caller needs both and resolving the buyer twice is how they
    drift: the percentage (:func:`offering_discount_pct`) and the flat ₹ of
    the vouchers/coupons picked for that plan (:func:`plan_discount_amount`).
    """
    if plan_id is None and cap is None:
        plan_id, cap = current_member_plan(user_id)
    pct = offering_discount_pct(rule, plan_id=plan_id, cap=cap)
    flat = plan_discount_amount(rule, plan_id, discounts, tenant_id)
    return pct, flat


def apply_member_benefit(amount, pct, flat):
    """``amount`` less ``pct``% then less ``flat`` ₹, floored at 0.

    Order matters and is fixed here so no caller has to decide: the percentage
    is a proportion of what the offering costs, the voucher is a fixed sum off
    what is left. Taking the voucher off first would make the percentage
    discount the voucher too.
    """
    net = apply_member_discount(amount, pct)
    if net is None:
        return None
    try:
        reduced = Decimal(str(net)) - Decimal(str(flat or 0))
    except (TypeError, ValueError):
        return net
    reduced = max(reduced, Decimal('0'))
    return float(reduced.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


def discount_for_user(amount, user_id, rule=None):
    """Charge ``user_id`` for one offering, net of their whole member benefit.

    Returns ``(net_amount, pct, redeemable)``.

    The percentage is automatic — holding the plan is the whole qualification —
    so it comes off here. The per-plan vouchers do NOT: they are an offer the
    buyer chooses to spend at checkout (see :func:`plan_offers`), and the
    booking path subtracts only the ones they actually picked, via
    :func:`redeemed_amount`. ``redeemable`` is what was on the table, returned
    so a caller can show or record it.

    ``rule`` is the offering's :class:`DisplayPricingRule`, and passing it is
    what makes the charge match the quote: the patient-facing card is badged
    with :func:`offering_discount_pct` for that same rule, so a charge path
    that omitted it would bill the tier's ceiling on an offering the admin had
    deliberately dialled below it — and would miss the per-plan vouchers
    entirely. ``None`` means "no overrides for this offering", which resolves
    to the ceiling and no vouchers — the correct answer for the offerings
    nobody has configured, and the safe one when a caller genuinely has no
    rule to hand.
    """
    pct, flat = member_deduction(rule, user_id)
    return apply_member_discount(amount, pct), pct, float(flat)
