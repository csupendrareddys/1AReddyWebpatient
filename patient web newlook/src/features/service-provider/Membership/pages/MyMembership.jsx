/**
 * MyMembership — provider-side view of the marketplace tier they signed
 * up for on ``larazen.in``.
 *
 * Round 2 surface — read-only. Round 8 will wire the Upgrade /
 * Cancel CTAs (currently disabled placeholders).
 *
 * Rendering states:
 *   * Loading              → spinner.
 *   * 404 (no subscription) → empty-state card pointing back to the
 *                             apex pricing page so the doctor can pick
 *                             a plan (e.g. signed up before R2).
 *   * Other errors         → red banner with the message.
 *   * Happy path           → tier card with status chip, trial /
 *                             period countdown, feature bullets, and
 *                             disabled upgrade button.
 */
import {
    Alert, Box, Button, Card, CardActions, CardContent, Chip, Container,
    CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
    Divider, MenuItem, Snackbar, Stack, TextField, Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { useMemo, useState } from 'react';

import {
    useGetMyMembershipQuery,
} from '../api/myMembershipEndpoints';
import MembershipPlansPanel from '../components/MembershipPlansPanel/MembershipPlansPanel';
import {
    useGetMyTenantProviderSubscriptionQuery,
    useListTenantProviderPlansForSignupQuery,
    useRequestMyTenantPlanMutation,
} from '../../../admin/api/tenantProviderPlanEndpoints';
import planLimitLines from '../../../../utils/planLimits';


const STATUS_COLOR = {
    pending: 'warning',
    trial: 'info',
    active: 'success',
    past_due: 'warning',
    cancelled: 'default',
    suspended: 'error',
    PENDING: 'warning',
    TRIAL: 'info',
    ACTIVE: 'success',
    PAST_DUE: 'warning',
    CANCELLED: 'default',
    SUSPENDED: 'error',
};

const STATUS_LABEL = {
    pending: 'Pending approval',
    trial: 'Trial',
    active: 'Active',
    past_due: 'Past due',
    cancelled: 'Cancelled',
    suspended: 'Suspended',
};


function daysBetween(target) {
    // Returns floor(days remaining) from now to ``target`` (ISO string).
    // Negative when the target is in the past.
    if (!target) return null;
    const now = new Date();
    const end = new Date(target);
    const diffMs = end.getTime() - now.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}


function bulletList(plan) {
    const bullets = plan?.features?.bullets;
    const authored = Array.isArray(bullets) ? bullets : [];
    // Read live off the plan's caps — see ``utils/planLimits``. On this page
    // in particular the member is looking at what they currently hold, so the
    // number here has to be the same one that refuses them on My Link.
    return [...authored, ...planLimitLines(plan).map((l) => l.text)];
}


function priceLabel(plan) {
    if (!plan) return { top: '—', bottom: '' };
    if (plan.price_inr_monthly == null) {
        return { top: 'Custom', bottom: 'Contact us' };
    }
    if (plan.price_inr_monthly === 0) {
        return { top: 'Free', bottom: 'forever' };
    }
    return {
        top: `₹${Math.round(plan.price_inr_monthly).toLocaleString()}`,
        bottom: '/month',
    };
}


const MyMembership = () => {
    // Two parallel sources — the provider is either on the apex
    // marketplace (``MembershipSubscription``) or inside a tenant
    // subdomain (``TenantProviderSubscription``). Never both for the
    // same provider profile; we render whichever returns data first.
    // If both 404, the empty-state card below fires.
    const apexQ = useGetMyMembershipQuery();
    const tenantQ = useGetMyTenantProviderSubscriptionQuery(undefined, {
        // Skip the tenant query while the apex query is loading to
        // keep the spinner state simple; it'll fire when apex resolves.
        skip: apexQ.isLoading,
    });

    const isLoading = apexQ.isLoading || tenantQ.isLoading;
    // Prefer apex (marketplace) when present — it's the older surface
    // and the one most providers will be on. Fall back to in-tenant.
    const data = apexQ.data || tenantQ.data || null;
    const isInTenant = !apexQ.data && !!tenantQ.data;
    // Only treat as an error when BOTH queries failed non-404.
    const apex404 = apexQ.error?.status === 404;
    const tenant404 = tenantQ.error?.status === 404;
    const error = (() => {
        if (data) return null;
        if (apex404 && tenant404) {
            // Synthesize a 404 so the empty-state branch fires.
            return { status: 404 };
        }
        return apexQ.error || tenantQ.error || null;
    })();

    const subscription = data?.subscription || null;
    const plan = data?.plan || null;

    // Trial countdown — only shown while in TRIAL state.
    const trialDaysLeft = useMemo(
        () => daysBetween(subscription?.trial_ends_at),
        [subscription?.trial_ends_at],
    );
    const periodDaysLeft = useMemo(
        () => daysBetween(subscription?.current_period_end),
        [subscription?.current_period_end],
    );

    // ── Phase A5 — doctor self-requests a plan; an admin approves it ──
    const [planDialogOpen, setPlanDialogOpen] = useState(false);
    const [selectedPlanId, setSelectedPlanId] = useState('');
    const [snack, setSnack] = useState(null);
    const plansQ = useListTenantProviderPlansForSignupQuery('doctor', {
        skip: !planDialogOpen,
    });
    const [requestPlan, requestState] = useRequestMyTenantPlanMutation();
    const activePlans = plansQ.data?.plans || [];

    const doRequest = async () => {
        try {
            await requestPlan(selectedPlanId).unwrap();
            setSnack({ sev: 'success', msg: 'Plan requested — pending admin approval.' });
            setPlanDialogOpen(false);
            setSelectedPlanId('');
            tenantQ.refetch();
        } catch (e) {
            setSnack({ sev: 'error', msg: e?.data?.error || 'Request failed.' });
        }
    };

    // Shared dialog + snackbar, rendered in both the empty-state and the
    // happy-path returns below (the early returns make a single mount point
    // impossible without a wrapper).
    const requestFlowUI = (
        <>
            <Dialog
                open={planDialogOpen}
                onClose={() => setPlanDialogOpen(false)}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>Request a plan</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Pick a plan to request. Your current plan stays active
                        until an admin approves the change.
                    </Typography>
                    {plansQ.isLoading ? (
                        <CircularProgress size={22} />
                    ) : activePlans.length === 0 ? (
                        <Alert severity="info">
                            No plans are available to request right now.
                        </Alert>
                    ) : (
                        <TextField
                            select
                            fullWidth
                            size="small"
                            label="Plan"
                            value={selectedPlanId}
                            onChange={(e) => setSelectedPlanId(e.target.value)}
                        >
                            {activePlans.map((p) => (
                                <MenuItem key={p.id} value={p.id}>
                                    {p.name}
                                    {p.price_inr_monthly != null
                                        ? ` — ₹${Math.round(p.price_inr_monthly).toLocaleString()}/mo`
                                        : ''}
                                </MenuItem>
                            ))}
                        </TextField>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPlanDialogOpen(false)}>Cancel</Button>
                    <Button
                        variant="contained"
                        disabled={!selectedPlanId || requestState.isLoading}
                        onClick={doRequest}
                    >
                        {requestState.isLoading ? 'Requesting…' : 'Request'}
                    </Button>
                </DialogActions>
            </Dialog>
            {snack && (
                <Snackbar
                    open
                    autoHideDuration={4000}
                    onClose={() => setSnack(null)}
                    anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                >
                    <Alert severity={snack.sev} variant="filled">
                        {snack.msg}
                    </Alert>
                </Snackbar>
            )}
        </>
    );

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    // 404 = no subscription. Show a friendly empty state instead of an
    // error banner. ``error.status`` is the RTK Query error shape.
    if (error && error.status === 404) {
        return (
            <Container maxWidth="md" sx={{ mt: 4, mb: 8 }}>
                <Card>
                    <CardContent sx={{ textAlign: 'center', py: 6 }}>
                        <WorkspacePremiumIcon
                            sx={{ fontSize: 56, color: 'primary.main', mb: 2 }}
                        />
                        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
                            No membership tier yet
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                            You're not on a plan yet. Request one below — an admin
                            approves it before it takes effect.
                        </Typography>
                        <Button
                            variant="contained"
                            onClick={() => setPlanDialogOpen(true)}
                        >
                            Choose a plan
                        </Button>
                    </CardContent>
                </Card>
                {requestFlowUI}
            </Container>
        );
    }

    if (error) {
        return (
            <Container maxWidth="md" sx={{ mt: 4, mb: 8 }}>
                <Alert severity="error">
                    Couldn't load your membership.{' '}
                    {error?.data?.error || 'Please refresh.'}
                </Alert>
            </Container>
        );
    }

    if (!plan || !subscription) return null;

    const statusKey = (subscription.status || '').toLowerCase();
    const statusColor = STATUS_COLOR[subscription.status] || 'default';
    const statusLabel = STATUS_LABEL[statusKey] || subscription.status;
    const bullets = bulletList(plan);
    const price = priceLabel(plan);

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 8 }}>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
                <WorkspacePremiumIcon color="primary" sx={{ fontSize: 32 }} />
                <Box>
                    <Typography variant="h5" sx={{ fontWeight: 700 }}>
                        My Plan
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {isInTenant
                            ? 'Your plan inside this tenant.'
                            : 'Your marketplace tier on larazen.in.'}
                    </Typography>
                </Box>
            </Stack>

            <Card elevation={2} sx={{ borderRadius: 3 }}>
                <CardContent sx={{ p: 3 }}>
                    {/* Header — tier name + status chip + price. */}
                    <Stack
                        direction="row"
                        spacing={2}
                        alignItems="center"
                        flexWrap="wrap"
                    >
                        <Typography variant="h4" sx={{ fontWeight: 700 }}>
                            {plan.name}
                        </Typography>
                        <Chip
                            size="small"
                            label={statusLabel}
                            color={statusColor}
                            variant="filled"
                        />
                        {plan.is_featured && (
                            <Chip
                                size="small"
                                label="Most popular"
                                color="primary"
                                variant="outlined"
                            />
                        )}
                    </Stack>
                    {plan.description && (
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ mt: 1, mb: 2 }}
                        >
                            {plan.description}
                        </Typography>
                    )}

                    <Stack
                        direction="row"
                        alignItems="baseline"
                        spacing={0.5}
                        sx={{ mt: 2 }}
                    >
                        <Typography variant="h4" sx={{ fontWeight: 700 }}>
                            {price.top}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {price.bottom}
                        </Typography>
                    </Stack>

                    {/* PENDING — no trial clock yet. */}
                    {statusKey === 'pending' && (
                        <Alert
                            severity="warning"
                            icon={<HourglassEmptyIcon />}
                            sx={{ mt: 2 }}
                        >
                            Your account is awaiting admin verification. Your
                            {plan.trial_days > 0
                                ? ` ${plan.trial_days}-day free trial`
                                : ' membership'}
                            {' '}starts the moment your credentials are approved
                            — no days are being burned right now.
                        </Alert>
                    )}

                    {/* TRIAL — countdown. */}
                    {statusKey === 'trial' && trialDaysLeft !== null && (
                        <Alert severity="info" sx={{ mt: 2 }}>
                            Trial — <strong>{Math.max(trialDaysLeft, 0)}</strong>{' '}
                            {trialDaysLeft === 1 ? 'day' : 'days'} remaining.
                        </Alert>
                    )}

                    {/* ACTIVE — renewal date. */}
                    {statusKey === 'active' && periodDaysLeft !== null && (
                        <Alert severity="success" sx={{ mt: 2 }}>
                            Active — renews in <strong>{Math.max(periodDaysLeft, 0)}</strong>{' '}
                            {periodDaysLeft === 1 ? 'day' : 'days'}.
                        </Alert>
                    )}

                    {/* Pending plan-change request (Phase A5). */}
                    {subscription.requested_plan_name && (
                        <Alert severity="info" sx={{ mt: 2 }}>
                            Plan change requested:{' '}
                            <strong>{subscription.requested_plan_name}</strong> —
                            pending admin approval.
                        </Alert>
                    )}

                    <Divider sx={{ my: 2 }} />

                    <Typography variant="overline" color="text.secondary">
                        What's included
                    </Typography>
                    <Stack spacing={1} sx={{ mt: 1 }}>
                        {bullets.length === 0 && (
                            <Typography variant="caption" color="text.secondary">
                                Core marketplace membership benefits.
                            </Typography>
                        )}
                        {bullets.map((b) => (
                            <Stack
                                key={b}
                                direction="row"
                                spacing={1}
                                alignItems="flex-start"
                            >
                                <CheckCircleOutlineIcon
                                    fontSize="small"
                                    color="success"
                                    sx={{ mt: '2px' }}
                                />
                                <Typography variant="body2">{b}</Typography>
                            </Stack>
                        ))}
                    </Stack>
                </CardContent>
                <CardActions sx={{ p: 3, pt: 0 }}>
                    {/* In-tenant doctors can request a plan change (admin
                        approves). Apex-marketplace change stays a future
                        release, so keep it disabled there. */}
                    <Button
                        variant="outlined"
                        disabled={!isInTenant}
                        onClick={() => isInTenant && setPlanDialogOpen(true)}
                        title={
                            isInTenant
                                ? 'Request a different plan'
                                : 'Plan change is coming in a future release'
                        }
                    >
                        {subscription.requested_plan_name
                            ? 'Change requested plan'
                            : 'Request plan change'}
                    </Button>
                </CardActions>
            </Card>

            {/* Apex (marketplace) members — plan-based providers — get a
                self-service tier picker: upgrade any time (prorated) or renew
                by paying. In-tenant providers use the admin-approved request
                flow above instead. */}
            {!isInTenant && apexQ.data && (
                <Box sx={{ mt: 3 }}>
                    <MembershipPlansPanel title="Change your plan" />
                </Box>
            )}
            {requestFlowUI}
        </Container>
    );
};

export default MyMembership;
