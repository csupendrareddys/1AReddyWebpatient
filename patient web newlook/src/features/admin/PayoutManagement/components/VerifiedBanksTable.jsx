/**
 * VerifiedBanksTable — doctors whose bank account is verified (payout-ready).
 * Shown beside the "Needs Bank Verification" list so the admin sees both the
 * pending and the cleared bank accounts at a glance.
 */
import {
    Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, Chip, Typography, CircularProgress, Stack,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import { useGetVerifiedBanksQuery } from '../../api/payoutEndpoints';

const cell = { fontSize: '0.85rem' };

export default function VerifiedBanksTable() {
    const { data, isLoading } = useGetVerifiedBanksQuery();
    const rows = data?.bank_accounts || [];

    return (
        <Box>
            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                <CheckCircleIcon color="success" fontSize="small" />
                <Typography variant="subtitle1" fontWeight={700}>
                    Verified bank accounts ({rows.length})
                </Typography>
            </Stack>
            <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell><b>Doctor</b></TableCell>
                            <TableCell><b>Account holder</b></TableCell>
                            <TableCell><b>Bank</b></TableCell>
                            <TableCell><b>Account</b></TableCell>
                            <TableCell><b>IFSC</b></TableCell>
                            <TableCell><b>Status</b></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {isLoading ? (
                            <TableRow><TableCell colSpan={6} align="center"><CircularProgress size={22} sx={{ my: 2 }} /></TableCell></TableRow>
                        ) : rows.length === 0 ? (
                            <TableRow><TableCell colSpan={6} align="center">
                                <Typography color="text.secondary" py={2}>No verified bank accounts yet.</Typography>
                            </TableCell></TableRow>
                        ) : rows.map((r) => (
                            <TableRow key={r.id}>
                                <TableCell sx={cell}>
                                    {r.doctor_name || '—'}
                                    {r.is_primary && <Chip label="Primary" size="small" sx={{ ml: 1 }} />}
                                </TableCell>
                                <TableCell sx={cell}>{r.account_holder || '—'}</TableCell>
                                <TableCell sx={cell}>{r.bank_name || '—'}</TableCell>
                                <TableCell sx={cell}>{r.account_number || '—'}</TableCell>
                                <TableCell sx={cell}>{r.ifsc || '—'}</TableCell>
                                <TableCell sx={cell}>
                                    <Chip label="Verified" color="success" size="small" icon={<CheckCircleIcon />} />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
}
