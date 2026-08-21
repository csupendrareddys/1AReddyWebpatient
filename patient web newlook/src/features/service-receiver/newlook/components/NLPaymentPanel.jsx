/**
 * NLPaymentPanel — port of the mobile MVP's ``PaymentPanel``: the settlement
 * step every product in both flows shares.
 *
 * It shows the whole price build-up rather than a single total, because each
 * line is a different party's decision — the offering's price, the admin's
 * discount, the patient's own rate, their plan benefit, vouchers attached to
 * the offering, a coupon they typed, and credits they hold. A patient who can
 * see why a number moved doesn't have to ring anyone to ask.
 *
 * Credits are capped server-side (``quote.maxCredits``); the slider can never
 * offer more than that, so the panel can't promise a redemption the backend
 * would refuse.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Chip, Divider, FormControlLabel, Slider,
    TextField, Typography,
} from '@mui/material';
import NLCard from './NLCard';
import NLIcon from './NLIcon';
import { findCoupon, RAZORPAY_MODES } from '../data/checkout';
import { colors, radius, tint, typography } from '../theme/tokens';
import { inr } from '../utils/format';

const Row = ({ label, value, strong, tone, hint }) => (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, py: '5px' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
                sx={{
                    fontSize: strong ? 14.5 : 13,
                    fontWeight: strong ? 700 : 400,
                    color: tone || colors.textPrimary,
                }}
            >
                {label}
            </Typography>
            {hint ? <Typography sx={typography.caption}>{hint}</Typography> : null}
        </Box>
        <Typography
            sx={{
                fontSize: strong ? 15.5 : 13.5,
                fontWeight: strong ? 800 : 600,
                color: tone || colors.textPrimary,
                whiteSpace: 'nowrap',
            }}
        >
            {value}
        </Typography>
    </Box>
);

const NLPaymentPanel = ({
    quote, vouchers = [], appliedVoucherIds = [], onToggleVoucher,
    coupons = [], onApplyCoupon, onRemoveCoupon,
    credits, onCredits, method, onMethod, agreed, onAgreed,
}) => {
    const [code, setCode] = useState('');
    const [codeError, setCodeError] = useState(null);

    const applyCode = () => {
        setCodeError(null);
        const found = findCoupon(code);
        if (!found) { setCodeError('That code isn’t valid.'); return; }
        if (coupons.some((c) => c.id === found.id)) { setCodeError('Already applied.'); return; }
        onApplyCoupon(found);
        setCode('');
    };

    return (
        <Box>
            {/* ── Price build-up ───────────────────────────────────────── */}
            <Typography sx={{ ...typography.label, mb: 1 }}>PRICE DETAILS</Typography>
            <NLCard sx={{ mb: 2 }}>
                {quote.listPrice && quote.listPrice > quote.fee ? (
                    <Row
                        label="List price"
                        value={
                            <span style={{ textDecoration: 'line-through', color: colors.textMuted }}>
                                {inr(quote.listPrice)}
                            </span>
                        }
                    />
                ) : null}
                <Row label="Base price" value={inr(quote.fee)} />
                {quote.incrementFixed ? (
                    <Row label="Platform fee" value={`+ ${inr(quote.incrementFixed)}`} />
                ) : null}
                {quote.incrementPctAmount ? (
                    <Row label={`Surcharge (${quote.incrementPct}%)`} value={`+ ${inr(quote.incrementPctAmount)}`} />
                ) : null}
                {quote.overallDiscount ? (
                    <Row
                        label={`Offering discount (${quote.overallDiscountPct}%)`}
                        value={`− ${inr(quote.overallDiscount)}`}
                        tone={colors.success}
                    />
                ) : null}
                <Divider sx={{ my: 0.75 }} />
                <Row label="Final price" value={inr(quote.finalPrice)} strong />
                {quote.userDiscount ? (
                    <Row
                        label={`Your account discount (${quote.userDiscountPct}%)`}
                        value={`− ${inr(quote.userDiscount)}`}
                        tone={colors.success}
                    />
                ) : null}
                {quote.planDiscount ? (
                    <Row
                        label={`Membership benefit (${quote.planDiscountPct}%)`}
                        value={`− ${inr(quote.planDiscount)}`}
                        tone={colors.success}
                    />
                ) : null}
                {quote.voucherTotal ? (
                    <Row label="Vouchers" value={`− ${inr(quote.voucherTotal)}`} tone={colors.success} />
                ) : null}
                {quote.couponTotal ? (
                    <Row label="Coupons" value={`− ${inr(quote.couponTotal)}`} tone={colors.success} />
                ) : null}
                {quote.creditsApplied ? (
                    <Row label="Health credits" value={`− ${inr(quote.creditsApplied)}`} tone={colors.secondary} />
                ) : null}
                <Divider sx={{ my: 0.75 }} />
                <Row
                    label="You pay"
                    value={quote.total === 0 ? 'Fully covered' : inr(quote.total)}
                    strong
                    tone={colors.primary}
                />
            </NLCard>

            {/* ── Vouchers attached to this offering ───────────────────── */}
            {vouchers.length ? (
                <>
                    <Typography sx={{ ...typography.label, mb: 1 }}>AVAILABLE VOUCHERS</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', mb: 2 }}>
                        {vouchers.map((v) => {
                            const on = appliedVoucherIds.includes(v.id);
                            return (
                                <Chip
                                    key={v.id}
                                    label={`${v.code} · ${inr(v.amount)}`}
                                    onClick={() => onToggleVoucher(v.id)}
                                    color={on ? 'success' : 'default'}
                                    variant={on ? 'filled' : 'outlined'}
                                    icon={<NLIcon name="pricetag" size={14} />}
                                />
                            );
                        })}
                    </Box>
                </>
            ) : null}

            {/* ── Coupon the patient types ─────────────────────────────── */}
            <Typography sx={{ ...typography.label, mb: 1 }}>HAVE A COUPON?</Typography>
            <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <TextField
                    value={code}
                    onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeError(null); }}
                    placeholder="Enter code"
                    size="small"
                    fullWidth
                />
                <Button variant="outlined" onClick={applyCode} disabled={!code.trim()}>
                    Apply
                </Button>
            </Box>
            {codeError ? (
                <Typography sx={{ ...typography.caption, color: colors.error, mb: 1 }}>
                    {codeError}
                </Typography>
            ) : null}
            {coupons.length ? (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', mb: 2 }}>
                    {coupons.map((c) => (
                        <Chip
                            key={c.id}
                            label={`${c.code} · ${inr(c.amount)}`}
                            onDelete={() => onRemoveCoupon(c.id)}
                            color="success"
                        />
                    ))}
                </Box>
            ) : <Box sx={{ mb: 2 }} />}

            {/* ── Health credits ──────────────────────────────────────── */}
            {quote.maxCredits > 0 ? (
                <>
                    <Typography sx={{ ...typography.label, mb: 0.5 }}>USE HEALTH CREDITS</Typography>
                    <Typography sx={{ ...typography.bodyMuted, mb: 1 }}>
                        Up to {inr(quote.maxCredits)} can go towards this booking.
                    </Typography>
                    <Box sx={{ px: 1, mb: 2 }}>
                        <Slider
                            value={Math.min(credits, quote.maxCredits)}
                            onChange={(_, v) => onCredits(v)}
                            min={0}
                            max={quote.maxCredits}
                            step={1}
                            valueLabelDisplay="auto"
                            valueLabelFormat={(v) => inr(v)}
                        />
                    </Box>
                </>
            ) : null}

            {/* ── How they'll pay ─────────────────────────────────────── */}
            <Typography sx={{ ...typography.label, mb: 1 }}>PAYMENT METHOD</Typography>
            <Box sx={{ display: 'grid', gap: '8px', mb: 2 }}>
                {[
                    {
                        key: 'razorpay',
                        label: 'Pay via Razorpay',
                        sub: 'UPI · Cards · Net banking · Wallets',
                        icon: 'shield-checkmark-outline',
                    },
                    {
                        key: 'wallet',
                        label: 'Wallet',
                        sub: 'Your platform balance',
                        icon: 'wallet-outline',
                    },
                ].map((m) => {
                    const on = method === m.key;
                    return (
                        <Box
                            key={m.key}
                            onClick={() => onMethod(m.key)}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1.25,
                                p: '12px',
                                cursor: 'pointer',
                                borderRadius: `${radius.md}px`,
                                border: `${on ? 2 : 1}px solid ${on ? colors.primary : colors.border}`,
                                bgcolor: on ? tint(colors.primary, 0.05) : colors.surface,
                            }}
                        >
                            <NLIcon name={m.icon} size={20} color={on ? colors.primary : colors.textMuted} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography sx={{ ...typography.body, fontWeight: 600 }}>
                                    {m.label}
                                </Typography>
                                <Typography sx={typography.caption}>{m.sub}</Typography>
                            </Box>
                            {on ? <NLIcon name="checkmark-circle" size={20} color={colors.primary} /> : null}
                        </Box>
                    );
                })}
            </Box>
            {method === 'razorpay' ? (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', mb: 2 }}>
                    {RAZORPAY_MODES.map((m) => (
                        <Chip key={m.label} label={m.label} size="small" variant="outlined" />
                    ))}
                </Box>
            ) : null}

            <FormControlLabel
                control={<Checkbox checked={agreed} onChange={(e) => onAgreed(e.target.checked)} />}
                label={
                    <Typography sx={typography.bodyMuted}>
                        I agree to the terms, the cancellation policy, and to sharing the records
                        I selected with this provider.
                    </Typography>
                }
            />
            {!agreed ? (
                <Alert severity="info" sx={{ mt: 1 }}>
                    Tick the box above to continue to payment.
                </Alert>
            ) : null}
        </Box>
    );
};

export default NLPaymentPanel;
