/**
 * PerPatientPayoutsTable — one section of the unified Payout Management page.
 * Renders the per-patient DoctorPayout rail (push/retry/update-status), scoped
 * to one compensation model via `billingType` ('plan' | 'consultant') — the
 * server filters and paginates by it (see billing_type param on
 * GET /api/admin/payouts), so totals stay correct per section rather than a
 * client-side filter silently mismatching the pagination count.
 *
 * Employees never earn a per-patient payout (they're salaried — see
 * compensation.py), so there is no 'employee' variant of this table.
 */
import { useState } from 'react';
import {
    Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, TablePagination, CircularProgress, Button, Chip,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
    Grid, Alert, IconButton, Tooltip,
} from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import SendIcon from '@mui/icons-material/Send';
import {
    useGetAdminPayoutsQuery,
    usePushPayoutMutation,
    useRetryPayoutMutation,
} from '../../api/payoutEndpoints';

const statusColors = {
    on_hold: 'default',
    claimable: 'secondary',
    pending: 'warning',
    processing: 'info',
    completed: 'success',
    failed: 'error',
    reversed: 'default',
};

// "Settled" here means the money is owed and released to the doctor — it is NOT
// in their bank yet. Only the doctor's claim sends it, so nothing an admin does
// can show Completed; Cashfree confirms that.
const statusLabels = {
    on_hold: 'On hold',
    claimable: 'Settled — doctor to collect',
    pending: 'Pending',
    processing: 'Processing',
    completed: 'Completed',
    failed: 'Failed',
    reversed: 'Reversed',
};

const headerStyle = {
    fontWeight: 700, fontSize: '0.75rem', whiteSpace: 'nowrap',
    backgroundColor: '#f5f5f5', borderRight: '1px solid #e0e0e0',
    borderBottom: '2px solid #bdbdbd', textAlign: 'center', py: 1.5, px: 1,
};

const cellStyle = {
    fontSize: '0.8rem', whiteSpace: 'nowrap', borderRight: '1px solid #e0e0e0',
    textAlign: 'center', py: 1, px: 1,
};

const PerPatientPayoutsTable = ({ billingType, sourceType, title, emptyMessage, onNotify }) => {
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(20);
    const [statusFilter, setStatusFilter] = useState('');

    const params = {
        page: page + 1, per_page: rowsPerPage,
        ...(billingType ? { billing_type: billingType } : {}),
        ...(sourceType ? { source_type: sourceType } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
    };
    const { data, isLoading, isFetching } = useGetAdminPayoutsQuery(params);
    const [retryPayout] = useRetryPayoutMutation();
    const [pushPayout, { isLoading: isPushing }] = usePushPayoutMutation();

    const payouts = data?.payouts || [];
    const pagination = data?.pagination || {};

    const handleRetry = async (payoutId) => {
        try {
            const res = await retryPayout({ payoutId }).unwrap();
            onNotify(res.message || 'Payout retried successfully');
        } catch (err) {
            onNotify(err?.data?.message || 'Retry failed', 'error');
        }
    };

    const handlePush = async (payoutId) => {
        try {
            const res = await pushPayout({ payoutId }).unwrap();
            onNotify(res.message || 'Pushed to the doctor to collect');
        } catch (err) {
            onNotify(err?.data?.message || 'Push failed', 'error');
        }
    };

    return (
        <Box>
            {title && (
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>{title}</Typography>
            )}
            <Paper sx={{ p: 2, mb: 2 }} elevation={1}>
                <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} sm={3}>
                        <TextField
                            select fullWidth label="Filter by Status" value={statusFilter}
                            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
                            size="small"
                        >
                            <MenuItem value="">All</MenuItem>
                            <MenuItem value="pending">Pending</MenuItem>
                            <MenuItem value="on_hold">On hold</MenuItem>
                            <MenuItem value="claimable">Settled — doctor to collect</MenuItem>
                            <MenuItem value="processing">Processing</MenuItem>
                            <MenuItem value="completed">Completed</MenuItem>
                            <MenuItem value="failed">Failed</MenuItem>
                        </TextField>
                    </Grid>
                </Grid>
            </Paper>

            <TableContainer component={Paper} elevation={2} sx={{ border: '1px solid #bdbdbd' }}>
                {(isLoading || isFetching) && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
                )}
                {!isLoading && (
                    <Table size="small" stickyHeader>
                        <TableHead>
                            {/* Same itemised ledger the doctor sees in My Bills →
                                Billing Breakdown, plus the admin-only Doctor /
                                Status / Actions columns. */}
                            <TableRow>
                                <TableCell sx={headerStyle}>Bill No.</TableCell>
                                <TableCell sx={headerStyle}>Doctor</TableCell>
                                <TableCell sx={headerStyle}>Appt ID</TableCell>
                                <TableCell sx={headerStyle}>Appt Amount</TableCell>
                                <TableCell sx={headerStyle}>Payment Amt</TableCell>
                                <TableCell sx={headerStyle}>Taxes (GST)</TableCell>
                                <TableCell sx={headerStyle}>Charge 1</TableCell>
                                <TableCell sx={headerStyle}>Charge 2</TableCell>
                                <TableCell sx={headerStyle}>Charge 3</TableCell>
                                <TableCell sx={headerStyle}>Total Charges</TableCell>
                                <TableCell sx={headerStyle}>Payment −<br />Charges</TableCell>
                                <TableCell sx={headerStyle}>TDS</TableCell>
                                <TableCell sx={headerStyle}>Razorpay Fee</TableCell>
                                <TableCell sx={headerStyle}>Final Payout</TableCell>
                                <TableCell sx={headerStyle}>Status</TableCell>
                                <TableCell sx={{ ...headerStyle, borderRight: 'none' }}>Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {payouts.length === 0 && !isFetching && (
                                <TableRow>
                                    <TableCell colSpan={16} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                        {emptyMessage || 'No payouts found.'}
                                    </TableCell>
                                </TableRow>
                            )}
                            {payouts.map((p) => {
                                // Same derivation as the doctor's ledger: payment
                                // minus the summed platform charges.
                                const paymentMinusCharges = (
                                    Number(p.payment_amount || 0) - Number(p.total_charges || 0)
                                ).toFixed(2);
                                return (
                                <TableRow key={p.id} hover>
                                    <TableCell sx={{ ...cellStyle, fontWeight: 600 }}>{p.bill_number}</TableCell>
                                    <TableCell sx={cellStyle}>{p.doctor_name || '-'}</TableCell>
                                    <TableCell sx={{ ...cellStyle, fontSize: '0.7rem' }}>{p.appointment_id}</TableCell>
                                    <TableCell sx={cellStyle}>{'₹'}{p.appointment_amount}</TableCell>
                                    <TableCell sx={cellStyle}>{'₹'}{p.payment_amount}</TableCell>
                                    <TableCell sx={cellStyle}>{'₹'}{p.taxes_gst}</TableCell>
                                    <TableCell sx={cellStyle}>{'₹'}{p.charge1_amount}</TableCell>
                                    <TableCell sx={cellStyle}>{'₹'}{p.charge2_amount}</TableCell>
                                    <TableCell sx={cellStyle}>{'₹'}{p.charge3_amount}</TableCell>
                                    <TableCell sx={cellStyle}>{'₹'}{p.total_charges}</TableCell>
                                    <TableCell sx={cellStyle}>{'₹'}{paymentMinusCharges}</TableCell>
                                    <TableCell sx={cellStyle}>{'₹'}{p.tds_amount}</TableCell>
                                    <TableCell sx={cellStyle}>{'₹'}{p.razorpay_fee}</TableCell>
                                    <TableCell sx={{ ...cellStyle, fontWeight: 700, color: '#2e7d32' }}>
                                        {'₹'}{p.payout_amount}
                                    </TableCell>
                                    <TableCell sx={cellStyle}>
                                        <Chip label={statusLabels[p.status] || p.status} color={statusColors[p.status] || 'default'} size="small" />
                                    </TableCell>
                                    <TableCell sx={{ ...cellStyle, borderRight: 'none' }}>
                                        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                                            {(p.status === 'on_hold' || p.status === 'pending') && (
                                                <Tooltip title={
                                                    p.hold_until && new Date(p.hold_until) > new Date()
                                                        ? `On hold until ${new Date(p.hold_until).toLocaleDateString()} — you can release it early`
                                                        : 'Release to the doctor to collect. This does not send money.'
                                                }>
                                                    <span>
                                                        <Button
                                                            size="small" variant="contained" color="secondary"
                                                            startIcon={<SendIcon />} disabled={isPushing}
                                                            onClick={() => handlePush(p.id)}
                                                        >
                                                            Push to doctor
                                                        </Button>
                                                    </span>
                                                </Tooltip>
                                            )}
                                            {p.status === 'claimable' && (
                                                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                                                    Waiting for the doctor to collect
                                                </Typography>
                                            )}
                                            {/* No manual status override: a settled/completed payout must
                                                not be reversible to pending/failed. Only Retry (for a
                                                pending/failed payout) remains. */}
                                            {(p.status === 'pending' || p.status === 'failed') && (
                                                <Tooltip title="Retry Payout">
                                                    <IconButton size="small" color="warning" onClick={() => handleRetry(p.id)}>
                                                        <ReplayIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                        </Box>
                                    </TableCell>
                                </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
                <TablePagination
                    component="div" count={pagination.total || 0}
                    page={page} onPageChange={(e, p) => setPage(p)}
                    rowsPerPage={rowsPerPage}
                    onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                    rowsPerPageOptions={[10, 20, 50]}
                />
            </TableContainer>
        </Box>
    );
};

export default PerPatientPayoutsTable;
