/**
 * MembershipSubscriptionsAdmin — the marketplace roster.
 *
 * ``MembershipPlansAdmin`` authors the tiers; this page lists everyone who
 * currently holds one and lets an admin move a subscriber onto a different
 * tier. Same relationship as Provider Plans ↔ Provider Subscriptions, and
 * this page is deliberately modelled on ``TenantProviderSubscriptionsAdmin``
 * so the two read identically.
 *
 * Tabs are the tenant's ``vertical_plan_types`` rows, fetched rather than
 * hardcoded: that table is tenant-authored and extensible, so a tenant that
 * adds a custom vertical gets a tab for it without a frontend change. The
 * backend filters on the plan's ``vertical_plan_type_id`` for the same
 * reason — ``MembershipSubscription.provider_type`` is a fixed enum and
 * would make custom verticals unreachable.
 *
 * Scope: change-plan only. Cancel / re-subscribe isn't offered here yet —
 * a cancelled membership needs a fresh row (the active-uniqueness index only
 * covers TRIAL/ACTIVE), which is a different flow from a tier swap.
 */
import { useMemo, useState } from 'react';
import {
    Alert, Autocomplete, Box, Button, Card, CardContent, Chip, CircularProgress,
    Container, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
    FormControl, FormControlLabel, IconButton, InputLabel, MenuItem, Select,
    Stack, Switch, Tab, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import RedeemIcon from '@mui/icons-material/Redeem';
import { useDispatch } from 'react-redux';

import { setSnackbar } from '../../redux/adminSharedUiSlice';
import {
    useListMembershipPlansQuery,
    useListMembershipSubscriptionsQuery,
    useChangeMembershipSubscriptionPlanMutation,
    useAssignMembershipToDoctorMutation,
    useSetSubscriptionHoldMutation,
    useEndSubscriptionTrialMutation,
    useExtendSubscriptionTrialMutation,
    useManualCreditGrantMutation,
} from '../../api/membershipEndpoints';
import { useListVerticalTypesQuery } from '../../api/verticalTypeEndpoints';
import { useGetDoctorsQuery } from '../../api/doctorsEndpoints';
import { useGetClinicsQuery, useGetHospitalsQuery } from '../../api/facilitiesEndpoints';
import { useGetPatientsQuery } from '../../api/patientsEndpoints';


// Mirrors ``MembershipSubscriptionStatus`` on the backend.
const STATUS_COLOR = {
    pending: 'warning',
    trial: 'info',
    active: 'success',
    past_due: 'error',
    cancelled: 'default',
    suspended: 'error',
    // Effective display states (server ``display_state``).
    held: 'error',
    expired: 'warning',
    free: 'success',
};

// How each effective state reads in the chip.
const STATE_LABEL = {
    held: 'On hold',
    expired: 'Expired',
    free: 'Free plan',
    active: 'Active',
    trial: 'Trial',
};


function StatusChip({ status }) {
    const label = STATE_LABEL[status] || (status || 'unknown').replace(/_/g, ' ');
    return (
        <Chip
            label={label}
            color={STATUS_COLOR[status] || 'default'}
            size="small"
            variant={status === 'free' ? 'outlined' : 'filled'}
            sx={{ textTransform: 'capitalize' }}
        />
    );
}


function planPriceLabel(plan) {
    const price = plan?.price_inr_monthly;
    if (price == null) return 'Custom';
    if (Number(price) === 0) return 'Free';
    return `₹${Math.round(price).toLocaleString()}/mo`;
}


function ChangePlanDialog({
    open, onClose, subscription, plans, onSubmit, onSetHold, onEndTrial,
    onExtendTrial, busy,
}) {
    const [planId, setPlanId] = useState('');
    const [extendDays, setExtendDays] = useState(7);

    // Active plans in the SAME vertical only — moving a doctor onto a hospital
    // tier is a provider migration, not a plan change, so never offer another
    // vertical's plans. The backend now resolves the vertical even for a
    // subscriber whose plan lost its vertical (from the fixed provider_type),
    // so ``vertical_plan_type`` is normally populated. As a belt-and-suspenders
    // fallback, match the plan's vertical CODE to the provider type, and only
    // if even that can't resolve show just the current plan — never everything.
    const currentVerticalId = subscription?.vertical_plan_type?.id;
    const provType = (subscription?.provider_type || '').toLowerCase();
    const eligiblePlans = (plans || []).filter((p) => {
        if (p.status !== 'active') return false;
        if (currentVerticalId) return p.vertical_plan_type?.id === currentVerticalId;
        if (provType) return (p.vertical_plan_type?.code || '').toLowerCase() === provType;
        return p.id === subscription?.membership_plan_id;
    });

    // A subscriber can be sitting on a plan that has since been archived —
    // archiving a membership tier soft-deletes it without checking for live
    // subscriptions, so the row keeps pointing at it. The plan list won't
    // contain it, so pre-selecting it would hand MUI an out-of-range value
    // and render a blank Select. Start empty in that case and say why.
    const currentIsSelectable = eligiblePlans.some(
        (p) => p.id === subscription?.membership_plan_id,
    );

    // Re-seed whenever the dialog opens for a different subscriber, so we
    // never pre-fill with the previous row's plan.
    const lastSubId = subscription?.id;
    useMemo(
        () => setPlanId(
            currentIsSelectable ? subscription.membership_plan_id : '',
        ),
        [lastSubId],  // eslint-disable-line react-hooks/exhaustive-deps
    );

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>
                Change plan for{' '}
                {subscription?.subscriber_display_name || 'subscriber'}
            </DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    {!currentIsSelectable && subscription?.plan_name && (
                        <Alert severity="warning">
                            This subscriber is on{' '}
                            <strong>{subscription.plan_name}</strong>, which is no
                            longer an active tier — it was archived while they were
                            still subscribed. Pick a current tier to move them onto.
                        </Alert>
                    )}
                    {eligiblePlans.length === 0 ? (
                        <Alert severity="info">
                            No other active{' '}
                            {subscription?.vertical_plan_type?.name || ''} plans
                            authored yet. Add some under{' '}
                            <strong>Membership Plans</strong> first.
                        </Alert>
                    ) : (
                        <FormControl fullWidth size="small">
                            <InputLabel id="membership-change-plan-label">
                                Plan
                            </InputLabel>
                            <Select
                                labelId="membership-change-plan-label"
                                value={planId}
                                label="Plan"
                                onChange={(e) => setPlanId(e.target.value)}
                            >
                                {eligiblePlans.map((p) => (
                                    <MenuItem key={p.id} value={p.id}>
                                        {p.name} — {planPriceLabel(p)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}
                    <Alert severity="info">
                        Swaps the tier on the running subscription — status,
                        trial clock and billing period are left as they are.
                        The new plan's commission and platform charges apply to
                        bookings from now on.
                    </Alert>

                    <Divider textAlign="left">
                        <Typography variant="caption" color="text.secondary">Account actions</Typography>
                    </Divider>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={!!subscription?.on_hold}
                                disabled={busy}
                                onChange={(e) => onSetHold(e.target.checked)}
                            />
                        }
                        label="Disciplinary hold — move to the holding page (admin chat)"
                    />
                    {subscription?.trial_ends_at && (
                        <Typography variant="caption" color="text.secondary">
                            Trial ends: {new Date(subscription.trial_ends_at).toLocaleDateString()}
                        </Typography>
                    )}
                    {/* Extend / restart the trial — lifts the holding page for a
                        member who was held because their trial had ended. */}
                    <Stack direction="row" spacing={1} alignItems="center">
                        <TextField
                            type="number" size="small" label="Days" sx={{ width: 100 }}
                            value={extendDays}
                            onChange={(e) => setExtendDays(Math.max(1, Number(e.target.value) || 1))}
                            inputProps={{ min: 1 }}
                        />
                        <Button size="small" color="primary" variant="outlined"
                            disabled={busy} onClick={() => onExtendTrial(extendDays)}>
                            Extend / restart trial
                        </Button>
                    </Stack>
                    {subscription?.status === 'trial' && (
                        <Button size="small" color="warning" variant="outlined"
                            disabled={busy} onClick={onEndTrial} sx={{ alignSelf: 'flex-start' }}>
                            End free trial now
                        </Button>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}>Cancel</Button>
                <Button
                    onClick={() => onSubmit(planId)}
                    variant="contained"
                    disabled={
                        busy || !planId || eligiblePlans.length === 0
                        || planId === subscription?.membership_plan_id
                    }
                >
                    {busy ? 'Saving…' : 'Save'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}


// Verticals we can present an entity picker for. Corporate is intentionally
// absent — it has no entity model to pick from.
const ASSIGNABLE_VERTICALS = ['doctor', 'clinic', 'hospital', 'patient'];
const ENTITY_LABEL = {
    doctor: 'Doctor', clinic: 'Clinic', hospital: 'Hospital', patient: 'Patient',
};
const entityName = (o) => (
    o.full_name || o.name
    || `${o.first_name || ''} ${o.last_name || ''}`.trim()
    || o.email || ''
);

// Put ANY vertical's entity (doctor / clinic / hospital / patient) that has no
// subscription (or a different one) onto a membership tier. Creates the
// subscription + starts its trial server-side.
function AssignEntityDialog({ open, onClose, plans, verticals, onAssign, busy }) {
    const [vertical, setVertical] = useState('');   // vertical code
    const [entity, setEntity] = useState(null);     // { id, label }
    const [planId, setPlanId] = useState('');

    // Load each entity source; each stays idle until its vertical is picked.
    const doctorsQ = useGetDoctorsQuery({ per_page: 300 }, { skip: !open || vertical !== 'doctor' });
    const clinicsQ = useGetClinicsQuery({ per_page: 300 }, { skip: !open || vertical !== 'clinic' });
    const hospitalsQ = useGetHospitalsQuery({ per_page: 300 }, { skip: !open || vertical !== 'hospital' });
    const patientsQ = useGetPatientsQuery({ per_page: 300 }, { skip: !open || vertical !== 'patient' });

    const verticalOptions = (verticals || [])
        .map((v) => ({ code: (v.code || '').toLowerCase(), name: v.name }))
        .filter((v) => ASSIGNABLE_VERTICALS.includes(v.code));

    let entityOptions = [];
    let entitiesLoading = false;
    if (vertical === 'doctor') {
        entitiesLoading = doctorsQ.isFetching;
        // Only plan-based doctors — employee/consultant doctors are mutually
        // exclusive with a membership tier (backend enforces the same).
        entityOptions = (doctorsQ.data?.doctors || [])
            .filter((d) => (d.billing_type || 'plan') === 'plan')
            .map((d) => ({ id: d.id, label: entityName(d) || 'Doctor' }));
    } else if (vertical === 'clinic') {
        entitiesLoading = clinicsQ.isFetching;
        entityOptions = (clinicsQ.data?.clinics || [])
            .map((c) => ({ id: c.id, label: entityName(c) || 'Clinic' }));
    } else if (vertical === 'hospital') {
        entitiesLoading = hospitalsQ.isFetching;
        entityOptions = (hospitalsQ.data?.hospitals || [])
            .map((h) => ({ id: h.id, label: entityName(h) || 'Hospital' }));
    } else if (vertical === 'patient') {
        entitiesLoading = patientsQ.isFetching;
        entityOptions = (patientsQ.data?.patients || [])
            .map((p) => ({ id: p.id, label: entityName(p) || 'Patient' }));
    }

    // Tiers for the selected vertical (or orphaned/null-vertical ones).
    const activePlans = (plans || []).filter((p) => {
        if (p.status !== 'active') return false;
        const code = (p.vertical_plan_type?.code || '').toLowerCase();
        return !vertical || !code || code === vertical;
    });

    // Reset when reopened.
    useMemo(() => { if (open) { setVertical(''); setEntity(null); setPlanId(''); } }, [open]);

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>Assign to a membership tier</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <Alert severity="info">
                        Puts the selected {vertical ? ENTITY_LABEL[vertical].toLowerCase() : 'member'} onto
                        the chosen tier and starts their trial. They can then pay to
                        activate — during the trial or after it ends.
                    </Alert>
                    <FormControl fullWidth size="small">
                        <InputLabel id="assign-vertical-label">Vertical</InputLabel>
                        <Select
                            labelId="assign-vertical-label" value={vertical} label="Vertical"
                            onChange={(e) => { setVertical(e.target.value); setEntity(null); setPlanId(''); }}
                        >
                            {verticalOptions.map((v) => (
                                <MenuItem key={v.code} value={v.code}>{v.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Autocomplete
                        size="small"
                        disabled={!vertical}
                        options={entityOptions}
                        loading={entitiesLoading}
                        getOptionLabel={(o) => o.label || ''}
                        isOptionEqualToValue={(o, v) => o.id === v.id}
                        value={entity}
                        onChange={(_, v) => setEntity(v)}
                        renderInput={(params) => (
                            <TextField
                                {...params}
                                label={vertical ? ENTITY_LABEL[vertical] : 'Select a vertical first'}
                                placeholder="Search"
                            />
                        )}
                    />
                    <FormControl fullWidth size="small" disabled={!vertical}>
                        <InputLabel id="assign-plan-label">Membership tier</InputLabel>
                        <Select
                            labelId="assign-plan-label" value={planId} label="Membership tier"
                            onChange={(e) => setPlanId(e.target.value)}
                        >
                            {activePlans.map((p) => (
                                <MenuItem key={p.id} value={p.id}>
                                    {p.name} — {planPriceLabel(p)}
                                    {p.vertical_plan_type?.name
                                        ? ` · ${p.vertical_plan_type.name}` : ''}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}>Cancel</Button>
                <Button
                    variant="contained"
                    disabled={busy || !vertical || !entity || !planId}
                    onClick={() => onAssign(vertical, entity.id, planId)}
                >
                    {busy ? 'Assigning…' : 'Assign'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}


export default function MembershipSubscriptionsAdmin() {
    const dispatch = useDispatch();
    const notify = (severity, message) =>
        dispatch(setSnackbar({ open: true, severity, message }));

    // Tab 0 is "All"; the rest are the tenant's authored verticals.
    const verticalsQ = useListVerticalTypesQuery();
    const verticals = verticalsQ.data || [];
    const [tab, setTab] = useState(0);
    const activeVertical = tab === 0 ? null : verticals[tab - 1];

    const subsQ = useListMembershipSubscriptionsQuery({
        planType: activeVertical?.id,
    });
    const plansQ = useListMembershipPlansQuery();

    const [changePlan, changeState] =
        useChangeMembershipSubscriptionPlanMutation();
    const [assignDoctor, assignState] = useAssignMembershipToDoctorMutation();
    const [assignOpen, setAssignOpen] = useState(false);
    const [setHold, holdState] = useSetSubscriptionHoldMutation();
    const [endTrial, endTrialState] = useEndSubscriptionTrialMutation();
    const [extendTrial, extendState] = useExtendSubscriptionTrialMutation();
    const [changeOpenFor, setChangeOpenFor] = useState(null);
    const [grantFor, setGrantFor] = useState(null);   // subscriber row for manual credits
    const [grantCredits, grantState] = useManualCreditGrantMutation();

    const handleGrantCredits = async (amount, note) => {
        try {
            await grantCredits({
                user_id: grantFor.user_id, amount: Number(amount), note,
            }).unwrap();
            notify('success', `Added ₹${Number(amount)} credits to ${grantFor.subscriber_display_name || 'member'}.`);
            setGrantFor(null);
        } catch (err) {
            notify('error', err?.data?.error || err?.data?.message || 'Failed to add credits.');
        }
    };

    const subscriptions = subsQ.data || [];
    const dialogBusy = changeState.isLoading || holdState.isLoading
        || endTrialState.isLoading || extendState.isLoading;

    const handleChangePlan = async (planId) => {
        try {
            await changePlan({
                id: changeOpenFor.id,
                membership_plan_id: planId,
            }).unwrap();
            notify('success', 'Membership plan updated.');
            setChangeOpenFor(null);
        } catch (err) {
            notify(
                'error',
                err?.data?.error || err?.data?.message
                    || 'Failed to update plan.',
            );
        }
    };

    const handleAssign = async (vertical, entityId, planId) => {
        try {
            await assignDoctor({
                vertical, entity_id: entityId, membership_plan_id: planId,
            }).unwrap();
            notify('success', `${vertical.charAt(0).toUpperCase()}${vertical.slice(1)} assigned to membership tier.`);
            setAssignOpen(false);
        } catch (err) {
            notify('error', err?.data?.error || err?.data?.message
                || 'Failed to assign doctor.');
        }
    };

    const handleSetHold = async (onHold) => {
        try {
            await setHold({ id: changeOpenFor.id, on_hold: onHold }).unwrap();
            notify('success', onHold ? 'Member placed on hold.' : 'Hold lifted.');
            setChangeOpenFor((s) => (s ? { ...s, on_hold: onHold } : s));
        } catch (err) {
            notify('error', err?.data?.error || err?.data?.message || 'Failed.');
        }
    };

    const handleEndTrial = async () => {
        try {
            await endTrial(changeOpenFor.id).unwrap();
            notify('success', 'Trial ended.');
            setChangeOpenFor((s) => (s ? { ...s, status: 'past_due' } : s));
        } catch (err) {
            notify('error', err?.data?.error || err?.data?.message || 'Failed.');
        }
    };

    const handleExtendTrial = async (days) => {
        try {
            const res = await extendTrial({ id: changeOpenFor.id, days }).unwrap();
            notify('success', `Trial extended by ${days} day(s).`);
            const newEnd = res?.data?.trial_ends_at;
            setChangeOpenFor((s) => (s ? { ...s, status: 'trial', trial_ends_at: newEnd } : s));
        } catch (err) {
            notify('error', err?.data?.error || err?.data?.message || 'Failed.');
        }
    };

    return (
        <Container maxWidth="lg" sx={{ mt: 3, mb: 6 }}>
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between"
                spacing={2} sx={{ mb: 1 }}>
                <Box>
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>
                        Membership Subscriptions
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        Everyone currently on one of your marketplace tiers, grouped by
                        vertical. Tiers are authored under{' '}
                        <strong>Membership Plans</strong>.
                    </Typography>
                </Box>
                <Button
                    variant="contained" startIcon={<PersonAddAlt1Icon />}
                    onClick={() => setAssignOpen(true)} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                >
                    Assign to tier
                </Button>
            </Stack>

            <Card>
                <CardContent>
                    {verticalsQ.isLoading ? (
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
                            {verticals.map((vt, i) => (
                                <Tab key={vt.id} label={vt.name} value={i + 1} />
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
                            Nobody is subscribed to{' '}
                            {activeVertical
                                ? `a ${activeVertical.name} tier`
                                : 'any membership tier'}{' '}
                            yet. Subscriptions appear here automatically when a
                            provider joins through your marketplace.
                        </Alert>
                    )}

                    {!subsQ.isLoading && !subsQ.error && subscriptions.length > 0 && (
                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Subscriber</TableCell>
                                        <TableCell>Vertical</TableCell>
                                        <TableCell>Current plan</TableCell>
                                        <TableCell>Status</TableCell>
                                        <TableCell>Since</TableCell>
                                        <TableCell align="right">Actions</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {subscriptions.map((s) => (
                                        <TableRow key={s.id} hover>
                                            <TableCell>
                                                {s.subscriber_display_name || s.id}
                                            </TableCell>
                                            <TableCell>
                                                {s.vertical_plan_type?.name
                                                    || s.provider_type || '—'}
                                            </TableCell>
                                            <TableCell>
                                                {s.plan_name || s.membership_plan_code || '—'}
                                                {s.plan_tier && (
                                                    <Chip
                                                        size="small"
                                                        variant="outlined"
                                                        sx={{ ml: 1, textTransform: 'capitalize' }}
                                                        label={s.plan_tier}
                                                    />
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <StatusChip status={s.display_state || s.status} />
                                            </TableCell>
                                            <TableCell>
                                                {s.current_period_start
                                                    ? new Date(s.current_period_start)
                                                        .toLocaleDateString()
                                                    : '—'}
                                            </TableCell>
                                            <TableCell align="right">
                                                <Tooltip title="Add health credits">
                                                    <span>
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => setGrantFor(s)}
                                                            disabled={!s.user_id}
                                                        >
                                                            <RedeemIcon fontSize="small" />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                                <Tooltip
                                                    title={
                                                        s.status === 'cancelled'
                                                            ? 'Cancelled memberships have no plan to change'
                                                            : 'Change plan'
                                                    }
                                                >
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
                onSetHold={handleSetHold}
                onEndTrial={handleEndTrial}
                onExtendTrial={handleExtendTrial}
                busy={dialogBusy}
            />

            <AssignEntityDialog
                open={assignOpen}
                onClose={() => setAssignOpen(false)}
                plans={plansQ.data}
                verticals={verticals}
                onAssign={handleAssign}
                busy={assignState.isLoading}
            />

            <GrantCreditsDialog
                open={!!grantFor}
                subscriber={grantFor}
                onClose={() => setGrantFor(null)}
                onGrant={handleGrantCredits}
                busy={grantState.isLoading}
            />
        </Container>
    );
}


function GrantCreditsDialog({ open, subscriber, onClose, onGrant, busy }) {
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');

    // Reset on open.
    useMemo(() => { if (open) { setAmount(''); setNote(''); } }, [open]);

    const amt = Number(amount);
    const valid = amt > 0;

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
            <DialogTitle>Add health credits</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <Alert severity="info">
                        Adds credits to <strong>{subscriber?.subscriber_display_name || 'this member'}</strong>’s
                        wallet immediately (1 credit = ₹1). A manual top-up, independent of their plan grant.
                    </Alert>
                    <TextField
                        label="Credits (₹)" type="number" size="small" autoFocus
                        value={amount} onChange={(e) => setAmount(e.target.value)}
                        inputProps={{ min: 1, step: 1 }}
                    />
                    <TextField
                        label="Note (optional)" size="small"
                        value={note} onChange={(e) => setNote(e.target.value)}
                        placeholder="e.g. goodwill / correction"
                    />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}>Cancel</Button>
                <Button variant="contained" disabled={busy || !valid}
                    onClick={() => onGrant(amt, note)}>
                    {busy ? 'Adding…' : 'Add credits'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
