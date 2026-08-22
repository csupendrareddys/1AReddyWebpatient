/**
 * ApprovalDetail — Detail page for a single approval request
 * Shows timeline, changes diff, and action buttons
 */
import {
    Box, Typography, Button, Alert, Snackbar, Paper, Chip,
    IconButton, Tooltip, Grid, Dialog, DialogTitle,
    DialogContent, DialogActions, TextField, CircularProgress,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import ReplyIcon from '@mui/icons-material/Reply';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CancelIcon from '@mui/icons-material/Cancel';

import useApprovals from '../../hooks/useApprovals';
import ApprovalTimeline from '../../components/ApprovalTimeline/ApprovalTimeline';
import ChangesDiffView from '../../components/ChangesDiffView/ChangesDiffView';

const STATUS_COLORS = {
    pending: 'warning',
    under_review: 'info',
    completed: 'success',
    rejected: 'error',
    cancelled: 'default',
    query: 'secondary',
};

const ApprovalDetail = () => {
    const {
        hasFullAccess,
        approvalDetail,
        detailLoading,
        actionDialog,
        actionComments,
        setActionComments,
        isActionLoading,
        snackbar,
        handleBackToQueue,
        handleOpenAction,
        handleCloseAction,
        handleExecuteAction,
        handleCloseSnackbar,
    } = useApprovals();

    if (detailLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!approvalDetail) {
        return <Alert severity="error">Approval request not found</Alert>;
    }

    const canAct = approvalDetail.status !== 'completed' &&
        approvalDetail.status !== 'rejected' &&
        approvalDetail.status !== 'cancelled';

    return (
        <Box>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <Tooltip title="Back to Queue">
                    <IconButton onClick={handleBackToQueue}>
                        <ArrowBackIcon />
                    </IconButton>
                </Tooltip>
                <Box sx={{ flex: 1 }}>
                    <Typography variant="h5" fontWeight={600}>
                        {approvalDetail.title || approvalDetail.entity_type || 'Approval Request'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        #{approvalDetail.id?.slice(0, 8)} · {approvalDetail.entity_type?.replace(/_/g, ' ')}
                    </Typography>
                </Box>
                <Chip
                    label={approvalDetail.status?.replace(/_/g, ' ').toUpperCase()}
                    color={STATUS_COLORS[approvalDetail.status] || 'default'}
                    sx={{ fontWeight: 600 }}
                />
            </Box>

            {/* Info Cards */}
            <Grid container spacing={3} sx={{ mb: 3 }}>
                <Grid item xs={12} md={4}>
                    <Paper sx={{ p: 2, borderRadius: 2 }}>
                        <Typography variant="caption" color="text.secondary">Requested By</Typography>
                        <Typography fontWeight={500}>
                            {approvalDetail.requested_by_name || approvalDetail.requested_by_id?.slice(0, 8)}
                        </Typography>
                    </Paper>
                </Grid>
                <Grid item xs={12} md={4}>
                    <Paper sx={{ p: 2, borderRadius: 2 }}>
                        <Typography variant="caption" color="text.secondary">Current Level</Typography>
                        <Typography fontWeight={500}>
                            L{approvalDetail.current_level || 0} / L{approvalDetail.required_level || 1}
                        </Typography>
                    </Paper>
                </Grid>
                <Grid item xs={12} md={4}>
                    <Paper sx={{ p: 2, borderRadius: 2 }}>
                        <Typography variant="caption" color="text.secondary">Created</Typography>
                        <Typography fontWeight={500}>
                            {approvalDetail.created_at
                                ? new Date(approvalDetail.created_at).toLocaleString()
                                : '—'}
                        </Typography>
                    </Paper>
                </Grid>
            </Grid>

            {/* Action Buttons */}
            {canAct && hasFullAccess && (
                <Paper sx={{ p: 2, mb: 3, borderRadius: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button
                        variant="contained"
                        color="success"
                        size="small"
                        startIcon={<CheckIcon />}
                        onClick={() => handleOpenAction('approve')}
                        sx={{ textTransform: 'none' }}
                    >
                        Approve
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        size="small"
                        startIcon={<CloseIcon />}
                        onClick={() => handleOpenAction('reject')}
                        sx={{ textTransform: 'none' }}
                    >
                        Reject
                    </Button>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<HelpOutlineIcon />}
                        onClick={() => handleOpenAction('query')}
                        sx={{ textTransform: 'none' }}
                    >
                        Raise Query
                    </Button>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<ArrowUpwardIcon />}
                        onClick={() => handleOpenAction('escalate')}
                        sx={{ textTransform: 'none' }}
                    >
                        Escalate
                    </Button>
                    <Button
                        variant="outlined"
                        color="warning"
                        size="small"
                        startIcon={<CancelIcon />}
                        onClick={() => handleOpenAction('cancel')}
                        sx={{ textTransform: 'none' }}
                    >
                        Cancel
                    </Button>
                </Paper>
            )}

            {approvalDetail.status === 'query' && (
                <Paper sx={{ p: 2, mb: 3, borderRadius: 2 }}>
                    <Button
                        variant="contained"
                        startIcon={<ReplyIcon />}
                        onClick={() => handleOpenAction('respond')}
                        sx={{
                            bgcolor: '#2563eb',
                            '&:hover': { bgcolor: '#1d4ed8' },
                            textTransform: 'none',
                        }}
                    >
                        Respond to Query
                    </Button>
                </Paper>
            )}

            {/* Changes + Timeline */}
            <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                    <ChangesDiffView changes={approvalDetail.changes || approvalDetail.data} />
                </Grid>
                <Grid item xs={12} md={6}>
                    <ApprovalTimeline actions={approvalDetail.actions || []} />
                </Grid>
            </Grid>

            {/* Action Dialog */}
            <Dialog open={actionDialog.open} onClose={handleCloseAction} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ fontWeight: 600, textTransform: 'capitalize' }}>
                    {actionDialog.type?.replace(/_/g, ' ')} Request
                </DialogTitle>
                <DialogContent>
                    <TextField
                        label="Comments"
                        value={actionComments}
                        onChange={(e) => setActionComments(e.target.value)}
                        multiline
                        rows={3}
                        fullWidth
                        autoFocus
                        sx={{ mt: 1 }}
                        required={actionDialog.type === 'query' || actionDialog.type === 'respond'}
                    />
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={handleCloseAction} disabled={isActionLoading}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleExecuteAction}
                        disabled={isActionLoading}
                        sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                        }}
                    >
                        {isActionLoading ? <CircularProgress size={20} /> : 'Confirm'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Snackbar */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={handleCloseSnackbar}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} variant="filled">
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default ApprovalDetail;
