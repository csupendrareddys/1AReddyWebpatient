"""The tenant's site-wide discount — one % off every patient-facing price.

**Currently switched off — see :data:`PLATFORM_DISCOUNT_ACTIVE`.** The module,
the column and the admin field are all intact and the number still round-trips
through Billing Configuration; it simply isn't subtracted from anything. Flip
the flag to bring it back.

``BillingConfig.platform_discount_pct`` is a single number a SUPER_ADMIN sets
for their whole marketplace. Unlike the two neighbouring reductions it is
neither per-offering nor per-buyer.

Where it sat in the stack::

    doctor's fee
      + DisplayPricingRule increment            ┐ per doctor × offering
      = the offering's pre-discount price         ← the struck-through "was"
      − DisplayPricingRule overall % / vouchers / coupons
      = the price every card quotes
      − platform_discount_pct                     ← this module (INACTIVE)
      − the buyer's per-offering member %         ← at purchase, per buyer
      = what the patient is charged

The strikethrough used to advertise this number and now advertises the
overall % instead (``display_pricing.markdown_fields``), which is why turning
this off doesn't leave the cards with nothing to slash.

Every failure mode returns 0. A discount lookup must never be able to take
down a booking page, and "no sale on" is both the safe answer and by far the
most common one.
"""
from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP

logger = logging.getLogger(__name__)

#: Whether the site-wide discount is subtracted from patient-facing prices.
#:
#: One switch rather than deleting the call sites: the cards now advertise the
#: per-offering overall % instead, and the site-wide number was retired from
#: pricing rather than from the product. Everything downstream — the config
#: column, the admin field, :func:`platform_discount_pct` — keeps working, so
#: re-enabling is this line and nothing else.
#:
#: While it is ``False``, :func:`apply_platform_discount` is an identity (it
#: still rounds), which is what keeps the two price funnels in
#: :mod:`app.common.display_pricing` calling it unconditionally: the funnels
#: are the only two paths to a patient-facing price, so leaving the calls in
#: place is what guarantees a re-enable lands on the quote and the charge
#: together rather than on whichever one someone remembers to re-wire.
PLATFORM_DISCOUNT_ACTIVE = False


def platform_discount_pct(tenant_id=None) -> Decimal:
    """The tenant's site-wide discount %, clamped to 0-100.

    Memoised on ``flask.g`` for the life of the request, for the same reason
    ``display_pricing.discount_amounts`` is: a doctor-list page prices dozens
    of rows and each one would otherwise re-query the same single config row.
    """
    try:
        from flask import g, has_app_context
        from app.models import BillingConfig
        from app.common.tenant_context import current_tenant_id_or_default

        tid = str(tenant_id or current_tenant_id_or_default() or '')
        cache_key = f'_platform_discount_pct_{tid}'
        if has_app_context() and hasattr(g, cache_key):
            return getattr(g, cache_key)

        pct = Decimal('0')
        query = BillingConfig.query.filter_by(is_active=True)
        if tid:
            query = query.filter(BillingConfig.tenant_id == tid)
        config = query.first()
        if config is not None:
            try:
                pct = Decimal(str(config.platform_discount_pct or 0))
            except (TypeError, ValueError):
                pct = Decimal('0')
        pct = min(max(pct, Decimal('0')), Decimal('100'))

        if has_app_context():
            setattr(g, cache_key, pct)
        return pct
    except Exception:
        logger.exception(
            '[PLATFORM_DISCOUNT] lookup failed; pricing at full rate',
        )
        return Decimal('0')


def apply_platform_discount(amount, pct=None, tenant_id=None):
    """``amount`` less the tenant's site-wide %, to 2dp, floored at 0.

    An identity (bar the rounding) while :data:`PLATFORM_DISCOUNT_ACTIVE` is
    ``False``, which it currently is.

    ``None`` in, ``None`` out — an unpriced offering must stay unpriced rather
    than become a free one. Pass ``pct`` when the caller already resolved it
    (a loop over many rows), otherwise it is looked up (and memoised).
    """
    if amount is None:
        return None
    try:
        base = Decimal(str(amount))
    except (TypeError, ValueError):
        return amount

    if not PLATFORM_DISCOUNT_ACTIVE:
        return float(base.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))

    percent = platform_discount_pct(tenant_id) if pct is None else pct
    try:
        percent = Decimal(str(percent or 0))
    except (TypeError, ValueError):
        percent = Decimal('0')
    if percent <= 0:
        return float(base.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))

    net = max(base - (base * percent / 100), Decimal('0'))
    return float(net.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
