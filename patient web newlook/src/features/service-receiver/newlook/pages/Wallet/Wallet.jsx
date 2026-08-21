/**
 * Wallet (new look) — port of the mobile MVP's ``app/more/wallet.tsx``: the
 * gradient balance card, quick-add presets, a top-up dialog with a payment
 * method picker, and the transaction history.
 *
 * Runs on ASSUMED endpoints #1/#2 (api/assumedEndpoints.js) — there is no
 * wallet deposit path in the backend today. The page states that plainly when
 * the endpoint 404s rather than pretending a balance.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
    DialogTitle, MenuItem, TextField, Typography,
} from '@mui/material';
import NLCard from '../../components/NLCard';
import NLIcon from '../../components/NLIcon';
import NLAssumedNotice from '../../components/NLAssumedNotice';
import NLEmptyState from '../../components/NLEmptyState';
import { useGetNLWalletQuery, useTopUpNLWalletMutation, isMissingEndpoint } from '../../api/assumedEndpoints';
import { colors, radius, typography } from '../../theme/tokens';
import { fmtDate, inr } from '../../utils/format';

/** Mobile's quick-add presets, verbatim. */
const PRESETS = [500, 1000, 2000, 5000];

/** Mobile's payment-method options. */
const METHODS = [
    { value: 'upi', label: 'UPI' },
    { value: 'card', label: 'Credit / Debit card' },
    { value: 'netbanking', label: 'Net banking' },
];

const Wallet = () => {
    const { data: wallet, isLoading, error } = useGetNLWalletQuery();
    const [topUp, { isLoading: paying }] = useTopUpNLWalletMutation();

    const [open, setOpen] = useState(false);
    const [preset, setPreset] = useState(1000);
    const [custom, setCustom] = useState('');
    const [method, setMethod] = useState('upi');
    const [payError, setPayError] = useState(null);

    const missing = isMissingEndpoint(error);
    const balance = wallet?.balance || 0;
    const transactions = wallet?.transactions || [];

    const amount = custom ? Number(custom) : preset || 0;
    const valid = Number.isFinite(amount) && amount >= 100;

    const submit = async () => {
        setPayError(null);
        try {
            const res = await topUp({ amount, method }).unwrap();
            // The assumed contract returns a Razorpay order; until the real
            // gateway hand-off exists, opening the returned URL is the most
            // this page can honestly do.
            if (res?.payment_url) window.open(res.payment_url, '_blank', 'noopener');
            setOpen(false);
        } catch (e) {
            setPayError(isMissingEndpoint(e)
                ? 'Top-up needs the backend endpoint POST /api/patient/wallet/top-up, which doesn’t exist yet.'
                : e?.data?.error || e?.data?.message || 'Top-up failed.');
        }
    };

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
                <Typography sx={{ ...typography.h1, flex: 1 }}>Wallet</Typography>
                <Button
                    variant="contained"
                    size="small"
                    startIcon={<NLIcon name="add-circle-outline" size={16} />}
                    onClick={() => setOpen(true)}
                >
                    Add money
                </Button>
            </Box>
            <Typography sx={{ ...typography.bodyMuted, mb: 2.5 }}>
                Money you keep on the platform to pay for consultations instantly.
            </Typography>

            <NLAssumedNotice error={error} endpoint="GET /api/patient/wallet" />

            <Box
                sx={{
                    borderRadius: '16px',
                    p: 2.5,
                    mb: 3,
                    color: colors.white,
                    background: `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`,
                    opacity: missing ? 0.6 : 1,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <NLIcon name="wallet-outline" size={18} color={colors.white} />
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600, opacity: 0.9 }}>
                        Available balance
                    </Typography>
                </Box>
                <Typography sx={{ fontSize: 34, fontWeight: 800, mt: 1 }}>
                    {isLoading ? '—' : inr(balance)}
                </Typography>
                <Typography sx={{ fontSize: 12, opacity: 0.85, mt: 0.5 }}>
                    Use this to pay for consultations instantly
                </Typography>
            </Box>

            <Typography sx={{ ...typography.label, mb: 1.25 }}>QUICK ADD</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', mb: 3 }}>
                {PRESETS.map((p) => (
                    <Button
                        key={p}
                        variant={preset === p && !custom ? 'contained' : 'outlined'}
                        onClick={() => { setPreset(p); setCustom(''); setOpen(true); }}
                        sx={{ fontWeight: 700, borderRadius: `${radius.sm}px` }}
                    >
                        ₹{p}
                    </Button>
                ))}
            </Box>

            <Typography sx={{ ...typography.label, mb: 1.25 }}>TRANSACTION HISTORY</Typography>
            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                    <CircularProgress />
                </Box>
            ) : transactions.length ? (
                transactions.map((t) => {
                    const credit = t.amount > 0;
                    return (
                        <NLCard
                            key={t.id}
                            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.25 }}
                        >
                            <Box
                                sx={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: '50%',
                                    bgcolor: credit ? '#E8F5E9' : '#FDECEA',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                <NLIcon
                                    name={credit ? 'arrow-back' : 'arrow-forward'}
                                    size={15}
                                    color={credit ? '#2e7d32' : '#c62828'}
                                    sx={{ transform: credit ? 'rotate(-90deg)' : 'rotate(-90deg) scaleX(-1)' }}
                                />
                            </Box>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography sx={typography.body} noWrap>
                                    {t.description || 'Transaction'}
                                </Typography>
                                <Typography sx={typography.bodyMuted}>
                                    {[fmtDate(t.date), t.method].filter(Boolean).join(' · ')}
                                </Typography>
                            </Box>
                            <Box sx={{ textAlign: 'right' }}>
                                <Typography
                                    sx={{
                                        fontSize: 14,
                                        fontWeight: 800,
                                        color: credit ? '#2e7d32' : '#c62828',
                                    }}
                                >
                                    {credit ? '+' : '−'}{inr(Math.abs(t.amount))}
                                </Typography>
                                {t.balance_after != null ? (
                                    <Typography sx={typography.caption}>
                                        {inr(t.balance_after)}
                                    </Typography>
                                ) : null}
                            </Box>
                        </NLCard>
                    );
                })
            ) : (
                <NLEmptyState
                    icon="wallet-outline"
                    title="No transactions yet"
                    subtitle="Top-ups and payments from this wallet appear here."
                />
            )}

            {/* ── Add money dialog ─────────────────────────────────────── */}
            <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Add money</DialogTitle>
                <DialogContent>
                    <Box
                        sx={{
                            bgcolor: colors.background,
                            borderRadius: `${radius.sm}px`,
                            p: 1.5,
                            mb: 2,
                        }}
                    >
                        <Typography sx={typography.bodyMuted}>Current balance</Typography>
                        <Typography sx={{ fontSize: 22, fontWeight: 800, color: colors.textPrimary }}>
                            {inr(balance)}
                        </Typography>
                    </Box>

                    <Typography sx={{ ...typography.label, mb: 1 }}>CHOOSE AMOUNT</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', mb: 2 }}>
                        {PRESETS.map((p) => (
                            <Button
                                key={p}
                                size="small"
                                variant={preset === p && !custom ? 'contained' : 'outlined'}
                                onClick={() => { setPreset(p); setCustom(''); }}
                            >
                                ₹{p}
                            </Button>
                        ))}
                    </Box>

                    <TextField
                        label="Or enter an amount"
                        placeholder="Minimum ₹100"
                        value={custom}
                        onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ''))}
                        size="small"
                        fullWidth
                        sx={{ mb: 2 }}
                    />

                    <TextField
                        select
                        label="Payment method"
                        value={method}
                        onChange={(e) => setMethod(e.target.value)}
                        size="small"
                        fullWidth
                    >
                        {METHODS.map((m) => (
                            <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                        ))}
                    </TextField>

                    {payError ? (
                        <Alert severity="warning" sx={{ mt: 2 }} onClose={() => setPayError(null)}>
                            {payError}
                        </Alert>
                    ) : null}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)}>Cancel</Button>
                    <Button variant="contained" disabled={!valid || paying} onClick={submit}>
                        {paying ? 'Processing…' : valid ? `Add ${inr(amount)}` : 'Enter at least ₹100'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default Wallet;
