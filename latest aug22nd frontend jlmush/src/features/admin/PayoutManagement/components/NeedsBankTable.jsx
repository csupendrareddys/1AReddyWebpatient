/**
 * NeedsBankTable — the "Needs Bank Verification" section of the unified
 * Payout Management page. Unchanged behaviour, extracted verbatim from the
 * page so it composes alongside the compensation-model sections.
 */
import { useState } from 'react';
import {
    Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, TablePagination, CircularProgress, Button, Chip, Typography,
    Tooltip,
} from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import { useGetPayoutsNeedingBankQuery, useRetryPayoutMutation } from '../../api/payoutEndpoints';

const statusColors = {
    on_hold: 'default', claimable: 'secondary', pending: 'warning',
    processing: 'info', completed: 'success', failed: 'error', reversed: 'default',
};
const statusLabels = {
    on_hold: 'On hold', claimable: 'Settled — doctor to collect', pending: 'Pending',
    processing: 'Processing', completed: 'Completed', failed: 'Failed', reversed: 'Reversed',
};
const bankStatusColors = { verified: 'success', pending: 'warning', rejected: 'error', missing: 'default' };

const headerStyle = {
    fontWeight: 700, fontSize: '0.75rem', whiteSpace: 'nowrap',
    backgroundColor: '#f5f5f5', borderRight: '1px solid #e0e0e0',
    borderBottom: '2px solid #bdbdbd', textAlign: 'center', py: 1.5, px: 1,
};
const cellStyle = {
    fontSize: '0.8rem', whiteSpace: 'nowrap', borderRight: '1px solid #e0e0e0',
    textAlign: 'center', py: 1, px: 1,
};

const NeedsBankTable = ({ onNotify }) => {
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(20);
    const { data, isLoading, isFetching } = useGetPayoutsNeedingBankQuery({});
    const [retryPayout] = useRetryPayoutMutation();

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

    return (
        <TableContainer component={Paper} elevation={2} sx={{ border: '1px solid #bdbdbd' }}>
            {(isLoading || isFetching) && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
            )}
            {!isLoading && (
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={headerStyle}>Bill No.</TableCell>
                            <TableCell sx={headerStyle}>Doctor</TableCell>
                            <TableCell sx={headerStyle}>Email</TableCell>
                            <TableCell sx={headerStyle}>Payout Amt</TableCell>
                            <TableCell sx={headerStyle}>Bank Status</TableCell>
                            <TableCell sx={headerStyle}>Payout Status</TableCell>
                            <TableCell sx={{ ...headerStyle, borderRight: 'none' }}>Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {payouts.length === 0 && !isFetching && (
                            <TableRow>
                                <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                    All payouts have verified bank accounts.
                                </TableCell>
                            </TableRow>
                        )}
                        {payouts.map((p) => (
                            <TableRow key={p.id} hover>
                                <TableCell sx={{ ...cellStyle, fontWeight: 600 }}>{p.bill_number}</TableCell>
                                <TableCell sx={cellStyle}>{p.doctor_name || '-'}</TableCell>
                                <TableCell sx={cellStyle}>{p.doctor_email || '-'}</TableCell>
                                <TableCell sx={{ ...cellStyle, fontWeight: 600 }}>{'₹'}{p.payout_amount}</TableCell>
                                <TableCell sx={cellStyle}>
                                    <Chip
                                        label={p.bank_status === 'missing' ? 'No Bank Account' : p.bank_status}
                                        color={bankStatusColors[p.bank_status] || 'default'}
                                        size="small" variant="outlined"
                                    />
                                </TableCell>
                                <TableCell sx={cellStyle}>
                                    <Chip label={statusLabels[p.status] || p.status} color={statusColors[p.status] || 'default'} size="small" />
                                </TableCell>
                                <TableCell sx={{ ...cellStyle, borderRight: 'none' }}>
                                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                                        {p.bank_status === 'missing' && (
                                            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                                                Waiting for doctor to add bank details
                                            </Typography>
                                        )}
                                        {p.bank_account_id && p.bank_status !== 'verified' && p.bank_status !== 'missing' && (
                                            <Tooltip title="Go to View Doctors to verify this doctor's bank account">
                                                <Button
                                                    size="small" variant="outlined"
                                                    startIcon={<AccountBalanceIcon />}
                                                    onClick={() => window.location.href = '/dashboard/admin/doctors'}
                                                >
                                                    Verify in Doctors
                                                </Button>
                                            </Tooltip>
                                        )}
                                        {(p.bank_status === 'verified' || p.bank_account_id) && (
                                            <Tooltip title="Retry Payout (re-checks bank verification)">
                                                <Button
                                                    size="small" variant="contained" color="warning"
                                                    startIcon={<ReplayIcon />}
                                                    onClick={() => handleRetry(p.id)}
                                                >
                                                    Retry
                                                </Button>
                                            </Tooltip>
                                        )}
                                    </Box>
                                </TableCell>
                            </TableRow>
                        ))}
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
    );
};

export default NeedsBankTable;
