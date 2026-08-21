/**
 * The slot-length ladder — the fixed set of durations a consultation can be
 * priced and booked at.
 *
 * Shared rather than local to the doctor's Pricing tab because three surfaces
 * now speak this vocabulary: the doctor picking prices per length, the patient
 * filtering Find-a-Doctor by length, and the admin's pricing config keyed on
 * the same ``range`` strings. The keys are what ends up in
 * ``Doctor.slot_pricing`` and in ``DisplayPricingRule.scope_key``, so a page
 * inventing its own copy of this list is a page that can silently stop lining
 * up with what the server prices.
 */
export const SLOT_RANGES = [
    { range: '0-10', label: '0 – 10 mins', short: '0–10', duration: 10 },
    { range: '10-20', label: '10 – 20 mins', short: '10–20', duration: 20 },
    { range: '20-30', label: '20 – 30 mins', short: '20–30', duration: 30 },
    { range: '30-40', label: '30 – 40 mins', short: '30–40', duration: 40 },
    { range: '40-50', label: '40 – 50 mins', short: '40–50', duration: 50 },
    { range: '50-60', label: '50 – 60 mins', short: '50–60', duration: 60 },
];

export const SLOT_RANGE_MAP = SLOT_RANGES.reduce(
    (map, r) => ({ ...map, [r.range]: r }), {},
);

/**
 * The ladder key a priced tier sits on.
 *
 * Mirrors ``slot_key`` in ``app/common/display_pricing.py``: tiers written by
 * the current Pricing tab carry ``range`` verbatim, but legacy rows have only
 * ``duration``, and those still have to land on the same rung — otherwise a
 * length filter would quietly exclude every doctor priced the old way.
 */
export const tierRangeKey = (tier) => {
    const raw = String(tier?.range ?? '').trim();
    if (raw) return raw;
    const duration = Number(tier?.duration);
    if (!Number.isFinite(duration) || duration <= 0) return '';
    return `${Math.max(duration - 10, 0)}-${duration}`;
};

/** '10-20' → '10–20 min'; a legacy tier carrying just a duration → '20 min'. */
export const slotRangeLabel = (range) => {
    const raw = String(range ?? '').trim();
    if (!raw) return 'Slot';
    const parts = raw.split('-');
    if (parts.length === 2) return `${parts[0].trim()}–${parts[1].trim()} min`;
    return `${raw} min`;
};
