import {
    Alert, Box, Button, Chip, CircularProgress, Container, LinearProgress,
    Link, List, ListItem, ListItemIcon, ListItemText, Paper, Stack, Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useNavigate } from 'react-router-dom';

import usePrimedQuery from '../../../../common/hooks/usePrimedQuery';
import { useGetTenantOnboardingQuery } from '../../api/tenantDomainEndpoints';
import DnsRecordsTable from '../components/DnsRecordsTable';

// Where each step actually gets done. Keyed to the backend's step keys so
// adding a step there only needs a destination here, not a UI rewrite.
const STEP_ACTIONS = {
    branding: { label: 'Edit branding', to: '/dashboard/admin/landing-config' },
    team: { label: 'Manage team', to: '/dashboard/admin/manage-admins' },
    providers: { label: 'Add people', to: '/dashboard/admin/doctors' },
    custom_domain: { label: 'Set up domain', to: '/dashboard/admin/domain' },
};

/**
 * First-run page: is my site live, and what should I do next?
 *
 * A new tenant used to be dropped straight into an empty dashboard with no
 * indication of whether their portal was reachable — the one thing they
 * actually want to know right after paying.
 *
 * Every step is derived from real rows server-side, so the list completes
 * itself as the tenant uses the product. There is no separate progress
 * table to fall out of sync with reality, and nothing to mark "done" by
 * hand.
 */
export default function Onboarding() {
    const navigate = useNavigate();
    const q = useGetTenantOnboardingQuery();
    const { data, settled } = usePrimedQuery(q);

    if (!settled) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!data) {
        return (
            <Container maxWidth="md" sx={{ mt: 4 }}>
                <Alert severity="error">Unable to load your setup status.</Alert>
            </Container>
        );
    }

    const { tenant, domain, plan, steps = [], complete } = data;
    const done = steps.filter((s) => s.done).length;
    const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
    const liveUrl = domain?.live_url;
    const pendingRecords = domain?.records_to_publish || [];

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 8 }}>
            <Typography variant="h5" gutterBottom>
                Welcome{tenant?.name ? `, ${tenant.name}` : ''}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {complete
                    ? 'Your portal is set up. This page stays here as a reference.'
                    : 'A few things left to get your portal ready.'}
            </Typography>

            {/* Is it live? — the first question a new customer has. */}
            <Paper sx={{ p: 3, mb: 3 }}>
                <Stack
                    direction={{ xs: 'column', sm: 'row' }} spacing={2}
                    alignItems={{ sm: 'center' }} justifyContent="space-between"
                >
                    <Box>
                        <Typography variant="overline" color="text.secondary">
                            Your portal
                        </Typography>
                        {liveUrl ? (
                            <Typography variant="h6">
                                <Link
                                    href={liveUrl} target="_blank" rel="noreferrer"
                                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                                >
                                    {liveUrl.replace(/^https?:\/\//, '')}
                                    <OpenInNewIcon fontSize="inherit" />
                                </Link>
                            </Typography>
                        ) : (
                            <Typography variant="h6" color="text.secondary">
                                Still being set up
                            </Typography>
                        )}
                    </Box>
                    <Stack direction="row" spacing={1}>
                        {plan?.code && (
                            <Chip size="small" label={`Plan: ${plan.code}`} />
                        )}
                        {plan?.status && (
                            <Chip
                                size="small"
                                label={plan.status}
                                color={plan.status === 'active' ? 'success' : 'warning'}
                            />
                        )}
                    </Stack>
                </Stack>

                {/* Only shown while something is genuinely outstanding — a
                    permanent "add these records" block on a working site
                    reads as an unresolved problem. */}
                {pendingRecords.length > 0 && (
                    <DnsRecordsTable records={pendingRecords} />
                )}
            </Paper>

            <Paper sx={{ p: 3 }}>
                <Stack
                    direction="row" justifyContent="space-between"
                    alignItems="center" sx={{ mb: 1 }}
                >
                    <Typography variant="h6">Setup</Typography>
                    <Typography variant="body2" color="text.secondary">
                        {done} of {steps.length}
                    </Typography>
                </Stack>
                <LinearProgress
                    variant="determinate" value={pct}
                    sx={{ mb: 2, height: 8, borderRadius: 4 }}
                />

                <List disablePadding>
                    {steps.map((s) => {
                        const action = STEP_ACTIONS[s.key];
                        return (
                            <ListItem
                                key={s.key}
                                divider
                                secondaryAction={
                                    action && !s.done ? (
                                        <Button
                                            size="small"
                                            onClick={() => navigate(action.to)}
                                        >
                                            {action.label}
                                        </Button>
                                    ) : null
                                }
                            >
                                <ListItemIcon sx={{ minWidth: 40 }}>
                                    {s.done
                                        ? <CheckCircleIcon color="success" />
                                        : <RadioButtonUncheckedIcon color="disabled" />}
                                </ListItemIcon>
                                <ListItemText
                                    primary={s.label}
                                    secondary={s.detail || null}
                                    sx={{
                                        '& .MuiListItemText-primary': {
                                            color: s.done ? 'text.secondary' : 'text.primary',
                                        },
                                    }}
                                />
                            </ListItem>
                        );
                    })}
                </List>
            </Paper>
        </Container>
    );
}
