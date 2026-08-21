/**
 * How a membership tier's capacity caps read on screen.
 *
 * Two numbers on the plan — ``limits.support_staff`` and ``limits.my_links`` —
 * become one sentence each. Every surface that shows a plan renders them
 * through here: the admin table, the tier picker, the public pricing cards,
 * and the provider's own membership page.
 *
 * **Derived, never authored.** These lines are NOT bullets an operator types.
 * The pinned-number bullets in ``features/admin/Membership/utils/fixedFeatures``
 * bake their number into a stored string at save time, which is fine for a
 * commission that changes with the plan itself — but a cap is the thing being
 * enforced, and a card promising "5 support staff" while the server allows 3
 * is worse than no card at all. Reading the live column means the promise and
 * the refusal can't drift apart.
 *
 * ``null`` (the API's unlimited) and ``0`` are deliberately different
 * sentences: "Unlimited support staff" and "No support staff" are opposite
 * offers, and collapsing either into a bare number would lose that.
 */

// metric key → how it reads. ``zero`` is spelled out rather than composed,
// because "0 support staff" is a price-list line nobody would write.
const LIMIT_COPY = {
    support_staff: {
        label: 'Support staff',
        unlimited: 'Unlimited support staff',
        zero: 'No support staff',
        some: (n) => `Up to ${n} support staff`,
    },
    my_links: {
        label: 'My Link affiliations',
        unlimited: 'Unlimited My Link affiliations',
        zero: 'No My Link affiliations',
        some: (n) => `Up to ${n} My Link affiliation${n === 1 ? '' : 's'}`,
    },
};

export const LIMIT_METRICS = ['support_staff', 'my_links'];

/** True when this cap is "as many as you like" — no plan, or no number set. */
export const isUnlimited = (value) => value === null || value === undefined;

/** One cap as a sentence: "Up to 5 support staff". */
export function limitLine(metric, value) {
    const copy = LIMIT_COPY[metric];
    if (!copy) return '';
    if (isUnlimited(value)) return copy.unlimited;
    if (Number(value) === 0) return copy.zero;
    return copy.some(Number(value));
}

/** Just the number, for a meter: "3 / 5" or "3 / ∞". */
export const limitCount = (used, value) =>
    `${used} / ${isUnlimited(value) ? '∞' : value}`;

/**
 * Both caps as display lines for one plan.
 *
 * A tier that sets neither returns an empty array rather than two "Unlimited"
 * lines: on a plan nobody has capped, they are noise on every card in the
 * catalog, and the absence of a limit is not a feature anyone shopped for.
 * Once an operator caps one, both are shown — at that point "Unlimited My Link
 * affiliations" next to "Up to 3 support staff" is the comparison being sold.
 */
export function planLimitLines(plan) {
    const limits = plan?.limits || {};
    if (LIMIT_METRICS.every((m) => isUnlimited(limits[m]))) return [];
    return LIMIT_METRICS.map((m) => ({ key: m, text: limitLine(m, limits[m]) }));
}

export default planLimitLines;
