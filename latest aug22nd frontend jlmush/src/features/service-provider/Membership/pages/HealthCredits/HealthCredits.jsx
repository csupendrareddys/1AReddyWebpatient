/**
 * HealthCredits — provider-facing health-credit wallet.
 *
 * Vertical-agnostic: shared by the doctor, clinic and hospital
 * dashboards (all three route to it). Renders the caller's wallet
 * balance + a recent ledger, from GET /api/membership/me/credits
 * (``useGetMyCreditsQuery`` — role-agnostic on the backend).
 *
 * Previously providers had no wallet surface at all — credits only
 * appeared as a top-bar chip that self-hid at a zero balance — so this
 * page is the "Health Credits" section for providers.
 */
import {
    Alert, Box, Card, CardContent, Chip, CircularProgress, Container,
    Divider, Paper, Stack, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Typography,
} from '@mui/material';
import LoyaltyIcon from '@mui/icons-material/Loyalty';

import { useGetMyCreditsQuery } from '../../api/myMembershipEndpoints';


const prettify = (s) =>
    (s || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

const fmtCredits = (n) => Number(n || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
});

const fmtDate = (iso) => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            day: 'numeric', month: 'short', year: 'numeric',
        });
    } catch {
        return iso;
    }
};


export default function HealthCredits() {
    const { data, isLoading, isError, error, refetch } = useGetMyCreditsQuery();

    const wallet = data?.wallet || null;
    const available = data?.available || 0;
    const ledger = data?.ledger || [];

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 8 }}>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
                <LoyaltyIcon color="primary" sx={{ fontSize: 32 }} />
                <Box>
                    <Typography variant="h5" sx={{ fontWeight: 700 }}>
                        Health Credits
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Your wallet balance and recent activity. Credits are
                        granted by your membership plan and can be redeemed at
                        checkout.
                    </Typography>
                </Box>
            </Stack>

            {isLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                    <CircularProgress />
                </Box>
            )}

            {isError && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={refetch}>
                    Couldn't load your health credits.{' '}
                    {error?.data?.error || error?.data?.message || 'Please refresh.'}
                </Alert>
            )}

            {!isLoading && !isError && (
                <>
                    {/* Balance summary */}
                    <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={2}
                        sx={{ mb: 3 }}
                    >
                        <Paper
                            variant="outlined"
                            sx={{ px: 3, py: 2.5, flex: 1, borderRadius: 2 }}
                        >
                            <Typography variant="overline" color="text.secondary">
                                Available to redeem
                            </Typography>
                            <Typography variant="h3" sx={{ fontWeight: 800, color: 'primary.main' }}>
                                {fmtCredits(available)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                credits
                            </Typography>
                        </Paper>
                        <Paper
                            variant="outlined"
                            sx={{ px: 3, py: 2.5, flex: 1, borderRadius: 2 }}
                        >
                            <Typography variant="overline" color="text.secondary">
                                Wallet balance
                            </Typography>
                            <Typography variant="h4" sx={{ fontWeight: 700 }}>
                                {fmtCredits(wallet?.balance ?? available)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {wallet?.period_end
                                    ? `Expires ${fmtDate(wallet.period_end)}`
                                    : 'No expiry set'}
                            </Typography>
                        </Paper>
                    </Stack>

                    <Card elevation={2} sx={{ borderRadius: 3 }}>
                        <CardContent sx={{ p: 3 }}>
                            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                                Recent activity
                            </Typography>
                            <Divider sx={{ mb: 2 }} />

                            {ledger.length === 0 ? (
                                <Alert severity="info">
                                    No credit activity yet. Credits from your
                                    membership plan will appear here.
                                </Alert>
                            ) : (
                                <TableContainer sx={{ overflowX: 'auto' }}>
                                    <Table size="small">
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>Date</TableCell>
                                                <TableCell>Activity</TableCell>
                                                <TableCell align="right">Amount</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {ledger.map((row) => {
                                                const positive = Number(row.amount) >= 0;
                                                return (
                                                    <TableRow key={row.id} hover>
                                                        <TableCell>{fmtDate(row.created_at)}</TableCell>
                                                        <TableCell>
                                                            <Stack spacing={0.25}>
                                                                <Chip
                                                                    size="small"
                                                                    variant="outlined"
                                                                    label={prettify(row.kind) || 'Adjustment'}
                                                                    sx={{ width: 'fit-content' }}
                                                                />
                                                                {row.note && (
                                                                    <Typography variant="caption" color="text.secondary">
                                                                        {row.note}
                                                                    </Typography>
                                                                )}
                                                            </Stack>
                                                        </TableCell>
                                                        <TableCell
                                                            align="right"
                                                            sx={{
                                                                fontWeight: 700,
                                                                color: positive ? 'success.main' : 'error.main',
                                                                whiteSpace: 'nowrap',
                                                            }}
                                                        >
                                                            {positive ? '+' : ''}{fmtCredits(row.amount)}
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            )}
                        </CardContent>
                    </Card>
                </>
            )}
        </Container>
    );
}
