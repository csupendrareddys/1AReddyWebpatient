/**
 * ChangeChildPlanDialog — move one child tenant onto another of the
 * apex's own plans. Children are seller-billed, so the change is
 * immediate: the backend re-points the subscription and rebuilds its
 * snapshot, clamped to the child's own hosting track.
 */
import { useState } from 'react';
import {
    Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle,
    MenuItem, Stack, TextField, Typography,
} from '@mui/material';

import { useListPlansQuery } from '../../api/pricingEndpoints';
import { useUpdateResellerTenantMutation } from '../api/resellerEndpoints';

const CYCLES = [
    ['monthly', 'Monthly'], ['quarterly', 'Quarterly'],
    ['semi_annual', 'Semi-annual'], ['annual', 'Annual'],
    ['biennial', '2-yearly'], ['triennial', '3-yearly'],
];

export default function ChangeChildPlanDialog({ child, initial, onClose }) {
    const { data: plans = [] } = useListPlansQuery('reseller');
    const [updateTenant, { isLoading }] = useUpdateResellerTenantMutation();
    const [planCode, setPlanCode] = useState(initial || '');
    const [cycle, setCycle] = useState(
        child.subscription?.billing_cycle || 'monthly');
    const [error, setError] = useState(null);

    const active = plans.filter((p) => p.status === 'active');

    const save = async () => {
        setError(null);
        try {
            await updateTenant({
                id: child.id,
                data: { plan_code: planCode, billing_cycle: cycle },
            }).unwrap();
            onClose(true);
        } catch (e) {
            const errs = e?.data?.errors;
            setError(errs
                ? Object.values(errs).flat().join(' ')
                : e?.data?.error || 'Plan change failed.');
        }
    };

    return (
        <Dialog open onClose={() => onClose(false)} fullWidth maxWidth="xs">
            <DialogTitle>Change plan — {child.name}</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2} sx={{ mt: 0.5 }}>
                    {error && <Alert severity="error">{error}</Alert>}
                    <TextField
                        select label="Plan" size="small" value={planCode}
                        onChange={(e) => setPlanCode(e.target.value)}
                    >
                        {active.map((p) => (
                            <MenuItem key={p.code} value={p.code}>
                                {p.name} ({p.code})
                            </MenuItem>
                        ))}
                    </TextField>
                    <TextField
                        select label="Billing cycle" size="small" value={cycle}
                        onChange={(e) => setCycle(e.target.value)}
                    >
                        {CYCLES.map(([v, l]) => (
                            <MenuItem key={v} value={v}>{l}</MenuItem>
                        ))}
                    </TextField>
                    <Typography variant="caption" color="text.secondary">
                        Takes effect immediately — the tenant&apos;s
                        entitlements re-resolve from the new plan. The new
                        plan must fit this tenant&apos;s hosting track.
                    </Typography>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => onClose(false)}>Cancel</Button>
                <Button variant="contained" onClick={save}
                    disabled={isLoading || !planCode}>
                    {isLoading ? 'Changing…' : 'Change plan'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
