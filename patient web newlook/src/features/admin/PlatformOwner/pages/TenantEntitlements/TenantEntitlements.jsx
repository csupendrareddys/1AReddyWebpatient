/**
 * TenantEntitlements — single tabbed page for managing one tenant's
 * subscription, add-ons, and permission allocations. Replaces the
 * scattered ``/permissions`` standalone (still there for back-compat)
 * by consolidating everything per-tenant in one place.
 *
 * Tabs:
 *   1. **Subscription** — current plan, billing cycle, change-plan
 *      picker. Read-only override viewer.
 *   2. **Add-ons**     — current attachments + attach/detach.
 *   3. **Permissions** — landing-module × action matrix (existing).
 */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    Alert, Box, Breadcrumbs, Button, Chip, CircularProgress, Container,
    Dialog, DialogActions, DialogContent, DialogTitle, FormControl,
    InputLabel, Link as MLink, MenuItem, Paper, Select, Stack, Tab, Table,
    TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Typography, IconButton,
    Tooltip,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';

import {
    useGetPlatformTenantQuery,
} from '../../../api/platformEndpoints';
import {
    useGetTenantSubscriptionQuery,
    useListAddonsQuery,
    useListPlansQuery,
    useListTenantAddonsQuery,
} from '../../../api/pricingEndpoints';
import { usePricingAdmin } from '../../../Pricing/hooks/usePricingAdmin';
import TenantPermissionsMatrix from '../TenantPermissions/TenantPermissionsMatrix';


const subscriptionStatusColor = {
    active: 'success', ACTIVE: 'success',
    trial: 'info', TRIAL: 'info',
    over_limit: 'warning', OVER_LIMIT: 'warning',
    suspended: 'error', SUSPENDED: 'error',
    cancelled: 'default', CANCELLED: 'default',
};


const SubscriptionTab = ({ tenantId }) => {
    const subQ = useGetTenantSubscriptionQuery(tenantId);
    const plansQ = useListPlansQuery();
    const { handleAssignPlan } = usePricingAdmin();

    const [changeOpen, setChangeOpen] = useState(false);
    const [chosenPlan, setChosenPlan] = useState('');
    const [billingCycle, setBillingCycle] = useState('monthly');

    if (subQ.isLoading || plansQ.isLoading) {
        return <Box sx={{ p: 3 }}><CircularProgress size={20} /></Box>;
    }

    const sub = subQ.data;
    const noSub = subQ.error?.status === 404 || !sub;
    const activePlans = (plansQ.data || []).filter((p) => p.status === 'active');

    const handleChange = async () => {
        if (!chosenPlan) return;
        await handleAssignPlan(tenantId, {
            plan_code: chosenPlan,
            billing_cycle: billingCycle,
        });
        setChangeOpen(false);
        subQ.refetch();
    };

    return (
        <Box sx={{ mt: 2 }}>
            {noSub && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    This tenant has no active subscription. Every PlanService gate will
                    refuse until you assign a plan.
                </Alert>
            )}
            {!noSub && (
                <Paper sx={{ p: 2, mb: 2 }}>
                    <Stack direction="row" spacing={4} alignItems="center" flexWrap="wrap">
                        <Box>
                            <Typography variant="caption" color="text.secondary">Plan</Typography>
                            <Typography variant="h6">{sub.plan_code}</Typography>
                        </Box>
                        <Box>
                            <Typography variant="caption" color="text.secondary">Status</Typography>
                            <Box sx={{ mt: 0.5 }}>
                                <Chip
                                    label={sub.status}
                                    color={subscriptionStatusColor[sub.status] || 'default'}
                                    size="small"
                                />
                            </Box>
                        </Box>
                        <Box>
                            <Typography variant="caption" color="text.secondary">Billing cycle</Typography>
                            <Typography>{sub.billing_cycle}</Typography>
                        </Box>
                        <Box>
                            <Typography variant="caption" color="text.secondary">Current period</Typography>
                            <Typography variant="body2">
                                {sub.current_period_start?.slice(0, 10)} → {sub.current_period_end?.slice(0, 10)}
                            </Typography>
                        </Box>
                        {sub.trial_ends_at && (
                            <Box>
                                <Typography variant="caption" color="text.secondary">Trial ends</Typography>
                                <Typography variant="body2">{sub.trial_ends_at.slice(0, 10)}</Typography>
                            </Box>
                        )}
                    </Stack>
                </Paper>
            )}

            <Button
                variant="contained"
                startIcon={<SwapHorizIcon />}
                onClick={() => {
                    setChosenPlan(sub?.plan_code || (activePlans[0]?.code || ''));
                    setBillingCycle(sub?.billing_cycle || 'monthly');
                    setChangeOpen(true);
                }}
            >
                {noSub ? 'Assign plan' : 'Change plan'}
            </Button>

            {sub?.overrides && Object.keys(sub.overrides).length > 0 && (
                <Paper sx={{ mt: 3, p: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        Overrides (replace plan + add-on values)
                    </Typography>
                    <pre style={{ margin: 0, fontSize: 12 }}>
                        {JSON.stringify(sub.overrides, null, 2)}
                    </pre>
                </Paper>
            )}

            <Dialog open={changeOpen} onClose={() => setChangeOpen(false)} fullWidth maxWidth="sm">
                <DialogTitle>{noSub ? 'Assign plan' : 'Change plan'}</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <FormControl size="small" fullWidth>
                            <InputLabel>Plan</InputLabel>
                            <Select
                                label="Plan"
                                value={chosenPlan}
                                onChange={(e) => setChosenPlan(e.target.value)}
                            >
                                {activePlans.length === 0 && (
                                    <MenuItem disabled>(no active plans — create one first)</MenuItem>
                                )}
                                {activePlans.map((p) => (
                                    <MenuItem key={p.code} value={p.code}>
                                        {p.name} ({p.code})
                                        {p.default_addons?.length ? ` · ${p.default_addons.length} bundled add-on(s)` : ''}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl size="small" fullWidth>
                            <InputLabel>Billing cycle</InputLabel>
                            <Select
                                label="Billing cycle"
                                value={billingCycle}
                                onChange={(e) => setBillingCycle(e.target.value)}
                            >
                                <MenuItem value="monthly">Monthly</MenuItem>
                                <MenuItem value="annual">Annual</MenuItem>
                            </Select>
                        </FormControl>
                        <Alert severity="info">
                            Changing plan re-assigns the subscription and auto-attaches the new
                            plan's <b>default add-ons</b> in dependency order. Existing add-ons
                            outside that list are left as-is.
                        </Alert>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setChangeOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleChange} disabled={!chosenPlan}>
                        {noSub ? 'Assign' : 'Change'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};


const AddonsTab = ({ tenantId }) => {
    const tenantAddonsQ = useListTenantAddonsQuery(tenantId);
    const catalogQ = useListAddonsQuery();
    const { handleAttachAddon, handleDetachAddon } = usePricingAdmin();

    const [attachOpen, setAttachOpen] = useState(false);
    const [picked, setPicked] = useState([]);

    const attached = tenantAddonsQ.data || [];
    const attachedCodes = useMemo(
        () => new Set(attached.map((a) => a.addon_code || a.code)),
        [attached],
    );

    // Only ``active`` catalog add-ons that aren't already attached.
    // Prerequisite check is enforced by the backend on attach;
    // surfacing it here would require resolving the dependency
    // graph client-side, which would drift from the backend rule.
    const eligible = (catalogQ.data || []).filter(
        (a) => a.status === 'active' && !attachedCodes.has(a.code),
    );

    if (tenantAddonsQ.isLoading || catalogQ.isLoading) {
        return <Box sx={{ p: 3 }}><CircularProgress size={20} /></Box>;
    }

    const handleAttach = async () => {
        // Sequential attach so prerequisite chains resolve in order.
        for (const code of picked) {
            // eslint-disable-next-line no-await-in-loop
            await handleAttachAddon(tenantId, code);
        }
        setPicked([]);
        setAttachOpen(false);
        tenantAddonsQ.refetch();
    };

    return (
        <Box sx={{ mt: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="subtitle2">
                    {attached.length} add-on{attached.length === 1 ? '' : 's'} attached
                </Typography>
                <Button
                    variant="contained"
                    startIcon={<LinkIcon />}
                    onClick={() => setAttachOpen(true)}
                    disabled={eligible.length === 0}
                >
                    Attach add-on
                </Button>
            </Stack>

            <TableContainer component={Paper}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Code</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Cycle</TableCell>
                            <TableCell>Attached at</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {attached.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5}>
                                    <Typography variant="body2" color="text.secondary">
                                        No add-ons attached yet.
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        )}
                        {attached.map((a) => {
                            const code = a.addon_code || a.code;
                            return (
                                <TableRow key={a.id || code} hover>
                                    <TableCell><code>{code}</code></TableCell>
                                    <TableCell>
                                        <Chip size="small" label={a.status || 'active'} />
                                    </TableCell>
                                    <TableCell>{a.billing_cycle || 'monthly'}</TableCell>
                                    <TableCell>
                                        {a.created_at ? a.created_at.slice(0, 10) : '—'}
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title="Detach">
                                            <IconButton
                                                size="small"
                                                color="error"
                                                onClick={async () => {
                                                    if (window.confirm(`Detach add-on "${code}"?`)) {
                                                        await handleDetachAddon(tenantId, code);
                                                        tenantAddonsQ.refetch();
                                                    }
                                                }}
                                            >
                                                <LinkOffIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </TableContainer>

            <Dialog open={attachOpen} onClose={() => setAttachOpen(false)} fullWidth maxWidth="sm">
                <DialogTitle>Attach add-on(s)</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <FormControl size="small" fullWidth>
                            <InputLabel>Add-ons</InputLabel>
                            <Select
                                multiple
                                label="Add-ons"
                                value={picked}
                                onChange={(e) => setPicked(e.target.value)}
                                renderValue={(selected) => (
                                    <Stack direction="row" spacing={0.5} flexWrap="wrap">
                                        {selected.map((c) => <Chip key={c} size="small" label={c} />)}
                                    </Stack>
                                )}
                            >
                                {eligible.length === 0 && (
                                    <MenuItem disabled>
                                        (no eligible add-ons — must be active in catalog and not already attached)
                                    </MenuItem>
                                )}
                                {eligible.map((a) => (
                                    <MenuItem key={a.code} value={a.code}>
                                        {a.name} ({a.code})
                                        {a.prerequisites?.length ? ` · needs ${a.prerequisites.join(', ')}` : ''}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <Alert severity="info">
                            The backend rejects add-ons whose prerequisites aren't already attached.
                            Pick prereqs first, then dependent add-ons in the next attach.
                        </Alert>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAttachOpen(false)}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleAttach}
                        disabled={picked.length === 0}
                    >
                        Attach {picked.length || ''}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};


const TenantEntitlements = () => {
    const { tenantId } = useParams();
    const navigate = useNavigate();
    const tenantQ = useGetPlatformTenantQuery(tenantId);

    const [tab, setTab] = useState(0);

    return (
        <Container maxWidth="lg" sx={{ py: 3 }}>
            <Breadcrumbs sx={{ mb: 2 }}>
                <MLink
                    component="button" underline="hover"
                    onClick={() => navigate('/dashboard/platform/tenants')}
                >
                    Tenants
                </MLink>
                <Typography color="text.primary">
                    {tenantQ.data?.name || tenantId}
                </Typography>
                <Typography color="text.primary">Entitlements</Typography>
            </Breadcrumbs>
            <Typography variant="h5" sx={{ mb: 2 }}>
                Entitlements — {tenantQ.data?.name || '…'}
                {tenantQ.data?.slug && (
                    <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                        ({tenantQ.data.slug})
                    </Typography>
                )}
            </Typography>

            <Paper>
                <Tabs
                    value={tab}
                    onChange={(_e, v) => setTab(v)}
                    indicatorColor="primary"
                    textColor="primary"
                >
                    <Tab label="Subscription" />
                    <Tab label="Add-ons" />
                    <Tab label="Permissions" />
                </Tabs>
                <Box sx={{ p: 2 }}>
                    {tab === 0 && <SubscriptionTab tenantId={tenantId} />}
                    {tab === 1 && <AddonsTab tenantId={tenantId} />}
                    {tab === 2 && <TenantPermissionsMatrix tenantId={tenantId} />}
                </Box>
            </Paper>
        </Container>
    );
};

export default TenantEntitlements;
