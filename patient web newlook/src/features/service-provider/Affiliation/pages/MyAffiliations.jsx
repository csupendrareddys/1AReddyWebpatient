/**
 * MyAffiliations — doctor-side view of the apex-marketplace
 * affiliation system. Shows the doctor's invite code (with copy +
 * regenerate + revoke), and a list of hospital requests the doctor
 * has to approve or reject.
 *
 * Hung off /dashboard/doctor/affiliations.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress,
    Dialog, DialogActions, DialogContent, DialogContentText,
    DialogTitle, Divider, IconButton, Snackbar, Stack, TextField,
    Tooltip, Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';

import {
    useGetMyInviteQuery,
    useRegenerateMyInviteMutation,
    useRevokeMyInviteMutation,
    useListMyAffiliationRequestsQuery,
    useApproveAffiliationRequestMutation,
    useRejectAffiliationRequestMutation,
} from '../api/affiliationEndpoints';

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

export default function MyAffiliations() {
    const [snack, setSnack] = useState({ open: false, msg: '', sev: 'info' });
    const [rejectDialog, setRejectDialog] = useState({ open: false, requestId: null });
    const [rejectReason, setRejectReason] = useState('');

    const notify = (sev, msg) => setSnack({ open: true, sev, msg });
    const errText = (err) =>
        err?.data?.error || err?.data?.message || err?.error || 'Operation failed.';

    const {
        data: invite, isLoading: inviteLoading, error: inviteError,
    } = useGetMyInviteQuery();
    const {
        data: requests = [], isLoading: requestsLoading, refetch: refetchRequests,
    } = useListMyAffiliationRequestsQuery();

    const [regenerate, { isLoading: regenerating }] = useRegenerateMyInviteMutation();
    const [revoke, { isLoading: revoking }] = useRevokeMyInviteMutation();
    const [approve, { isLoading: approving }] = useApproveAffiliationRequestMutation();
    const [reject, { isLoading: rejecting }] = useRejectAffiliationRequestMutation();

    const handleRegenerate = async () => {
        try {
            await regenerate().unwrap();
            notify('success', 'Invite code generated.');
        } catch (e) {
            notify('error', errText(e));
        }
    };
    const handleRevoke = async () => {
        try {
            await revoke().unwrap();
            notify('success', 'Invite code revoked.');
        } catch (e) {
            notify('error', errText(e));
        }
    };
    const handleCopy = async () => {
        if (!invite?.code) return;
        try {
            await navigator.clipboard.writeText(invite.code);
            notify('info', 'Code copied to clipboard.');
        } catch {
            notify('error', 'Could not copy — clipboard blocked.');
        }
    };
    const handleApprove = async (id) => {
        try {
            await approve(id).unwrap();
            notify('success', 'Request approved.');
            refetchRequests();
        } catch (e) {
            notify('error', errText(e));
        }
    };
    const openReject = (id) => {
        setRejectReason('');
        setRejectDialog({ open: true, requestId: id });
    };
    const handleReject = async () => {
        try {
            await reject({
                requestId: rejectDialog.requestId,
                reason: rejectReason,
            }).unwrap();
            notify('success', 'Request rejected.');
            setRejectDialog({ open: false, requestId: null });
            refetchRequests();
        } catch (e) {
            notify('error', errText(e));
        }
    };

    const pending = requests.filter((r) => r.status === 'pending');
    const history = requests.filter((r) => r.status !== 'pending');

    return (
        <Box sx={{ maxWidth: 880, mx: 'auto', py: 3 }}>
            <Typography variant="h4" gutterBottom>
                Hospital affiliations
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Share your invite code with a hospital or clinic so they can add
                you onto their roster. You'll see their request below and can
                approve or reject it.
            </Typography>

            {/* ── Invite code card ──────────────────────────────── */}
            <Card sx={{ mb: 4 }}>
                <CardContent>
                    <Typography variant="h6" gutterBottom>
                        Your invite code
                    </Typography>
                    {inviteLoading ? (
                        <CircularProgress size={20} />
                    ) : inviteError ? (
                        <Alert severity="error">
                            {errText(inviteError)}
                        </Alert>
                    ) : invite?.code ? (
                        <>
                            <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1 }}>
                                <Typography
                                    variant="h5"
                                    sx={{
                                        fontFamily: 'monospace',
                                        bgcolor: 'grey.100', px: 2, py: 1,
                                        borderRadius: 1, letterSpacing: 1,
                                    }}
                                >
                                    {invite.code}
                                </Typography>
                                <Tooltip title="Copy">
                                    <IconButton onClick={handleCopy} size="small">
                                        <ContentCopyIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </Stack>
                            {invite.expires_at && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                                    Expires: {formatDate(invite.expires_at)}
                                </Typography>
                            )}
                            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                                <Button
                                    size="small"
                                    startIcon={<RefreshIcon />}
                                    onClick={handleRegenerate}
                                    disabled={regenerating}
                                >
                                    {regenerating ? 'Regenerating…' : 'Regenerate'}
                                </Button>
                                <Button
                                    size="small"
                                    color="error"
                                    startIcon={<DeleteOutlineIcon />}
                                    onClick={handleRevoke}
                                    disabled={revoking}
                                >
                                    {revoking ? 'Revoking…' : 'Revoke'}
                                </Button>
                            </Stack>
                        </>
                    ) : (
                        <>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                No active invite code. Generate one to share with a hospital.
                            </Typography>
                            <Button
                                variant="contained"
                                onClick={handleRegenerate}
                                disabled={regenerating}
                            >
                                {regenerating ? 'Generating…' : 'Generate invite code'}
                            </Button>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* ── Pending requests ────────────────────────────── */}
            <Typography variant="h6" gutterBottom>
                Pending requests
            </Typography>
            {requestsLoading ? (
                <CircularProgress size={20} />
            ) : pending.length === 0 ? (
                <Alert severity="info" sx={{ mb: 3 }}>
                    No pending requests. When a hospital uses your code, the
                    request will show up here for your approval.
                </Alert>
            ) : (
                <Stack spacing={2} sx={{ mb: 4 }}>
                    {pending.map((r) => (
                        <Card key={r.id} variant="outlined">
                            <CardContent>
                                <Stack
                                    direction={{ xs: 'column', sm: 'row' }}
                                    justifyContent="space-between"
                                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                                    spacing={2}
                                >
                                    <Box>
                                        <Typography variant="subtitle1">
                                            {r.hospital_name || 'Unnamed hospital'}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {r.employment_type?.replace('_', ' ')} ·
                                            Requested {formatDate(r.requested_at)}
                                        </Typography>
                                    </Box>
                                    <Stack direction="row" spacing={1}>
                                        <Button
                                            size="small"
                                            variant="contained"
                                            color="success"
                                            startIcon={<CheckCircleOutlineIcon />}
                                            onClick={() => handleApprove(r.id)}
                                            disabled={approving}
                                        >
                                            Approve
                                        </Button>
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            color="error"
                                            startIcon={<HighlightOffIcon />}
                                            onClick={() => openReject(r.id)}
                                            disabled={rejecting}
                                        >
                                            Reject
                                        </Button>
                                    </Stack>
                                </Stack>
                            </CardContent>
                        </Card>
                    ))}
                </Stack>
            )}

            {/* ── History ────────────────────────────────────── */}
            {history.length > 0 && (
                <>
                    <Divider sx={{ my: 3 }} />
                    <Typography variant="h6" gutterBottom>
                        History
                    </Typography>
                    <Stack spacing={1}>
                        {history.map((r) => (
                            <Card key={r.id} variant="outlined">
                                <CardContent sx={{ py: 1.5 }}>
                                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                                        <Box>
                                            <Typography variant="body2">
                                                {r.hospital_name || 'Unnamed hospital'}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {formatDate(r.responded_at || r.requested_at)}
                                                {r.rejection_reason ? ` · ${r.rejection_reason}` : ''}
                                            </Typography>
                                        </Box>
                                        <Chip
                                            label={r.status}
                                            size="small"
                                            color={STATUS_COLORS[r.status] || 'default'}
                                        />
                                    </Stack>
                                </CardContent>
                            </Card>
                        ))}
                    </Stack>
                </>
            )}

            {/* ── Reject reason dialog ─────────────────────────── */}
            <Dialog
                open={rejectDialog.open}
                onClose={() => setRejectDialog({ open: false, requestId: null })}
                fullWidth maxWidth="xs"
            >
                <DialogTitle>Reject affiliation request</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        Optionally tell the hospital why you're rejecting.
                        They'll see this message in their roster view.
                    </DialogContentText>
                    <TextField
                        autoFocus fullWidth multiline rows={3}
                        label="Reason (optional)"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        inputProps={{ maxLength: 500 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRejectDialog({ open: false, requestId: null })}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleReject}
                        color="error"
                        variant="contained"
                        disabled={rejecting}
                    >
                        {rejecting ? 'Rejecting…' : 'Reject'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar
                open={snack.open}
                autoHideDuration={4000}
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
