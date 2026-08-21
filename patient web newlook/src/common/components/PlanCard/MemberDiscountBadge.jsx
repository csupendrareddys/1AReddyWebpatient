/**
 * MemberDiscountBadge — a membership tier's flat "N% off everything" benefit.
 *
 * A marketplace ``MembershipPlan`` can grant its holders a blanket percentage
 * off the patient-facing price of every consultation and catalog service
 * (``member_discount_pct``). That benefit is quoted in three unrelated card
 * layouts — ``MembershipPricingSection`` on the apex landing page,
 * ``JoinNetworkPage``, and ``PlanCard`` at /join_receiver — which is exactly
 * the situation that produces three lookalike badges that drift the moment
 * one of them gets restyled.
 *
 * Renders nothing when the plan grants no discount, so callers can drop it in
 * unconditionally: a plan with the field at 0 (or a SaaS plan, which has no
 * such field at all) simply doesn't get a badge.
 *
 * Deliberately NOT the same thing as the "N% OFF" chip beside the price on
 * those cards. That one is the plan's own markdown against its ``og_`` list
 * price — what you save on the *subscription*. This is what you save on
 * everything you buy afterwards.
 */
import { Chip, Stack, Tooltip, Typography } from '@mui/material';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';

/** The plan's member discount as a positive number, or 0. */
export const memberDiscountOf = (plan) => {
    const pct = Number(plan?.member_discount_pct);
    return Number.isFinite(pct) && pct > 0 ? pct : 0;
};

/**
 * What ONE offering grants the viewer — the payload's own
 * ``member_discount_pct``, not the tier's blanket ceiling.
 *
 * A membership tier's headline % is a CEILING: ``plan_discounts`` on each
 * doctor × offering pricing rule can dial an individual offering below it, and
 * the server charges that dialled figure. Every patient-facing payload that
 * quotes a price now carries the resolved number beside it — a consultation
 * type, a duration tier, a marketplace product — so a card reading this shows
 * what the buyer will actually be charged rather than what their plan promises
 * at best.
 *
 * ``member_discount_pct_min`` rides along on payloads that speak for a SET of
 * slots (a consultation type covers several duration tiers). Equal min and max
 * means every slot grants the same thing and the card can state it flatly;
 * they differ only where an admin dialled one slot down, and only then is
 * "Upto" the honest word.
 */
export const offeringMemberDiscount = (offering) => {
    const rawFlat = Number(offering?.member_discount_amount);
    // The per-plan vouchers / coupons an admin picked for this buyer's tier on
    // this offering. A separate figure from the percentage because it is a
    // different kind of thing — one scales with the price, one doesn't — and
    // adding them together would leave a card unable to say "20% + ₹100 off",
    // which is what the patient is actually getting.
    const flat = Number.isFinite(rawFlat) && rawFlat > 0 ? rawFlat : 0;

    const max = Number(offering?.member_discount_pct);
    if (!Number.isFinite(max) || max <= 0) {
        return { pct: 0, min: 0, flat, exact: true, hasDiscount: flat > 0 };
    }
    const rawMin = Number(offering?.member_discount_pct_min);
    // Absent ``_min`` means the payload speaks for a single offering, so its
    // one figure IS both ends of the range — not "unknown, assume it varies".
    const min = Number.isFinite(rawMin) ? rawMin : max;
    return { pct: max, min, flat, exact: min === max, hasDiscount: true };
};

/** The deepest benefit across a set of offerings — the card-level headline. */
export const bestMemberDiscount = (offerings = []) => (offerings || []).reduce(
    (best, o) => Math.max(best, offeringMemberDiscount(o).pct), 0,
);

/** ``amount`` less ``pct``%, 2dp. Mirrors ``apply_member_discount`` server-side. */
export const applyPct = (amount, pct) => {
    const value = Number(amount);
    if (amount == null || amount === '' || !Number.isFinite(value)) return null;
    const percent = Number(pct);
    if (!Number.isFinite(percent) || percent <= 0) return value;
    return Math.round(value * (1 - percent / 100) * 100) / 100;
};

/**
 * ``amount`` less the whole membership benefit — the % first, then the flat ₹
 * of the tier's vouchers, floored at 0.
 *
 * The order is fixed here so no caller has to decide, and it mirrors
 * ``apply_member_benefit`` server-side: the percentage is a proportion of what
 * the offering costs, the voucher is a fixed sum off what's left. Taking the
 * voucher first would let the percentage discount the voucher too.
 */
export const applyMemberBenefit = (amount, member) => {
    const net = applyPct(amount, member?.pct);
    if (net == null) return null;
    const flat = Number(member?.flat);
    if (!Number.isFinite(flat) || flat <= 0) return net;
    return Math.max(0, Math.round((net - flat) * 100) / 100);
};

export default function MemberDiscountBadge({ plan, sx }) {
    const pct = memberDiscountOf(plan);
    if (!pct) return null;

    return (
        <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{
                mt: 1.5,
                px: 1.25,
                py: 0.75,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'success.light',
                bgcolor: 'success.50',
                ...sx,
            }}
        >
            <LocalOfferOutlinedIcon fontSize="small" color="success" />
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'success.dark' }}>
                {pct}% off
            </Typography>
            <Typography variant="caption" color="text.secondary">
                every consultation &amp; service
            </Typography>
        </Stack>
    );
}

/**
 * The compact form — just the percentage — for surfaces that badge a price
 * rather than describe a plan: the doctor tiles, the service cards, and the
 * marketplace product cards, where it sits in the card's top-right corner.
 *
 * ``pct`` rather than a plan here: those surfaces read the *viewer's* own
 * discount from ``/api/membership/my-benefits``, and never hold a plan row.
 */
export function MemberDiscountChip({
    pct, sx, size = 'small', exact = true, planName = null,
}) {
    const value = Number(pct);
    if (!Number.isFinite(value) || value <= 0) return null;
    // "Upto" only where the figure genuinely varies across the slots the card
    // speaks for. Hedging on a number that doesn't vary reads as a catch, and
    // it is the honest word in precisely one case — see
    // ``offeringMemberDiscount``.
    const label = exact ? `${value}% OFF` : `UPTO ${value}% OFF`;
    return (
        // The card's own prices are NOT reduced by this — a membership
        // discount depends on who is buying and is settled at purchase, so
        // the tooltip has to say so explicitly. Without it the chip reads as
        // a promise that the price beside it is already discounted, and the
        // patient meets the real number for the first time at checkout.
        <Tooltip
            title={[
                planName ? `Your ${planName} membership` : 'Your membership',
                exact ? null : 'varies by slot length',
                'applied at billing',
            ].filter(Boolean).join(' — ')}
        >
            <Chip
                size={size}
                color="success"
                label={label}
                sx={{ fontWeight: 700, ...sx }}
            />
        </Tooltip>
    );
}
