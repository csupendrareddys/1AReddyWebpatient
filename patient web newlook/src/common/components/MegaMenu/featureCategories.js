/**
 * Grouping helper for the top-nav dropdown's middle level.
 *
 * The public nav is three levels — module → category → feature. Only the outer
 * two are things in the database: a category is a label an admin writes on a
 * feature (``LandingFeature.category``), and features naming the same one are
 * the same group. That keeps a category free of a page, a slug and a settings
 * screen it would never use, at the cost of deriving the group list here.
 *
 * Order is the order the features arrive in, which is ``display_order`` — so a
 * category appears where its first feature does, and the one control an admin
 * already uses to order features also orders the groups. Nothing else to set.
 */

/** Bucket for features with no category, when siblings do have one. */
export const UNCATEGORISED = 'Other';

/**
 * Group nav items into ``[{ name, items }]`` in nav order.
 *
 * Returns ``null`` when NO item carries a category — the caller renders its
 * flat two-level layout instead. That's the honest answer rather than one
 * group holding everything: a middle level with a single entry is a level the
 * visitor has to click through for nothing, and it's the state every module
 * is in until an admin starts categorising.
 *
 * @param {Array} items [{ name, slug, category?, description? }]
 */
export function groupByCategory(items = []) {
    if (!items.some((i) => (i?.category || '').trim())) return null;

    const groups = [];
    const byName = new Map();
    // Uncategorised leftovers are collected separately and appended, so a
    // stray uncategorised feature early in the order can't push "Other" to
    // the front of a nav that's otherwise deliberately arranged.
    const leftovers = [];

    items.forEach((item) => {
        const name = (item?.category || '').trim();
        if (!name) {
            leftovers.push(item);
            return;
        }
        if (!byName.has(name)) {
            const group = { name, items: [] };
            byName.set(name, group);
            groups.push(group);
        }
        byName.get(name).items.push(item);
    });

    if (leftovers.length) groups.push({ name: UNCATEGORISED, items: leftovers });
    return groups;
}

export default groupByCategory;
