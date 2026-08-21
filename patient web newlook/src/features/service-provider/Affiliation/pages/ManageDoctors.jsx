/**
 * ManageDoctors — facility-admin view of the apex-marketplace
 * affiliation roster. Lists current doctors + pending requests and
 * exposes the "Add Doctor" dialog with two tabs (Enter code / Create
 * new doctor).
 *
 * Mounted at /dashboard/hospital/doctors, /dashboard/clinic/doctors, and
 * /dashboard/staff/doctors — the facility's own support staff get the same
 * page, showing their employer's roster, because the endpoints resolve the
 * practice from the principal rather than from the signed-in user. What
 * differs for them is which controls appear; see ``useProviderCan``.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress,
    Snackbar, Stack, Tab, Tabs, Typography,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';

import useProviderCan from '../../../staff/hooks/useProviderCan';
import {
    useListFacilityDoctorsQuery,
    useCancelFacilityRequestMutation,
} from '../api/scopedAffiliationApi';

// The catalog leaf the invite/cancel controls are gated on — the same path the
// backend checks, spelled once.
const M_INVITATIONS = 'doctors_network.manage_doctors.invitations';

import AddDoctorDialog from '../components/AddDoctorDialog';

const STATUS_COLORS = {
    pending: 'warning',
    approved: 'success',
    rejected: 'default',
    cancelled: 'default',
};

const formatDate = (iso) => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return iso;
    }
};

export default function ManageDoctors() {
    // Shared with the facility's own staff, who reach this from
    // /dashboard/staff/doctors. They may hold view without invite, so the
    // write controls are asked for rather than assumed. A clinic or hospital
    // admin gets ``true`` for everything without a round trip.
    const { can } = useProviderCan();
    const canInvite = can(M_INVITATIONS, 'can_create');
    const canCancel = can(M_INVITATIONS, 'can_delete');

    const [tab, setTab] = useState(0); // 0=current,1=pending,2=history
    const [addOpen, setAddOpen] = useState(false);
    const [snack, setSnack] = useState({ open: false, sev: 'info', msg: '' });

    const notify = (sev, msg) => setSnack({ open: true, sev, msg });
    const errText = (err) =>
        err?.data?.error || err?.data?.message || err?.error || 'Operation failed.';

    const {
        data: affiliations = [], isLoading, error, refetch,
    } = useListFacilityDoctorsQuery();
    const [cancelRequest, { isLoading: cancelling }] = useCancelFacilityRequestMutation();

    const handleCancel = async (id) => {
        try {
            await cancelRequest(id).unwrap();
            notify('success', 'Request cancelled.');
            refetch();
        } catch (e) {
            notify('error', errText(e));
        }
    };

    const approved = affiliations.filter((a) => a.status === 'approved');
    const pending = affiliations.filter((a) => a.status === 'pending');
    const history = affiliations.filter(
        (a) => a.status === 'rejected' || a.status === 'cancelled',
    );

    const lists = [approved, pending, history];
    const counts = lists.map((l) => l.length);

    return (
        <Box sx={{ maxWidth: 1100, mx: 'auto', py: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
                <Box>
                    <Typography variant="h4">Manage doctors</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Add doctors who practice at your facility. Patients on
                        the larazen marketplace can then book them through your
                        facility profile.
                    </Typography>
                </Box>
                {canInvite && (
                    <Button
                        variant="contained"
                        size="large"
                        startIcon={<PersonAddIcon />}
                        onClick={() => setAddOpen(true)}
                    >
                        Add doctor
                    </Button>
                )}
            </Stack>

            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
                <Tab label={`Current (${counts[0]})`} />
                <Tab label={`Pending (${counts[1]})`} />
                <Tab label={`History (${counts[2]})`} />
            </Tabs>

            {isLoading ? (
                <CircularProgress size={24} />
            ) : error ? (
                <Alert severity="error">{errText(error)}</Alert>
            ) : lists[tab].length === 0 ? (
                <Alert severity="info">
                    {tab === 0
                        ? (canInvite
                            ? 'No doctors on your roster yet. Click "Add doctor" to invite or create one.'
                            : 'No doctors on this roster yet.')
                        : tab === 1
                            ? 'No pending requests. Outgoing invites awaiting doctor approval will show up here.'
                            : 'No historical rejected or cancelled requests.'}
                </Alert>
            ) : (
                <Stack spacing={2}>
                    {lists[tab].map((a) => (
                        <Card key={a.id} variant="outlined">
                            <CardContent>
                                <Stack
                                    direction={{ xs: 'column', sm: 'row' }}
                                    justifyContent="space-between"
                                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                                    spacing={2}
                                >
                                    <Box>
                                        <Stack direction="row" spacing={1} alignItems="center">
                                            <Typography variant="subtitle1">
                                                {a.doctor_name || 'Unnamed doctor'}
                                            </Typography>
                                            <Chip
                                                label={a.status}
                                                size="small"
                                                color={STATUS_COLORS[a.status] || 'default'}
                                            />
                                            {a.request_method && (
                                                <Chip
                                                    label={
                                                        a.request_method === 'code' ? 'invite-code'
                                                        : a.request_method === 'invite' ? 'invited'
                                                        : a.request_method
                                                    }
                                                    size="small" variant="outlined"
                                                />
                                            )}
                                            {a.doctor_pending_activation && (
                                                <Chip
                                                    label="awaiting activation"
                                                    size="small" color="warning" variant="outlined"
                                                />
                                            )}
                                        </Stack>
                                        <Typography variant="caption" color="text.secondary">
                                            {a.doctor_phone && `${a.doctor_phone} · `}
                                            {a.doctor_email && `${a.doctor_email} · `}
                                            {a.employment_type?.replace('_', ' ')}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                            Requested {formatDate(a.requested_at)}
                                            {a.responded_at && ` · responded ${formatDate(a.responded_at)}`}
                                            {a.rejection_reason && ` · "${a.rejection_reason}"`}
                                        </Typography>
                                    </Box>
                                    {a.status === 'pending' && canCancel && (
                                        <Button
                                            size="small"
                                            color="error"
                                            onClick={() => handleCancel(a.id)}
                                            disabled={cancelling}
                                        >
                                            Cancel request
                                        </Button>
                                    )}
                                </Stack>
                            </CardContent>
                        </Card>
                    ))}
                </Stack>
            )}

            <AddDoctorDialog
                open={addOpen}
                onClose={() => setAddOpen(false)}
                onResult={(sev, msg) => notify(sev, msg)}
            />

            <Snackbar
                open={snack.open}
                autoHideDuration={5000}
                onClose={() => setSnack((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    severity={snack.sev}
                    onClose={() => setSnack((s) => ({ ...s, open: false }))}
                    variant="filled" elevation={6}
                >
                    {snack.msg}
                </Alert>
            </Snackbar>
        </Box>
    );
}
