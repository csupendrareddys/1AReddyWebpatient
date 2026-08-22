"""Resolve the patient-facing *display price* for a provider's offering.

A provider's own number is what they are paid — a ``Doctor.slot_pricing`` tier
for a consultation, or ``DoctorMarketplaceProduct.doctor_price`` for a catalog
service. ``DisplayPricingRule`` holds the SUPER_ADMIN overlay (platform
increment + overall discount) for that offering. This module is the single
place the two are combined, so the admin preview, the doctor cards, the booking
dialog, the marketplace listing and the amount charged can never disagree.

Formula (mirrors the admin table, column for column)::

    gross   = fee + increment_fixed + fee * increment_pct / 100
    display = gross - gross * overall_discount_pct / 100
                    - selected vouchers - selected coupons

Vouchers and coupons are flat ₹ rows an admin marks applicable to a given
doctor × offering; each one subtracts directly. Plan-based patient reductions
are still NOT applied here — those depend on the individual patient's active
plan and are only knowable at purchase time. The rule now carries their
per-offering *rate* (``plan_discounts``), but resolving and subtracting it is
:mod:`app.common.member_discount`'s job, at purchase.

``gross`` is what a card strikes through and ``display_price`` is what it
quotes beside it, so the percentage a patient reads off a card is exactly the
Overall % (plus vouchers/coupons) an admin typed into the pricing table.
"""
from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP

logger = logging.getLogger(__name__)

#: Tiers written before per-type pricing existed carry no ``consultation_type``;
#: every reader in the codebase treats those as in-person. Kept in sync with
#: ``DoctorService.DEFAULT_PRICING_TYPE``.
DEFAULT_CONSULTATION_TYPE = 'complete'

#: ``scope_type`` for catalog services. Mirrors ``models.display_pricing``;
#: duplicated as a literal to keep this module import-light.
SERVICE_SCOPE = 'service'

#: ``scope_type`` for admin-authored group offerings (healthcare plans). These
#: are priced once per offering — ``scope_key`` is the offering id and the rule
#: carries no ``doctor_id``, because the plan has a team behind it rather than
#: one owner.
GROUP_SCOPE = 'group_offering'


# ─── scope keys ────────────────────────────────────────────────────────────

def slot_key(tier):
    """Canonical duration-slot key ('0-10', '10-20', …) for a pricing tier.

    Tiers normally carry ``range`` verbatim from the doctor's Pricing tab.
    Legacy rows only have ``duration``, which the UI derives the range from in
    10-minute steps — reproduce that here so a rule keyed on '10-20' still
    matches a tier that only says ``duration: 20``.
    """
    if not isinstance(tier, dict):
        return ''
    raw = tier.get('range')
    if raw not in (None, ''):
        return str(raw).strip()
    duration = tier.get('duration')
    if duration in (None, ''):
        return ''
    try:
        duration = int(float(duration))
    except (TypeError, ValueError):
        return ''
    return f'{max(duration - 10, 0)}-{duration}'


def tier_consultation_type(tier):
    """The consultation type a tier belongs to, defaulting legacy rows."""
    if not isinstance(tier, dict):
        return DEFAULT_CONSULTATION_TYPE
    return tier.get('consultation_type') or DEFAULT_CONSULTATION_TYPE


def _range_bounds(tier):
    """``(min, max)`` minutes for a tier's range key, or ``None``."""
    parts = slot_key(tier).split('-')
    if len(parts) != 2:
        return None
    try:
        return int(parts[0]), int(parts[1])
    except (TypeError, ValueError):
        return None


def tier_for_duration(tiers, consultation_type, duration):
    """The ``slot_pricing`` tier a slot of ``duration`` minutes falls in.

    Mirrors ``getPriceForSlot`` in the booking UI exactly — a range is matched
    as ``(min, max]`` so a 12-minute slot prices under '10-20' rather than
    falling through to the flat consultation fee. ``duration`` of ``None``
    matches on consultation type alone (first priced tier wins).
    """
    ctype = consultation_type or DEFAULT_CONSULTATION_TYPE
    for tier in (tiers or []):
        if not isinstance(tier, dict) or tier.get('price') is None:
            continue
        if tier_consultation_type(tier) != ctype:
            continue
        if duration is None:
            return tier
        bounds = _range_bounds(tier)
        if bounds and bounds[0] < duration <= bounds[1]:
            return tier
    return None


# ─── the overlay ───────────────────────────────────────────────────────────

def _rule_field(rule, name, default=0):
    """Read a field off a rule that may be an ORM row or a plain dict."""
    if rule is None:
        return default
    return rule.get(name, default) if isinstance(rule, dict) else getattr(rule, name, default)


def _rule_decimal(rule, name):
    try:
        return Decimal(str(_rule_field(rule, name, 0) or 0))
    except (TypeError, ValueError):
        return Decimal('0')


def discount_amounts(tenant_id=None):
    """``{id_str: Decimal}`` for every active voucher and coupon in the tenant.

    Memoised on ``flask.g`` for the life of the request: a doctor-list page
    prices dozens of rows and every one of them needs the same map, so looking
    it up per row would be a needless query storm.

    Inactive and soft-deleted rows are omitted, which is what makes
    deactivating a voucher take effect immediately without an admin having to
    unpick it from every pricing rule that references it.
    """
    try:
        from flask import g, has_app_context
        from app.models import Voucher, Coupon
        from app.common.tenant_context import current_tenant_id_or_default

        tid = str(tenant_id or current_tenant_id_or_default() or '')
        cache_key = f'_display_discount_amounts_{tid}'
        if has_app_context() and hasattr(g, cache_key):
            return getattr(g, cache_key)

        amounts = {}
        for model in (Voucher, Coupon):
            query = model.query.filter(
                model.is_active == True,  # noqa: E712
                model.is_deleted == False,  # noqa: E712
            )
            if tid:
                query = query.filter(model.tenant_id == tid)
            for row in query.all():
                amounts[str(row.id)] = Decimal(str(row.amount or 0))

        if has_app_context():
            setattr(g, cache_key, amounts)
        return amounts
    except Exception:
        logger.exception('[DISPLAY_PRICING] voucher/coupon lookup failed')
        return {}


def _selected_total(rule, field, discounts):
    """Summed ₹ of the vouchers (or coupons) a rule selects.

    Ids that no longer resolve — deleted or deactivated — contribute nothing
    rather than raising, so a price never breaks because an admin retired a
    voucher.
    """
    total = Decimal('0')
    for raw_id in (_rule_field(rule, field, None) or []):
        total += discounts.get(str(raw_id), Decimal('0'))
    return total


def price_breakdown(fee, rule, discounts=None, tenant_id=None):
    """Itemised arithmetic from a provider's fee to the patient-facing price.

    Returns Decimals so callers can format or tax them without a float
    round-trip. ``apply_rule`` is the thin "just give me the number" wrapper —
    both go through here so the admin's preview, the patient's quote and the
    charged amount can never drift apart::

        gross    = fee + increment_fixed + fee * increment_pct/100
        after %  = gross - gross * overall_discount_pct/100
        display  = after % - vouchers - coupons     (floored at 0)
    """
    try:
        base = Decimal(str(fee))
    except (TypeError, ValueError):
        return None

    if discounts is None:
        discounts = discount_amounts(tenant_id) if rule is not None else {}

    increment_fixed = _rule_decimal(rule, 'increment_fixed')
    increment_pct_amt = base * _rule_decimal(rule, 'increment_pct') / 100
    gross = base + increment_fixed + increment_pct_amt
    overall_amt = gross * _rule_decimal(rule, 'overall_discount_pct') / 100
    vouchers = _selected_total(rule, 'voucher_ids', discounts)
    coupons = _selected_total(rule, 'coupon_ids', discounts)

    display = gross - overall_amt - vouchers - coupons
    return {
        'doctor_fee': base,
        'increment_fixed': increment_fixed,
        'increment_pct_amount': increment_pct_amt,
        'gross': gross,
        'overall_discount_amount': overall_amt,
        'voucher_amount': vouchers,
        'coupon_amount': coupons,
        # A stack of discounts can exceed the gross; the patient is never owed
        # money, so the floor is applied to the final figure only.
        'display_price': max(display, Decimal('0')),
    }


def apply_rule(fee, rule, discounts=None, tenant_id=None):
    """Display price for ``fee`` under ``rule`` (``None`` rule = identity).

    ``rule`` may be a :class:`DisplayPricingRule` or any object/dict exposing
    ``increment_fixed`` / ``increment_pct`` / ``overall_discount_pct`` and the
    ``voucher_ids`` / ``coupon_ids`` selections. Returns a float rounded to 2dp
    and floored at 0.
    """
    if rule is None:
        try:
            return _money(Decimal(str(fee)))
        except (TypeError, ValueError):
            return None
    parts = price_breakdown(fee, rule, discounts, tenant_id)
    return None if parts is None else _money(parts['display_price'])


def _money(value):
    return float(value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


# ─── the markdown, as the patient-facing cards need to render it ────────────

def _whole_pct(before, after):
    """``before`` → ``after`` as a whole-number % reduction, or 0.

    Whole numbers because this is a badge ("20% off"), not an accounting
    figure — the money the patient actually pays is always the display price
    itself, never this percentage re-applied.
    """
    try:
        before = Decimal(str(before))
        after = Decimal(str(after))
    except (TypeError, ValueError):
        return 0
    if before <= 0 or after >= before:
        return 0
    pct = (before - after) / before * 100
    return int(pct.quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def viewer_id():
    """The signed-in user's id, or ``None`` outside an authenticated request.

    The patient-facing serializers that call :func:`markdown_fields` render on
    both public and authenticated routes, and only the second kind can badge a
    membership benefit. Reading the identity here rather than threading a
    ``user_id`` through every serializer keeps the badge from being a
    parameter that four call sites have to remember to pass.

    The verification is done here rather than assumed, because the surfaces
    that most need the badge are the ones that DON'T require a token:
    ``/api/doctor/list`` — what the Find Doctors page calls — carries no
    ``@jwt_required`` at all, so it serves signed-in patients and anonymous
    visitors through the same handler. Reading the identity without verifying
    first raises there for everybody, and the symptom is a member seeing no
    membership benefit on the one screen they browse doctors from.

    ``optional=True`` is what makes that work both ways: a request carrying a
    token resolves its user, one without simply yields ``None``. A malformed
    or expired token raises and is swallowed — an anonymous-looking render is
    the right failure here, since this only decides whether a badge appears.

    Under the Operations act-on-behalf proxy the viewer is the PATIENT being
    booked for, and it has to be resolved before the token is touched, for two
    separate reasons:

    * the claims are the admin's on purpose (the proxy swaps the loaded user,
      not the token), so ``get_jwt_identity()`` here badges the admin's
      membership on the patient's booking screen — which is no badge at all,
      since admins don't hold patient tiers; and
    * ``verify_jwt_in_request`` re-runs the user lookup and *overwrites*
      ``g._jwt_extended_jwt_user`` unconditionally. Called inside the proxy it
      silently reverts ``current_user`` to the admin for the rest of the
      request, so the first priced card rendered would end the impersonation
      for everything serialized after it.
    """
    try:
        from app.api.admin.operations.act_on_behalf import ops_acting_as_user_id

        acting_for = ops_acting_as_user_id()
        if acting_for is not None:
            return acting_for
    except Exception:
        # Same bargain as below: this only decides whether a badge appears.
        logger.exception('[DISPLAY_PRICING] act-on-behalf viewer lookup failed')

    try:
        from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
        verify_jwt_in_request(optional=True)
        return get_jwt_identity()
    except Exception:
        return None


def markdown_fields(fee, rule, discounts=None, tenant_id=None):
    """The discount decoration for one offering's card.

    Two independent things, either of which may be absent:

    ``original_price`` + ``discount_pct``
        The strikethrough. ``original_price`` is the offering's PRE-DISCOUNT
        price — the doctor's fee plus the admin's increment, before the
        overall %, vouchers and coupons come off it — and ``price`` beside it
        is what those reduce it to. So the struck figure and the percentage
        both describe the same thing an admin typed into the Overall column,
        which is the only reading of a slashed price that survives someone
        checking the arithmetic.

    ``member_discount_pct``
        The corner chip: what the VIEWER's membership tier takes off this
        particular offering (see
        :func:`app.common.member_discount.offering_discount_pct`). Not folded
        into ``price`` — it depends on who is looking and is settled at
        purchase — and absent for anonymous visitors and non-members.

    Keys are omitted rather than zeroed when they don't apply, so a card with
    no markdown renders exactly as it did before any of this existed. A
    strikethrough equal to the price is worse than no strikethrough.

    The tenant's site-wide ``platform_discount_pct`` is deliberately not part
    of this any more — see :mod:`app.common.platform_discount`, where it is
    switched off but kept intact.
    """
    out = {}
    try:
        parts = price_breakdown(fee, rule, discounts, tenant_id)
        if parts is not None:
            gross = _money(parts['gross'])
            display = _money(parts['display_price'])
            if gross > display:
                out['original_price'] = gross
                out['discount_pct'] = _whole_pct(gross, display)
    except Exception:
        # Never the reason a booking page 500s — the price itself resolved
        # fine, this is only the decoration around it.
        logger.exception('[DISPLAY_PRICING] markdown fields failed; showing no discount')

    try:
        from app.common.member_discount import member_deduction

        pct, flat = member_deduction(rule, viewer_id(), tenant_id=tenant_id)
        if pct > 0:
            out['member_discount_pct'] = float(pct)
        # The per-plan vouchers/coupons, in ₹. A separate key from the
        # percentage because it is a separate kind of thing: one scales with
        # the price and one doesn't, and a card that added them together
        # couldn't say "20% + ₹100 off" — which is what the patient is getting.
        if flat > 0:
            out['member_discount_amount'] = float(flat)
    except Exception:
        logger.exception('[DISPLAY_PRICING] member discount badge failed; omitting it')
    return out


def tier_card_extras(tier):
    """The optional decoration keys off one already-:func:`decorate_tiers` tier.

    A card's per-slot row ("0-10 mins · ₹300") is built in three unrelated
    places — the doctor list, the authenticated doctor-match and the public
    booking service — and each of them used to hand-copy ``original_price`` +
    ``discount_pct`` across while silently dropping ``member_discount_pct``.
    That drop is why a patient browsing slots saw their tier's blanket ceiling
    on every row instead of what the row actually grants them.

    Returns only the keys that apply, so a row with no markdown and no
    membership benefit spreads to nothing and renders exactly as before.
    """
    out = {}
    if not isinstance(tier, dict):
        return out
    if tier.get('original_price') is not None:
        out['original_price'] = tier['original_price']
        out['discount_pct'] = tier.get('discount_pct')
    if tier.get('member_discount_pct') is not None:
        out['member_discount_pct'] = tier['member_discount_pct']
    if tier.get('member_discount_amount') is not None:
        out['member_discount_amount'] = tier['member_discount_amount']
    return out


def markdown_range(tiers):
    """``original_price_min`` / ``_max`` / ``discount_pct`` for a set of tiers.

    A doctor card quotes a *range* ("₹100 – ₹250"), so it needs a range to
    slash. Bounds are min/max over the tiers' own list prices — pairing each
    end with the tier that produced it would happily emit a backwards range
    (the cheapest slot can be the one with the deepest markdown).

    ``discount_pct`` is the markdown across the whole set (summed list prices
    → summed display prices), i.e. what this consultation type is marked down
    by on average. Any single tier's own exact figure is still on that tier.

    ``member_discount_pct`` is the BEST of the set — the card quotes a range
    of prices, so its corner chip has to answer "what could my membership take
    off here", and the deepest slot is the honest answer to that. The exact
    figure for the slot the patient actually picks is on that tier and is what
    the booking summary quotes once they have picked one.

    ``member_discount_pct_min`` is the WORST of the same set, and it is what
    lets a card say which of those two sentences it is telling. When the two
    are equal every slot of this offering grants the same thing, and the card
    can state it flatly ("30% off with your plan") instead of hedging "Upto
    30%" at a patient for whom 30% is simply the answer. They differ only when
    an admin has dialled one slot below the others, and only then is the hedge
    the honest word. Sent alongside rather than folded in, because a card that
    only got the max cannot tell the two cases apart.

    ``{}`` when nothing in the set is marked down and no membership benefit
    applies, so the range renders unslashed exactly as today. Expects tiers
    already through :func:`decorate_tiers`.
    """
    try:
        prices, originals, member_pcts, member_flats = [], [], [], []
        for tier in (tiers or []):
            if not isinstance(tier, dict):
                continue
            try:
                price = float(tier.get('price'))
            except (TypeError, ValueError):
                continue
            prices.append(price)
            try:
                # A tier with no markdown has no ``original_price``; its own
                # price *is* its list price, and it still has to weigh in on
                # the bounds or an undiscounted slot would vanish from them.
                originals.append(float(tier['original_price']))
            except (TypeError, ValueError, KeyError):
                originals.append(price)
            # Absent means this tier grants the viewer nothing, which still
            # counts against the set: one slot at 0 is exactly what makes the
            # benefit non-uniform and the card's claim an "up to".
            try:
                member_pcts.append(float(tier['member_discount_pct']))
            except (TypeError, ValueError, KeyError):
                member_pcts.append(0.0)
            try:
                member_flats.append(float(tier['member_discount_amount']))
            except (TypeError, ValueError, KeyError):
                member_flats.append(0.0)

        out = {}
        if prices and sum(originals) > sum(prices):
            out['original_price_min'] = min(originals)
            out['original_price_max'] = max(originals)
            out['discount_pct'] = _whole_pct(sum(originals), sum(prices))
        if member_pcts and max(member_pcts) > 0:
            out['member_discount_pct'] = max(member_pcts)
            out['member_discount_pct_min'] = min(member_pcts)
        # The deepest per-plan voucher across the set. A range can't quote a
        # with-voucher price — the voucher may sit on one slot of several — so
        # this is only ever "there is one, worth up to N", and the exact figure
        # for the slot the patient picks is on that slot's own row.
        if member_flats and max(member_flats) > 0:
            out['member_discount_amount'] = max(member_flats)
        return out
    except Exception:
        logger.exception('[DISPLAY_PRICING] markdown range failed; showing no discount')
        return {}


# ─── rule lookup ───────────────────────────────────────────────────────────

def rules_for_doctors(doctor_ids, tenant_id=None):
    """``{(doctor_id_str, scope_type, scope_key): rule}`` for the given doctors.

    Empty dict when the table is missing or the query fails — display pricing
    must never take down a booking page, it just falls back to the provider's
    raw fee.
    """
    ids = [str(d) for d in (doctor_ids or []) if d]
    if not ids:
        return {}
    try:
        from app.models import DisplayPricingRule
        from app.common.tenant_context import current_tenant_id_or_default

        query = DisplayPricingRule.query.filter(
            DisplayPricingRule.doctor_id.in_(ids),
        )
        tid = tenant_id or current_tenant_id_or_default()
        if tid:
            query = query.filter(DisplayPricingRule.tenant_id == tid)
        rows = query.all()
    except Exception:
        logger.exception('[DISPLAY_PRICING] rule lookup failed; using raw fees')
        return {}

    return {(str(r.doctor_id), r.scope_type, r.scope_key): r for r in rows}


def rules_for_scope(scope_type, scope_key, tenant_id=None):
    """``{doctor_id_str: rule}`` for one scope — the admin table read.

    A rule with no doctor (a group offering, priced once for the whole plan)
    is keyed under ``None`` rather than the string ``'None'``, so callers can
    look it up with a plain ``.get(None)``.
    """
    try:
        from app.models import DisplayPricingRule
        from app.common.tenant_context import current_tenant_id_or_default

        query = DisplayPricingRule.query.filter(
            DisplayPricingRule.scope_type == scope_type,
            DisplayPricingRule.scope_key == scope_key,
        )
        tid = tenant_id or current_tenant_id_or_default()
        if tid:
            query = query.filter(DisplayPricingRule.tenant_id == tid)
        return {
            (str(r.doctor_id) if r.doctor_id is not None else None): r
            for r in query.all()
        }
    except Exception:
        logger.exception('[DISPLAY_PRICING] scope lookup failed')
        return {}


def rule_for(doctor_id, scope_type, scope_key, rules):
    """The rule for one scope in a map from :func:`rules_for_doctors`."""
    return rules.get((str(doctor_id), scope_type, str(scope_key)))


# ─── consultations ─────────────────────────────────────────────────────────

def rule_for_tier(doctor_id, tier, rules):
    """The rule matching a ``slot_pricing`` tier."""
    return rule_for(doctor_id, tier_consultation_type(tier), slot_key(tier), rules)


def display_price_for_tier(doctor_id, tier, rules, tenant_id=None):
    """Display price for one ``slot_pricing`` tier (``None`` if it has no fee).

    The site-wide discount hook sits here rather than at each call site: this
    function and :func:`display_price_for_service` are the only two ways a
    patient-facing price is produced — every serializer AND
    :func:`resolve_booking_fee` come through them — so putting it here is what
    guarantees the quote on the card and the amount charged can't disagree.
    It is currently an identity; see :mod:`app.common.platform_discount`.
    """
    if not isinstance(tier, dict) or tier.get('price') is None:
        return None
    from app.common.platform_discount import apply_platform_discount
    return apply_platform_discount(
        apply_rule(tier.get('price'), rule_for_tier(doctor_id, tier, rules)),
        tenant_id=tenant_id,
    )


def decorate_tiers(doctor_id, tiers, rules=None):
    """Copy of ``tiers`` with ``price`` replaced by the display price.

    The doctor's own number is preserved as ``doctor_fee`` so payout-side
    readers (and the admin preview) can still see it. Used by every
    patient-facing serializer — patients are quoted the display price, never
    the doctor's payout figure.

    A marked-down tier also carries ``original_price`` (float, same type as
    ``price``) and ``discount_pct`` so the card can slash what it came down
    from, and a tier a signed-in member gets a benefit on carries
    ``member_discount_pct`` for the corner chip. Each key is absent when it
    doesn't apply — see :func:`markdown_fields`.
    """
    tiers = tiers or []
    if rules is None:
        rules = rules_for_doctors([doctor_id])
    out = []
    for tier in tiers:
        if not isinstance(tier, dict):
            continue
        priced = dict(tier)
        if tier.get('price') is not None:
            rule = rule_for_tier(doctor_id, tier, rules)
            priced['doctor_fee'] = float(tier['price'])
            # Through the funnel, not ``apply_rule`` directly, so the tier the
            # card quotes carries the site-wide discount that the booking will
            # actually charge.
            priced['price'] = display_price_for_tier(doctor_id, tier, rules)
            priced.update(markdown_fields(tier['price'], rule))
        out.append(priced)
    return out


def booking_tier(doctor, consultation_type, duration_minutes, fallback_fee=None):
    """The ``slot_pricing`` tier one booking prices off, or ``None``.

    Split out of :func:`resolve_booking_fee` because two answers have to be
    derived from the same tier and must not be derived twice: the amount
    charged, and the :class:`DisplayPricingRule` whose ``plan_discounts`` decide
    what the buyer's membership takes off that amount. Resolving the tier
    independently at each of those two places is exactly how the price on the
    card and the price on the invoice drift apart.

    Doctors who never filled the per-slot table in get a synthetic tier around
    their flat ``Doctor.consultation_fee`` (then ``fallback_fee``), so the flat
    case still goes through the same overlay funnel rather than round a side of
    it. ``None`` only when there is no price anywhere.
    """
    if doctor is None:
        return None

    tier = tier_for_duration(
        getattr(doctor, 'slot_pricing', None), consultation_type, duration_minutes,
    )
    if tier is not None:
        return tier

    flat = getattr(doctor, 'consultation_fee', None)
    fee = flat if flat is not None else fallback_fee
    if fee is None:
        return None
    # No tier for this slot: a flat-fee doctor never appears in the admin
    # table, so this is an identity apply unless a rule happens to exist for
    # the derived range.
    return {
        'consultation_type': consultation_type,
        'duration': duration_minutes,
        'price': fee,
    }


def rule_for_booking(doctor, consultation_type, duration_minutes,
                     fallback_fee=None, rules=None, tenant_id=None):
    """The rule the booking's display price came off, or ``None``.

    The charge-side companion to :func:`resolve_booking_fee`: the fee it
    returns is what the patient pays *before* their membership tier, and this
    is the row that says how much of that tier the slot actually grants. Pass
    it to :func:`app.common.member_discount.discount_for_user` and the invoice
    matches the chip the booking summary quoted; omit it and the ceiling gets
    billed on a slot an admin deliberately dialled below it.

    ``rules`` lets a caller that already looked the doctor's rules up hand them
    over rather than paying for a second query. ``None`` back means "no
    overrides for this slot", which resolves to the tier's full ceiling — the
    right answer for every slot nobody has overridden.
    """
    tier = booking_tier(doctor, consultation_type, duration_minutes, fallback_fee)
    if tier is None:
        return None
    if rules is None:
        rules = rules_for_doctors([doctor.id], tenant_id=tenant_id)
    return rule_for_tier(doctor.id, tier, rules)


def resolve_booking_fee(doctor, consultation_type, duration_minutes,
                        fallback_fee=None, tenant_id=None, rules=None):
    """What to charge for one booking — the single server-side price authority.

    Picks the doctor's ``slot_pricing`` tier for this consultation type and
    slot length, applies the admin overlay, and returns the result in ₹. Used
    by both booking paths (public and authenticated) so re-pricing a slot in
    ``/dashboard/admin/pricing-config`` moves the amount actually charged.

    Doctors who never filled the per-slot table in fall back to their flat
    ``Doctor.consultation_fee``, and then to ``fallback_fee``. ``None`` when
    there is no price anywhere.

    The buyer's own membership tier is deliberately NOT applied here — it
    depends on who is booking, comes off last, and needs
    :func:`rule_for_booking` to know how much of the tier this slot grants.
    ``rules`` is the same escape hatch it is there: a caller wanting both
    numbers passes one lookup into both calls.
    """
    if doctor is None:
        return fallback_fee

    tier = booking_tier(doctor, consultation_type, duration_minutes, fallback_fee)
    if tier is None:
        return None
    if rules is None:
        rules = rules_for_doctors([doctor.id], tenant_id=tenant_id)
    return display_price_for_tier(doctor.id, tier, rules)


# ─── catalog services ──────────────────────────────────────────────────────

def display_price_for_group_offering(offering_id, fee, tenant_id=None):
    """Final patient price for a group offering's ``patient_price``.

    Keyed on the offering with no doctor, so one lookup answers it — there is
    no per-member overlay to merge.
    """
    if fee is None:
        return None
    rule = rules_for_scope(GROUP_SCOPE, str(offering_id),
                           tenant_id=tenant_id).get(None)
    return apply_rule(fee, rule, tenant_id=tenant_id)


def display_price_for_service(doctor_id, product_id, fee, rules=None,
                              tenant_id=None):
    """Display price for one ``DoctorMarketplaceProduct``.

    Keyed on the *catalog* product id rather than the per-doctor listing id, so
    an admin prices "Medical Certificate for Dr X" once and the rule survives
    the doctor de-listing and re-listing the service.
    """
    if fee is None:
        return None
    if rules is None:
        rules = rules_for_doctors([doctor_id], tenant_id=tenant_id)
    # Site-wide discount last — see ``display_price_for_tier`` for why both
    # funnels apply it rather than their callers.
    from app.common.platform_discount import apply_platform_discount
    return apply_platform_discount(
        apply_rule(fee, rule_for(doctor_id, SERVICE_SCOPE, product_id, rules)),
        tenant_id=tenant_id,
    )


def decorate_marketplace_product(mp_dict, doctor_id, product_id, rules=None,
                                 tenant_id=None):
    """Rewrite a ``DoctorMarketplaceProduct.to_dict()`` to the display price.

    ``doctor_price`` becomes what the patient pays; the doctor's own figure is
    kept as ``doctor_fee`` for payout-side readers. ``tax_amount`` is left
    untouched — GST is carved out of the *doctor's* fee, not the platform
    increment, so it must keep tracking the doctor's number.

    A discounted service also carries ``original_price`` + ``discount_pct``
    for the strikethrough on the card, and ``member_discount_pct`` when the
    viewer's membership tier grants something on this particular service.
    ``original_price`` is stringified like the ``doctor_price`` it renders
    beside, so a card showing both doesn't print one as '350.0' and the other
    as '300'.
    """
    if not isinstance(mp_dict, dict):
        return mp_dict
    raw = mp_dict.get('doctor_price')
    if raw in (None, ''):
        return mp_dict
    if rules is None:
        rules = rules_for_doctors([doctor_id], tenant_id=tenant_id)
    rule = rule_for(doctor_id, SERVICE_SCOPE, product_id, rules)

    priced = dict(mp_dict)
    priced['doctor_fee'] = float(raw)
    # Through the funnel, not ``apply_rule`` directly — same reason as
    # ``decorate_tiers``: the quoted number has to carry the site-wide
    # discount the purchase will actually charge.
    priced['doctor_price'] = str(
        display_price_for_service(doctor_id, product_id, raw, rules, tenant_id)
    )
    markdown = markdown_fields(raw, rule, tenant_id=tenant_id)
    if 'original_price' in markdown:
        priced['original_price'] = str(markdown['original_price'])
        priced['discount_pct'] = markdown['discount_pct']
    if 'member_discount_pct' in markdown:
        # Left a number, not stringified like the prices around it — it is a
        # percentage the card formats itself, never something rendered beside
        # ``doctor_price``.
        priced['member_discount_pct'] = markdown['member_discount_pct']
    if 'member_discount_amount' in markdown:
        # The per-plan voucher on this service, in ₹. Also left a number: the
        # card quotes it as a conditional ("pay X if you use it"), not as a
        # price rendered beside ``doctor_price``.
        priced['member_discount_amount'] = markdown['member_discount_amount']
    return priced
