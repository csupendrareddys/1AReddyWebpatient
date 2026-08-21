/**
 * CreditPoliciesAdmin — the dedicated surface for each membership plan's health
 * credits: how many ₹ credits it grants per period, and the per-offering
 * redemption caps (max % of the price AND an absolute ₹ ceiling — the lower
 * wins).
 *
 * Kept OFF the plan dialog on purpose: constraints edited here take effect
 * immediately for every current member (the backend reads the live
 * ``CreditPolicy`` by plan at grant / quote time), so retuning a cap never
 * needs a plan re-version or a renewal. Credits are a wallet-everywhere
 * mechanism — the ``Membership renewal`` scope even lets a provider (doctor)
 * spend credits toward renewing their own plan.
 */
import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
    Box, Paper, Typography, Stack, Chip, TextField, Switch, Button, Divider,
    Table, TableHead, TableBody, TableRow, TableCell, CircularProgress,
    Alert, FormControlLabel,
} from '@mui/material';
import RedeemIcon from '@mui/icons-material/Redeem';

import { setSnackbar } from '../../redux/adminSharedUiSlice';
import {
    useListCreditPoliciesQuery,
    useUpsertCreditPolicyMutation,
} from '../../api/membershipEndpoints';
import { CREDIT_SCOPES } from '../utils/creditScopes';

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

function CreditPolicyCard({ row }) {
    const dispatch = useDispatch();
    const [save, { isLoading }] = useUpsertCreditPolicyMutation();

    const seed = () => ({
        grant_amount: row.policy?.grant_amount ?? 0,
        is_active: row.policy?.is_active ?? true,
        // '' = no expiry override (grants expire at the billing-period end).
        validity_days: row.policy?.validity_days ?? '',
        second_opinion_grant: row.policy?.second_opinion_grant ?? 0,
        second_opinion_redeem_threshold: row.policy?.second_opinion_redeem_threshold ?? 0,
        second_opinion_grants: { ...(row.policy?.second_opinion_grants || {}) },
        second_opinion_pct: row.policy?.second_opinion_pct ?? 0,
        second_opinion_pcts: { ...(row.policy?.second_opinion_pcts || {}) },
        scopes: { ...(row.policy?.scopes || {}) },
    });
    const [draft, setDraft] = useState(seed);

    // Re-seed if the server row changes underneath us (e.g. after a save
    // elsewhere or a refetch) — but only when not mid-edit is overkill here;
    // the list invalidates on save so a fresh row is the source of truth.
    useEffect(() => {
        setDraft(seed());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row.policy?.grant_amount, row.policy?.is_active,
        row.policy?.validity_days, row.policy?.second_opinion_grant,
        row.policy?.second_opinion_redeem_threshold,
        row.policy?.second_opinion_pct,
        JSON.stringify(row.policy?.second_opinion_grants),
        JSON.stringify(row.policy?.second_opinion_pcts),
        JSON.stringify(row.policy?.scopes)]);

    const grant = Number(draft.grant_amount) || 0;
    const scopeCfg = (key) => draft.scopes[key] || {};
    const setScope = (key, patch) => setDraft((d) => ({
        ...d,
        scopes: { ...d.scopes, [key]: { ...(d.scopes[key] || {}), ...patch } },
    }));

    const onSave = async () => {
        try {
            await save({
                plan_id: row.plan_id,
                grant_amount: grant,
                is_active: draft.is_active,
                validity_days: draft.validity_days === '' ? null : Number(draft.validity_days),
                second_opinion_grant: Number(draft.second_opinion_grant) || 0,
                second_opinion_redeem_threshold: Number(draft.second_opinion_redeem_threshold) || 0,
                second_opinion_grants: draft.second_opinion_grants,
                second_opinion_pct: Number(draft.second_opinion_pct) || 0,
                second_opinion_pcts: draft.second_opinion_pcts,
                scopes: draft.scopes,
            }).unwrap();
            dispatch(setSnackbar({
                open: true, severity: 'success',
                message: `Credits for "${row.name}" saved — live for all members.`,
            }));
        } catch (err) {
            dispatch(setSnackbar({
                open: true, severity: 'error',
                message: err?.data?.error || 'Save failed',
            }));
        }
    };

    return (
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                <RedeemIcon color="success" />
                <Typography variant="subtitle1" fontWeight={700}>{row.name}</Typography>
                {row.vertical_label && (
                    <Chip size="small" label={row.vertical_label}
                        color={row.is_receiver ? 'secondary' : 'primary'} variant="outlined" />
                )}
                <Chip size="small" label={row.is_receiver ? 'Receiver' : 'Provider'} variant="outlined" />
                <Chip size="small" label={row.status}
                    color={row.status === 'active' ? 'success' : 'default'} variant="outlined" />
                <Box sx={{ flex: 1 }} />
                <FormControlLabel
                    control={<Switch size="small" checked={!!draft.is_active}
                        onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))} />}
                    label="Redemption on"
                />
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mb: 1.5 }}>
                <TextField
                    label="Credits granted / period (₹)"
                    type="number"
                    size="small"
                    inputProps={{ min: 0, step: 1 }}
                    value={draft.grant_amount ?? 0}
                    onChange={(e) => setDraft((d) => ({
                        ...d, grant_amount: e.target.value === '' ? 0 : Number(e.target.value),
                    }))}
                    helperText="₹ credits the member gets each cycle (no rollover). 0 = none."
                    sx={{ width: 260 }}
                />
                <TextField
                    label="Credit validity (days)"
                    type="number"
                    size="small"
                    inputProps={{ min: 0, step: 1 }}
                    value={draft.validity_days ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, validity_days: e.target.value }))}
                    helperText="Days a grant stays valid. Blank = until billing-period end. Applies to all current members immediately."
                    sx={{ width: 260 }}
                />
            </Stack>

            {/* Second-opinion credits are earned only by DOCTORS (a family
                doctor's referral commission on their empanelled patient's
                bookings). They never apply to a receiver/patient plan, so the
                whole block is hidden there. */}
            {!row.is_receiver && (
                <>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mb: 1.5 }}>
                        <TextField
                            label="Second-opinion grant — default (credits)"
                            type="number"
                            size="small"
                            inputProps={{ min: 0, step: 1 }}
                            value={draft.second_opinion_grant ?? 0}
                            onChange={(e) => setDraft((d) => ({ ...d, second_opinion_grant: e.target.value }))}
                            helperText="Fallback credits per completed booking (used when a per-type value below is blank). 0 = off. Overridable per-doctor."
                            sx={{ width: 260 }}
                        />
                        <TextField
                            label="Second-opinion grant — default (% of cost)"
                            type="number"
                            size="small"
                            inputProps={{ min: 0, max: 100, step: 0.5 }}
                            value={draft.second_opinion_pct ?? 0}
                            onChange={(e) => setDraft((d) => ({ ...d, second_opinion_pct: e.target.value }))}
                            helperText="Credits as a % of the booking amount. If both flat and % are set, the LOWER of the two is granted. 0 = off."
                            sx={{ width: 260 }}
                        />
                        <TextField
                            label="Second-opinion redeem threshold"
                            type="number"
                            size="small"
                            inputProps={{ min: 0, step: 1 }}
                            value={draft.second_opinion_redeem_threshold ?? 0}
                            onChange={(e) => setDraft((d) => ({ ...d, second_opinion_redeem_threshold: e.target.value }))}
                            helperText="Minimum credits a doctor must hold before redeeming to cash."
                            sx={{ width: 260 }}
                        />
                    </Stack>

                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, mb: 0.5 }}>
                        Per-type second-opinion grant (blank = use the default above):
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        {[
                            { k: 'consultation', label: 'Consultation' },
                            { k: 'service', label: 'Service' },
                            { k: 'group', label: 'Group plan' },
                        ].map(({ k, label }) => (
                            <TextField
                                key={k}
                                label={`${label} (credits)`}
                                type="number"
                                size="small"
                                inputProps={{ min: 0, step: 1 }}
                                value={draft.second_opinion_grants?.[k] ?? ''}
                                onChange={(e) => setDraft((d) => ({
                                    ...d,
                                    second_opinion_grants: {
                                        ...d.second_opinion_grants,
                                        [k]: e.target.value === '' ? undefined : Number(e.target.value),
                                    },
                                }))}
                                sx={{ width: 200 }}
                            />
                        ))}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, mb: 0.5 }}>
                        Per-type second-opinion % of cost (blank = use the default % above):
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        {[
                            { k: 'consultation', label: 'Consultation' },
                            { k: 'service', label: 'Service' },
                            { k: 'group', label: 'Group plan' },
                        ].map(({ k, label }) => (
                            <TextField
                                key={k}
                                label={`${label} (% of cost)`}
                                type="number"
                                size="small"
                                inputProps={{ min: 0, max: 100, step: 0.5 }}
                                value={draft.second_opinion_pcts?.[k] ?? ''}
                                onChange={(e) => setDraft((d) => ({
                                    ...d,
                                    second_opinion_pcts: {
                                        ...d.second_opinion_pcts,
                                        [k]: e.target.value === '' ? undefined : Number(e.target.value),
                                    },
                                }))}
                                sx={{ width: 200 }}
                            />
                        ))}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, mb: 1.5 }}>
                        1 credit = ₹1. When a type has both a flat and a % value, the doctor is granted the LOWER of the two.
                        Redeemable up to the lower of Max % of the price and Max ₹, capped by balance.
                    </Typography>
                </>
            )}

            <Divider sx={{ mb: 1 }} />
            <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Where credits apply</TableCell>
                            <TableCell align="center">Allowed</TableCell>
                            <TableCell align="right">Max %</TableCell>
                            <TableCell align="right">Max ₹</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {CREDIT_SCOPES.map((s) => {
                            const cfg = scopeCfg(s.key);
                            const disabled = !draft.is_active || grant <= 0;
                            return (
                                <TableRow key={s.key}>
                                    <TableCell>{s.label}</TableCell>
                                    <TableCell align="center">
                                        <Switch size="small" checked={!!cfg.allowed} disabled={disabled}
                                            onChange={(e) => setScope(s.key, { allowed: e.target.checked })} />
                                    </TableCell>
                                    <TableCell align="right">
                                        <TextField type="number" size="small" disabled={disabled || !cfg.allowed}
                                            value={cfg.max_pct ?? ''} placeholder="—"
                                            onChange={(e) => setScope(s.key, { max_pct: numOrNull(e.target.value) })}
                                            inputProps={{ min: 0, max: 100 }} sx={{ width: 80 }} />
                                    </TableCell>
                                    <TableCell align="right">
                                        <TextField type="number" size="small" disabled={disabled || !cfg.allowed}
                                            value={cfg.max_amount ?? ''} placeholder="—"
                                            onChange={(e) => setScope(s.key, { max_amount: numOrNull(e.target.value) })}
                                            inputProps={{ min: 0 }} sx={{ width: 90 }} />
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </Box>

            <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1.5 }}>
                <Button variant="contained" onClick={onSave} disabled={isLoading}>
                    {isLoading ? 'Saving…' : 'Save credits'}
                </Button>
            </Stack>
        </Paper>
    );
}

export default function CreditPoliciesAdmin() {
    const { data: rows = [], isLoading, error } = useListCreditPoliciesQuery();

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1000, mx: 'auto' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <RedeemIcon color="success" />
                <Typography variant="h5" fontWeight={800}>Health Credits</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                Set how many credits each plan grants per period and where they can be redeemed.
                Changes here are live immediately for every current member — no plan re-version, no renewal.
            </Typography>

            {isLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
            )}
            {error && <Alert severity="error">Couldn’t load credit policies.</Alert>}

            {!isLoading && !error && rows.length === 0 && (
                <Alert severity="info">No membership plans yet — create a plan first.</Alert>
            )}

            <Stack spacing={2}>
                {rows.map((row) => <CreditPolicyCard key={row.plan_id} row={row} />)}
            </Stack>
        </Box>
    );
}
