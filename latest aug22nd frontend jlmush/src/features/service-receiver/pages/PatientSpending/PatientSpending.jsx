/**
 * PatientSpending — the patient's spending: a table of every payment they made
 * (consultation, service, health-plan installment, membership) with a
 * total-paid summary.
 */
import {
    Box, Container, Typography, Paper, Table, TableHead, TableBody, TableRow,
    TableCell, Chip, CircularProgress, Alert, Stack, Divider,
} from '@mui/material';
import PaymentsIcon from '@mui/icons-material/Payments';
import MedicalServicesIcon from '@mui/icons-material/MedicalServices';
import StorefrontIcon from '@mui/icons-material/Storefront';
import GroupsIcon from '@mui/icons-material/Groups';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';

import RedeemIcon from '@mui/icons-material/Redeem';
import { useGetSpendingQuery, useGetCreditsQuery } from '../../api/scopedBookingApi';

const KIND_META = {
    consultation: { label: 'Consultation', icon: <MedicalServicesIcon fontSize="small" />, color: 'primary' },
    service: { label: 'Service', icon: <StorefrontIcon fontSize="small" />, color: 'secondary' },
    health_plan: { label: 'Health plan', icon: <GroupsIcon fontSize="small" />, color: 'success' },
    membership: { label: 'Membership', icon: <WorkspacePremiumIcon fontSize="small" />, color: 'warning' },
    other: { label: 'Payment', icon: <PaymentsIcon fontSize="small" />, color: 'default' },
};
const STATUS_COLOR = {
    success: 'success', pending: 'warning', processing: 'info',
    authorized: 'info', failed: 'error', refunded: 'default',
};
const money = (n, c = 'INR') => `${c === 'INR' ? '₹' : ''}${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function PatientSpending() {
    const { data, isLoading, error } = useGetSpendingQuery();
    const { data: credits } = useGetCreditsQuery();
    const payments = data?.payments || [];
    const total = data?.total_spent || 0;
    const creditBalance = credits?.available || 0;
    const creditExpiry = credits?.wallet?.period_end;

    return (
        <Container maxWidth="lg" sx={{ mt: 3, mb: 6 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
                <PaymentsIcon color="primary" />
                <Typography variant="h4" fontWeight={700}>My Spending</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Every payment you’ve made — consultations, services, health plans and membership.
            </Typography>

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
            ) : error ? (
                <Alert severity="error">Couldn’t load your spending.</Alert>
            ) : (
                <>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
                        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, flex: 1 }}>
                            <Typography variant="overline" color="text.secondary">Total paid</Typography>
                            <Typography variant="h4" fontWeight={800}>{money(total)}</Typography>
                            <Divider sx={{ my: 1 }} />
                            <Typography variant="caption" color="text.secondary">
                                {payments.filter((p) => p.status === 'success').length} successful payment(s)
                                {payments.length > payments.filter((p) => p.status === 'success').length
                                    ? ` · ${payments.length} total records` : ''}
                            </Typography>
                        </Paper>
                        {creditBalance > 0 && (
                            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, flex: 1 }}>
                                <Stack direction="row" spacing={0.75} alignItems="center">
                                    <RedeemIcon color="success" fontSize="small" />
                                    <Typography variant="overline" color="text.secondary">Health credits</Typography>
                                </Stack>
                                <Typography variant="h4" fontWeight={800} color="success.main">{money(creditBalance)}</Typography>
                                <Divider sx={{ my: 1 }} />
                                <Typography variant="caption" color="text.secondary">
                                    Spendable on eligible bookings
                                    {creditExpiry ? ` · resets ${fmtDate(creditExpiry)}` : ''}
                                </Typography>
                            </Paper>
                        )}
                    </Stack>

                    <Paper variant="outlined" sx={{ borderRadius: 2, overflowX: 'auto' }}>
                        {payments.length === 0 ? (
                            <Alert severity="info" sx={{ m: 2 }}>You haven’t made any payments yet.</Alert>
                        ) : (
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Date</TableCell>
                                        <TableCell>Type</TableCell>
                                        <TableCell>For</TableCell>
                                        <TableCell align="right">Amount</TableCell>
                                        <TableCell>Status</TableCell>
                                        <TableCell>Method</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {payments.map((p) => {
                                        const km = KIND_META[p.kind] || KIND_META.other;
                                        return (
                                            <TableRow key={p.id} hover>
                                                <TableCell>{fmtDate(p.date)}</TableCell>
                                                <TableCell>
                                                    <Chip size="small" icon={km.icon} label={km.label} color={km.color} variant="outlined" />
                                                </TableCell>
                                                <TableCell>{p.label}</TableCell>
                                                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                                                    {money(p.amount, p.currency)}
                                                </TableCell>
                                                <TableCell>
                                                    <Chip size="small" label={p.status}
                                                        color={STATUS_COLOR[p.status] || 'default'}
                                                        sx={{ textTransform: 'capitalize' }} />
                                                </TableCell>
                                                <TableCell sx={{ textTransform: 'capitalize' }}>{p.method || '—'}</TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        )}
                    </Paper>
                </>
            )}
        </Container>
    );
}
