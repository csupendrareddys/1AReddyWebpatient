/**
 * SaasSubscriptionsAdmin — PLATFORM_OWNER roster of tenants by SaaS plan.
 *
 * The catalog page (``PlansAdmin``) answers "what plans exist?" and the
 * per-tenant entitlements page answers "what is tenant X on?". This page
 * answers the inverse — "who is on plan type Y?" — so a plan type can be
 * worked as a whole instead of drilling into each tenant from the Tenants
 * list one at a time.
 *
 * Mirrors ``TenantProviderSubscriptionsAdmin``: a tab per plan type, a row
 * per subscriber, a per-row Change Plan action. Two deliberate differences
 * from that page:
 *
 *   * No Cancel action. Cancelling a tenant's SaaS subscription takes their
 *     whole subdomain down (every ``PlanService`` gate starts refusing), so
 *     that stays on the per-tenant entitlements page where the blast radius
 *     is visible.
 *   * The write reuses ``assignTenantSubscription`` — the same endpoint the
 *     entitlements page calls — so there is exactly one code path that moves
 *     a tenant between plans, and one place that knows to re-attach the new
 *     plan's default add-ons and recompute over-limit state.
 */
import { useMemo, useState } from 'react';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress,
    Container, Dialog, DialogActions, DialogContent, DialogTitle,
    FormControl, IconButton, InputLabel, MenuItem, Select, Stack,
    Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs,
    Tooltip, Typography,
} from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useDispatch } from 'react-redux';

import { setSnackbar } from '../../redux/adminSharedUiSlice';
import {
    useListAllTenantSubscriptionsQuery,
    useListPlanTypesQuery,
    useListPlansQuery,
    useAssignTenantSubscriptionMutation,
} from '../../api/pricingEndpoints';


// Mirrors ``SubscriptionStatus`` on the backend. Kept in the same shape as
// the provider-subscriptions page so the two tables read identically.
const STATUS_COLOR = {
    trial: 'info',
    active: 'success',
    past_due: 'error',
    over_limit: 'warning',
    cancelled: 'default',
    suspended: 'error',
};


function StatusChip({ status }) {
    const label = (status || 'unknown').replace(/_/g, ' ');
    return (
        <Chip
            label={label}
            color={STATUS_COLOR[status] || 'default'}
            size="small"
            sx={{ textTransform: 'capitalize' }}
        />
    );
}


function ChangePlanDialog({ open, onClose, subscription, plans, onSubmit, busy }) {
    const [planCode, setPlanCode] = useState('');
    const [billingCycle, setBillingCycle] = useState('monthly');

    // Re-seed from the row whenever the dialog opens for a different tenant,
    // so we never pre-fill with the previous row's plan.
    const lastId = subscription?.id;
    useMemo(() => {
        setPlanCode(subscription?.plan_code || '');
        setBillingCycle(subscription?.billing_cycle || 'monthly');
    }, [lastId]);  // eslint-disable-line react-hooks/exhaustive-deps

    const activePlans = (plans || []).filter((p) => p.status === 'active');

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>
                Change plan for {subscription?.tenant_name || 'tenant'}
            </DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    {activePlans.length === 0 ? (
                        <Alert severity="info">
                            No active SaaS plans authored yet. Add some under{' '}
                            <strong>Plans</strong> first.
                        </Alert>
                    ) : (
                        <FormControl fullWidth size="small">
                            <InputLabel id="saas-change-plan-label">Plan</InputLabel>
                            <Select
                                labelId="saas-change-plan-label"
                                value={planCode}
                                label="Plan"
                                onChange={(e) => setPlanCode(e.target.value)}
                            >
                                {activePlans.map((p) => (
                                    <MenuItem key={p.code} value={p.code}>
                                        {p.name} ({p.code})
                                        {p.plan_type?.name ? ` · ${p.plan_type.name}` : ''}
                                        {p.default_addons?.length
                                            ? ` · ${p.default_addons.length} bundled add-on(s)`
                                            : ''}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}
                    <FormControl fullWidth size="small">
                        <InputLabel id="saas-cycle-label">Billing cycle</InputLabel>
                        <Select
                            labelId="saas-cycle-label"
                            value={billingCycle}
                            label="Billing cycle"
                            onChange={(e) => setBillingCycle(e.target.value)}
                        >
                            <MenuItem value="monthly">Monthly</MenuItem>
                            <MenuItem value="annual">Annual</MenuItem>
                        </Select>
                    </FormControl>
                    <Alert severity="info">
                        Re-assigns the subscription and auto-attaches the new plan's{' '}
                        <b>default add-ons</b> in dependency order. Add-ons outside
                        that list are left as-is. The billing period restarts today.
                    </Alert>
                    {/* The assign endpoint overwrites ``overrides`` with whatever
                        the body carries, so a tenant with per-tenant overrides
                        would silently lose them if we posted without the field.
                        They're echoed back untouched — say so, since the operator
                        can't see them from this page. */}
                    {subscription?.overrides
                        && Object.keys(subscription.overrides).length > 0 && (
                        <Alert severity="warning">
                            This tenant has{' '}
                            {Object.keys(subscription.overrides).length} per-tenant
                            override(s). They'll be carried over unchanged — edit them
                            on the tenant's Entitlements page.
                        </Alert>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}>Cancel</Button>
                <Button
                    onClick={() => onSubmit({
                        plan_code: planCode,
                        billing_cycle: billingCycle,
                    })}
                    variant="contained"
                    disabled={busy || !planCode || activePlans.length === 0}
                >
                    {busy ? 'Saving…' : 'Change plan'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}


export default function SaasSubscriptionsAdmin() {
    const dispatch = useDispatch();
    const notify = (severity, message) =>
        dispatch(setSnackbar({ open: true, severity, message }));

    // Tab 0 is always "All"; the rest are the authored plan types. Driven off
    // the ``saas_plan_types`` table rather than a hardcoded list so a new plan
    // type shows up here without a frontend change.
    const planTypesQ = useListPlanTypesQuery();
    const planTypes = planTypesQ.data || [];
    const [tab, setTab] = useState(0);
    const activePlanType = tab === 0 ? null : planTypes[tab - 1];

    const subsQ = useListAllTenantSubscriptionsQuery({
        planType: activePlanType?.id,
    });
    const plansQ = useListPlansQuery();

    const [assignSub, assignState] = useAssignTenantSubscriptionMutation();
    const [changeOpenFor, setChangeOpenFor] = useState(null);

    const subscriptions = subsQ.data || [];

    const handleChangePlan = async ({ plan_code, billing_cycle }) => {
        try {
            await assignSub({
                tenantId: changeOpenFor.tenant_id,
                data: {
                    plan_code,
                    billing_cycle,
                    // Echo the existing overrides back — the endpoint replaces
                    // the column wholesale, so omitting them would null them out.
                    ...(changeOpenFor.overrides
                        ? { overrides: changeOpenFor.overrides }
                        : {}),
                },
            }).unwrap();
            notify('success', `${changeOpenFor.tenant_name} moved to ${plan_code}.`);
            setChangeOpenFor(null);
        } catch (err) {
            notify(
                'error',
                err?.data?.error || err?.data?.message || 'Failed to change plan.',
            );
        }
    };

    return (
        <Container maxWidth="lg" sx={{ mt: 3, mb: 6 }}>
            <Typography variant="h4" sx={{ mb: 1, fontWeight: 700 }}>
                SaaS Subscriptions
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Every tenant on the platform, grouped by plan type, with the plan
                they're currently subscribed to. Plans are authored under{' '}
                <strong>Plans</strong>.
            </Typography>

            <Card>
                <CardContent>
                    {planTypesQ.isLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress />
                        </Box>
                    ) : (
                        <Tabs
                            value={tab}
                            onChange={(_, v) => setTab(v)}
                            variant="scrollable"
                            scrollButtons="auto"
                            sx={{ mb: 2 }}
                        >
                            <Tab label="All" value={0} />
                            {planTypes.map((pt, i) => (
                                <Tab key={pt.id} label={pt.name} value={i + 1} />
                            ))}
                        </Tabs>
                    )}

                    {subsQ.isLoading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress />
                        </Box>
                    )}

                    {subsQ.error && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            Couldn't load subscriptions.
                        </Alert>
                    )}

                    {!subsQ.isLoading && !subsQ.error && subscriptions.length === 0 && (
                        <Alert severity="info">
                            No tenant is subscribed to{' '}
                            {activePlanType
                                ? `a ${activePlanType.name} plan`
                                : 'any plan'}{' '}
                            yet.
                        </Alert>
                    )}

                    {!subsQ.isLoading && !subsQ.error && subscriptions.length > 0 && (
                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Tenant</TableCell>
                                        <TableCell>Current plan</TableCell>
                                        <TableCell>Plan type</TableCell>
                                        <TableCell>Status</TableCell>
                                        <TableCell>Cycle</TableCell>
                                        <TableCell>Period ends</TableCell>
                                        <TableCell align="right">Actions</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {subscriptions.map((s) => (
                                        <TableRow key={s.id} hover>
                                            <TableCell>
                                                {s.tenant_name || s.tenant_slug || s.tenant_id}
                                                {s.tenant_is_default && (
                                                    <Chip
                                                        size="small"
                                                        label="platform"
                                                        variant="outlined"
                                                        sx={{ ml: 1 }}
                                                    />
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {s.plan_name || s.plan_code || '—'}
                                            </TableCell>
                                            <TableCell>
                                                {s.plan_type?.name || '—'}
                                            </TableCell>
                                            <TableCell>
                                                <StatusChip status={s.status} />
                                            </TableCell>
                                            <TableCell>{s.billing_cycle}</TableCell>
                                            <TableCell>
                                                {s.current_period_end
                                                    ? new Date(s.current_period_end)
                                                        .toLocaleDateString()
                                                    : '—'}
                                            </TableCell>
                                            <TableCell align="right">
                                                <Tooltip title="Change plan">
                                                    <span>
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => setChangeOpenFor(s)}
                                                        >
                                                            <SwapHorizIcon fontSize="small" />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </CardContent>
            </Card>

            <ChangePlanDialog
                open={!!changeOpenFor}
                onClose={() => setChangeOpenFor(null)}
                subscription={changeOpenFor}
                plans={plansQ.data}
                onSubmit={handleChangePlan}
                busy={assignState.isLoading}
            />
        </Container>
    );
}
