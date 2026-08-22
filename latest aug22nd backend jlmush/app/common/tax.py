"""Indian GST / TDS for the platform's two-supply pricing model.

Why this module exists
======================
The patient pays one number — the **display price** — but under Indian GST
that single collection is *two distinct supplies* with two distinct taxable
values:

1. **The provider's supply.** The doctor renders a professional / healthcare
   service to the patient. Their quoted fee (``Doctor.slot_pricing[].price``
   or ``DoctorMarketplaceProduct.doctor_price``) is their payout, and the
   doctor-facing UI states it is *"inclusive of applicable taxes"* — so any
   GST on this supply is **carved out of** the fee, never added on top. This
   mirrors ``DoctorMarketplaceProduct.tax_amount``.

2. **The platform's supply.** The delta between the display price and the
   doctor's fee (``display_price - doctor_fee``, produced by the increment /
   discount overlay in ``app.common.display_pricing``) is the platform's
   facilitation / intermediary margin. That is a *separate* supply, normally
   taxed at the standard 18% services rate, and it must NOT be blended into
   the doctor's taxable value.

Before this module, ``payout.py`` levied one GST figure on ``payment.amount``
— the doctor's fee **plus** the platform's markup as one blob — which is
wrong on both the taxable value and (where healthcare is exempt) the rate.

Rate structure
==============
``CGST + SGST`` for an intra-state supply (place of supply == supplier's
state), ``IGST`` for inter-state, where ``IGST == CGST + SGST``. Modes follow
the pattern already established on ``DoctorProduct`` /
``DoctorMarketplaceProduct``: ``none | intra_state | inter_state``, plus an
``auto`` mode here that derives intra vs. inter from the two states.

Nothing is hard-coded to 18%: every rate is read from ``BillingConfig``
(tenant-wide flat pair + a per-consultation-type override map) or, for catalog
services, from the product's own ``tax_mode`` / rate columns.

Money
=====
Every figure is a :class:`decimal.Decimal` quantized to 2dp with
``ROUND_HALF_UP``. No float arithmetic anywhere on the money path. The
CGST/SGST split is computed so the two halves always re-add to the total GST
(the residual paise lands on SGST) — a naive independent quantize can drift
by ₹0.01 and break the invoice footing.

Read :func:`compute_tax_breakdown` first; everything else supports it.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field, asdict
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

logger = logging.getLogger(__name__)

ZERO = Decimal('0.00')
CENT = Decimal('0.01')
HUNDRED = Decimal('100')

#: Tax modes, mirroring ``DoctorProduct.tax_mode`` / ``DoctorMarketplaceProduct``.
#: ``auto`` is this module's addition — resolve intra vs. inter from the states.
TAX_MODE_NONE = 'none'
TAX_MODE_INTRA = 'intra_state'
TAX_MODE_INTER = 'inter_state'
TAX_MODE_AUTO = 'auto'
TAX_MODES = (TAX_MODE_NONE, TAX_MODE_INTRA, TAX_MODE_INTER, TAX_MODE_AUTO)

#: ``scope_type`` for catalog services (mirrors ``display_pricing.SERVICE_SCOPE``).
SERVICE_SCOPE = 'service'

#: GSTIN state codes (first two digits of a GSTIN). Used to derive the
#: platform's own state from ``BillingConfig.bill_gst_reg`` without adding a
#: column, and to compare it against a doctor's free-text address state.
STATE_CODES = {
    '01': 'jammu and kashmir', '02': 'himachal pradesh', '03': 'punjab',
    '04': 'chandigarh', '05': 'uttarakhand', '06': 'haryana', '07': 'delhi',
    '08': 'rajasthan', '09': 'uttar pradesh', '10': 'bihar', '11': 'sikkim',
    '12': 'arunachal pradesh', '13': 'nagaland', '14': 'manipur',
    '15': 'mizoram', '16': 'tripura', '17': 'meghalaya', '18': 'assam',
    '19': 'west bengal', '20': 'jharkhand', '21': 'odisha',
    '22': 'chhattisgarh', '23': 'madhya pradesh', '24': 'gujarat',
    '26': 'dadra and nagar haveli and daman and diu', '27': 'maharashtra',
    '29': 'karnataka', '30': 'goa', '31': 'lakshadweep', '32': 'kerala',
    '33': 'tamil nadu', '34': 'puducherry', '35': 'andaman and nicobar islands',
    '36': 'telangana', '37': 'andhra pradesh', '38': 'ladakh',
}
_STATE_NAME_TO_CODE = {name: code for code, name in STATE_CODES.items()}


# ─── money primitives ──────────────────────────────────────────────────────

def money(value) -> Decimal:
    """``value`` as a 2dp ``Decimal``, ROUND_HALF_UP. Non-numeric → 0.00."""
    if isinstance(value, Decimal):
        dec = value
    else:
        try:
            dec = Decimal(str(value if value not in (None, '') else 0))
        except (InvalidOperation, TypeError, ValueError):
            return ZERO
    try:
        return dec.quantize(CENT, rounding=ROUND_HALF_UP)
    except InvalidOperation:  # pragma: no cover — absurd magnitudes only
        return ZERO


def rate(value) -> Decimal:
    """A percentage as an unrounded ``Decimal`` (rates carry 2dp, not money)."""
    if value in (None, ''):
        return Decimal('0')
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal('0')


def carve_out(gross, total_rate):
    """Split a **tax-inclusive** ``gross`` into ``(taxable_value, tax)``.

    ``taxable = gross * 100 / (100 + r)``; the tax is the remainder, so the two
    always re-add to ``gross`` exactly. This is the pattern the doctor's fee
    must use — the doctor's quoted price already includes any GST on their
    supply (see ``PricingSlots.jsx``: *"Your quoted price is inclusive of
    applicable taxes and is your payout amount"*).
    """
    gross = money(gross)
    r = rate(total_rate)
    if r <= 0 or gross <= 0:
        return gross, ZERO
    taxable = money(gross * HUNDRED / (HUNDRED + r))
    return taxable, money(gross - taxable)


def add_on(net, total_rate):
    """Split a **tax-exclusive** ``net`` into ``(taxable_value, tax)``."""
    net = money(net)
    r = rate(total_rate)
    if r <= 0 or net <= 0:
        return net, ZERO
    return net, money(net * r / HUNDRED)


def split_gst(tax_total, tax_mode, cgst_rate, sgst_rate, igst_rate):
    """``(cgst, sgst, igst)`` for a computed ``tax_total`` under ``tax_mode``.

    For an intra-state supply the total is split in the CGST:SGST ratio and the
    residual paise is pushed onto SGST, so ``cgst + sgst == tax_total`` holds
    exactly (independent quantizing of each half can drift by ₹0.01).
    """
    tax_total = money(tax_total)
    if tax_total <= 0:
        return ZERO, ZERO, ZERO
    if tax_mode == TAX_MODE_INTER:
        return ZERO, ZERO, tax_total
    if tax_mode == TAX_MODE_INTRA:
        c, s = rate(cgst_rate), rate(sgst_rate)
        if (c + s) <= 0:
            return ZERO, ZERO, ZERO
        cgst = money(tax_total * c / (c + s))
        return cgst, money(tax_total - cgst), ZERO
    return ZERO, ZERO, ZERO


# ─── place of supply ───────────────────────────────────────────────────────

def normalise_state(value):
    """A free-text state name (or a 2-digit GSTIN code) → canonical lowercase.

    ``None`` when it cannot be recognised, which callers treat as "unknown" —
    an unknown state must never silently flip a supply to inter-state, because
    IGST charged where CGST/SGST was due is not creditable to the recipient.
    """
    if value in (None, ''):
        return None
    text = str(value).strip().lower()
    if not text:
        return None
    if text in STATE_CODES:            # '36'
        return STATE_CODES[text]
    if text in _STATE_NAME_TO_CODE:    # 'telangana'
        return text
    # Tolerate common spellings/abbreviations that aren't worth a full table.
    aliases = {
        'orissa': 'odisha', 'pondicherry': 'puducherry',
        'new delhi': 'delhi', 'nct of delhi': 'delhi',
        'j&k': 'jammu and kashmir', 'ap': 'andhra pradesh',
        'ts': 'telangana', 'tg': 'telangana',
    }
    return aliases.get(text)


def platform_state(config):
    """The platform's registered state, from ``BillingConfig.bill_gst_reg``.

    A GSTIN's first two digits are its state code, so the supplier's state is
    already on the config — no extra column, and it cannot drift from the GSTIN
    printed on the invoice.
    """
    gstin = (getattr(config, 'bill_gst_reg', None) or '').strip()
    if len(gstin) >= 2 and gstin[:2].isdigit():
        return STATE_CODES.get(gstin[:2])
    return None


def doctor_state(doctor):
    """The doctor's state, from their communication address then their User."""
    if doctor is None:
        return None
    for addr_attr in ('communication_address', 'permanent_address'):
        addr = getattr(doctor, addr_attr, None)
        if isinstance(addr, dict):
            found = normalise_state(addr.get('state'))
            if found:
                return found
    user = getattr(doctor, 'user', None)
    return normalise_state(getattr(user, 'state', None)) if user else None


def resolve_mode(configured_mode, supplier_state=None, place_of_supply=None,
                 default=TAX_MODE_INTRA):
    """Turn a configured mode (possibly ``auto``) into a concrete mode.

    ``auto`` compares the supplier's state with the place of supply:
    same → intra-state (CGST+SGST), different → inter-state (IGST). When either
    state is unknown it falls back to ``default`` (intra-state) rather than
    guessing IGST — see :func:`normalise_state`.
    """
    mode = (configured_mode or TAX_MODE_AUTO).strip().lower()
    if mode in (TAX_MODE_NONE, TAX_MODE_INTRA, TAX_MODE_INTER):
        return mode
    if mode != TAX_MODE_AUTO:
        logger.warning('[TAX] unknown tax_mode %r — treating as auto', mode)
    if supplier_state and place_of_supply:
        return TAX_MODE_INTRA if supplier_state == place_of_supply else TAX_MODE_INTER
    return default


# ─── rate resolution ───────────────────────────────────────────────────────

def _cfg(config, name, fallback=None):
    value = getattr(config, name, None)
    return fallback if value is None else value


@dataclass
class RateSet:
    """One supply's resolved tax treatment."""
    mode: str = TAX_MODE_NONE
    cgst_rate: Decimal = Decimal('0')
    sgst_rate: Decimal = Decimal('0')
    igst_rate: Decimal = Decimal('0')
    #: Where the rates came from — 'product' | 'consultation_type' | 'config'.
    source: str = 'config'

    @property
    def total_rate(self) -> Decimal:
        """The effective combined rate for this mode (0 when exempt)."""
        if self.mode == TAX_MODE_INTRA:
            return self.cgst_rate + self.sgst_rate
        if self.mode == TAX_MODE_INTER:
            return self.igst_rate
        return Decimal('0')


def resolve_doctor_rates(config, consultation_type=None, product=None,
                         supplier_state=None, place_of_supply=None):
    """Rates for the **doctor's** supply (the healthcare / professional service).

    Precedence:

    1. ``product`` (a ``DoctorProduct`` / ``DoctorMarketplaceProduct``) — the
       catalog item carries its own admin-set ``tax_mode`` + rates and already
       governs the service-order payout, so it wins for services.
    2. ``BillingConfig.gst_by_consultation_type[consultation_type]`` — the
       per-type override map. Keys ``cgst`` / ``sgst`` (required, as today) plus
       optional ``igst`` (defaults to cgst+sgst) and ``mode``.
    3. The flat ``BillingConfig.cgst_rate`` / ``sgst_rate`` / ``igst_rate``
       pair with ``BillingConfig.doctor_tax_mode``.
    """
    if product is not None and getattr(product, 'tax_mode', None):
        p_mode = resolve_mode(product.tax_mode, supplier_state, place_of_supply)
        c, s = rate(getattr(product, 'cgst_rate', 0)), rate(getattr(product, 'sgst_rate', 0))
        i = rate(getattr(product, 'igst_rate', None)) or (c + s)
        return RateSet(mode=p_mode, cgst_rate=c, sgst_rate=s, igst_rate=i,
                       source='product')

    configured = _cfg(config, 'doctor_tax_mode', TAX_MODE_AUTO)

    by_type = getattr(config, 'gst_by_consultation_type', None) or {}
    entry = by_type.get(consultation_type) if consultation_type else None
    if isinstance(entry, dict) and entry.get('cgst') is not None and entry.get('sgst') is not None:
        c, s = rate(entry.get('cgst')), rate(entry.get('sgst'))
        i = rate(entry.get('igst')) or (c + s)
        return RateSet(
            mode=resolve_mode(entry.get('mode') or configured, supplier_state, place_of_supply),
            cgst_rate=c, sgst_rate=s, igst_rate=i, source='consultation_type',
        )

    c, s = rate(_cfg(config, 'cgst_rate', 0)), rate(_cfg(config, 'sgst_rate', 0))
    i = rate(_cfg(config, 'igst_rate', None)) or (c + s)
    return RateSet(
        mode=resolve_mode(configured, supplier_state, place_of_supply),
        cgst_rate=c, sgst_rate=s, igst_rate=i, source='config',
    )


def resolve_platform_rates(config, supplier_state=None, place_of_supply=None):
    """Rates for the **platform's** supply (facilitation / commission).

    Its own columns on ``BillingConfig`` — an intermediary service is a
    standard-rated supply (18% today) and is deliberately independent of
    whatever the healthcare supply attracts, which may be exempt.
    """
    c = rate(_cfg(config, 'platform_fee_cgst_rate', 0))
    s = rate(_cfg(config, 'platform_fee_sgst_rate', 0))
    i = rate(_cfg(config, 'platform_fee_igst_rate', None)) or (c + s)
    return RateSet(
        mode=resolve_mode(_cfg(config, 'platform_tax_mode', TAX_MODE_AUTO),
                          supplier_state, place_of_supply),
        cgst_rate=c, sgst_rate=s, igst_rate=i, source='config',
    )


def resolve_tds_rate(doctor, config):
    """TDS % for one doctor — per-doctor override, else the tenant flat rate.

    Duplicated deliberately from ``billing_service.resolve_tds_rate`` so this
    module stays importable with no API-layer dependency; it defers to that
    function when the doctor is a real ORM row.
    """
    if doctor is not None:
        try:
            from app.api.common.payment.billing_service import (
                resolve_tds_rate as _resolve,
            )
            return rate(_resolve(doctor, config))
        except Exception:  # pragma: no cover — no app context / no profile table
            logger.debug('[TAX] per-doctor TDS lookup unavailable; using flat rate')
    return rate(_cfg(config, 'tds_rate', 0))


# ─── the breakdown ─────────────────────────────────────────────────────────

@dataclass
class TaxBreakdown:
    """Itemised, fully reconciled tax split for one priced offering.

    Every field is a 2dp ``Decimal``. The invariant that must always hold::

        total_to_patient == doctor_taxable_value + doctor_gst_total
                          + platform_taxable_value + platform_gst_total

    (checked by :attr:`reconciles`).
    """

    # ── what went in ──
    doctor_fee: Decimal = ZERO
    display_price: Decimal = ZERO

    # ── supply 1: the doctor's professional / healthcare service ──
    doctor_tax_mode: str = TAX_MODE_NONE
    doctor_tax_inclusive: bool = True
    doctor_taxable_value: Decimal = ZERO
    doctor_cgst_rate: Decimal = Decimal('0')
    doctor_sgst_rate: Decimal = Decimal('0')
    doctor_igst_rate: Decimal = Decimal('0')
    doctor_cgst: Decimal = ZERO
    doctor_sgst: Decimal = ZERO
    doctor_igst: Decimal = ZERO
    doctor_gst_total: Decimal = ZERO
    doctor_rate_source: str = 'config'

    # ── supply 2: the platform's facilitation margin (display − doctor fee) ──
    platform_fee: Decimal = ZERO
    platform_tax_mode: str = TAX_MODE_NONE
    platform_tax_inclusive: bool = True
    platform_taxable_value: Decimal = ZERO
    platform_cgst_rate: Decimal = Decimal('0')
    platform_sgst_rate: Decimal = Decimal('0')
    platform_igst_rate: Decimal = Decimal('0')
    platform_cgst: Decimal = ZERO
    platform_sgst: Decimal = ZERO
    platform_igst: Decimal = ZERO
    platform_gst_total: Decimal = ZERO
    #: When the overall discount pushes the display price *below* the doctor's
    #: fee, the platform is funding the gap out of its own pocket. There is no
    #: negative supply under GST, so it is reported here rather than folded
    #: into a negative platform fee.
    platform_subsidy: Decimal = ZERO

    # ── supply 2b: plan commission billed to the doctor (payout-side only) ──
    platform_charges: Decimal = ZERO
    platform_charges_gst: Decimal = ZERO
    platform_charges_total: Decimal = ZERO

    # ── TDS (s.194J, deducted from the doctor's professional fee) ──
    tds_rate: Decimal = Decimal('0')
    tds_base: Decimal = ZERO
    tds_amount: Decimal = ZERO
    #: True when ``net_to_doctor`` has the doctor's own GST withheld from it.
    platform_remits_doctor_gst: bool = False

    # ── totals ──
    total_to_patient: Decimal = ZERO
    net_to_doctor: Decimal = ZERO
    platform_net_revenue: Decimal = ZERO
    gst_total: Decimal = ZERO

    #: Human-readable notes about judgement calls applied to this computation.
    notes: list = field(default_factory=list)

    @property
    def reconciles(self) -> bool:
        """True when the patient's total equals the sum of both supplies.

        ``platform_subsidy`` is netted off — a discount that takes the display
        price below the doctor's fee is the platform paying part of the
        doctor's fee itself, so the patient's total is short by exactly that.
        """
        return money(
            self.doctor_taxable_value + self.doctor_gst_total
            + self.platform_taxable_value + self.platform_gst_total
            - self.platform_subsidy
        ) == self.total_to_patient

    def as_dict(self, stringify=True):
        """JSON-safe dict. ``stringify`` keeps exact 2dp text (recommended);
        ``False`` yields floats for callers that want to do arithmetic."""
        out = asdict(self)
        for key, value in out.items():
            if isinstance(value, Decimal):
                out[key] = str(value) if stringify else float(value)
        out['reconciles'] = self.reconciles
        return out


def compute_tax_breakdown(
    doctor_fee,
    display_price=None,
    *,
    config=None,
    doctor=None,
    consultation_type=None,
    product=None,
    platform_charges=None,
    platform_remits_doctor_gst=False,
    supplier_state=None,
    place_of_supply=None,
    tenant_id=None,
):
    """The single source of truth for how one priced offering is taxed.

    Parameters
    ----------
    doctor_fee:
        The provider's own quoted price — their payout. **Tax-inclusive**: the
        doctor-facing UI promises this is what they receive, so GST on their
        supply is carved out of it rather than added to it.
    display_price:
        What the patient is quoted / charged (``apply_rule`` output). Defaults
        to ``doctor_fee`` (no overlay ⇒ no platform margin).
    config:
        A ``BillingConfig``. When ``None`` it is loaded for ``tenant_id`` /
        the doctor's tenant, falling back to a transient default row.
    doctor:
        A ``Doctor``. Drives the per-doctor TDS override and the place of
        supply for the platform's supply to them.
    consultation_type:
        ``'video' | 'complete' | …`` — selects the per-type GST override. The
        literal ``'service'`` (``SERVICE_SCOPE``) means a catalog service, for
        which ``product`` should be passed.
    product:
        A ``DoctorProduct`` / ``DoctorMarketplaceProduct``. Its own
        ``tax_mode`` + rate columns win over the config for the doctor's supply.
    platform_charges:
        Plan commission (c1+c2+c3) billed to the doctor on a payout. Taxed as a
        second platform supply and deducted from the doctor's net. Omit on the
        pricing-preview path — there is no payout yet.
    platform_remits_doctor_gst:
        Who pays the GST on the doctor's supply over to the government.

        ``False`` (default, and the legally standard position): the doctor is
        the supplier, so they keep their full tax-inclusive fee and discharge
        their own output tax. ``net_to_doctor`` does **not** subtract
        ``doctor_gst_total``.

        ``True``: the platform withholds the doctor's GST from the payout and
        remits it — only defensible under a reverse-charge or s.9(5) CGST
        e-commerce-operator arrangement. The service-order and plan-installment
        payout paths behaved this way before this module existed and pass
        ``True`` to keep their numbers unchanged; the appointment paths did
        not, and use the default. **This inconsistency is pre-existing and
        wants a product decision** — it is surfaced rather than silently
        harmonised.
    supplier_state / place_of_supply:
        Override the derived states (see :func:`resolve_mode`).

    Returns
    -------
    :class:`TaxBreakdown` — all Decimals, quantized to 2dp.
    """
    config = config if config is not None else _load_config(doctor, tenant_id)

    fee = money(doctor_fee)
    display = money(display_price) if display_price not in (None, '') else fee
    notes = []

    # ── place of supply ────────────────────────────────────────────────
    plat_state = normalise_state(supplier_state) or platform_state(config)
    doc_state = normalise_state(place_of_supply) or doctor_state(doctor)
    if not plat_state or not doc_state:
        notes.append(
            'Place of supply could not be determined on both sides — defaulted '
            'to intra-state (CGST+SGST). IGST wrongly charged on an intra-state '
            'supply is not creditable, so the safe default is intra.'
        )

    # ── supply 1: the doctor's fee, GST carved OUT of it ───────────────
    if consultation_type == SERVICE_SCOPE and product is None:
        notes.append('Catalog service priced without its product row — '
                     'fell back to the tenant GST config.')
    d_rates = resolve_doctor_rates(
        config, consultation_type=consultation_type, product=product,
        supplier_state=doc_state, place_of_supply=doc_state,
    )
    d_taxable, d_gst = carve_out(fee, d_rates.total_rate)
    d_cgst, d_sgst, d_igst = split_gst(
        d_gst, d_rates.mode, d_rates.cgst_rate, d_rates.sgst_rate, d_rates.igst_rate)
    if d_rates.mode == TAX_MODE_NONE:
        notes.append(
            'Doctor supply treated as EXEMPT (Notification 12/2017-CT(R) '
            'Entry 74 — healthcare services by a clinical establishment / '
            'authorised medical practitioner). No GST carved out of the fee.'
        )

    # ── supply 2: the platform's margin ────────────────────────────────
    margin = money(max(display - fee, ZERO))
    subsidy = money(max(fee - display, ZERO))
    if subsidy > 0:
        notes.append(
            f'Display price is ₹{subsidy} below the doctor fee — the platform '
            'is funding the gap. Platform margin floored at 0 (there is no '
            'negative supply under GST) and the shortfall is reported as '
            'platform_subsidy.'
        )
    p_rates = resolve_platform_rates(
        config, supplier_state=plat_state, place_of_supply=doc_state)
    p_inclusive = bool(_cfg(config, 'platform_fee_tax_inclusive', True))
    p_taxable, p_gst = (
        carve_out(margin, p_rates.total_rate) if p_inclusive
        else add_on(margin, p_rates.total_rate)
    )
    p_cgst, p_sgst, p_igst = split_gst(
        p_gst, p_rates.mode, p_rates.cgst_rate, p_rates.sgst_rate, p_rates.igst_rate)

    # ── supply 2b: plan commission billed to the doctor ────────────────
    # Commission is invoiced to the doctor tax-exclusive (the standard practice
    # for an intermediary raising a bill), so GST is ADDED to the deduction.
    charges = money(platform_charges) if platform_charges not in (None, '') else ZERO
    _, charges_gst = add_on(charges, p_rates.total_rate)

    # ── TDS (s.194J) ───────────────────────────────────────────────────
    # Base is the doctor's professional fee. Per CBDT Circular 23/2017 the GST
    # component is excluded when it is identifiable, which it is here — so the
    # base is the carved-out taxable value, NOT the display price and NOT the
    # fee net of platform charges (the old, wrong behaviour).
    tds_rate_pct = resolve_tds_rate(doctor, config)
    exclude_gst = bool(_cfg(config, 'tds_exclude_gst', True))
    tds_base = d_taxable if exclude_gst else fee
    tds = money(tds_base * tds_rate_pct / HUNDRED)

    # ── totals ─────────────────────────────────────────────────────────
    total_to_patient = money(display + (ZERO if p_inclusive else p_gst))
    net_to_doctor = money(fee - tds - charges - charges_gst
                          - (d_gst if platform_remits_doctor_gst else ZERO))
    platform_net_revenue = money(p_taxable + charges)
    if platform_remits_doctor_gst and d_gst > 0:
        notes.append(
            "Doctor's GST withheld from the payout (platform remits it). Only "
            'correct under reverse charge / s.9(5) CGST; otherwise the doctor '
            'is the supplier and should keep and remit it themselves.'
        )

    breakdown = TaxBreakdown(
        doctor_fee=fee,
        display_price=display,
        doctor_tax_mode=d_rates.mode,
        doctor_tax_inclusive=True,
        doctor_taxable_value=d_taxable,
        doctor_cgst_rate=d_rates.cgst_rate,
        doctor_sgst_rate=d_rates.sgst_rate,
        doctor_igst_rate=d_rates.igst_rate,
        doctor_cgst=d_cgst, doctor_sgst=d_sgst, doctor_igst=d_igst,
        doctor_gst_total=d_gst,
        doctor_rate_source=d_rates.source,
        platform_fee=margin,
        platform_tax_mode=p_rates.mode,
        platform_tax_inclusive=p_inclusive,
        platform_taxable_value=p_taxable,
        platform_cgst_rate=p_rates.cgst_rate,
        platform_sgst_rate=p_rates.sgst_rate,
        platform_igst_rate=p_rates.igst_rate,
        platform_cgst=p_cgst, platform_sgst=p_sgst, platform_igst=p_igst,
        platform_gst_total=p_gst,
        platform_subsidy=subsidy,
        platform_charges=charges,
        platform_charges_gst=charges_gst,
        platform_charges_total=money(charges + charges_gst),
        tds_rate=tds_rate_pct,
        tds_base=tds_base,
        tds_amount=tds,
        platform_remits_doctor_gst=bool(platform_remits_doctor_gst),
        total_to_patient=total_to_patient,
        net_to_doctor=net_to_doctor,
        platform_net_revenue=platform_net_revenue,
        gst_total=money(d_gst + p_gst),
        notes=notes,
    )
    if not breakdown.reconciles:  # pragma: no cover — guards a math regression
        logger.error(
            '[TAX] breakdown does not reconcile: fee=%s display=%s -> %s',
            fee, display, breakdown.as_dict(),
        )
    return breakdown


def _load_config(doctor=None, tenant_id=None):
    """The active ``BillingConfig`` for a tenant, or a transient default row.

    Never raises: a missing table / no app context must not take down a pricing
    preview, it just yields the column defaults.
    """
    try:
        from app.models import BillingConfig
        tid = tenant_id or getattr(doctor, 'tenant_id', None)
        if tid is None:
            from app.common.tenant_context import current_tenant_id_or_default
            tid = current_tenant_id_or_default()
        cfg = None
        if tid is not None:
            cfg = BillingConfig.query.filter_by(
                tenant_id=tid, is_active=True).first()
        return cfg if cfg is not None else BillingConfig()
    except Exception:
        logger.exception('[TAX] BillingConfig lookup failed; using defaults')

        class _Defaults:  # noqa: D401 — minimal duck-type of BillingConfig
            pass
        return _Defaults()


# ─── payout convenience ────────────────────────────────────────────────────

def payout_tax_figures(doctor, *, doctor_fee, display_price=None, config=None,
                       consultation_type=None, product=None,
                       platform_charges=None, platform_remits_doctor_gst=False):
    """``(gst_total, tds_amount, net_to_doctor, breakdown)`` for a payout row.

    A thin adapter so ``payout.py`` / ``_generate_order_payout`` can adopt the
    corrected math without restructuring: ``DoctorPayout.taxes_gst`` takes the
    doctor-supply GST (the tax on what the doctor actually supplied — the
    platform's own GST is the platform's output tax, not a payout line), and
    ``tds_amount`` / ``payout_amount`` take the corrected TDS and net.
    """
    breakdown = compute_tax_breakdown(
        doctor_fee, display_price, config=config, doctor=doctor,
        consultation_type=consultation_type, product=product,
        platform_charges=platform_charges,
        platform_remits_doctor_gst=platform_remits_doctor_gst,
    )
    return (breakdown.doctor_gst_total, breakdown.tds_amount,
            breakdown.net_to_doctor, breakdown)
