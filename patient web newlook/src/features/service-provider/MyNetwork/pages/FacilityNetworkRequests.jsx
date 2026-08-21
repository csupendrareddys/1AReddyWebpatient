/**
 * FacilityNetworkRequests — clinic/hospital inbox for the pending care-network
 * requests doctors sent to this facility. Accepting creates the doctor→facility
 * connection; rejecting dismisses it.
 *
 * Also mounted for the facility's own staff at
 * /dashboard/staff/network-requests. A front desk is often given the inbox to
 * read without the authority to answer it, so the two buttons are gated
 * separately from the list.
 */
import {
    Box, Chip, Container, Typography, Paper, Stack, Button, CircularProgress,
    Alert, Snackbar,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import HandshakeIcon from '@mui/icons-material/Handshake';
import { useState } from 'react';
import useProviderCan from '../../../staff/hooks/useProviderCan';
import {
    useGetFacilityNetworkRequestsQuery,
    useAcceptFacilityNetworkRequestMutation,
    useRejectFacilityNetworkRequestMutation,
} from '../api/networkEndpoints';

const M_NETWORK = 'doctors_network.network_requests';

const FacilityNetworkRequests = () => {
    const { can } = useProviderCan();
    const canRespond = can(M_NETWORK, 'can_edit');
    const { data: requests = [], isLoading } = useGetFacilityNetworkRequestsQuery();
    const [accept, acceptState] = useAcceptFacilityNetworkRequestMutation();
    const [reject, rejectState] = useRejectFacilityNetworkRequestMutation();
    const [snack, setSnack] = useState(null);
    const busy = acceptState.isLoading || rejectState.isLoading;

    const act = async (fn, id, ok) => {
        try {
            await fn(id).unwrap();
            setSnack({ sev: 'success', msg: ok });
        } catch (e) {
            setSnack({ sev: 'error', msg: e?.data?.error || e?.data?.message || 'Action failed' });
        }
    };

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 8 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
                <HandshakeIcon color="primary" />
                <Typography variant="h5" fontWeight={700}>Network Requests</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Doctors requesting to add your facility to their care network.
                Accept to connect.
            </Typography>

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                    <CircularProgress />
                </Box>
            ) : requests.length === 0 ? (
                <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                    No pending connection requests.
                </Paper>
            ) : (
                <Stack spacing={1.5}>
                    {requests.map((r) => (
                        <Paper key={r.id} variant="outlined" sx={{ p: 2 }}>
                            <Stack
                                direction="row"
                                alignItems="center"
                                justifyContent="space-between"
                                flexWrap="wrap"
                                gap={1}
                            >
                                <Box>
                                    <Typography variant="body1" fontWeight={600}>
                                        {r.requester_name || 'A doctor'}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        wants to connect with{' '}
                                        {r.target_facility_name || 'your facility'}
                                        {r.referral_type ? ` · Referral ${r.referral_type}` : ''}
                                    </Typography>
                                </Box>
                                {canRespond ? (
                                    <Stack direction="row" spacing={1}>
                                        <Button
                                            size="small"
                                            variant="contained"
                                            color="success"
                                            startIcon={<CheckIcon />}
                                            disabled={busy}
                                            onClick={() => act(accept, r.id, 'Connection accepted')}
                                        >
                                            Accept
                                        </Button>
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            color="error"
                                            startIcon={<CloseIcon />}
                                            disabled={busy}
                                            onClick={() => act(reject, r.id, 'Request rejected')}
                                        >
                                            Reject
                                        </Button>
                                    </Stack>
                                ) : (
                                    <Chip size="small" variant="outlined" label="View only" />
                                )}
                            </Stack>
                        </Paper>
                    ))}
                </Stack>
            )}

            {snack && (
                <Snackbar
                    open
                    autoHideDuration={4000}
                    onClose={() => setSnack(null)}
                    anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                >
                    <Alert severity={snack.sev} variant="filled">{snack.msg}</Alert>
                </Snackbar>
            )}
        </Container>
    );
};

export default FacilityNetworkRequests;
