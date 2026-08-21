/**
 * AvailabilityApprovals — Admin page to review/approve/reject doctor
 * availability + fee configs.
 *
 * Availability is diffed per-slot, so a doctor's schedule save produces many
 * requests. The Pending tab batches them BY DOCTOR: each doctor is a group with
 * a "select all" checkbox, every request has its own tick-box, and "Approve
 * selected" clears the ticked ones in one call. "Approve all pending" clears the
 * whole queue. The Approved / Rejected / All tabs stay a flat read-only list.
 */
import React, { useState, useMemo, useEffect } from 'react';
import {
    Box, Typography, Paper, Table, TableContainer, TableHead, TableRow, TableCell,
    TableBody, IconButton, Chip, Button, Dialog, DialogTitle,
    DialogContent, DialogActions, TextField, Snackbar, Alert,
    CircularProgress, Tooltip, Stack, Tabs, Tab, Checkbox,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import DoneAllIcon from '@mui/icons-material/DoneAll';

import {
    useGetAvailabilityApprovalsQuery,
    useApproveAvailabilityMutation,
    useApproveAllAvailabilityMutation,
    useApproveBatchAvailabilityMutation,
    useRejectAvailabilityMutation,
} from '../../../api/marketplaceEndpoints';

// Backend's ApprovalRequestStatus enum maps approved → COMPLETED.
const TABS = [
    { key: 'pending',   label: 'Pending' },
    { key: 'completed', label: 'Approved' },
    { key: 'rejected',  label: 'Rejected' },
    { key: 'all',       label: 'All' },
];

const STATUS_CHIP = {
    pending:   { label: 'Pending',  color: 'warning' },
    completed: { label: 'Approved', color: 'success' },
    approved:  { label: 'Approved', color: 'success' },
    rejected:  { label: 'Rejected', color: 'error' },
    cancelled: { label: 'Cancelled', color: 'default' },
};

const CAT_LABEL = {
    working_hours: 'Weekly slot',
    calendar: 'Dated slot',
    pricing: 'Pricing',
    global_config: 'Slot settings',
};

// Turn a per-slot request into a human summary.
const describeSlot = (req) => {
    if (!req) return null;
    const cat = req.category;
    const data = req.changes_data;
    const where = cat === 'calendar'
        ? req.date
        : [req.type, req.day].filter(Boolean).join(' · ');

    if (data && data._deleted) {
        return { headline: CAT_LABEL[cat] || cat, detail: `Remove slot — ${where}`, removed: true };
    }
    if (cat === 'working_hours' || cat === 'calendar') {
        const time = data ? `${data.start ?? '?'}–${data.end ?? '?'}` : '';
        const types = Array.isArray(data?.consultation_types) && data.consultation_types.length
            ? ` [${data.consultation_types.join(', ')}]` : '';
        return { headline: CAT_LABEL[cat] || cat, detail: `${where} · ${time}${types}` };
    }
    if (cat === 'pricing') return { headline: 'Pricing', detail: `${req.type} fee update` };
    if (cat === 'global_config') return { headline: 'Slot settings', detail: 'slot size / gap / exceptions' };
    return { headline: cat || 'Change', detail: where };
};

const AvailabilityApprovals = () => {
    const [tabIdx, setTabIdx] = useState(0);
    const activeTab = TABS[tabIdx];
    const isPending = activeTab.key === 'pending';
    // Load a big page so a doctor's whole batch is selectable at once.
    const { data: requests = [], isLoading } = useGetAvailabilityApprovalsQuery({
        status: activeTab.key, per_page: 50,
    });
    const [approveAvailability] = useApproveAvailabilityMutation();
    const [approveAllAvailability, { isLoading: bulkApproving }] = useApproveAllAvailabilityMutation();
    const [approveBatchAvailability, { isLoading: batchApproving }] = useApproveBatchAvailabilityMutation();
    const [rejectAvailability] = useRejectAvailabilityMutation();

    const [rejectDialog, setRejectDialog] = useState({ open: false, requestId: null });
    const [rejectReason, setRejectReason] = useState('');
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
    const [selected, setSelected] = useState(() => new Set());

    // Group the loaded requests by doctor (each doctor is a batch).
    const groups = useMemo(() => {
        const map = new Map();
        requests.forEach((r) => {
            const key = r.doctor_id || r.full_name || 'unknown';
            if (!map.has(key)) {
                map.set(key, { key, name: r.full_name || 'Dr. Unknown', profile: r.profile_image, rows: [] });
            }
            map.get(key).rows.push(r);
        });
        return [...map.values()];
    }, [requests]);

    // Clear selection when the visible set changes (tab switch / refetch).
    useEffect(() => { setSelected(new Set()); }, [tabIdx]);

    const toggleOne = (id) => setSelected((s) => {
        const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
    });
    const toggleDoctor = (rows, checked) => setSelected((s) => {
        const n = new Set(s);
        rows.forEach((r) => (checked ? n.add(r.request_id) : n.delete(r.request_id)));
        return n;
    });
    const allSel = (rows) => rows.length > 0 && rows.every((r) => selected.has(r.request_id));
    const someSel = (rows) => rows.some((r) => selected.has(r.request_id)) && !allSel(rows);

    const handleApprove = async (requestId) => {
        try {
            await approveAvailability(requestId).unwrap();
            setSnackbar({ open: true, message: 'Request approved', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Approve failed', severity: 'error' });
        }
    };

    const handleApproveSelected = async () => {
        const ids = [...selected];
        if (!ids.length) return;
        try {
            const res = await approveBatchAvailability(ids).unwrap();
            setSnackbar({ open: true, message: res?.message || `Approved ${ids.length}`, severity: 'success' });
            setSelected(new Set());
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Approve failed', severity: 'error' });
        }
    };

    const handleApproveAll = async () => {
        if (!window.confirm('Approve ALL pending availability requests (every doctor, across all pages)? This cannot be undone.')) return;
        try {
            const res = await approveAllAvailability().unwrap();
            setSnackbar({ open: true, message: res?.message || 'All pending requests approved', severity: 'success' });
            setSelected(new Set());
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Bulk approve failed', severity: 'error' });
        }
    };

    const handleReject = async () => {
        try {
            await rejectAvailability({ requestId: rejectDialog.requestId, reason: rejectReason }).unwrap();
            setSnackbar({ open: true, message: 'Request rejected', severity: 'success' });
            setRejectDialog({ open: false, requestId: null });
            setRejectReason('');
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Reject failed', severity: 'error' });
        }
    };

    if (isLoading) {
        return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
    }

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" fontWeight="bold" mb={2}>Availability Approvals</Typography>

            <Tabs value={tabIdx} onChange={(_, v) => setTabIdx(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
                {TABS.map((t) => <Tab key={t.key} label={t.label} />)}
            </Tabs>

            {/* ── Pending: batched by doctor, tick-box selectable ── */}
            {isPending && (
                requests.length === 0 ? (
                    <Alert severity="info">No requests in the pending bucket.</Alert>
                ) : (
                    <>
                        <Stack direction="row" spacing={1.5} justifyContent="flex-end" sx={{ mb: 1.5 }}>
                            <Button
                                variant="contained" color="success"
                                startIcon={<CheckCircleIcon />}
                                disabled={selected.size === 0 || batchApproving}
                                onClick={handleApproveSelected}
                            >
                                {batchApproving ? 'Approving…' : `Approve selected (${selected.size})`}
                            </Button>
                            <Button
                                variant="outlined" color="success"
                                startIcon={bulkApproving ? <CircularProgress size={18} color="inherit" /> : <DoneAllIcon />}
                                onClick={handleApproveAll} disabled={bulkApproving}
                            >
                                {bulkApproving ? 'Approving…' : 'Approve all pending'}
                            </Button>
                        </Stack>

                        <Stack spacing={2}>
                            {groups.map((g) => (
                                <Paper key={g.key} variant="outlined">
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1,
                                        bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider' }}>
                                        <Checkbox
                                            checked={allSel(g.rows)} indeterminate={someSel(g.rows)}
                                            onChange={(e) => toggleDoctor(g.rows, e.target.checked)}
                                        />
                                        <img src={g.profile || '/default-avatar.png'} alt="" width={28} height={28} style={{ borderRadius: '50%' }} />
                                        <Typography fontWeight={700}>{g.name}</Typography>
                                        <Chip size="small" label={`${g.rows.length} pending`} color="warning" variant="outlined" />
                                    </Box>
                                    <Table size="small">
                                        <TableBody>
                                            {g.rows.map((req) => {
                                                const slot = describeSlot(req);
                                                return (
                                                    <TableRow key={req.request_id} hover selected={selected.has(req.request_id)}>
                                                        <TableCell padding="checkbox">
                                                            <Checkbox
                                                                checked={selected.has(req.request_id)}
                                                                onChange={() => toggleOne(req.request_id)}
                                                            />
                                                        </TableCell>
                                                        <TableCell>
                                                            <Chip label={req.title} size="small" color="primary" variant="outlined" />
                                                        </TableCell>
                                                        <TableCell>
                                                            {slot && (
                                                                <Box>
                                                                    <Typography variant="body2" fontWeight={600} color={slot.removed ? 'error.main' : 'text.primary'}>
                                                                        {slot.headline}
                                                                    </Typography>
                                                                    <Typography variant="caption" color="text.secondary">{slot.detail}</Typography>
                                                                </Box>
                                                            )}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Typography variant="caption" color="text.secondary">
                                                                {req.requested_at ? new Date(req.requested_at).toLocaleString() : '—'}
                                                            </Typography>
                                                        </TableCell>
                                                        <TableCell align="right">
                                                            <Tooltip title="Approve">
                                                                <IconButton color="success" size="small" onClick={() => handleApprove(req.request_id)}>
                                                                    <CheckCircleIcon fontSize="small" />
                                                                </IconButton>
                                                            </Tooltip>
                                                            <Tooltip title="Reject">
                                                                <IconButton color="error" size="small" onClick={() => setRejectDialog({ open: true, requestId: req.request_id })}>
                                                                    <CancelIcon fontSize="small" />
                                                                </IconButton>
                                                            </Tooltip>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </Paper>
                            ))}
                        </Stack>
                    </>
                )
            )}

            {/* ── Approved / Rejected / All: flat read-only list ── */}
            {!isPending && (
                requests.length === 0 ? (
                    <Alert severity="info">No requests in the {activeTab.label.toLowerCase()} bucket.</Alert>
                ) : (
                    <TableContainer component={Paper}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell><b>Doctor</b></TableCell>
                                    <TableCell><b>Request Type</b></TableCell>
                                    <TableCell><b>Slot</b></TableCell>
                                    <TableCell><b>Status</b></TableCell>
                                    <TableCell><b>Requested</b></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {requests.map((req) => {
                                    const rawStatus = (req.status || 'pending').toLowerCase();
                                    const chip = STATUS_CHIP[rawStatus] || { label: rawStatus, color: 'default' };
                                    const slot = describeSlot(req);
                                    return (
                                        <TableRow key={req.request_id}>
                                            <TableCell>
                                                <Box display="flex" alignItems="center" gap={1}>
                                                    <img src={req.profile_image || '/default-avatar.png'} alt="" width={30} height={30} style={{ borderRadius: '50%' }} />
                                                    {req.full_name || 'Dr. Unknown'}
                                                </Box>
                                            </TableCell>
                                            <TableCell><Chip label={req.title} size="small" color="primary" variant="outlined" /></TableCell>
                                            <TableCell>
                                                {slot ? (
                                                    <Box>
                                                        <Typography variant="body2" fontWeight={600} color={slot.removed ? 'error.main' : 'text.primary'}>{slot.headline}</Typography>
                                                        <Typography variant="caption" color="text.secondary">{slot.detail}</Typography>
                                                    </Box>
                                                ) : '—'}
                                            </TableCell>
                                            <TableCell><Chip label={chip.label} size="small" color={chip.color} variant="outlined" /></TableCell>
                                            <TableCell>{req.requested_at ? new Date(req.requested_at).toLocaleString() : '—'}</TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )
            )}

            {/* Reject Dialog */}
            <Dialog open={rejectDialog.open} onClose={() => setRejectDialog({ open: false, requestId: null })} maxWidth="sm" fullWidth>
                <DialogTitle>Reject Request</DialogTitle>
                <DialogContent>
                    <TextField
                        label="Rejection Reason" multiline rows={3} fullWidth
                        value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                        sx={{ mt: 1 }} placeholder="Explain why the configuration is being rejected..."
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRejectDialog({ open: false, requestId: null })}>Cancel</Button>
                    <Button variant="contained" color="error" onClick={handleReject}>Reject</Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar((s) => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
            </Snackbar>
        </Box>
    );
};

export default AvailabilityApprovals;
