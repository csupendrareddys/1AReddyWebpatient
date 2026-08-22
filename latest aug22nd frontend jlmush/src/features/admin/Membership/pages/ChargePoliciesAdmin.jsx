/**
 * ChargePoliciesAdmin — the dedicated surface for each membership plan's three
 * platform charges (commission fees c1/c2/c3) and their per-charge tax.
 *
 * Kept OFF the plan dialog on purpose (mirrors Health Credits): charges edited
 * here take effect on the NEXT payout for every doctor on the plan — the backend
 * reads the live ChargePolicy by plan at payout time, so retuning never needs a
 * plan re-version or a renewal. Existing payouts keep their snapshotted amounts.
 */
import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
    Box, Paper, Typography, Stack, Chip, TextField, Switch, Button, Divider,
    Table, TableHead, TableBody, TableRow, TableCell, CircularProgress,
    Alert, FormControlLabel, MenuItem,
} from '@mui/material';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';

import { setSnackbar } from '../../redux/adminSharedUiSlice';
import {
    useListChargePoliciesQuery,
    useUpsertChargePolicyMutation,
} from '../../api/membershipEndpoints';

const CHARGES = [1, 2, 3];
const num = (v) => (v === '' || v == null ? 0 : Number(v));

function ChargePolicyCard({ row }) {
    const dispatch = useDispatch();
    const [save, { isLoading }] = useUpsertChargePolicyMutation();

    const seed = () => {
        const p = row.policy || {};
        const d = { is_active: p.is_active ?? true };
        CHARGES.forEach((i) => {
            d[`charge${i}_name`] = p[`charge${i}_name`] ?? `Charge ${i}`;
            d[`charge${i}_type`] = p[`charge${i}_type`] ?? 'percentage';
            d[`charge${i}_value`] = p[`charge${i}_value`] ?? 0;
            d[`charge${i}_tax_type`] = p[`charge${i}_tax_type`] ?? 'percentage';
            d[`charge${i}_tax_value`] = p[`charge${i}_tax_value`] ?? 0;
        });
        return d;
    };
    const [draft, setDraft] = useState(seed);

    useEffect(() => {
        setDraft(seed());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(row.policy)]);

    const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

    const onSave = async () => {
        try {
            await save({ plan_id: row.plan_id, ...draft }).unwrap();
            dispatch(setSnackbar({
                open: true, severity: 'success',
                message: `Charges for "${row.name}" saved — live on the next payout.`,
            }));
        } catch (err) {
            dispatch(setSnackbar({
                open: true, severity: 'error', message: err?.data?.error || 'Save failed',
            }));
        }
    };

    const unit = (type) => (type === 'fixed' ? '₹' : '%');

    return (
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                <ReceiptLongIcon color="primary" />
                <Typography variant="subtitle1" fontWeight={700}>{row.name}</Typography>
                {row.vertical_label && (
                    <Chip size="small" label={row.vertical_label} variant="outlined" />
                )}
                <Chip size="small" label={row.status}
                    color={row.status === 'active' ? 'success' : 'default'} variant="outlined" />
                <Box sx={{ flex: 1 }} />
                <FormControlLabel
                    control={<Switch size="small" checked={!!draft.is_active}
                        onChange={(e) => set('is_active', e.target.checked)} />}
                    label="Charges on"
                />
            </Stack>

            <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Charge name</TableCell>
                            <TableCell>Type</TableCell>
                            <TableCell align="right">Value</TableCell>
                            <TableCell>Tax type</TableCell>
                            <TableCell align="right">Tax value</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {CHARGES.map((i) => {
                            const disabled = !draft.is_active;
                            return (
                                <TableRow key={i}>
                                    <TableCell>
                                        <TextField size="small" disabled={disabled} sx={{ width: 150 }}
                                            value={draft[`charge${i}_name`]}
                                            onChange={(e) => set(`charge${i}_name`, e.target.value)} />
                                    </TableCell>
                                    <TableCell>
                                        <TextField select size="small" disabled={disabled} sx={{ width: 120 }}
                                            value={draft[`charge${i}_type`]}
                                            onChange={(e) => set(`charge${i}_type`, e.target.value)}>
                                            <MenuItem value="percentage">Percentage</MenuItem>
                                            <MenuItem value="fixed">Fixed ₹</MenuItem>
                                        </TextField>
                                    </TableCell>
                                    <TableCell align="right">
                                        <TextField type="number" size="small" disabled={disabled} sx={{ width: 100 }}
                                            value={draft[`charge${i}_value`]}
                                            onChange={(e) => set(`charge${i}_value`, num(e.target.value))}
                                            InputProps={{ endAdornment: <Typography variant="caption">{unit(draft[`charge${i}_type`])}</Typography> }}
                                            inputProps={{ min: 0, step: 0.01 }} />
                                    </TableCell>
                                    <TableCell>
                                        <TextField select size="small" disabled={disabled} sx={{ width: 120 }}
                                            value={draft[`charge${i}_tax_type`]}
                                            onChange={(e) => set(`charge${i}_tax_type`, e.target.value)}>
                                            <MenuItem value="percentage">Percentage</MenuItem>
                                            <MenuItem value="fixed">Fixed ₹</MenuItem>
                                        </TextField>
                                    </TableCell>
                                    <TableCell align="right">
                                        <TextField type="number" size="small" disabled={disabled} sx={{ width: 100 }}
                                            value={draft[`charge${i}_tax_value`]}
                                            onChange={(e) => set(`charge${i}_tax_value`, num(e.target.value))}
                                            InputProps={{ endAdornment: <Typography variant="caption">{unit(draft[`charge${i}_tax_type`])}</Typography> }}
                                            inputProps={{ min: 0, step: 0.01 }} />
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </Box>

            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                    Percentage charges apply to the payout base; each charge's tax applies to that charge.
                </Typography>
                <Button variant="contained" onClick={onSave} disabled={isLoading}>
                    {isLoading ? 'Saving…' : 'Save charges'}
                </Button>
            </Stack>
        </Paper>
    );
}

export default function ChargePoliciesAdmin() {
    const { data: rows = [], isLoading, error } = useListChargePoliciesQuery();

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1000, mx: 'auto' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <ReceiptLongIcon color="primary" />
                <Typography variant="h5" fontWeight={800}>Charges &amp; Taxes</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                Set each plan's platform charges and their per-charge tax. Changes take effect on the
                next payout for every doctor on the plan — no plan re-version, no renewal. Existing
                payouts keep the amounts they were created with.
            </Typography>

            {isLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
            )}
            {error && <Alert severity="error">Couldn’t load charge policies.</Alert>}

            {!isLoading && !error && rows.length === 0 && (
                <Alert severity="info">No membership plans yet — create a plan first.</Alert>
            )}

            <Stack spacing={2}>
                {rows.map((row) => <ChargePolicyCard key={row.plan_id} row={row} />)}
            </Stack>
        </Box>
    );
}
