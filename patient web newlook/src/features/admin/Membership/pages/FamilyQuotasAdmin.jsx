/**
 * FamilyQuotasAdmin — per-plan Patient Family quotas.
 *
 * A patient's family members (minors, linked adults) and the roles they author
 * never buy their own membership plan — they're covered by the OWNER's plan.
 * So the plan decides how many of each the owner may create. Only RECEIVER
 * (patient) plans are shown: quotas bind a patient owner, never a provider.
 *
 * Sentinels: -1 = unlimited, 0 = none (deny). Kept off the plan dialog (mirrors
 * Health Credits / Charges) so a cap retunes live — enforced at the next create
 * for every owner on the plan, no plan re-version or renewal.
 */
import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
    Box, Paper, Typography, Stack, Chip, TextField, Switch, Button, Divider,
    CircularProgress, Alert, FormControlLabel,
} from '@mui/material';
import FamilyRestroomIcon from '@mui/icons-material/FamilyRestroom';

import { setSnackbar } from '../../redux/adminSharedUiSlice';
import {
    useListFamilyPoliciesQuery,
    useUpsertFamilyPolicyMutation,
} from '../../api/membershipEndpoints';

const CAPS = [
    { key: 'max_minor_subaccounts', label: 'Minor profiles',
      help: 'Login-less child/dependent profiles the owner can add.' },
    { key: 'max_family_links', label: 'Linked adults',
      help: 'Adult family members the owner can reciprocally link.' },
    { key: 'max_patient_roles', label: 'Family roles',
      help: 'Custom roles the owner can author to grant linked adults.' },
];

// -1 unlimited, 0 none, else the number. Renders -1 as the ∞ affordance.
const capHelper = (v) => {
    const n = Number(v);
    if (n === -1) return 'Unlimited';
    if (n === 0) return 'None allowed';
    return `Up to ${n}`;
};

function FamilyQuotaCard({ row }) {
    const dispatch = useDispatch();
    const [save, { isLoading }] = useUpsertFamilyPolicyMutation();

    const seed = () => ({
        max_minor_subaccounts: row.policy?.max_minor_subaccounts ?? 0,
        max_family_links: row.policy?.max_family_links ?? 0,
        max_patient_roles: row.policy?.max_patient_roles ?? 0,
        is_active: row.policy?.is_active ?? true,
    });
    const [draft, setDraft] = useState(seed);

    useEffect(() => {
        setDraft(seed());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row.policy?.max_minor_subaccounts, row.policy?.max_family_links,
        row.policy?.max_patient_roles, row.policy?.is_active]);

    const setCap = (key) => (e) => {
        const raw = e.target.value;
        setDraft((d) => ({ ...d, [key]: raw === '' ? 0 : Math.max(-1, Math.trunc(Number(raw))) }));
    };

    const onSave = async () => {
        try {
            await save({
                plan_id: row.plan_id,
                max_minor_subaccounts: Number(draft.max_minor_subaccounts) || 0,
                max_family_links: Number(draft.max_family_links) || 0,
                max_patient_roles: Number(draft.max_patient_roles) || 0,
                is_active: draft.is_active,
            }).unwrap();
            dispatch(setSnackbar({
                open: true, severity: 'success',
                message: `Family quotas for "${row.name}" saved.`,
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
                <FamilyRestroomIcon color="secondary" />
                <Typography variant="subtitle1" fontWeight={700}>{row.name}</Typography>
                {row.vertical_label && (
                    <Chip size="small" label={row.vertical_label} color="secondary" variant="outlined" />
                )}
                <Chip size="small" label={row.status}
                    color={row.status === 'active' ? 'success' : 'default'} variant="outlined" />
                <Box sx={{ flex: 1 }} />
                <FormControlLabel
                    control={<Switch size="small" checked={!!draft.is_active}
                        onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))} />}
                    label="Quotas on"
                />
            </Stack>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Use <b>-1</b> for unlimited, <b>0</b> to disallow. When quotas are off, plan-default
                limits apply.
            </Typography>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                {CAPS.map((c) => (
                    <TextField
                        key={c.key}
                        label={c.label}
                        type="number"
                        size="small"
                        inputProps={{ min: -1, step: 1 }}
                        value={draft[c.key] ?? 0}
                        onChange={setCap(c.key)}
                        helperText={`${capHelper(draft[c.key])} — ${c.help}`}
                        sx={{ width: 260 }}
                    />
                ))}
            </Stack>

            <Divider sx={{ my: 2 }} />
            <Stack direction="row" justifyContent="flex-end">
                <Button variant="contained" onClick={onSave} disabled={isLoading}>
                    {isLoading ? 'Saving…' : 'Save quotas'}
                </Button>
            </Stack>
        </Paper>
    );
}

export default function FamilyQuotasAdmin() {
    const { data: rows = [], isLoading, error } = useListFamilyPoliciesQuery();
    // Quotas only bind a patient owner — show receiver plans only.
    const receiverRows = rows.filter((r) => r.is_receiver);

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1000, mx: 'auto' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <FamilyRestroomIcon color="secondary" />
                <Typography variant="h5" fontWeight={800}>Family Quotas</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                Set how many minor profiles, linked adults, and family roles each receiver
                (patient) plan lets an owner create. Members don’t buy their own plan — the
                owner’s plan covers them. Changes apply on the next create.
            </Typography>

            {isLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
            )}
            {error && <Alert severity="error">Couldn’t load family quotas.</Alert>}

            {!isLoading && !error && receiverRows.length === 0 && (
                <Alert severity="info">
                    No receiver (patient) plans yet — create a patient membership plan first.
                </Alert>
            )}

            <Stack spacing={2}>
                {receiverRows.map((row) => <FamilyQuotaCard key={row.plan_id} row={row} />)}
            </Stack>
        </Box>
    );
}
