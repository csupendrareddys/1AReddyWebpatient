// Return the maximum consultation duration configured by the doctor.
// The calendar enforces slot_size + gap ≤ this value.
// We use the configured pricing slots to restrict calendar generation
// even if they are 'pending' admin approval.

/**
 * @param {Array} slotPricing  — [{range, duration, price, consultation_type}, ...]
 * @param {string|null} consultationType — if provided, only consider pricing for this type
 * @returns {number} max duration in minutes (0 if none configured)
 */
const getMaxDuration = (slotPricing = [], consultationType = null) => {
    if (!slotPricing || !slotPricing.length) return 0;

    let filtered = slotPricing;
    if (consultationType) {
        filtered = slotPricing.filter(
            (s) => (s.consultation_type || 'complete') === consultationType,
        );
    }

    if (!filtered.length) return 0;

    const max = Math.max(
        ...filtered.map((s) => {
            const dur = Number(s.duration);
            return isNaN(dur) ? 0 : dur;
        }),
    );
    return max > 0 ? max : 0;
};

/**
 * Get the valid slot sizes for a specific consultation type from pricing config.
 * Only returns durations that have a price set.
 */
export const getConfiguredDurations = (slotPricing = [], consultationType = null) => {
    if (!slotPricing || !slotPricing.length) return [];

    let filtered = slotPricing;
    if (consultationType) {
        filtered = slotPricing.filter(
            (s) => (s.consultation_type || 'complete') === consultationType,
        );
    }

    return filtered
        .filter((s) => s.price && Number(s.price) > 0)
        .map((s) => Number(s.duration))
        .filter((d) => d > 0)
        .sort((a, b) => a - b);
};

/**
 * Expand pricing ranges into all valid slot sizes (multiples of 5).
 * E.g. range "10-20" → [10, 15, 20].
 * Only considers entries with a price set.
 */
export const getSlotSizesFromPricing = (slotPricing = [], consultationType = null) => {
    if (!slotPricing || !slotPricing.length) return [];

    let filtered = slotPricing;
    if (consultationType) {
        filtered = slotPricing.filter(
            (s) => (s.consultation_type || 'complete') === consultationType,
        );
    }

    const sizes = new Set();
    filtered
        .filter((s) => s.price && Number(s.price) > 0 && s.range)
        .forEach((s) => {
            const parts = s.range.split('-');
            if (parts.length === 2) {
                const min = parseInt(parts[0], 10);
                const max = parseInt(parts[1], 10);
                if (!isNaN(min) && !isNaN(max)) {
                    // Generate all multiples of 5 within [min, max], minimum 5
                    for (let v = Math.max(min, 5); v <= max; v += 5) {
                        sizes.add(v);
                    }
                }
            }
        });

    return [...sizes].sort((a, b) => a - b);
};

/**
 * Check if a specific consultation type has pricing configured (at least one duration with a price).
 */
export const hasTypePricing = (slotPricing = [], consultationType) => {
    return slotPricing.some(
        (s) =>
            (s.consultation_type || 'complete') === consultationType &&
            s.price &&
            Number(s.price) > 0,
    );
};

export default getMaxDuration;
