/**
 * CreditRedeem — a checkout control for spending health credits on a booking.
 *
 * Given the offering scope + price, it fetches the server-capped redeemable
 * amount (by the plan's per-offering rule + balance) and lets the patient apply
 * up to that many credits. Reports the applied amount up via ``onChange`` so the
 * parent can lower the payable and send ``redeem_credits`` at booking.
 * Renders nothing when the patient has no credits eligible for this offering.
 */
import { useEffect, useState } from 'react';
import {
    Paper, Box, Stack, Typography, TextField, Button, Chip,
} from '@mui/material';
import RedeemIcon from '@mui/icons-material/Redeem';

import { useGetCreditQuoteQuery } from '../../api/scopedBookingApi';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function CreditRedeem({ offering, price, onChange }) {
    const skip = !offering || !price || Number(price) <= 0;
    const { data: quote } = useGetCreditQuoteQuery(
        { offering, price: Math.round(Number(price) || 0) },
        { skip },
    );
    const max = Math.floor(quote?.max_redeemable || 0);
    const available = quote?.available || 0;
    const [amount, setAmount] = useState(0);

    // Clamp when the max changes (price/offering changed) and report up.
    useEffect(() => {
        const next = Math.min(amount, max);
        if (next !== amount) setAmount(next);
        onChange?.(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [max]);

    if (skip || !quote?.allowed || max <= 0) return null;

    const set = (v) => {
        const clamped = Math.max(0, Math.min(Math.floor(Number(v) || 0), max));
        setAmount(clamped);
        onChange?.(clamped);
    };

    return (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <RedeemIcon color="success" fontSize="small" />
                <Typography variant="subtitle2" fontWeight={700}>Health credits</Typography>
                <Chip size="small" variant="outlined" label={`${money(available)} available`} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                You can use up to <strong>{money(max)}</strong> in credits on this booking.
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                    size="small"
                    type="number"
                    label="Use credits"
                    value={amount}
                    onChange={(e) => set(e.target.value)}
                    inputProps={{ min: 0, max, step: 1 }}
                    sx={{ width: 160 }}
                />
                <Button size="small" onClick={() => set(max)} disabled={amount >= max}>
                    Use max
                </Button>
                {amount > 0 && (
                    <Typography variant="body2" color="success.main" fontWeight={600}>
                        −{money(amount)}
                    </Typography>
                )}
            </Stack>
        </Paper>
    );
}
