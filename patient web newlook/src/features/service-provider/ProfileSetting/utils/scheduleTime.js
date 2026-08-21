/**
 * Shared helpers for the weekly working-hours schedule.
 *
 * A "slot" is { start: 'HH:MM', end: 'HH:MM' } (24h strings).
 * A "day map" is { Monday: [slot, ...], Tuesday: [...], ... } — days with no
 * key (or an empty array) are treated as unavailable.
 */

export const DAYS = [
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

/** Short weekday label for compact grids. */
export const DAY_SHORT = {
    Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
    Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};

/** 'HH:MM' → minutes since midnight. */
export const toMins = (t) => {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

/** '09:00' → '9:00 AM' */
export const formatTime12h = (t) => {
    if (!t) return '';
    const [hRaw, m] = t.split(':').map(Number);
    const period = hRaw >= 12 ? 'PM' : 'AM';
    const h = hRaw % 12 === 0 ? 12 : hRaw % 12;
    return `${h}:${String(m).padStart(2, '0')} ${period}`;
};

/** Total hours covered by a list of slots (ignores overlaps for a quick tally). */
export const slotsTotalHours = (slots = []) => {
    const mins = slots.reduce((sum, s) => {
        const d = toMins(s.end) - toMins(s.start);
        return sum + (d > 0 ? d : 0);
    }, 0);
    return mins / 60;
};

/** '8h' / '8.5h' / '45m' compact hours label. */
export const formatHours = (hours) => {
    if (!hours) return '0h';
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    const rounded = Math.round(hours * 10) / 10;
    return `${rounded}h`;
};

/**
 * Returns a Set of slot indices that have errors (end <= start, or overlap
 * with another valid slot). Mirrors the validation used by the legacy list
 * editor so behaviour stays consistent.
 */
export const getSlotErrors = (slots = []) => {
    const errors = new Set();
    slots.forEach((slot, i) => {
        const aStart = toMins(slot.start);
        const aEnd = toMins(slot.end);
        if (aEnd <= aStart) {
            errors.add(i);
            return;
        }
        slots.forEach((other, j) => {
            if (i === j) return;
            const bStart = toMins(other.start);
            const bEnd = toMins(other.end);
            if (bEnd <= bStart) return;
            if (aStart < bEnd && bStart < aEnd) {
                errors.add(i);
                errors.add(j);
            }
        });
    });
    return errors;
};

/**
 * Compute the shared time window (in minutes) spanning every slot across an
 * entire per-type day map, so all cells in the grid draw on the same scale.
 * Falls back to a sensible 08:00–18:00 clinic window when empty.
 */
export const computeSharedWindow = (perTypeHours = {}) => {
    let min = Infinity;
    let max = -Infinity;
    Object.values(perTypeHours).forEach((dayMap = {}) => {
        Object.values(dayMap).forEach((slots) => {
            if (!Array.isArray(slots)) return;
            slots.forEach((s) => {
                const st = toMins(s.start);
                const en = toMins(s.end);
                if (en <= st) return;
                if (st < min) min = st;
                if (en > max) max = en;
            });
        });
    });
    if (min === Infinity || max === -Infinity) {
        return { start: 8 * 60, end: 18 * 60 };
    }
    // Pad to whole hours and guarantee a minimum readable span.
    let start = Math.floor(min / 60) * 60;
    let end = Math.ceil(max / 60) * 60;
    if (end - start < 6 * 60) end = start + 6 * 60;
    return { start, end };
};

/** Are two day maps' slot lists for a given day identical? */
export const sameDaySlots = (a = [], b = []) => {
    if (a.length !== b.length) return false;
    return a.every((s, i) => s.start === b[i].start && s.end === b[i].end);
};
