/**
 * SecondOpinionCredits — a doctor's family-doctor commission wallet.
 *
 * Shows the health-credit balance earned by giving second opinions on their
 * empanelled patients' completed bookings, the per-booking rate + redeem
 * threshold, the ledger, and a Redeem-to-cash action (1 credit = ₹1). Rendered
 * as a tab in the doctor's My Bills.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Divider,
    Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, TextField, Typography,
} from '@mui/material';
import PaidIcon from '@mui/icons-material/Paid';

import {
    useGetSecondOpinionWalletQuery,
    useRedeemSecondOpinionMutation,
} from '../api/familyDoctorEndpoints';
import ConfirmDialog from './ConfirmDialog';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

function Tile({ label, value, color }) {
    return (
        <Paper variant="outlined" sx={{ px: 2.5, py: 1.5, borderRadius: 2, minWidth: 140 }}>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700, color: color || 'text.primary' }}>{value}</Typography>
        </Paper>
    );
}

export default function SecondOpinionCredits() {
    const { data, isLoading, isError } = useGetSecondOpinionWalletQuery();
    const [redeem, { isLoading: redeeming }] = useRedeemSecondOpinionMutation();
    const [amount, setAmount] = useState('');
    const [snack, setSnack] = useState(null);
    const [confirm, setConfirm] = useState(null);

    const w = data || { balance: 0, threshold: 0, rate: 0, eligible: false, ledger: [] };

    const doRedeem = async () => {
        setSnack(null);
        try {
            const body = amount ? { amount: Number(amount) } : {};
            const res = await redeem(body).unwrap();
            setAmount('');
            setSnack({ sev: 'success', msg: res?.message || 'Redemption submitted.' });
        } catch (e) {
            setSnack({ sev: 'error', msg: e?.data?.message || e?.data?.error || 'Redemption failed.' });
        }
    };

    if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;
    if (isError) return <Alert severity="error">Could not load your second-opinion credits.</Alert>;

    return (
        <Box>
            <Typography variant="h6" gutterBottom>Second Opinion Credits</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Credits you earn for second opinions on your empanelled patients' completed
                bookings (1 credit = ₹1). Redeem to cash once you reach the threshold.
            </Typography>

            {snack && <Alert severity={snack.sev} onClose={() => setSnack(null)} sx={{ mb: 2 }}>{snack.msg}</Alert>}

            <Stack direction="row" spacing={2} sx={{ mb: 3, flexWrap: 'wrap', gap: 1 }}>
                <Tile label="Balance (credits)" value={w.balance} color="primary.main" />
                <Tile label="Redeem threshold" value={w.threshold} />
                <Tile label="Per-booking rate" value={w.rate} />
            </Stack>

            <Card sx={{ mb: 3 }}>
                <CardContent>
                    <Typography variant="subtitle2" gutterBottom>Redeem to cash</Typography>
                    {w.eligible ? (
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
                            <TextField
                                size="small" type="number" label="Amount (blank = all)"
                                value={amount} onChange={(e) => setAmount(e.target.value)}
                                inputProps={{ min: 1, max: w.balance }} sx={{ width: 200 }}
                            />
                            <Button variant="contained" startIcon={<PaidIcon />} disabled={redeeming}
                                onClick={() => setConfirm({
                                    title: 'Redeem to cash?',
                                    message: `Redeem ${amount ? `${amount} credits` : `all ${w.balance} credits`} to cash (1 credit = ₹1)? This creates a payout that admin will process.`,
                                    confirmLabel: 'Redeem',
                                    confirmColor: 'primary',
                                    onConfirm: doRedeem,
                                })}>
                                Redeem
                            </Button>
                            <Typography variant="caption" color="text.secondary">
                                Creates a payout in your bills, paid out by admin.
                            </Typography>
                        </Stack>
                    ) : (
                        <Alert severity="info">
                            You need at least <strong>{w.threshold}</strong> credits to redeem
                            (you have {w.balance}).
                        </Alert>
                    )}
                </CardContent>
            </Card>

            <Divider sx={{ mb: 2 }} />
            <Typography variant="subtitle2" gutterBottom>Ledger</Typography>
            {w.ledger.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No second-opinion credit activity yet.</Typography>
            ) : (
                <TableContainer sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Date</TableCell>
                                <TableCell>Type</TableCell>
                                <TableCell>Note</TableCell>
                                <TableCell align="right">Credits</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {w.ledger.map((r, i) => (
                                <TableRow key={i} hover>
                                    <TableCell>{fmtDate(r.date)}</TableCell>
                                    <TableCell>
                                        <Chip size="small"
                                            color={r.amount >= 0 ? 'success' : 'default'}
                                            variant="outlined"
                                            label={r.ref_type === 'second_opinion_redeem' ? 'Redeemed' : 'Earned'} />
                                    </TableCell>
                                    <TableCell>{r.note || '—'}</TableCell>
                                    <TableCell align="right" sx={{ color: r.amount >= 0 ? 'success.main' : 'text.secondary' }}>
                                        {r.amount >= 0 ? '+' : ''}{r.amount}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            <ConfirmDialog data={confirm} onClose={() => setConfirm(null)} busy={redeeming} />
        </Box>
    );
}
