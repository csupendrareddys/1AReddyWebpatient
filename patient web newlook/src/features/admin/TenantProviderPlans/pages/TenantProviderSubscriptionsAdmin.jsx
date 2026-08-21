/**
 * TenantProviderSubscriptionsAdmin — Round 10.
 *
 * Tenant SUPER_ADMIN's surface for managing the in-tenant providers'
 * subscriptions. Three tabs (Doctor / Clinic / Hospital), each shows
 * the providers in that vertical with their current plan + status,
 * and exposes per-row "Change Plan" + "Cancel" actions.
 *
 * Backend contract enforces tenant scope — caller can never see /
 * write another tenant's subscriptions. PLATFORM_OWNER is explicitly
 * NOT allowed cross-tenant writes (the platform-side write endpoints
 * now return 403 with ``code='cross_tenant_write_forbidden'`` —
 * Round 10 Part B).
 */
import { useMemo, useState } from 'react';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress,
    Container, Dialog, DialogActions, DialogContent, DialogTitle,
    FormControl, IconButton, InputLabel, MenuItem, Select, Stack,
    Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs,
    Tooltip, Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CancelIcon from '@mui/icons-material/Cancel';
import AddIcon from '@mui/icons-material/Add';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { useDispatch } from 'react-redux';

import { setSnackbar } from '../../redux/adminSharedUiSlice';
import {
    useListTenantProviderPlansQuery,
    useListTenantProviderSubscriptionsQuery,
    useChangeTenantProviderSubscriptionPlanMutation,
    useCancelTenantProviderSubscriptionMutation,
    useListUnsubscribedProvidersQuery,
    useCreateTenantProviderSubscriptionMutation,
    useActivateTenantProviderSubscriptionMutation,
    useApproveTenantProviderSubscriptionRequestMutation,
} from '../../api/tenantProviderPlanEndpoints';


const VERTICALS = [
    { key: 'doctor',   label: 'Doctors' },
    { key: 'clinic',   label: 'Clinics' },
    { key: 'hospital', label: 'Hospitals' },
];

// Status → MUI Chip color. The set mirrors MembershipSubscriptionStatus.
const STATUS_COLOR = {
    pending:   'warning',
    trial:     'info',
    active:    'success',
    past_due:  'error',
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


function ChangePlanDialog({
    open, onClose, subscription, plans, onSubmit, busy,
}) {
    const [planId, setPlanId] = useState(
        subscription?.tenant_provider_plan_id || '',
    );
    // Reset selection whenever the dialog opens for a different sub.
    const lastSubId = subscription?.id;
    useMemo(() => setPlanId(
        subscription?.tenant_provider_plan_id || '',
    ), [lastSubId]);  // eslint-disable-line react-hooks/exhaustive-deps

    const activePlans = (plans || []).filter((p) => p.status === 'active');

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>
                Change plan for {subscription?.provider_display_name || 'provider'}
            </DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    {activePlans.length === 0 ? (
                        <Alert severity="info">
                            No active plans authored for this vertical yet.
                            Add some under Employee / Consultant Plans first.
                        </Alert>
                    ) : (
                        <FormControl fullWidth>
                            <InputLabel id="change-plan-label">Plan</InputLabel>
                            <Select
                                labelId="change-plan-label"
                                value={planId}
                                label="Plan"
                                onChange={(e) => setPlanId(e.target.value)}
                            >
                                {activePlans.map((p) => {
                                    const price = p.price_inr_monthly == null
                                        ? 'Custom'
                                        : p.price_inr_monthly === 0
                                            ? 'Free'
                                            : `₹${Math.round(p.price_inr_monthly).toLocaleString()}/mo`;
                                    return (
                                        <MenuItem key={p.id} value={p.id}>
                                            {p.name} — {price}
                                        </MenuItem>
                                    );
                                })}
                            </Select>
                        </FormControl>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}>Cancel</Button>
                <Button
                    onClick={() => onSubmit(planId)}
                    variant="contained"
                    disabled={busy || !planId || activePlans.length === 0}
                >
                    {busy ? 'Saving…' : 'Save'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}


function SubscribeProviderDialog({
    open, onClose, vertical, plans, onSubmit, busy,
}) {
    // Reset selections when re-opening for a different vertical so
    // we never pre-fill with a stale provider/plan from another tab.
    const [providerId, setProviderId] = useState('');
    const [planId, setPlanId] = useState('');
    useMemo(() => { setProviderId(''); setPlanId(''); },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [vertical, open]);

    // Pull unsubscribed providers only when the dialog is actually
    // open — keeps the listing query off the page-load hot path.
    const { data: providers = [], isLoading } =
        useListUnsubscribedProvidersQuery(vertical, { skip: !open });

    const activePlans = (plans || []).filter((p) => p.status === 'active');
    const selectedProvider = providers.find((p) => p.provider_id === providerId);

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>
                Subscribe a {vertical} to a plan
            </DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    {isLoading && (
                        <Stack direction="row" spacing={1} alignItems="center">
                            <CircularProgress size={16} />
                            <Typography variant="body2" color="text.secondary">
                                Loading providers without subscriptions…
                            </Typography>
                        </Stack>
                    )}
                    {!isLoading && providers.length === 0 && (
                        <Alert severity="success" variant="outlined">
                            Every {vertical} in your tenant already has a
                            subscription — nothing to backfill.
                        </Alert>
                    )}
                    {!isLoading && providers.length > 0 && (
                        <>
                            <FormControl fullWidth>
                                <InputLabel id="sub-provider-label">
                                    Provider
                                </InputLabel>
                                <Select
                                    labelId="sub-provider-label"
                                    value={providerId}
                                    label="Provider"
                                    onChange={(e) => setProviderId(e.target.value)}
                                >
                                    {providers.map((p) => (
                                        <MenuItem
                                            key={p.provider_id}
                                            value={p.provider_id}
                                        >
                                            {p.display_name}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            {activePlans.length === 0 ? (
                                <Alert severity="info">
                                    No active {vertical} plans authored yet. Add
                                    some under <strong>Employee / Consultant Plans</strong>{' '}
                                    first.
                                </Alert>
                            ) : (
                                <FormControl fullWidth>
                                    <InputLabel id="sub-plan-label">
                                        Plan
                                    </InputLabel>
                                    <Select
                                        labelId="sub-plan-label"
                                        value={planId}
                                        label="Plan"
                                        onChange={(e) => setPlanId(e.target.value)}
                                    >
                                        {activePlans.map((p) => {
                                            const price = p.price_inr_monthly == null
                                                ? 'Custom'
                                                : p.price_inr_monthly === 0
                                                    ? 'Free'
                                                    : `₹${Math.round(p.price_inr_monthly).toLocaleString()}/mo`;
                                            return (
                                                <MenuItem
                                                    key={p.id} value={p.id}
                                                >
                                                    {p.name} — {price}
                                                </MenuItem>
                                            );
                                        })}
                                    </Select>
                                </FormControl>
                            )}
                        </>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}>Cancel</Button>
                <Button
                    onClick={() => onSubmit({
                        provider_id: providerId,
                        user_id: selectedProvider?.user_id,
                        plan_id: planId,
                    })}
                    variant="contained"
                    disabled={
                        busy || !providerId || !planId
                        || providers.length === 0
                        || activePlans.length === 0
                        || !selectedProvider?.user_id
                    }
                >
                    {busy ? 'Subscribing…' : 'Subscribe'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}


function CancelDialog({ open, onClose, subscription, onConfirm, busy }) {
    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
            <DialogTitle>Cancel subscription</DialogTitle>
            <DialogContent>
                <Typography variant="body2">
                    Cancel the subscription for{' '}
                    <strong>
                        {subscription?.provider_display_name || 'this provider'}
                    </strong>
                    ? The row stays for audit; the provider can be
                    re-subscribed to any plan later.
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}>Keep</Button>
                <Button
                    onClick={onConfirm}
                    color="error"
                    variant="contained"
                    disabled={busy}
                >
                    {busy ? 'Cancelling…' : 'Cancel subscription'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}


export default function TenantProviderSubscriptionsAdmin() {
    const dispatch = useDispatch();
    const notify = (severity, message) =>
        dispatch(setSnackbar({ open: true, severity, message }));

    const [tab, setTab] = useState(0);
    const activeVertical = VERTICALS[tab];

    // Roster + available plans for the active vertical. Both queries
    // re-fire on tab change because the vertical arg is part of the
    // RTK cache key.
    const subsQ = useListTenantProviderSubscriptionsQuery(
        { vertical: activeVertical.key },
    );
    const plansQ = useListTenantProviderPlansQuery(activeVertical.key);

    const [changePlan, changeState] =
        useChangeTenantProviderSubscriptionPlanMutation();
    const [cancelSub, cancelState] =
        useCancelTenantProviderSubscriptionMutation();
    const [createSub, createState] =
        useCreateTenantProviderSubscriptionMutation();
    const [activateSub, activateState] =
        useActivateTenantProviderSubscriptionMutation();
    const [approveRequest, approveState] =
        useApproveTenantProviderSubscriptionRequestMutation();

    const [changeOpenFor, setChangeOpenFor] = useState(null);
    const [cancelOpenFor, setCancelOpenFor] = useState(null);
    const [subscribeOpen, setSubscribeOpen] = useState(false);

    const subscriptions = subsQ.data || [];
    const plans = plansQ.data || [];

    const handleChangePlan = async (planId) => {
        try {
            await changePlan({
                id: changeOpenFor.id, plan_id: planId,
            }).unwrap();
            notify('success', 'Subscription plan updated.');
            setChangeOpenFor(null);
        } catch (err) {
            notify(
                'error',
                err?.data?.error || err?.data?.message
                    || 'Failed to update plan.',
            );
        }
    };

    const handleActivate = async (sub) => {
        try {
            await activateSub(sub.id).unwrap();
            notify('success', 'Subscription activated.');
        } catch (err) {
            notify(
                'error',
                err?.data?.error || err?.data?.message
                    || 'Failed to activate subscription.',
            );
        }
    };

    const handleApproveRequest = async (sub) => {
        try {
            await approveRequest(sub.id).unwrap();
            notify('success', `Applied requested plan: ${sub.requested_plan_name}.`);
        } catch (err) {
            notify(
                'error',
                err?.data?.error || err?.data?.message
                    || 'Failed to approve request.',
            );
        }
    };

    const handleSubscribe = async ({ provider_id, user_id, plan_id }) => {
        try {
            await createSub({
                vertical: activeVertical.key,
                provider_id, user_id, plan_id,
            }).unwrap();
            notify('success', 'Provider subscribed to plan.');
            setSubscribeOpen(false);
        } catch (err) {
            notify(
                'error',
                err?.data?.error || err?.data?.message
                    || 'Failed to subscribe provider.',
            );
        }
    };

    const handleCancel = async () => {
        try {
            await cancelSub(cancelOpenFor.id).unwrap();
            notify('success', 'Subscription cancelled.');
            setCancelOpenFor(null);
        } catch (err) {
            notify(
                'error',
                err?.data?.error || err?.data?.message
                    || 'Failed to cancel subscription.',
            );
        }
    };

    return (
        <Container maxWidth="lg" sx={{ mt: 3, mb: 6 }}>
            <Typography variant="h4" sx={{ mb: 1, fontWeight: 700 }}>
                Employee / Consultant Subscriptions
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Manage which in-tenant plan each of your doctors, clinics
                and hospitals is on. Plans are authored under{' '}
                <strong>Employee / Consultant Plans</strong>.
            </Typography>

            <Card>
                <CardContent>
                    <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        sx={{ mb: 2 }}
                    >
                        <Tabs
                            value={tab}
                            onChange={(_, v) => setTab(v)}
                        >
                            {VERTICALS.map((v, i) => (
                                <Tab key={v.key} label={v.label} value={i} />
                            ))}
                        </Tabs>
                        {/* Backfill flow: attach a plan to a provider that
                            doesn't have one yet. Pre-Round-9 invites + any
                            signup without a plan land here so the
                            super_admin can subscribe them retroactively. */}
                        <Button
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={() => setSubscribeOpen(true)}
                        >
                            Subscribe Provider
                        </Button>
                    </Stack>

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
                            No {activeVertical.label.toLowerCase()} subscriptions
                            in your tenant yet. They appear here automatically
                            after a {activeVertical.label.toLowerCase().slice(0, -1)}{' '}
                            signs up or you invite one.
                        </Alert>
                    )}

                    {!subsQ.isLoading && !subsQ.error && subscriptions.length > 0 && (
                        <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Provider</TableCell>
                                    <TableCell>Current plan</TableCell>
                                    <TableCell>Status</TableCell>
                                    <TableCell>Created</TableCell>
                                    <TableCell align="right">Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {subscriptions.map((s) => (
                                    <TableRow key={s.id} hover>
                                        <TableCell>
                                            {s.provider_display_name || s.id}
                                        </TableCell>
                                        <TableCell>
                                            {s.plan_name || s.plan_code || '—'}
                                            {s.requested_plan_name && (
                                                <Chip
                                                    size="small"
                                                    color="info"
                                                    variant="outlined"
                                                    sx={{ ml: 1 }}
                                                    label={`requested: ${s.requested_plan_name}`}
                                                />
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <StatusChip status={s.status} />
                                        </TableCell>
                                        <TableCell>
                                            {s.created_at
                                                ? new Date(s.created_at).toLocaleDateString()
                                                : '—'}
                                        </TableCell>
                                        <TableCell align="right">
                                            {/* Approve a doctor's pending
                                                plan-change request (Phase A5)
                                                — applies requested_plan + clears
                                                the request. */}
                                            {s.requested_plan_name && (
                                                <Tooltip title={`Approve requested plan: ${s.requested_plan_name}`}>
                                                    <span>
                                                        <IconButton
                                                            size="small"
                                                            color="info"
                                                            onClick={() => handleApproveRequest(s)}
                                                            disabled={approveState.isLoading}
                                                        >
                                                            <DoneAllIcon fontSize="small" />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                            )}
                                            {/* Activate: flip PENDING/TRIAL →
                                                ACTIVE. Auto-fires on
                                                verification approval; this
                                                button is the manual escape
                                                hatch for backfilled
                                                subscriptions where the
                                                auto-trigger missed. */}
                                            {(s.status === 'pending' || s.status === 'trial') && (
                                                <Tooltip title="Activate subscription">
                                                    <span>
                                                        <IconButton
                                                            size="small"
                                                            color="success"
                                                            onClick={() => handleActivate(s)}
                                                            disabled={activateState.isLoading}
                                                        >
                                                            <PlayArrowIcon fontSize="small" />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                            )}
                                            <Tooltip title="Change plan">
                                                <span>
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => setChangeOpenFor(s)}
                                                        disabled={s.status === 'cancelled'}
                                                    >
                                                        <EditIcon fontSize="small" />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                            <Tooltip title="Cancel subscription">
                                                <span>
                                                    <IconButton
                                                        size="small"
                                                        color="error"
                                                        onClick={() => setCancelOpenFor(s)}
                                                        disabled={s.status === 'cancelled'}
                                                    >
                                                        <CancelIcon fontSize="small" />
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
                plans={plans}
                onSubmit={handleChangePlan}
                busy={changeState.isLoading}
            />
            <CancelDialog
                open={!!cancelOpenFor}
                onClose={() => setCancelOpenFor(null)}
                subscription={cancelOpenFor}
                onConfirm={handleCancel}
                busy={cancelState.isLoading}
            />
            <SubscribeProviderDialog
                open={subscribeOpen}
                onClose={() => setSubscribeOpen(false)}
                vertical={activeVertical.key}
                plans={plans}
                onSubmit={handleSubscribe}
                busy={createState.isLoading}
            />
        </Container>
    );
}
