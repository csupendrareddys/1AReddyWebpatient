/**
 * BillingPage — the tenant pays for its OWN SaaS subscription here.
 *
 * Until Phase 5 this didn't exist: a trial simply lapsed and only the
 * vendor could reset a subscription. Now the tenant's SUPER_ADMIN renews
 * one period at a time (Razorpay one-time order on the VENDOR's account),
 * and a lapsed tenant pays its way out of PAST_DUE / SUSPENDED from this
 * page — which is why the page is role-gated, never feature-gated: a
 * suspended tenant has no features, but must still reach this screen.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Chip, CircularProgress, Container, Paper, Stack,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';

import usePrimedQuery from '../../../../common/hooks/usePrimedQuery';
import { runRazorpayCheckout } from '../../../../utils/runRazorpayCheckout';
import AddonShop from '../components/AddonShop';
import {
    useGetSaasSubscriptionQuery,
    useCreateSubscriptionOrderMutation,
    useVerifySubscriptionPaymentMutation,
    useReconcileSubscriptionPaymentMutation,
} from '../../api/billingEndpoints';

const STATUS_COLOR = {
    active: 'success',
    trial: 'info',
    over_limit: 'warning',
    past_due: 'warning',
    suspended: 'error',
    cancelled: 'default',
};

// Kept in sync with the backend's PERIOD_DAYS — a period the plan
// prices but this map omits would be silently unbuyable from here.
const PERIOD_LABEL = {
    monthly: 'Monthly', quarterly: 'Quarterly',
    semi_annual: 'Semi-annual', annual: 'Annual',
    biennial: '2-yearly', triennial: '3-yearly',
};

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
}) : '—');

const fmtInr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

/** The status strip explains what the current state MEANS for the tenant,
 * not just what it is called. */
function StatusBanner({ sub }) {
    if (!sub) return null;
    const { status, trial_ends_at: trialEnd, current_period_end: periodEnd,
        suspend_after: suspendAfter } = sub;
    if (status === 'trial') {
        return (
            <Alert severity="info" sx={{ mb: 2 }}>
                You are on a free trial until <b>{fmtDate(trialEnd)}</b>. Pay for
                your first period below to keep the workspace running after that.
            </Alert>
        );
    }
    if (status === 'past_due') {
        return (
            <Alert severity="warning" sx={{ mb: 2 }}>
                Your subscription is <b>past due</b>
                {suspendAfter ? <> — the workspace will be suspended after <b>{fmtDate(suspendAfter)}</b></> : null}.
                Renew below to keep everything running.
            </Alert>
        );
    }
    if (status === 'suspended') {
        return (
            <Alert severity="error" sx={{ mb: 2 }}>
                Your workspace is <b>suspended</b> for non-payment — features are
                switched off for all users. Nothing has been deleted: pay below
                and access is restored immediately.
            </Alert>
        );
    }
    if (status === 'over_limit') {
        return (
            <Alert severity="warning" sx={{ mb: 2 }}>
                Your tenant is over its plan limits. Renewing does not lift
                seat limits — contact the vendor to upgrade the plan.
            </Alert>
        );
    }
    return (
        <Alert severity="success" sx={{ mb: 2 }}>
            Your subscription is active until <b>{fmtDate(periodEnd)}</b>.
            Renewing early stacks another period on top.
        </Alert>
    );
}

export default function BillingPage() {
    const q = useGetSaasSubscriptionQuery();
    const { data, settled, reprime } = usePrimedQuery(q);

    const [createOrder] = useCreateSubscriptionOrderMutation();
    const [verify] = useVerifySubscriptionPaymentMutation();

    const [period, setPeriod] = useState('monthly');

    const [recheck, setRecheck] = useState(null);

    const [reconcile, { isLoading: reconciling }] =

        useReconcileSubscriptionPaymentMutation();
    const [paying, setPaying] = useState(false);
    const [notice, setNotice] = useState(null);

    if (!settled) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
            </Box>
        );
    }
    if (!data?.subscription) {
        return (
            <Container maxWidth="md" sx={{ mt: 4 }}>
                <Alert severity="error">
                    Unable to load billing details. If this tenant has no
                    subscription, contact the vendor.
                </Alert>
            </Container>
        );
    }

    const sub = data.subscription;
    const plan = data.plan || {};
    const pricing = data.pricing || {};
    const payments = data.payments || [];
    const periods = Object.keys(PERIOD_LABEL).filter((p) => p in pricing);
    const chosen = periods.includes(period) ? period : periods[0];
    const price = chosen != null ? pricing[chosen] : null;

    const onPay = async () => {
        setNotice(null);
        setPaying(true);
        try {
            if (Number(price) === 0) {
                // Free plan — the backend applies the period directly,
                // no gateway round-trip to run.
                const res = await createOrder({ period: chosen }).unwrap();
                if (!res?.data?.no_payment_needed) {
                    throw new Error('Unexpected response for a free renewal.');
                }
            } else {
                await runRazorpayCheckout({
                    createOrder,
                    verify: (body) => verify(body),
                    createOrderArgs: { period: chosen },
                    name: plan.name || 'Subscription',
                    description: `${PERIOD_LABEL[chosen]} renewal`,
                });
            }
            reprime();
            setNotice({ severity: 'success',
                text: 'Payment received — your subscription has been extended.' });
        } catch (e) {
            const text = e?.data?.error || e?.data?.message || e?.message
                || 'Payment did not complete.';
            setNotice({ severity: 'error', text });
        } finally {
            setPaying(false);
        }
    };

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 8 }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                <ReceiptLongIcon color="primary" />
                <Typography variant="h5">Billing</Typography>
            </Stack>

            <StatusBanner sub={sub} />
            {notice && (
                <Alert severity={notice.severity} sx={{ mb: 2 }}
                    onClose={() => setNotice(null)}>
                    {notice.text}
                </Alert>
            )}

            <Paper sx={{ p: 3, mb: 3 }}>
                <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
                    <Typography variant="h6">
                        {plan.name || sub.plan_code}
                    </Typography>
                    <Chip size="small" label={sub.status}
                        color={STATUS_COLOR[sub.status] || 'default'} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                    Plan code: {sub.plan_code} · Billing cycle: {sub.billing_cycle}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    {sub.status === 'trial'
                        ? <>Trial ends {fmtDate(sub.trial_ends_at)}</>
                        : <>Paid until {fmtDate(sub.current_period_end)}</>}
                </Typography>
            </Paper>

            <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 2 }}>
                    {sub.status === 'trial' ? 'Start your paid subscription'
                        : 'Renew / extend'}
                </Typography>
                {periods.length === 0 ? (
                    <Alert severity="info">
                        Your plan is priced individually — contact the vendor to
                        renew.
                    </Alert>
                ) : (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}
                        alignItems={{ sm: 'center' }}>
                        <ToggleButtonGroup exclusive size="small" value={chosen}
                            onChange={(_, v) => v && setPeriod(v)}>
                            {periods.map((p) => (
                                <ToggleButton key={p} value={p} sx={{ px: 2 }}>
                                    {PERIOD_LABEL[p]} — {fmtInr(pricing[p])}
                                </ToggleButton>
                            ))}
                        </ToggleButtonGroup>
                        <Button variant="contained" disabled={paying}
                            onClick={onPay}
                            startIcon={paying
                                ? <CircularProgress size={16} color="inherit" />
                                : null}>
                            {paying ? 'Processing…'
                                : `Pay ${price != null ? fmtInr(price) : ''}`}
                        </Button>
                    </Stack>
                )}
                <Typography variant="caption" color="text.secondary"
                    sx={{ display: 'block', mt: 1.5 }}>
                    One period is charged at a time — no auto-debit. Paying while
                    active extends from your current period end; paying from a
                    lapsed state starts the new period today.
                </Typography>
            </Paper>

            <Paper sx={{ p: 3 }}>
                <Stack direction="row" alignItems="center" spacing={1}
                    sx={{ mb: 2 }}>
                    <Typography variant="h6" sx={{ flex: 1 }}>
                        Payment history
                    </Typography>
                    {/* Neither settle path is guaranteed: a tab closed
                        mid-checkout skips the verify call, and a missing
                        webhook skips the backup. This asks the gateway
                        directly so a paid-but-unconfirmed period can be
                        recovered without paying twice. */}
                    <Button size="small" variant="outlined"
                        disabled={reconciling}
                        onClick={async () => {
                            setRecheck(null);
                            try {
                                const res = await reconcile({}).unwrap();
                                setRecheck({
                                    severity: res?.data?.settled
                                        ? 'success' : 'info',
                                    text: res?.message || 'Checked.',
                                });
                                if (res?.data?.settled) reprime();
                            } catch (e) {
                                setRecheck({ severity: 'error',
                                    text: e?.data?.error
                                        || 'Could not check right now.' });
                            }
                        }}>
                        {reconciling ? 'Checking…' : 'Recheck payment'}
                    </Button>
                </Stack>
                {recheck && (
                    <Alert severity={recheck.severity} sx={{ mb: 2 }}
                        onClose={() => setRecheck(null)}>
                        {recheck.text}
                    </Alert>
                )}
                {payments.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                        No subscription payments yet.
                    </Typography>
                ) : (
                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Date</TableCell>
                                    <TableCell align="right">Amount</TableCell>
                                    <TableCell>Status</TableCell>
                                    <TableCell>Reference</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {payments.map((p) => (
                                    <TableRow key={p.id}>
                                        <TableCell>{fmtDate(p.payment_date)}</TableCell>
                                        <TableCell align="right">{fmtInr(p.amount)}</TableCell>
                                        <TableCell>
                                            <Chip size="small" label={p.status}
                                                color={p.status === 'success' ? 'success'
                                                    : p.status === 'failed' ? 'error' : 'default'} />
                                        </TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                            {p.transaction_id || '—'}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Paper>
            <AddonShop onPurchased={reprime} />

        </Container>
    );
}
