/**
 * MembershipPlansPanel — a plan-based provider's self-service tier picker +
 * Razorpay pay-for-plan flow. Shared by the "My Membership" page (upgrade /
 * renew any time) and the holding page (pay to reactivate a lapsed tier).
 *
 * Flow:
 *   1. List the active tiers in the provider's vertical (tagged current /
 *      upgrade / downgrade), with the periods each offers.
 *   2. Selecting a tier + period asks the backend to PRICE it (proration is
 *      server-side — a mid-cycle upgrade is credited, a mid-cycle downgrade is
 *      refused with a clear message).
 *   3. "Pay" creates a Razorpay order for that amount and, on success, verifies
 *      → the subscription activates for a fresh period. A fully-credited /
 *      free change activates with no gateway round-trip.
 *
 * Amounts are never computed here — the panel only renders what the backend
 * quotes and pays exactly what the create-order priced.
 */
import { useEffect, useMemo, useState } from 'react';
import {
    Box, Paper, Typography, Button, Chip, MenuItem, TextField, Alert,
    Stack, CircularProgress, Divider,
} from '@mui/material';
import RedeemIcon from '@mui/icons-material/Redeem';
import { loadRazorpayScript } from '../../../../../utils/loadRazorpayScript';
import {
    useGetMyMembershipPlansQuery,
    useGetMyCreditQuoteQuery,
    useQuoteMyMembershipChangeMutation,
    useCreateMembershipPaymentOrderMutation,
    useVerifyMembershipPaymentMutation,
} from '../../api/myMembershipEndpoints';

const PERIOD_LABEL = {
    monthly: 'Monthly', quarterly: 'Quarterly', semi_annual: 'Half-yearly',
    annual: 'Annual', biennial: '2-yearly', triennial: '3-yearly',
};
const RELATION_CHIP = {
    current: { label: 'Current', color: 'default' },
    upgrade: { label: 'Upgrade', color: 'success' },
    downgrade: { label: 'Downgrade', color: 'warning' },
    lateral: { label: 'Switch', color: 'info' },
};
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

// A member needs to pay for their CURRENT tier unless it's a live, paid period
// (or a free/comp active plan, which carries no ``plan_period``). A trial, a
// lapsed period (status still 'active' but current_period_end in the past — the
// holding-page case), or a past-due row all need payment.
const needsPayment = (sub) => {
    if (!sub) return true;
    if (sub.status !== 'active') return true;
    if (!sub.plan_period) return false;              // free / comped active plan
    if (!sub.current_period_end) return false;
    return new Date(sub.current_period_end) <= new Date();
};

export default function MembershipPlansPanel({ title = 'Plans', onPaid, dense = false }) {
    const { data, isLoading, isError, error, refetch } = useGetMyMembershipPlansQuery();
    const [quoteChange, quoteState] = useQuoteMyMembershipChangeMutation();
    const [createOrder] = useCreateMembershipPaymentOrderMutation();
    const [verifyPayment] = useVerifyMembershipPaymentMutation();

    const [selPlan, setSelPlan] = useState(null);       // the plan object
    const [selPeriod, setSelPeriod] = useState('monthly');
    const [quote, setQuote] = useState(null);           // { amount_inr, kind, credit_inr }
    const [quoteErr, setQuoteErr] = useState('');
    const [payErr, setPayErr] = useState('');
    const [paying, setPaying] = useState(false);
    const [done, setDone] = useState('');
    const [creditsApplied, setCreditsApplied] = useState(0);

    const subscription = data?.subscription || null;
    const plans = data?.plans || [];

    // Health credits redeemable toward THIS renewal (the ``membership`` scope).
    // Priced off the amount the backend quoted; the wallet + the plan's policy
    // cap it. Whole rupees, reset whenever the quote changes.
    const membershipPrice = quote && quote.amount_inr > 0 ? Math.round(quote.amount_inr) : 0;
    const { data: creditQuote } = useGetMyCreditQuoteQuery(
        { offering: 'membership', price: membershipPrice },
        { skip: !membershipPrice },
    );
    const maxCredit = Math.floor(creditQuote?.max_redeemable || 0);
    const creditAvailable = creditQuote?.available || 0;
    const payable = Math.max(0, (quote?.amount_inr || 0) - creditsApplied);

    // Clamp the applied credits whenever the cap changes (new plan / period).
    useEffect(() => {
        setCreditsApplied((c) => Math.min(c, maxCredit));
    }, [maxCredit]);

    const periodsForSel = useMemo(
        () => (selPlan ? Object.keys(selPlan.periods || {}) : []),
        [selPlan],
    );

    const pickPlan = async (plan) => {
        setSelPlan(plan);
        setQuote(null); setQuoteErr(''); setPayErr(''); setDone(''); setCreditsApplied(0);
        const periods = Object.keys(plan.periods || {});
        const period = periods.includes(selPeriod) ? selPeriod : (periods[0] || 'monthly');
        setSelPeriod(period);
        await runQuote(plan.id, period);
    };

    const runQuote = async (planId, period) => {
        setQuote(null); setQuoteErr(''); setCreditsApplied(0);
        try {
            const q = await quoteChange({ membership_plan_id: planId, period }).unwrap();
            setQuote(q);
        } catch (e) {
            setQuoteErr(e?.data?.error || e?.data?.message || 'This change is not available.');
        }
    };

    const changePeriod = (period) => {
        setSelPeriod(period);
        if (selPlan) runQuote(selPlan.id, period);
    };

    const pay = async () => {
        if (!selPlan || !subscription) return;
        setPaying(true); setPayErr(''); setDone('');
        try {
            const res = await createOrder({
                subscription_id: subscription.id,
                plan_id: selPlan.id,
                period: selPeriod,
                redeem_credits: creditsApplied || 0,
            }).unwrap();
            const d = res?.data || res;

            // Fully credited / free — activated server-side, no checkout needed.
            if (d?.no_payment_needed) {
                setDone('Your plan is now active.');
                setSelPlan(null); setQuote(null);
                refetch(); onPaid?.();
                return;
            }

            const ok = await loadRazorpayScript();
            if (!ok || !window.Razorpay) {
                throw new Error('Could not load the payment SDK. Please retry.');
            }
            const prefill = Object.fromEntries(
                Object.entries(d?.prefill || {}).filter(([, v]) => v),
            );
            await new Promise((resolve, reject) => {
                const rzp = new window.Razorpay({
                    key: d.key_id,
                    amount: d.amount,
                    currency: 'INR',
                    name: 'Membership',
                    description: `${selPlan.name} — ${PERIOD_LABEL[selPeriod] || selPeriod}`,
                    order_id: d.razorpay_order_id,
                    prefill,
                    theme: { color: '#2563eb' },
                    handler: async (r) => {
                        try {
                            await verifyPayment({
                                razorpay_order_id: r.razorpay_order_id,
                                razorpay_payment_id: r.razorpay_payment_id,
                                razorpay_signature: r.razorpay_signature,
                                payment_id: d.payment_id,
                            }).unwrap();
                            resolve();
                        } catch (verr) { reject(verr); }
                    },
                    modal: { ondismiss: () => reject(new Error('Payment cancelled.')) },
                });
                rzp.on('payment.failed', (resp) => {
                    try { rzp.close(); } catch { /* noop */ }
                    reject(new Error(resp?.error?.description || 'Payment failed.'));
                });
                rzp.open();
            });

            setDone('Payment successful — your plan is now active.');
            setSelPlan(null); setQuote(null);
            refetch(); onPaid?.();
        } catch (e) {
            setPayErr(e?.data?.error || e?.data?.message || e?.message || 'Payment failed.');
        } finally {
            setPaying(false);
        }
    };

    if (isLoading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress /></Box>;
    }
    // 404 = no subscription → nothing to offer (panel simply hides).
    if (isError && error?.status === 404) return null;
    if (isError) {
        return <Alert severity="error">Couldn't load plans.</Alert>;
    }

    return (
        <Paper variant="outlined" sx={{ p: dense ? 2 : 3, borderRadius: 2 }}>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>{title}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Upgrade any time (the unused part of your current plan is credited).
                Downgrades take effect when your current period ends.
            </Typography>

            {done && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setDone('')}>{done}</Alert>}

            <Stack spacing={1.5}>
                {plans.map((p) => {
                    const rel = RELATION_CHIP[p.relation] || RELATION_CHIP.lateral;
                    const isSel = selPlan?.id === p.id;
                    const monthly = p.periods?.monthly;
                    return (
                        <Paper
                            key={p.id}
                            variant="outlined"
                            sx={{
                                p: 1.5, borderRadius: 2,
                                borderColor: isSel ? 'primary.main' : 'divider',
                                borderWidth: isSel ? 2 : 1,
                            }}
                        >
                            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                                <Typography fontWeight={600}>{p.name}</Typography>
                                <Chip size="small" label={rel.label} color={rel.color} variant="outlined" />
                                {monthly != null && (
                                    <Typography variant="body2" color="text.secondary">
                                        from {money(monthly)}/mo
                                    </Typography>
                                )}
                                <Box sx={{ flexGrow: 1 }} />
                                {/* The current plan shows "Active" only once it's
                                    actually paid-and-live. A trial / lapsed member
                                    can still pay for their current tier to activate
                                    (or renew) it. */}
                                {(p.relation === 'current' && !needsPayment(subscription))
                                    ? <Chip size="small" label="Active" color="success" />
                                    : (
                                        <Button size="small" variant={isSel ? 'contained' : 'outlined'}
                                            onClick={() => pickPlan(p)}>
                                            {p.relation === 'current' ? 'Pay to activate'
                                                : p.relation === 'upgrade' ? 'Upgrade' : 'Select'}
                                        </Button>
                                    )}
                            </Stack>

                            {isSel && (
                                <Box sx={{ mt: 1.5 }}>
                                    <Divider sx={{ mb: 1.5 }} />
                                    <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                                        <TextField
                                            select size="small" label="Billing period" sx={{ minWidth: 160 }}
                                            value={selPeriod} onChange={(e) => changePeriod(e.target.value)}
                                        >
                                            {periodsForSel.map((per) => (
                                                <MenuItem key={per} value={per}>
                                                    {PERIOD_LABEL[per] || per} · {money(p.periods[per])}
                                                </MenuItem>
                                            ))}
                                        </TextField>
                                        {quoteState.isLoading ? (
                                            <CircularProgress size={20} />
                                        ) : quote ? (
                                            <Box>
                                                <Typography variant="body2">
                                                    Pay now: <strong>{money(payable)}</strong>
                                                    {quote.credit_inr > 0 && (
                                                        <Typography component="span" variant="caption" color="success.main" sx={{ ml: 1 }}>
                                                            ({money(quote.credit_inr)} proration credit)
                                                        </Typography>
                                                    )}
                                                    {creditsApplied > 0 && (
                                                        <Typography component="span" variant="caption" color="success.main" sx={{ ml: 1 }}>
                                                            (−{money(creditsApplied)} health credits)
                                                        </Typography>
                                                    )}
                                                </Typography>
                                            </Box>
                                        ) : null}
                                        <Box sx={{ flexGrow: 1 }} />
                                        <Button
                                            variant="contained" disabled={!quote || paying || !!quoteErr}
                                            onClick={pay}
                                        >
                                            {paying ? 'Processing…'
                                                : payable === 0 ? 'Activate' : `Pay ${money(payable)}`}
                                        </Button>
                                    </Stack>

                                    {/* Health credits toward this renewal (the wallet-
                                        everywhere ``membership`` scope). Only shows when
                                        the plan's policy allows it and the wallet has a
                                        redeemable balance. */}
                                    {quote && maxCredit > 0 && (
                                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, mt: 1.5 }}>
                                            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                                                <RedeemIcon color="success" fontSize="small" />
                                                <Typography variant="subtitle2" fontWeight={700}>Health credits</Typography>
                                                <Chip size="small" variant="outlined" label={`${money(creditAvailable)} available`} />
                                            </Stack>
                                            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                                                Use up to <strong>{money(maxCredit)}</strong> in credits on this renewal.
                                            </Typography>
                                            <Stack direction="row" spacing={1} alignItems="center">
                                                <TextField
                                                    size="small" type="number" label="Use credits"
                                                    value={creditsApplied}
                                                    onChange={(e) => setCreditsApplied(
                                                        Math.max(0, Math.min(Math.floor(Number(e.target.value) || 0), maxCredit)),
                                                    )}
                                                    inputProps={{ min: 0, max: maxCredit, step: 1 }}
                                                    sx={{ width: 150 }}
                                                />
                                                <Button size="small" disabled={creditsApplied >= maxCredit}
                                                    onClick={() => setCreditsApplied(maxCredit)}>
                                                    Use max
                                                </Button>
                                            </Stack>
                                        </Paper>
                                    )}

                                    {quoteErr && <Alert severity="info" sx={{ mt: 1 }}>{quoteErr}</Alert>}
                                    {payErr && <Alert severity="error" sx={{ mt: 1 }}>{payErr}</Alert>}
                                </Box>
                            )}
                        </Paper>
                    );
                })}
                {plans.length === 0 && (
                    <Alert severity="info">No other tiers are available in your vertical yet.</Alert>
                )}
            </Stack>
        </Paper>
    );
}
