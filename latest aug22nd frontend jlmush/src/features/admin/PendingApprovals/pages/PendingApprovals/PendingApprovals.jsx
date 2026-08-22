/**
 * PendingApprovals — Super Admin approval centre
 *
 * Tabs:
 *   1. Slot Visibility  — approve / reject per-type slot disappearance gap
 *   2. Doctor Requests  — respond to requests raised from the Publish Status tab
 */
import React, { useState } from 'react';
import {
    Box, Typography, Tabs, Tab, Paper, Table, TableContainer, TableHead, TableRow,
    TableCell, TableBody, IconButton, Tooltip, Chip, Dialog,
    DialogTitle, DialogContent, DialogActions, Button, TextField,
    MenuItem, Select, FormControl, InputLabel, Alert, Snackbar,
    CircularProgress, Stack, Collapse,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ReplyIcon from '@mui/icons-material/Reply';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import MessageIcon from '@mui/icons-material/Message';

import {
    useGetPendingSlotVisibilityRequestsQuery,
    useApproveSlotVisibilityMutation,
    useRejectSlotVisibilityMutation,
    useGetAllDoctorAdminRequestsQuery,
    useRespondDoctorAdminRequestMutation,
} from '../../../api/doctorApprovalsEndpoints';

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_COLORS = {
    pending:   'warning',
    in_review: 'info',
    resolved:  'success',
    rejected:  'error',
};

const RESPOND_STATUSES = [
    { value: 'in_review', label: 'Mark In Review' },
    { value: 'resolved',  label: 'Mark Resolved' },
    { value: 'rejected',  label: 'Reject' },
];

const GAP_LABEL = (mins) => {
    if (mins === 0) return 'Emergency (0 min)';
    return `${mins} min before`;
};

// ─── Tab 1: Slot Visibility Approvals ────────────────────────────────────────

const SlotVisibilityTab = () => {
    const { data: requests = [], isLoading } = useGetPendingSlotVisibilityRequestsQuery();
    const [approve] = useApproveSlotVisibilityMutation();
    const [reject]  = useRejectSlotVisibilityMutation();

    const [expandedRow, setExpandedRow] = useState(null);
    const [rejectDialog, setRejectDialog] = useState({ open: false, doctorId: null });
    const [rejectReason, setRejectReason] = useState('');
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

    const showSnack = (message, severity = 'success') =>
        setSnackbar({ open: true, message, severity });

    const handleApprove = async (doctorId) => {
        try {
            await approve(doctorId).unwrap();
            showSnack('Slot visibility approved');
        } catch (err) {
            showSnack(err?.data?.message || 'Approve failed', 'error');
        }
    };

    const handleReject = async () => {
        try {
            await reject({ doctorId: rejectDialog.doctorId, reason: rejectReason }).unwrap();
            showSnack('Slot visibility rejected');
            setRejectDialog({ open: false, doctorId: null });
            setRejectReason('');
        } catch (err) {
            showSnack(err?.data?.message || 'Reject failed', 'error');
        }
    };

    if (isLoading) return <Box display="flex" justifyContent="center" mt={6}><CircularProgress /></Box>;

    if (requests.length === 0) {
        return <Alert severity="info" sx={{ mt: 2 }}>No pending slot visibility requests.</Alert>;
    }

    return (
        <>
            <TableContainer component={Paper} sx={{ mt: 2 }}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell />
                            <TableCell><b>Doctor</b></TableCell>
                            <TableCell><b>Requested At</b></TableCell>
                            <TableCell><b>Current Approved Gap</b></TableCell>
                            <TableCell align="center"><b>Actions</b></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {requests.map((req) => (
                            <React.Fragment key={req.doctor_id}>
                                <TableRow hover>
                                    <TableCell padding="checkbox">
                                        <IconButton size="small" onClick={() =>
                                            setExpandedRow(expandedRow === req.doctor_id ? null : req.doctor_id)
                                        }>
                                            {expandedRow === req.doctor_id ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                        </IconButton>
                                    </TableCell>
                                    <TableCell>{req.full_name || req.doctor_id}</TableCell>
                                    <TableCell>
                                        {req.requested_at
                                            ? new Date(req.requested_at).toLocaleString('en-IN')
                                            : '—'}
                                    </TableCell>
                                    <TableCell>
                                        {Object.keys(req.currently_approved_gap || {}).length > 0
                                            ? <Stack direction="row" spacing={0.5} flexWrap="wrap">
                                                {Object.entries(req.currently_approved_gap).map(([type, mins]) => (
                                                    <Chip key={type} size="small"
                                                        label={`${type}: ${GAP_LABEL(mins)}`}
                                                        variant="outlined" />
                                                ))}
                                              </Stack>
                                            : <Typography variant="body2" color="text.disabled">None set</Typography>
                                        }
                                    </TableCell>
                                    <TableCell align="center">
                                        <Tooltip title="Approve">
                                            <IconButton color="success" onClick={() => handleApprove(req.doctor_id)}>
                                                <CheckCircleIcon />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Reject">
                                            <IconButton color="error" onClick={() =>
                                                setRejectDialog({ open: true, doctorId: req.doctor_id })
                                            }>
                                                <CancelIcon />
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>

                                {/* Expanded: requested gaps */}
                                <TableRow>
                                    <TableCell colSpan={5} sx={{ py: 0, borderBottom: expandedRow === req.doctor_id ? undefined : 'none' }}>
                                        <Collapse in={expandedRow === req.doctor_id}>
                                            <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1, my: 1 }}>
                                                <Typography variant="subtitle2" gutterBottom>
                                                    Requested Slot Visibility Gap
                                                </Typography>
                                                <Stack direction="row" spacing={1} flexWrap="wrap">
                                                    {Object.entries(req.requested_gap || {}).map(([type, mins]) => (
                                                        <Chip key={type}
                                                            icon={<AccessTimeIcon />}
                                                            label={`${type}: ${GAP_LABEL(mins)}`}
                                                            color="primary" variant="outlined" size="small" />
                                                    ))}
                                                </Stack>
                                            </Box>
                                        </Collapse>
                                    </TableCell>
                                </TableRow>
                            </React.Fragment>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            {/* Reject Dialog */}
            <Dialog open={rejectDialog.open}
                onClose={() => setRejectDialog({ open: false, doctorId: null })}
                maxWidth="sm" fullWidth>
                <DialogTitle>Reject Slot Visibility Request</DialogTitle>
                <DialogContent>
                    <TextField
                        label="Rejection Reason" multiline rows={3} fullWidth
                        value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                        sx={{ mt: 1 }}
                        placeholder="Explain why the request is being rejected..."
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRejectDialog({ open: false, doctorId: null })}>Cancel</Button>
                    <Button variant="contained" color="error" onClick={handleReject}>Reject</Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={4000}
                onClose={() => setSnackbar(s => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
            </Snackbar>
        </>
    );
};

// ─── Tab 2: Doctor Admin Requests ────────────────────────────────────────────

const DoctorRequestsTab = () => {
    const [statusFilter, setStatusFilter] = useState('pending');
    const { data = {}, isLoading } = useGetAllDoctorAdminRequestsQuery({ status: statusFilter || undefined });
    const [respond] = useRespondDoctorAdminRequestMutation();

    const { requests = [], total = 0 } = data;

    const [respondDialog, setRespondDialog] = useState({ open: false, requestId: null });
    const [respondStatus, setRespondStatus] = useState('in_review');
    const [respondText, setRespondText] = useState('');
    const [expandedRow, setExpandedRow] = useState(null);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

    const showSnack = (message, severity = 'success') =>
        setSnackbar({ open: true, message, severity });

    const handleRespond = async () => {
        try {
            await respond({
                requestId: respondDialog.requestId,
                status: respondStatus,
                adminResponse: respondText,
            }).unwrap();
            showSnack('Response sent to doctor');
            setRespondDialog({ open: false, requestId: null });
            setRespondText('');
        } catch (err) {
            showSnack(err?.data?.message || 'Failed to respond', 'error');
        }
    };

    if (isLoading) return <Box display="flex" justifyContent="center" mt={6}><CircularProgress /></Box>;

    return (
        <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2, mb: 1 }}>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>Status Filter</InputLabel>
                    <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} label="Status Filter">
                        <MenuItem value="">All</MenuItem>
                        <MenuItem value="pending">Pending</MenuItem>
                        <MenuItem value="in_review">In Review</MenuItem>
                        <MenuItem value="resolved">Resolved</MenuItem>
                        <MenuItem value="rejected">Rejected</MenuItem>
                    </Select>
                </FormControl>
                <Typography variant="body2" color="text.secondary">{total} request(s)</Typography>
            </Box>

            {requests.length === 0
                ? <Alert severity="info">No requests found.</Alert>
                : (
                <TableContainer component={Paper}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell />
                                <TableCell><b>Doctor</b></TableCell>
                                <TableCell><b>Consultation Type</b></TableCell>
                                <TableCell><b>Status</b></TableCell>
                                <TableCell><b>Submitted</b></TableCell>
                                <TableCell align="center"><b>Action</b></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {requests.map((req) => (
                                <React.Fragment key={req.id}>
                                    <TableRow hover>
                                        <TableCell padding="checkbox">
                                            <IconButton size="small" onClick={() =>
                                                setExpandedRow(expandedRow === req.id ? null : req.id)
                                            }>
                                                {expandedRow === req.id ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                            </IconButton>
                                        </TableCell>
                                        <TableCell>{req.doctor_name || req.doctor_id}</TableCell>
                                        <TableCell>
                                            {req.consultation_type
                                                ? <Chip size="small" label={req.consultation_type} />
                                                : <Typography variant="body2" color="text.disabled">General</Typography>
                                            }
                                        </TableCell>
                                        <TableCell>
                                            <Chip size="small"
                                                label={req.status}
                                                color={STATUS_COLORS[req.status] || 'default'} />
                                        </TableCell>
                                        <TableCell>
                                            {req.created_at
                                                ? new Date(req.created_at).toLocaleString('en-IN')
                                                : '—'}
                                        </TableCell>
                                        <TableCell align="center">
                                            <Tooltip title="Respond">
                                                <IconButton color="primary" onClick={() => {
                                                    setRespondDialog({ open: true, requestId: req.id });
                                                    setRespondStatus('in_review');
                                                }}>
                                                    <ReplyIcon />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>

                                    {/* Expanded: remarks + attachments + admin response */}
                                    <TableRow>
                                        <TableCell colSpan={6} sx={{ py: 0, borderBottom: expandedRow === req.id ? undefined : 'none' }}>
                                            <Collapse in={expandedRow === req.id}>
                                                <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1, my: 1 }}>
                                                    <Typography variant="subtitle2" gutterBottom>
                                                        <MessageIcon fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
                                                        Doctor's Remarks
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ mb: 1.5 }}>
                                                        {req.remarks || '(no remarks)'}
                                                    </Typography>

                                                    {req.attachments?.length > 0 && (
                                                        <>
                                                            <Typography variant="subtitle2" gutterBottom>Attachments</Typography>
                                                            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1.5 }}>
                                                                {req.attachments.map((url, i) => (
                                                                    <Chip key={i} size="small" label={`File ${i + 1}`}
                                                                        component="a" href={url} target="_blank"
                                                                        clickable variant="outlined" />
                                                                ))}
                                                            </Stack>
                                                        </>
                                                    )}

                                                    {req.admin_response && (
                                                        <>
                                                            <Typography variant="subtitle2" gutterBottom>Admin Response</Typography>
                                                            <Typography variant="body2" color="text.secondary">
                                                                {req.admin_response}
                                                            </Typography>
                                                        </>
                                                    )}
                                                </Box>
                                            </Collapse>
                                        </TableCell>
                                    </TableRow>
                                </React.Fragment>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* Respond Dialog */}
            <Dialog open={respondDialog.open}
                onClose={() => setRespondDialog({ open: false, requestId: null })}
                maxWidth="sm" fullWidth>
                <DialogTitle>Respond to Doctor Request</DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
                    <FormControl fullWidth size="small">
                        <InputLabel>Update Status</InputLabel>
                        <Select value={respondStatus} onChange={(e) => setRespondStatus(e.target.value)} label="Update Status">
                            {RESPOND_STATUSES.map((s) => (
                                <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <TextField
                        label="Response Message" multiline rows={4} fullWidth
                        value={respondText} onChange={(e) => setRespondText(e.target.value)}
                        placeholder="Write your response to the doctor..."
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRespondDialog({ open: false, requestId: null })}>Cancel</Button>
                    <Button variant="contained" onClick={handleRespond}>Send Response</Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={4000}
                onClose={() => setSnackbar(s => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
            </Snackbar>
        </>
    );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const PendingApprovals = () => {
    const [tab, setTab] = useState(0);

    return (
        <Box>
            <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
                Pending Approvals
            </Typography>

            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tab label="Slot Visibility" />
                <Tab label="Doctor Requests" />
            </Tabs>

            {tab === 0 && <SlotVisibilityTab />}
            {tab === 1 && <DoctorRequestsTab />}
        </Box>
    );
};

export default PendingApprovals;
