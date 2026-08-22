/**
 * SalaryPayoutsTable — the Employee / Consultancy sections of the unified
 * Payout Management page. Lists SalaryPayout rows tenant-wide, scoped to one
 * `kind` ('salary' for employees, 'retainer' for consultants), with the same
 * Adjust / Push / Withhold controls and audit-trail rendering as the
 * per-doctor editor (EmploymentAgreementEditor.jsx) — this is the same data,
 * just viewed across every doctor instead of one at a time.
 *
 * Generating a NEW salary/retainer for a period is still done per-doctor from
 * Profile & Schedule → Analytics & Settings → Admin: Payout (the doctor's
 * billing config lives there); this page is the tenant-wide OPERATE/settle
 * surface once a payout exists.
 */
import { useState } from 'react';
import {
    Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, CircularProgress, Button, Chip, Dialog, DialogTitle,
    DialogContent, DialogActions, TextField, MenuItem, Stack, Alert,
} from '@mui/material';
import {
    useGetSalaryPayoutsQuery,
    useAdjustSalaryPayoutMutation,
    usePushSalaryPayoutMutation,
    useUpdateSalaryStatusMutation,
} from '../../api/doctorBillingEndpoints';

const ADJUST_KINDS = [
    { value: 'lwp', label: 'Leave Without Pay' },
    { value: 'penalty', label: 'Penalty' },
    { value: 'bonus', label: 'Bonus' },
    { value: 'correction', label: 'Manual Correction' },
];

// Salary rows use the same PayoutStatus enum as the per-patient rail, but the
// labels here are salary-appropriate rather than borrowed per-patient wording
// ("Ready to Claim" reads oddly for a "Settled" salary row).
const statusColors = {
    on_hold: 'default', pending: 'warning', claimable: 'secondary',
    processing: 'info', completed: 'success', failed: 'error', reversed: 'default',
};
const statusLabels = {
    on_hold: 'On hold', pending: 'Pending (not yet pushed)', claimable: 'Pushed — doctor to claim',
    processing: 'Processing', completed: 'Paid', failed: 'Failed', reversed: 'Reversed',
};

const headerStyle = {
    fontWeight: 700, fontSize: '0.75rem', whiteSpace: 'nowrap',
    backgroundColor: '#f5f5f5', borderRight: '1px solid #e0e0e0',
    borderBottom: '2px solid #bdbdbd', textAlign: 'center', py: 1.5, px: 1,
};
const cellStyle = {
    fontSize: '0.8rem', borderRight: '1px solid #e0e0e0', textAlign: 'center', py: 1, px: 1,
};

const SalaryPayoutsTable = ({ kind, title, emptyMessage, onNotify }) => {
    // No params: the backend doesn't filter by `kind` (it's a plain row
    // field, not indexed query criteria), so calling with the same empty
    // params here as the Employee and Consultancy sections both do means RTK
    // Query shares one cached fetch of the full tenant-wide list between them
    // instead of hitting the API twice for what is the same underlying data.
    const { data: rows = [], isLoading, isFetching } = useGetSalaryPayoutsQuery();
    const [adjustSalary, { isLoading: adjusting }] = useAdjustSalaryPayoutMutation();
    const [pushSalary, { isLoading: pushing }] = usePushSalaryPayoutMutation();
    const [updateSalary] = useUpdateSalaryStatusMutation();

    const [adjustFor, setAdjustFor] = useState(null);
    const [adjustForm, setAdjustForm] = useState({ amount: '', kind: 'lwp', reason: '' });

    const filtered = rows.filter((r) => r.kind === kind);

    const openAdjust = (row) => {
        setAdjustFor(row);
        setAdjustForm({ amount: '', kind: 'lwp', reason: '' });
    };

    const submitAdjust = async () => {
        const amt = parseFloat(adjustForm.amount);
        if (!amt) { onNotify('Enter a non-zero amount', 'warning'); return; }
        if (!adjustForm.reason.trim()) { onNotify('A reason is required', 'warning'); return; }
        const signed = ['lwp', 'penalty'].includes(adjustForm.kind) ? -Math.abs(amt) : Math.abs(amt);
        try {
            await adjustSalary({
                id: adjustFor.id, amount: signed,
                kind: adjustForm.kind, reason: adjustForm.reason.trim(),
            }).unwrap();
            onNotify('Adjustment recorded');
            setAdjustFor(null);
        } catch (err) {
            onNotify(err?.data?.error || err?.data?.message || 'Adjustment failed', 'error');
        }
    };

    const handlePush = async (row) => {
        try {
            const res = await pushSalary({ id: row.id }).unwrap();
            onNotify(res.message || 'Pushed to the doctor to collect');
        } catch (err) {
            onNotify(err?.data?.error || err?.data?.message || 'Push failed', 'error');
        }
    };

    const handleWithholdToggle = async (row) => {
        try {
            await updateSalary({ id: row.id, compliance_withheld: !row.compliance_withheld }).unwrap();
            onNotify(row.compliance_withheld ? 'Released' : 'Withheld for compliance');
        } catch (err) {
            onNotify(err?.data?.message || 'Failed', 'error');
        }
    };

    return (
        <Box>
            {title && (
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>{title}</Typography>
            )}
            <TableContainer component={Paper} elevation={2} sx={{ border: '1px solid #bdbdbd' }}>
                {(isLoading || isFetching) && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
                )}
                {!isLoading && (
                    <Table size="small" stickyHeader>
                        <TableHead>
                            <TableRow>
                                <TableCell sx={headerStyle}>Doctor</TableCell>
                                <TableCell sx={headerStyle}>Period</TableCell>
                                <TableCell sx={headerStyle}>Base (original)</TableCell>
                                <TableCell sx={headerStyle}>Adjustments</TableCell>
                                <TableCell sx={headerStyle}>Net (approved)</TableCell>
                                <TableCell sx={headerStyle}>Status</TableCell>
                                <TableCell sx={{ ...headerStyle, borderRight: 'none' }}>Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {filtered.length === 0 && !isFetching && (
                                <TableRow>
                                    <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                        {emptyMessage || 'No payouts found.'}
                                    </TableCell>
                                </TableRow>
                            )}
                            {filtered.map((s) => {
                                const adjusted = Number(s.adjustments_total || 0) !== 0;
                                const adjustable = ['pending', 'on_hold'].includes(s.status);
                                return (
                                    <TableRow key={s.id} hover>
                                        <TableCell sx={cellStyle}>{s.doctor_name || '-'}</TableCell>
                                        <TableCell sx={{ ...cellStyle, whiteSpace: 'nowrap' }}>
                                            {s.period_start} → {s.period_end}
                                        </TableCell>
                                        <TableCell sx={cellStyle}>{'₹'}{s.gross_salary}</TableCell>
                                        <TableCell sx={{ ...cellStyle, color: adjusted ? (Number(s.adjustments_total) < 0 ? '#c62828' : '#2e7d32') : 'inherit' }}>
                                            {adjusted ? `${Number(s.adjustments_total) > 0 ? '+' : ''}₹${s.adjustments_total}` : '—'}
                                        </TableCell>
                                        <TableCell sx={{ ...cellStyle, fontWeight: 700 }}>{'₹'}{s.net_amount}</TableCell>
                                        <TableCell sx={cellStyle}>
                                            <Stack spacing={0.5} alignItems="center">
                                                <Chip label={statusLabels[s.status] || s.status} color={statusColors[s.status] || 'default'} size="small" />
                                                {s.compliance_withheld && <Chip label="Withheld" size="small" color="error" variant="outlined" />}
                                            </Stack>
                                        </TableCell>
                                        <TableCell sx={{ ...cellStyle, borderRight: 'none' }}>
                                            <Stack direction="row" spacing={0.5} justifyContent="center" flexWrap="wrap" useFlexGap>
                                                {adjustable && (
                                                    <Button size="small" onClick={() => openAdjust(s)}>Adjust</Button>
                                                )}
                                                {adjustable && (
                                                    <Button size="small" variant="contained" color="secondary"
                                                        disabled={s.compliance_withheld || pushing}
                                                        onClick={() => handlePush(s)}>
                                                        Push
                                                    </Button>
                                                )}
                                                {s.status === 'claimable' && (
                                                    <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                                                        Waiting for the doctor to collect
                                                    </Typography>
                                                )}
                                                <Button size="small" color={s.compliance_withheld ? 'primary' : 'error'}
                                                    onClick={() => handleWithholdToggle(s)}>
                                                    {s.compliance_withheld ? 'Release' : 'Withhold'}
                                                </Button>
                                            </Stack>
                                            {(s.adjustments || []).map((a) => (
                                                <Typography key={a.id} variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                                    {Number(a.amount) < 0 ? '−' : '+'}₹{Math.abs(Number(a.amount))} · {a.kind} · {a.reason}
                                                    {a.created_by_name ? ` — ${a.created_by_name}` : ''}
                                                    {a.created_at ? ` (${new Date(a.created_at).toLocaleDateString()})` : ''}
                                                </Typography>
                                            ))}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </TableContainer>

            <Dialog open={!!adjustFor} onClose={() => setAdjustFor(null)} maxWidth="xs" fullWidth>
                <DialogTitle>Adjust {kind === 'retainer' ? 'retainer' : 'salary'} — {adjustFor?.doctor_name}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <Alert severity="info">
                            The original amount of ₹{adjustFor?.gross_salary} is kept. This is
                            recorded as a separate, permanent entry the doctor can see.
                        </Alert>
                        <TextField select label="Type" size="small" value={adjustForm.kind}
                            onChange={(e) => setAdjustForm((f) => ({ ...f, kind: e.target.value }))}>
                            {ADJUST_KINDS.map((k) => (
                                <MenuItem key={k.value} value={k.value}>{k.label}</MenuItem>
                            ))}
                        </TextField>
                        <TextField label="Amount (₹)" type="number" size="small" value={adjustForm.amount}
                            onChange={(e) => setAdjustForm((f) => ({ ...f, amount: e.target.value }))}
                            helperText={['lwp', 'penalty'].includes(adjustForm.kind)
                                ? 'Entered as a positive number; it will be deducted.'
                                : 'Will be added to the payout.'} />
                        <TextField label="Reason (required)" size="small" multiline rows={2}
                            value={adjustForm.reason} required
                            onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))}
                            placeholder="e.g. Leave Without Pay (2 Days)" />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAdjustFor(null)}>Cancel</Button>
                    <Button variant="contained" onClick={submitAdjust} disabled={adjusting}>
                        {adjusting ? 'Saving…' : 'Record adjustment'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default SalaryPayoutsTable;
