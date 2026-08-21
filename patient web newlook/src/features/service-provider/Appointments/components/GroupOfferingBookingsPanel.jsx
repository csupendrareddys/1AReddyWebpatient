/**
 * GroupOfferingBookingsPanel — the team lead accepts (or rejects) paid group
 * offering bookings, mirroring the service-order accept flow. Accepting opens
 * the team's group + per-doctor chat channels and starts the plan.
 *
 * Hooks come from ``scopedDoctorApi`` because admin Operations mounts this too:
 * there the lead is the doctor being managed, not the admin, whose own teams
 * (if any) are a different set entirely.
 */
import {
    Box, Paper, Typography, Stack, Button, Chip, CircularProgress, Alert, Snackbar,
    Tabs, Tab,
} from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CancelIcon from '@mui/icons-material/Cancel';
import { useState } from 'react';

import {
    useGetIncomingPlanBookingsQuery,
    useAcceptPlanBookingMutation,
    useRejectPlanBookingMutation,
} from '../../api/scopedDoctorApi';

// Plan lifecycle buckets, mirroring the marketplace Service List.
const STATUS_META = {
    pending_acceptance: { label: 'To review', color: 'warning' },
    active: { label: 'In process', color: 'info' },
    completed: { label: 'Completed', color: 'success' },
    cancelled: { label: 'Cancelled', color: 'error' },
};
const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'pending_acceptance', label: 'To Review' },
    { key: 'active', label: 'In Process' },
    { key: 'completed', label: 'Completed' },
    { key: 'cancelled', label: 'Cancelled' },
];

export default function GroupOfferingBookingsPanel() {
    const { data: bookings = [], isLoading } = useGetIncomingPlanBookingsQuery();
    const [acceptBooking] = useAcceptPlanBookingMutation();
    const [rejectBooking] = useRejectPlanBookingMutation();
    const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });
    const [filter, setFilter] = useState('all');
    const notify = (message, severity = 'info') => setSnack({ open: true, message, severity });

    const shown = filter === 'all' ? bookings : bookings.filter((b) => b.status === filter);

    const onAccept = async (b) => {
        try {
            await acceptBooking(b.booking_id).unwrap();
            notify('Plan accepted — the team channels are now open.', 'success');
        } catch (e) {
            notify(e?.data?.message || e?.data?.error || 'Accept failed', 'error');
        }
    };
    const onReject = async (b) => {
        if (!window.confirm('Reject this plan booking? (refunds are handled separately)')) return;
        try {
            await rejectBooking(b.booking_id).unwrap();
            notify('Plan booking rejected.', 'info');
        } catch (e) {
            notify(e?.data?.message || e?.data?.error || 'Reject failed', 'error');
        }
    };

    return (
        <Box>
            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                <GroupsIcon color="secondary" sx={{ fontSize: 28 }} />
                <Typography variant="h5" fontWeight="bold">My Group Offering</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" mb={2}>
                Plan bookings on teams you lead, across their lifecycle. Accept a
                <em> To Review</em> booking to open the group + per-doctor chat and start the
                plan — the same flow as a service order.
            </Typography>

            <Tabs value={filter} onChange={(_, v) => setFilter(v)} sx={{ mb: 2 }}
                variant="scrollable" scrollButtons="auto">
                {FILTERS.map((f) => {
                    const count = f.key === 'all' ? bookings.length
                        : bookings.filter((b) => b.status === f.key).length;
                    return <Tab key={f.key} value={f.key} label={`${f.label} (${count})`} />;
                })}
            </Tabs>

            {isLoading ? (
                <Box display="flex" justifyContent="center" mt={6}><CircularProgress /></Box>
            ) : shown.length === 0 ? (
                <Alert severity="info">No plan bookings in this bucket.</Alert>
            ) : (
                <Stack spacing={1.5}>
                    {shown.map((b) => {
                        const meta = STATUS_META[b.status] || { label: b.status, color: 'default' };
                        const canAct = b.status === 'pending_acceptance';
                        return (
                            <Paper key={b.booking_id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                                <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                                    <Box>
                                        <Typography variant="subtitle1" fontWeight={700}>{b.plan_name}</Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            Patient: {b.patient_name || '—'} · Paid ₹{b.total_payable}
                                        </Typography>
                                    </Box>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <Chip size="small" label={meta.label} color={meta.color} />
                                        {canAct && (
                                            <>
                                                <Button size="small" variant="contained" color="secondary"
                                                    startIcon={<PlayArrowIcon />} onClick={() => onAccept(b)}>
                                                    Accept
                                                </Button>
                                                <Button size="small" variant="outlined" color="error"
                                                    startIcon={<CancelIcon />} onClick={() => onReject(b)}>
                                                    Reject
                                                </Button>
                                            </>
                                        )}
                                    </Stack>
                                </Stack>
                            </Paper>
                        );
                    })}
                </Stack>
            )}

            <Snackbar open={snack.open} autoHideDuration={4000}
                onClose={() => setSnack((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snack.severity} variant="filled">{snack.message}</Alert>
            </Snackbar>
        </Box>
    );
}
