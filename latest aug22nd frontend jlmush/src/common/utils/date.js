/**
 * Date helpers shared across the app.
 */

/**
 * Format a ``Date`` (or date-like value) as a ``YYYY-MM-DD`` calendar string
 * using the **local** date parts.
 *
 * Why this exists instead of ``new Date(v).toISOString().split('T')[0]``:
 * a value chosen in a date picker is a ``Date`` at *local* midnight.
 * ``toISOString()`` converts it to UTC, so for any timezone east of UTC
 * (e.g. IST, +05:30) the calendar day rolls **back by one** — a birth date
 * entered as the 15th would persist as the 14th. Formatting the local
 * year/month/day keeps the exact day the user picked, regardless of timezone.
 *
 * @param {Date|string|number|null|undefined} value
 * @returns {string|null} ``YYYY-MM-DD`` or ``null`` for empty/invalid input.
 */
export const toLocalDateString = (value) => {
    if (!value && value !== 0) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/** Today's date as a local ``YYYY-MM-DD`` string. */
export const todayLocalDateString = () => toLocalDateString(new Date());
