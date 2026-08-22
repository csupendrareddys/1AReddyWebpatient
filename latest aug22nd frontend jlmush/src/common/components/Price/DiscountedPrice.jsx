/**
 * DiscountedPrice — an offering's list price struck through beside what it
 * actually costs.
 *
 * The SUPER_ADMIN pricing overlay (``/dashboard/admin/pricing-config``) can
 * mark one doctor × offering down: a % off the gross, plus any vouchers and
 * coupons attached to that rule. The patient-facing payloads used to carry
 * only the resulting number, so a card could say ₹300 but never that ₹300 was
 * down from ₹350. The backend now sends ``original_price`` + ``discount_pct``
 * alongside the price whenever — and only when — there is a real markdown
 * (see ``app.common.display_pricing.markdown_fields``), and this renders the
 * pair. Four surfaces show it (marketplace card, marketplace purchase dialog,
 * both doctor cards, the booking summary), which is exactly the situation
 * that otherwise produces four lookalike strikethroughs that drift apart.
 *
 * NOT the membership discount. That one is the *buyer's* tier taking a flat %
 * off everything, it stacks on top of this at purchase time, and it is
 * rendered as the green corner chip + an itemised line — never as a
 * strikethrough. Keeping the two visually distinct is the whole point: a
 * strikethrough here always means "this offering's own list price was
 * reduced", so the two discounts can appear on the same card without the
 * patient having to guess which number is which.
 *
 * ``price``/``original`` accept a number, a numeric string ('300.0' — the
 * marketplace payload stringifies its prices) or an already-composed string
 * such as a range ('₹100 – ₹250'). Numeric values are formatted; anything
 * else renders verbatim.
 */
import { Stack, Typography } from '@mui/material';

/** '₹300' / '₹299.50' — trailing '.00' dropped, because prices are usually round. */
export const formatMoney = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return `₹${Number.isInteger(n) ? n : n.toFixed(2).replace(/\.?0+$/, '')}`;
};

const render = (value) => {
    if (value === null || value === undefined || value === '') return null;
    return Number.isFinite(Number(value)) ? formatMoney(value) : String(value);
};

/**
 * @param price      what the patient pays (required)
 * @param original   the pre-discount list price; omit / null for no strike
 * @param discountPct whole-number markdown, badged when > 0
 * @param variant    typography variant for the live price
 * @param originalVariant  variant for the struck price (defaults to `variant`)
 * @param color      colour of the live price
 * @param showPct    set false where the card has no room for the badge
 */
export default function DiscountedPrice({
    price,
    original = null,
    discountPct = 0,
    variant = 'body2',
    originalVariant,
    color = 'primary',
    fontWeight = 700,
    showPct = true,
    spacing = 0.75,
    sx,
}) {
    const priceText = render(price);
    const originalText = render(original);
    const pct = Number(discountPct);
    // Guard the degenerate case the backend already tries not to send: a
    // strikethrough equal to the price reads as a bug, so drop it.
    const struck = originalText && originalText !== priceText ? originalText : null;

    return (
        <Stack
            direction="row"
            spacing={spacing}
            alignItems="baseline"
            flexWrap="wrap"
            useFlexGap
            sx={sx}
        >
            {struck && (
                <Typography
                    variant={originalVariant || variant}
                    color="text.disabled"
                    sx={{ textDecoration: 'line-through' }}
                >
                    {struck}
                </Typography>
            )}
            <Typography variant={variant} color={color} fontWeight={fontWeight}>
                {priceText}
            </Typography>
            {struck && showPct && Number.isFinite(pct) && pct > 0 && (
                <Typography variant="caption" color="error.main" fontWeight={700}>
                    {pct}% off
                </Typography>
            )}
        </Stack>
    );
}
