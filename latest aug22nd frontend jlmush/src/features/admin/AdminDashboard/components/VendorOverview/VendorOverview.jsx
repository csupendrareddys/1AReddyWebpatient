/**
 * VendorOverview — the SaaS seller's dashboard home.
 *
 * The vendor's business is TENANTS, not patients — so its dashboard leads
 * with the customer book: how many tenants sit in each subscription state,
 * who signed up recently, and who needs attention (past due / suspended).
 * Rendered only when ``showPlatformConsole`` (platform owner on the
 * vendor host); tenant admins keep the product dashboard.
 */
import { useMemo } from 'react';
import {
    Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table,
    TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useNavigate } from 'react-router-dom';

import usePrimedQuery from '../../../../../common/hooks/usePrimedQuery';
import { useListPlatformTenantsQuery } from '../../../api/platformEndpoints';

const STATUS_COLOR = {
    active: 'success',
    trial: 'info',
    over_limit: 'warning',
    past_due: 'warning',
    suspended: 'error',
    cancelled: 'default',
};

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
}) : '—');

function StatTile({ label, value, tone }) {
    return (
        <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 120 }}>
            <Typography variant="h4" color={tone || 'text.primary'}>
                {value}
            </Typography>
            <Typography variant="body2" color="text.secondary">{label}</Typography>
        </Paper>
    );
}

export default function VendorOverview() {
    const navigate = useNavigate();
    // usePrimedQuery: the plain subscription can wedge at status 'pending'
    // in dev (see frontend CLAUDE.md) — prime imperatively like the other
    // list surfaces.
    const q = useListPlatformTenantsQuery();
    const { data, settled } = usePrimedQuery(q);
    const isLoading = !settled;
    const isError = settled && !data;

    const { rows, counts } = useMemo(() => {
        const tenants = (Array.isArray(data) ? data : data?.data || [])
            .filter((t) => !t.is_platform);
        const counts = { total: tenants.length, trial: 0, active: 0,
            attention: 0 };
        for (const t of tenants) {
            const st = t.subscription?.status;
            if (st === 'trial') counts.trial += 1;
            else if (st === 'active') counts.active += 1;
            if (['past_due', 'suspended', 'over_limit'].includes(st)) {
                counts.attention += 1;
            }
        }
        const rows = [...tenants]
            .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
            .slice(0, 8);
        return { rows, counts };
    }, [data]);

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress size={28} />
            </Box>
        );
    }
    if (isError) {
        return (
            <Alert severity="error" sx={{ mb: 3 }}>
                Unable to load the tenants overview.
            </Alert>
        );
    }

    return (
        <Box sx={{ mb: 3 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                <BusinessIcon color="primary" fontSize="small" />
                <Typography variant="h6">Your tenants</Typography>
                <Box sx={{ flex: 1 }} />
                <Button size="small" endIcon={<OpenInNewIcon />}
                    onClick={() => navigate('/dashboard/platform/tenants')}>
                    Manage tenants
                </Button>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
                <StatTile label="Tenants" value={counts.total} />
                <StatTile label="On trial" value={counts.trial} tone="info.main" />
                <StatTile label="Paying" value={counts.active} tone="success.main" />
                <StatTile label="Need attention" value={counts.attention}
                    tone={counts.attention ? 'error.main' : 'text.primary'} />
            </Stack>

            <Paper variant="outlined">
                <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Tenant</TableCell>
                                <TableCell>Plan</TableCell>
                                <TableCell>Billing</TableCell>
                                <TableCell>Paid / trial until</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map((t) => {
                                const sub = t.subscription;
                                const until = sub?.status === 'trial'
                                    ? sub?.trial_ends_at : sub?.current_period_end;
                                return (
                                    <TableRow key={t.id} hover sx={{ cursor: 'pointer' }}
                                        onClick={() => navigate(`/dashboard/platform/tenants/${t.id}/entitlements`)}>
                                        <TableCell>
                                            <Typography variant="body2">{t.name}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {t.slug}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>{sub?.plan_code || '—'}</TableCell>
                                        <TableCell>
                                            {sub ? (
                                                <Chip size="small" label={sub.status}
                                                    color={STATUS_COLOR[sub.status] || 'default'} />
                                            ) : (
                                                <Chip size="small" label="no subscription"
                                                    variant="outlined" />
                                            )}
                                        </TableCell>
                                        <TableCell>{fmtDate(until)}</TableCell>
                                    </TableRow>
                                );
                            })}
                            {rows.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={4}>
                                        <Typography variant="body2" color="text.secondary">
                                            No tenants yet — create one from Manage
                                            tenants, or share your pricing page.
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>
        </Box>
    );
}
