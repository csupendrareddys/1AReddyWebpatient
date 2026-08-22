/**
 * Shared pricing helpers for the SaaS plan surfaces — the ``/pricing``
 * section and the ``/join_receiver`` patient plans page.
 *
 * Extracted from ``PricingSection`` when the receiver page needed the same
 * card + billing UI: two copies of this maths would drift the moment a
 * discount percentage changed on one page and not the other.
 *
 * ``plan.pricing`` is built server-side via ``_create_pricing_dict`` — a flat
 * map of ``price_inr_<period>`` / ``og_price_inr_<period>`` across all six
 * BILLING_PERIODS keys. The old top-level price_inr_monthly / annual columns
 * are deprecated and not read here.
 */

// Same billing-period config JoinNetworkPage carries its own copy of —
// keep in sync if either changes.
export const BILLING_PERIODS = [
    { key: 'monthly', label: 'Monthly', months: 1 },
    { key: 'quarterly', label: 'Quarterly', months: 3 },
    { key: 'semi_annual', label: 'Semi-Annual', months: 6 },
    { key: 'annual', label: 'Annual', months: 12 },
    { key: 'biennial', label: 'Biennial', months: 24 },
    { key: 'triennial', label: 'Triennial', months: 36 },
];

export const DEFAULT_BILLING = 'annual';

// Maps dotted-path → friendly label for the "core features" line in the card.
export const CORE_FEATURE_LABELS = {
    'patient.basic_info': 'Patient profiles',
    'doctor.profile': 'Provider profiles',
    'doctor.calendar': 'Calendar & appointments',
    'doctor.pricing': 'Per-provider pricing',
    'admin.manage_users': 'Team user management',
    'communication.email': 'Email notifications',
    'payments.razorpay': 'Razorpay payments',
    'domain.subdomain': 'Branded subdomain',
};

export const enabledCorePaths = (tree, prefix = '') => {
    const out = [];
    if (!tree || typeof tree !== 'object') return out;
    for (const [key, value] of Object.entries(tree)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'boolean') {
            if (value) out.push(path);
        } else if (value && typeof value === 'object' && 'enabled' in value) {
            if (value.enabled) out.push(path);
        } else if (value && typeof value === 'object') {
            out.push(...enabledCorePaths(value, path));
        }
    }
    return out;
};

/**
 * A period's price is one of four things, and the ``pricing`` dict says
 * which by its VALUE — there's no separate flag:
 *
 *   * a positive number  → sell it at that price
 *   * ``0``              → offered, free of charge
 *   * ``-1``             → quote-only; render "Custom / Contact sales"
 *   * absent             → not offered on this period at all
 *
 * The last case used to be indistinguishable from the quote-only one: any
 * missing price rendered as Custom, so "nobody typed an annual number yet" and
 * "this tier is quote-only" produced the same enquiry CTA. Now only ``-1``
 * means Custom, and an unpriced period simply isn't offered.
 *
 * ``-1`` rather than a marker string because the backend's
 * ``_create_pricing_dict`` coerces every value with ``float()`` — a number
 * survives that, a word wouldn't. Any negative reads as Custom, since there's
 * no other sane meaning for one.
 */
export const CUSTOM_PRICE = 'custom';

/**
 * ``CUSTOM_PRICE`` | a number >= 0 | null (not offered).
 *
 * 0 is a real price meaning free, not "never set" — the admin's price fields
 * sit empty (null) until typed in, and the backend only drops null/blank from
 * the pricing dict, so a stored 0 is a deliberate one.
 */
export const priceForPeriod = (plan, periodKey) => {
    const raw = plan?.pricing?.[`price_inr_${periodKey}`];
    if (raw == null || raw === '') return null;
    const amount = Number(raw);
    if (!Number.isFinite(amount)) return null;
    if (amount < 0) return CUSTOM_PRICE;
    return amount;
};

/**
 * The periods worth offering across a set of plans: shown only if some plan
 * either prices it or marks it Custom. An unpriced period isn't rendered, so
 * it can't be selected, so no card has to answer for it.
 */
export const visibleBillingPeriods = (plans = []) =>
    BILLING_PERIODS.filter((period) =>
        plans.some((plan) => priceForPeriod(plan, period.key) != null),
    );

/** What one month of a plan costs on a given period. Null unless it's a real price. */
const perMonthCost = (plan, periodKey) => {
    const price = priceForPeriod(plan, periodKey);
    if (price == null || price === CUSTOM_PRICE) return null;
    const period = BILLING_PERIODS.find((p) => p.key === periodKey);
    return period ? price / period.months : null;
};

/**
 * The "Save N%" figures for the billing toggle, as ``{periodKey: percent}``,
 * measured against each plan's own monthly rate.
 *
 * These used to be six hardcoded percentages sitting in BILLING_PERIODS
 * (8/12/18/25/30) — a blanket marketing claim that no plan's actual prices had
 * to honour, so the chip could promise 18% off annual while the numbers on the
 * card said otherwise. Now the chip can only claim what the prices do.
 *
 * Monthly is the baseline and never appears: it can't save against itself.
 * That's arithmetic, not a leftover hardcode — a monthly plan's discount
 * versus its OWN list price is a different thing, and that's the ``og_``
 * -derived "N% OFF" chip on the card.
 *
 * Takes the best saving across plans where they disagree, which is the
 * "save up to" reading — a single chip over a mixed grid can't be exact for
 * every card.
 */
export const billingSavings = (plans = []) => {
    const out = {};
    for (const period of BILLING_PERIODS) {
        if (period.key === 'monthly') continue;
        let best = 0;
        for (const plan of plans) {
            const baseline = perMonthCost(plan, 'monthly');
            const discounted = perMonthCost(plan, period.key);
            if (!baseline || discounted == null) continue;
            best = Math.max(best, ((baseline - discounted) / baseline) * 100);
        }
        if (Math.round(best) > 0) out[period.key] = Math.round(best);
    }
    return out;
};

/**
 * Price labels for a plan at a period, or null when the plan doesn't offer
 * that period — the caller renders nothing rather than inventing a label.
 * Unreachable while the toggle only offers periods some plan has; it's the
 * backstop for a plan pricing a different set than its neighbours.
 */
export function resolvePrice(plan, periodKey) {
    const period = BILLING_PERIODS.find((p) => p.key === periodKey) || BILLING_PERIODS[0];
    const pricing = plan.pricing || {};

    const price = priceForPeriod(plan, periodKey);
    if (price == null) return null;

    if (price === CUSTOM_PRICE) {
        return {
            current: 'Custom',
            original: null,
            discount: null,
            bottom: 'Contact sales',
            totalForPeriod: null,
            isCustom: true,
        };
    }

    const ogPriceKey = `og_price_inr_${periodKey}`;
    const ogPrice = pricing[ogPriceKey];

    // A priced-at-zero period is given away, not unpriced. The list price it's
    // marked down from still shows if the admin set one ("was ₹999"), but no
    // "% OFF" chip beside the word Free — that pair reads as noise — and no
    // "Billed ₹0 per year" line, hence the null total.
    if (price === 0) {
        const ogPerMonth = ogPrice != null && ogPrice > 0 ? ogPrice / period.months : null;
        return {
            current: 'Free',
            original: ogPerMonth != null ? `₹${Math.round(ogPerMonth).toLocaleString()}` : null,
            discount: null,
            bottom: '',
            totalForPeriod: null,
            isFree: true,
        };
    }

    const perMonth = price / period.months;
    const ogPerMonth = ogPrice != null ? ogPrice / period.months : null;
    const discount =
        ogPerMonth && ogPerMonth > perMonth
            ? Math.round(((ogPerMonth - perMonth) / ogPerMonth) * 100)
            : null;

    return {
        current: `₹${Math.round(perMonth).toLocaleString()}`,
        original: ogPerMonth != null ? `₹${Math.round(ogPerMonth).toLocaleString()}` : null,
        discount,
        bottom: '/month',
        totalForPeriod: price,
    };
}
