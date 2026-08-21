/**
 * The pricing model both booking flows settle through — ported from the mobile
 * MVP's ``src/data/checkout.ts``, arithmetic unchanged.
 *
 * One quote shape for every product this app sells, so a consultation and a
 * care plan can't drift on how a discount is applied. The order matters and is
 * the mobile app's:
 *
 *   fee + increments            → gross
 *   − overall offering discount → FINAL PRICE
 *   − patient's own discount
 *   − membership plan discount
 *   − vouchers + coupons        → payable
 *   − health credits (capped)   → total
 *
 * The percentages and voucher books are the offering's and the patient's, and
 * in the real system come from the admin's pricing rows + the patient's plan.
 * Callers pass what they know; the caps below are the mobile app's defaults
 * until the backend quotes them.
 */

/** Every figure the patient sees is whole rupees — paise through a percentage
 * discount produces things like ₹2,499.9, which reads as a bug. */
const rupees = (n) => Math.round(n);
const sum = (rows) => rows.reduce((s, d) => s + d.amount, 0);

export const PRODUCT_LABEL = {
    appointment: 'Appointment',
    service: 'Service',
    group_offering: 'Group Offering',
    recovery_plan: 'Recovery Plan',
    advanced_plan: 'Advanced Care Plan',
};

/** Vouchers the admin attached to this offering — offered, not typed in. */
export const vouchersFor = (kind) => {
    if (kind === 'appointment') {
        return [
            { id: 'v1', code: 'FAMILY100', label: 'Family Care plan voucher', amount: 100, kind: 'voucher' },
            { id: 'v2', code: 'FOLLOWUP50', label: 'Follow-up within 14 days', amount: 50, kind: 'voucher' },
        ];
    }
    if (kind === 'recovery_plan' || kind === 'advanced_plan') {
        return [{ id: 'v3', code: 'PLAN250', label: 'Care plan enrolment credit', amount: 250, kind: 'voucher' }];
    }
    return [{ id: 'v4', code: 'FIRSTBUY', label: 'First purchase credit', amount: 75, kind: 'voucher' }];
};

/** Coupons the patient can type in. Codes match case-insensitively. */
export const COUPON_BOOK = [
    { id: 'c1', code: 'WELCOME200', label: 'Welcome offer', amount: 200, kind: 'coupon' },
    { id: 'c2', code: 'HEALTH15', label: 'Health week', amount: 150, kind: 'coupon' },
    { id: 'c3', code: 'REFER100', label: 'Referral reward', amount: 100, kind: 'coupon' },
];

export const findCoupon = (code) =>
    COUPON_BOOK.find((c) => c.code.toLowerCase() === String(code).trim().toLowerCase()) || null;

/** An admin-set discount on this patient's account. */
export const USER_DISCOUNT_PCT = 5;

/** What Razorpay's own sheet offers — shown so the choice isn't a mystery. */
export const RAZORPAY_MODES = [
    { label: 'UPI', icon: 'card-outline' },
    { label: 'Cards', icon: 'card-outline' },
    { label: 'Net banking', icon: 'business-outline' },
    { label: 'Wallets', icon: 'wallet-outline' },
];

/** Web reserves the slot while payment runs; the countdown is part of the UI. */
export const RESERVATION_MINUTES = 20;

/**
 * @param {object} opts
 * @param {number} opts.fee              the offering's base price
 * @param {number|null} [opts.listPrice] struck-through price when marked down
 * @param {number} [opts.planDiscountPct] the patient's membership benefit
 * @param {number} [opts.creditsAvailable] health credits the patient holds
 * @param {number} [opts.creditsMaxPct]   server ceiling on credit redemption
 */
export function quoteFor(opts) {
    const {
        fee, listPrice = null, incrementFixed = 0, incrementPct = 0,
        overallDiscountPct = 0, vouchers = [], coupons = [], creditsApplied = 0,
        planDiscountPct = 0, creditsAvailable = 0, creditsMaxPct = 20,
    } = opts;

    const incrementPctAmount = rupees((fee * incrementPct) / 100);
    const gross = rupees(fee + incrementFixed + incrementPctAmount);
    const overallDiscount = rupees((gross * overallDiscountPct) / 100);
    const finalPrice = Math.max(0, rupees(gross - overallDiscount));

    const userDiscount = rupees((finalPrice * USER_DISCOUNT_PCT) / 100);
    const planDiscount = rupees((finalPrice * planDiscountPct) / 100);
    const voucherTotal = rupees(sum(vouchers));
    const couponTotal = rupees(sum(coupons));

    const afterDiscounts = Math.max(
        0,
        rupees(finalPrice - userDiscount - planDiscount - voucherTotal - couponTotal),
    );

    // Credits cover only the server-set share of the offering, and never more
    // than the patient holds or still owes.
    const maxCredits = Math.min(
        creditsAvailable,
        Math.floor((finalPrice * creditsMaxPct) / 100),
        afterDiscounts,
    );
    const credits = Math.min(creditsApplied, maxCredits);

    return {
        listPrice,
        fee,
        incrementFixed,
        incrementPct,
        incrementPctAmount,
        gross,
        overallDiscountPct,
        overallDiscount,
        finalPrice,
        userDiscountPct: USER_DISCOUNT_PCT,
        userDiscount,
        planDiscountPct,
        planDiscount,
        voucherTotal,
        couponTotal,
        creditsApplied: credits,
        total: Math.max(0, rupees(afterDiscounts - credits)),
        maxCredits,
    };
}
