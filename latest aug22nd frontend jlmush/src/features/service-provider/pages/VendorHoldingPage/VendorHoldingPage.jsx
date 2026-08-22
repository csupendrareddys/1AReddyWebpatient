/**
 * VendorHoldingPage — the whole app for a HELD vendor.
 *
 * A vendor who is pending verification, marked inactive, or past their trial
 * sees only this: a chat with the admin team (chat + documents both ways). The
 * vendor cannot schedule calls — only the admin can. Rendered in place of the
 * doctor dashboard by DoctorLayout when the account is held.
 */
import { Box, Paper, Typography, Alert, CircularProgress, Stack, Button } from '@mui/material';
import LockClockOutlinedIcon from '@mui/icons-material/LockClockOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { logoutUser } from '../../../auth/redux/authSlice';
import { useGetAccountStateQuery } from '../../api/doctorEndpoints';
import { useGetServiceChannelQuery } from '../../../admin/api/serviceCommunicationEndpoints';
import ChannelChat from '../../../communication/components/ChannelChat';
import ChannelDocumentsPanel from '../../../communication/components/ChannelDocumentsPanel';
import ScheduledCallsPanel from '../../../communication/components/ScheduledCallsPanel';
import MembershipPlansPanel from '../../Membership/components/MembershipPlansPanel/MembershipPlansPanel';

const REASON = {
    pending_verification: {
        title: 'Your account is under review',
        body: 'Our team is verifying your details. You can chat with us and share any '
            + 'documents we ask for below — we’ll activate your account as soon as it’s done.',
        severity: 'info',
    },
    inactive: {
        title: 'Your account is currently inactive',
        body: 'Your account has been paused. Please chat with our team below to resolve it.',
        severity: 'warning',
    },
    trial_expired: {
        title: 'Your trial period has ended',
        body: 'To keep offering your services, chat with our team below to continue.',
        severity: 'warning',
    },
    plan_expired: {
        title: 'Your membership has expired',
        body: 'Your plan period has ended. Reactivate it below to restore your '
            + 'account, or chat with our team if you need help.',
        severity: 'warning',
    },
    disciplinary: {
        title: 'Your account is temporarily on hold',
        body: 'Your account has been placed on hold by our team. Please chat with us '
            + 'below to resolve it.',
        severity: 'error',
    },
};

export default function VendorHoldingPage({ stateOverride = null }) {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const handleLogout = async () => {
        try { await dispatch(logoutUser()); } finally { navigate('/'); }
    };

    // Doctors get their hold state from the doctor endpoint; any other held user
    // (patient, …) passes it in via stateOverride from the general endpoint.
    const doctorQ = useGetAccountStateQuery(undefined, { skip: !!stateOverride });
    const state = stateOverride || doctorQ.data;
    const isLoading = stateOverride ? false : doctorQ.isLoading;
    const channelId = state?.holding_channel_id;
    const { data: channel, isLoading: chLoading } = useGetServiceChannelQuery(channelId, {
        skip: !channelId,
    });

    if (isLoading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;
    }

    const info = REASON[state?.reason] || REASON.pending_verification;

    return (
        <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 900, mx: 'auto' }}>
            <Stack direction="row" spacing={1.5} alignItems="center" mb={2}>
                <LockClockOutlinedIcon color="action" />
                <Typography variant="h5" fontWeight={700}>Account on hold</Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Button
                    variant="outlined" color="inherit" size="small"
                    startIcon={<LogoutIcon />} onClick={handleLogout}
                >
                    Log out
                </Button>
            </Stack>

            <Alert severity={info.severity} sx={{ mb: 2 }}>
                <Typography fontWeight={700}>{info.title}</Typography>
                <Typography variant="body2">{info.body}</Typography>
            </Alert>

            {/* Trial/period lapse → let a plan-based provider pay to reactivate
                right here. On success the payment invalidates the account-state,
                the hold lifts, and the dashboard returns. Hides itself when the
                caller has no membership subscription (e.g. a held patient). */}
            {(state?.reason === 'trial_expired' || state?.reason === 'plan_expired') && (
                <Box sx={{ mb: 2 }}>
                    <MembershipPlansPanel
                        title="Pay to reactivate your plan"
                        onPaid={() => { if (!stateOverride) doctorQ.refetch(); }}
                    />
                </Box>
            )}

            <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Typography fontWeight={600}>Chat with our team</Typography>
                    <Typography variant="caption" color="text.secondary">
                        Messages and documents both ways. Calls are arranged by our team.
                    </Typography>
                </Box>
                <Box sx={{ height: { xs: '55vh', md: '58vh' } }}>
                    {(!channelId || chLoading) ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
                    ) : (
                        <ChannelChat channel={channel} />
                    )}
                </Box>
            </Paper>

            {channelId && channel && (
                <Box sx={{ mt: 2 }}>
                    {/* The vendor can join calls our team schedules, but cannot
                        schedule them (ScheduledCallsPanel gates that to admin on
                        holding channels). */}
                    <ScheduledCallsPanel channel={channel} />
                    <Box sx={{ mt: 2 }}>
                        <ChannelDocumentsPanel channel={channel} />
                    </Box>
                </Box>
            )}
        </Box>
    );
}
