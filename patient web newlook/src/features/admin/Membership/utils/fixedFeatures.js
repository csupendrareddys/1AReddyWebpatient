/**
 * Special "fixed-number" feature bullets for a marketplace MembershipPlan.
 *
 * The three platform charges live in their own plan columns
 * (``charge1_*`` / ``charge2_*`` / ``charge3_*``), not baked into the
 * free-form copy the operator types. But the operator still wants them to sit
 * *in* the feature list — reorderable, with a custom trailing message — just
 * with the number itself pinned.
 *
 * The trick: they're stored as ordinary strings in ``features.bullets`` (so
 * the backend still sees a plain string array and the public card renders
 * them in place), but the leading "word" is a token — ``{charge1}`` /
 * ``{charge2}`` / ``{charge3}`` — that resolves to the current charge number
 * at render / edit time. Everything after the token is the operator's
 * editable message.
 *
 *   stored:   "{charge1} platform fee on every booking"
 *   rendered: "15% platform fee on every booking"   (charge1 = 15%, percentage)
 *   rendered: "₹25 platform fee on every booking"   (charge1 = 25, fixed)
 *
 * A charge value of 0 or null / undefined means "not charged", so that bullet
 * is dropped entirely rather than shown as "0% …".
 */

// One token per charge slot. The trailing number identifies which
// ``chargeN_*`` column the bullet pins its number to.
export const CHARGE1_TOKEN = '{charge1}';
export const CHARGE2_TOKEN = '{charge2}';
export const CHARGE3_TOKEN = '{charge3}';

export const SPECIAL_TOKENS = [CHARGE1_TOKEN, CHARGE2_TOKEN, CHARGE3_TOKEN];

// token → the charge slot number (1/2/3) it pins to.
const CHARGE_NUM = {
    [CHARGE1_TOKEN]: 1,
    [CHARGE2_TOKEN]: 2,
    [CHARGE3_TOKEN]: 3,
};

// Fallback seed copy per slot, used only when the charge has no name yet.
// The operator edits the message afterwards; only the leading number is fixed.
const FALLBACK_MESSAGE = {
    [CHARGE1_TOKEN]: 'platform charge on every booking',
    [CHARGE2_TOKEN]: 'platform charge on every booking',
    [CHARGE3_TOKEN]: 'platform charge on every booking',
};

/** The charge slot number (1/2/3) a token pins to, or null. */
export const chargeNumOf = (token) => CHARGE_NUM[token] ?? null;

/** The token a bullet leads with, or null for a plain authored bullet. */
export function tokenOf(bullet) {
    if (typeof bullet !== 'string') return null;
    return SPECIAL_TOKENS.find((t) => bullet.startsWith(t)) || null;
}

export const isSpecialBullet = (bullet) => tokenOf(bullet) !== null;

/** The editable message part of a special bullet (text after the token). */
export function messageOf(bullet) {
    const token = tokenOf(bullet);
    if (!token) return '';
    return bullet.slice(token.length).replace(/^\s+/, '');
}

/**
 * Rebuild a special bullet string from its token + edited message.
 *
 * The message is embedded verbatim (not trimmed) so spaces survive while
 * the operator is mid-word — the save-time normaliser trims the whole
 * bullet. A blank / whitespace-only message collapses to the bare token so
 * the line still resolves to just the number.
 */
export function composeSpecialBullet(token, message) {
    const msg = message || '';
    return msg.trim() ? `${token} ${msg}` : token;
}

/** The default seed message for a token — the charge's name if it has one. */
function defaultMessage(token, plan) {
    const n = chargeNumOf(token);
    const name = n ? (plan?.[`charge${n}_name`] || '').trim() : '';
    return name || FALLBACK_MESSAGE[token] || '';
}

/** A freshly seeded special bullet (token + default copy). */
export const defaultSpecialBullet = (token, plan) =>
    composeSpecialBullet(token, defaultMessage(token, plan));

/**
 * The resolved leading label for a token given the plan's charge — e.g.
 * "15%" (percentage) or "₹25" (fixed). Empty string when the charge value is
 * 0 / null (⇒ drop the bullet).
 */
export function tokenPrefix(token, plan) {
    const n = chargeNumOf(token);
    if (!n) return '';
    const value = Number(plan?.[`charge${n}_value`]);
    if (!value) return '';
    const type = plan?.[`charge${n}_type`];
    return type === 'fixed' ? `₹${value}` : `${value}%`;
}

/** True when this special token is currently charged (⇒ its bullet applies). */
export const tokenActive = (token, plan) => tokenPrefix(token, plan) !== '';

/**
 * Resolve one stored bullet to its display string given the plan. Returns
 * null for a special bullet whose charge is 0 / null (so it's dropped).
 */
export function resolveBullet(bullet, plan) {
    const token = tokenOf(bullet);
    if (!token) return typeof bullet === 'string' ? bullet : '';
    const prefix = tokenPrefix(token, plan);
    if (!prefix) return null;
    return `${prefix}${bullet.slice(token.length)}`;
}

/** Full resolved, in-order bullet list for public render (drops empties). */
export function resolveBullets(plan) {
    const list = Array.isArray(plan?.features?.bullets) ? plan.features.bullets : [];
    return list
        .map((b) => resolveBullet(b, plan))
        .filter((s) => s && s.trim());
}

/**
 * Save-time normaliser: resolve every token to its live number and store the
 * result as a plain, trimmed string. The backend (and every plan card) only
 * ever sees finished strings like "15% platform fee on every booking" — no
 * ``{token}`` ever leaves the editor. Specials whose charge is 0 / blank drop
 * out.
 */
export function bakeBullets(plan, bullets) {
    return (Array.isArray(bullets) ? bullets : [])
        .map((b) => resolveBullet(b, plan))
        .filter((s) => s && s.trim())
        .map((s) => s.trim());
}

/**
 * Edit-time inverse of ``bakeBullets``: the backend hands back baked strings,
 * so before the editor sees them we re-attach the token to the special rows
 * it should treat as fixed-number lines. Matching is by the current resolved
 * prefix (e.g. "15%"), which is deterministic given the plan's charge; the
 * operator's message and the row's position are preserved. A row already
 * claimed by an earlier token is skipped so two charges sharing a prefix
 * (e.g. both 10%) can't both latch onto the same baked line. Plain bullets
 * are left untouched.
 */
export function tokeniseBullets(plan, bullets) {
    const list = (Array.isArray(bullets) ? bullets : []).map((b) => String(b));
    SPECIAL_TOKENS.forEach((token) => {
        // Already tokenised (mid-session data) — nothing to do.
        if (list.some((b) => tokenOf(b) === token)) return;
        const prefix = tokenPrefix(token, plan);
        if (!prefix) return;
        const idx = list.findIndex(
            (b) => tokenOf(b) === null && (b === prefix || b.startsWith(`${prefix} `)),
        );
        if (idx === -1) return;
        const rest = list[idx] === prefix ? '' : list[idx].slice(prefix.length + 1);
        list[idx] = composeSpecialBullet(token, rest);
    });
    return list;
}

export default resolveBullets;
