/**
 * SubscriptionLifecycle — the vendor's manual controls over one tenant's
 * subscription, mirroring what the membership console gives its admins:
 * extend a trial, mark a period paid without a gateway round-trip,
 * suspend by hand, or lift a suspension.
 *
 * The copy states the safety rule plainly, because operators need to
 * trust it: a manual suspension turns access off but never starts a
 * countdown to deleting anyone's data.
 */
import { useState } from 'react';
import {
    Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle,
    MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import MoreTimeIcon from '@mui/icons-material/MoreTime';
import PaidOutlinedIcon from '@mui/icons-material/PaidOutlined';

import { useTenantSubscriptionLifecycleMutation } from
    '../../api/pricingEndpoints';

const PERIODS = [
    ['monthly', 'Monthly'], ['quarterly', 'Quarterly'],
    ['semi_annual', 'Half-yearly'], ['annual', 'Yearly'],
    ['biennial', '2-yearly'], ['triennial', '3-yearly'],
];

export default function SubscriptionLifecycle({ tenantId, sub, onDone }) {
    const [run, { isLoading }] = useTenantSubscriptionLifecycleMutation();
    const [notice, setNotice] = useState(null);
    const [dialog, setDialog] = useState(null);   // 'extend' | 'activate'
    const [days, setDays] = useState(14);
    const [period, setPeriod] = useState(sub?.billing_cycle || 'monthly');

    if (!sub) return null;
    const status = String(sub.status || '').toLowerCase();
    const suspended = status === 'suspended';

    const fire = async (action, body, confirm) => {
        if (confirm && !window.confirm(confirm)) return;
        setNotice(null);
        try {
            const res = await run({ tenantId, action, body }).unwrap();
            setNotice({ severity: 'success',
                text: res?.message || 'Done.' });
            setDialog(null);
            onDone?.();
        } catch (e) {
            setNotice({ severity: 'error',
                text: e?.data?.error || 'That did not go through.' });
        }
    };

    return (
        <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Lifecycle
            </Typography>
            <Typography variant="caption" color="text.secondary"
                sx={{ display: 'block', mb: 1.5 }}>
                Manual overrides on top of automatic billing. Suspending
                here turns access off and holds add-ons — it never
                schedules data for deletion.
            </Typography>

            {notice && (
                <Alert severity={notice.severity} sx={{ mb: 1.5 }}
                    onClose={() => setNotice(null)}>
                    {notice.text}
                </Alert>
            )}

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button size="small" variant="outlined"
                    startIcon={<MoreTimeIcon />} disabled={isLoading}
                    onClick={() => { setDays(14); setDialog('extend'); }}>
                    Extend trial
                </Button>
                <Button size="small" variant="outlined"
                    startIcon={<PaidOutlinedIcon />} disabled={isLoading}
                    onClick={() => {
                        setPeriod(sub.billing_cycle || 'monthly');
                        setDialog('activate');
                    }}>
                    Mark paid
                </Button>
                {suspended ? (
                    <Button size="small" variant="contained" color="success"
                        startIcon={<CheckCircleOutlineIcon />}
                        disabled={isLoading}
                        onClick={() => fire('restore', null,
                            'Lift the suspension for this tenant?')}>
                        Restore
                    </Button>
                ) : (
                    <Button size="small" variant="outlined" color="error"
                        startIcon={<BlockIcon />} disabled={isLoading}
                        onClick={() => fire('suspend', null,
                            'Suspend this subscription? The tenant will see '
                            + 'the sign-in-and-pay page. Their data is not '
                            + 'touched.')}>
                        Suspend billing
                    </Button>
                )}
            </Stack>

            <Dialog open={dialog === 'extend'} onClose={() => setDialog(null)}
                fullWidth maxWidth="xs">
                <DialogTitle>Extend trial</DialogTitle>
                <DialogContent dividers>
                    <TextField
                        autoFocus type="number" size="small" fullWidth
                        label="Days to add" value={days}
                        inputProps={{ min: 1, max: 365 }}
                        onChange={(e) => setDays(Number(e.target.value))}
                        helperText="Extends from the current trial end, or
                            from today if the trial already lapsed."
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialog(null)}>Cancel</Button>
                    <Button variant="contained" disabled={isLoading || days < 1}
                        onClick={() => fire('extend-trial', { days })}>
                        Extend
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={dialog === 'activate'} onClose={() => setDialog(null)}
                fullWidth maxWidth="xs">
                <DialogTitle>Mark paid</DialogTitle>
                <DialogContent dividers>
                    <TextField
                        select size="small" fullWidth label="Period to grant"
                        value={period}
                        onChange={(e) => setPeriod(e.target.value)}
                        helperText="Grants one paid period without taking
                            payment — for an offline payment or a comped
                            account."
                    >
                        {PERIODS.map(([v, l]) => (
                            <MenuItem key={v} value={v}>{l}</MenuItem>
                        ))}
                    </TextField>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialog(null)}>Cancel</Button>
                    <Button variant="contained" disabled={isLoading}
                        onClick={() => fire('activate', { period })}>
                        Mark paid
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
}
