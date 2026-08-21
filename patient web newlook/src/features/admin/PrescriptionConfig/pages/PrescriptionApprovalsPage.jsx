/**
 * PrescriptionApprovalsPage — Admin reviews doctor prescriptions.
 * Tab bar lets the admin switch between Pending / Approved / Rejected
 * / All — previously only PENDING was reachable, which made it
 * impossible to look back at decisions already taken or check the
 * status of a prescription the doctor just pushed to the patient.
 */
import { useState } from 'react';
import {
    Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, TablePagination, Button, Chip, CircularProgress,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField, Snackbar, Alert,
    IconButton, Tooltip, Tabs, Tab,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import VisibilityIcon from '@mui/icons-material/Visibility';
import AssignmentIcon from '@mui/icons-material/Assignment';
import {
    useGetPendingApprovalsQuery,
    useApprovePrescriptionMutation,
    useRejectPrescriptionMutation,
} from '../../api/prescriptionConfigEndpoints';

// Tab index → backend status filter. Keep these in sync with the
// ``status`` query param accepted by /admin/prescription-config/
// pending-approvals (pending|approved|rejected|all).
const TABS = [
    { key: 'pending',  label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'all',      label: 'All' },
];

const STATUS_CHIP = {
    pending_approval: { label: 'Pending', color: 'warning' },
    approved:         { label: 'Approved', color: 'success' },
    active:           { label: 'Active', color: 'success' },
    rejected:         { label: 'Rejected', color: 'error' },
    revised:          { label: 'Revised', color: 'info' },
    expired:          { label: 'Expired', color: 'default' },
    cancelled:        { label: 'Cancelled', color: 'default' },
    draft:            { label: 'Draft', color: 'default' },
};

const PrescriptionApprovalsPage = () => {
    const [tabIdx, setTabIdx] = useState(0);
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);
    const [rejectDialog, setRejectDialog] = useState({ open: false, id: null });
    const [rejectReason, setRejectReason] = useState('');
    const [snack, setSnack] = useState({ open: false, msg: '', sev: 'success' });

    const activeTab = TABS[tabIdx];
    const { data, isLoading } = useGetPendingApprovalsQuery({
        page: page + 1,
        per_page: rowsPerPage,
        status: activeTab.key,
    });
    const [approvePrescription] = useApprovePrescriptionMutation();
    const [rejectPrescription] = useRejectPrescriptionMutation();

    const prescriptions = data?.prescriptions || [];
    const pagination = data?.pagination || {};
    const handleTabChange = (_, v) => {
        setTabIdx(v);
        setPage(0); // reset paginator when switching buckets
    };

    const handleApprove = async (id) => {
        try {
            await approvePrescription(id).unwrap();
            setSnack({ open: true, msg: 'Prescription approved!', sev: 'success' });
        } catch (err) {
            setSnack({ open: true, msg: err?.data?.message || 'Failed', sev: 'error' });
        }
    };

    const handleReject = async () => {
        try {
            await rejectPrescription({ id: rejectDialog.id, reason: rejectReason }).unwrap();
            setSnack({ open: true, msg: 'Prescription rejected', sev: 'info' });
            setRejectDialog({ open: false, id: null });
            setRejectReason('');
        } catch (err) {
            setSnack({ open: true, msg: err?.data?.message || 'Failed', sev: 'error' });
        }
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" gap={1} mb={2}>
                <AssignmentIcon fontSize="large" color="primary" />
                <Typography variant="h4" fontWeight="bold">Prescription Approvals</Typography>
                {pagination.total > 0 && (
                    <Chip
                        label={`${pagination.total} ${activeTab.label.toLowerCase()}`}
                        color={activeTab.key === 'pending' ? 'warning' : 'default'}
                        size="small"
                        sx={{ ml: 1 }}
                    />
                )}
            </Box>

            {/* Status tabs — actioned items don't disappear from the
                admin's view, they just move to a different tab. */}
            <Tabs
                value={tabIdx}
                onChange={handleTabChange}
                sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
            >
                {TABS.map((t) => (
                    <Tab key={t.key} label={t.label} />
                ))}
            </Tabs>

            <TableContainer component={Paper}>
                {isLoading ? (
                    <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>
                ) : (
                    <>
                        <Table size="small">
                            <TableHead>
                                <TableRow sx={{ bgcolor: '#fff3e0' }}>
                                    <TableCell><b>Doctor</b></TableCell>
                                    <TableCell><b>Patient</b></TableCell>
                                    <TableCell><b>Diagnosis</b></TableCell>
                                    <TableCell><b>Medicines</b></TableCell>
                                    <TableCell><b>Status</b></TableCell>
                                    <TableCell><b>Date</b></TableCell>
                                    <TableCell align="right"><b>Actions</b></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {prescriptions.map((p) => {
                                    const chip = STATUS_CHIP[p.status] || { label: p.status || '—', color: 'default' };
                                    // Approve / Reject only make sense while
                                    // the row is still PENDING_APPROVAL.
                                    // Once actioned, the row is read-only
                                    // (admin can still click View).
                                    const isPending = p.status === 'pending_approval';
                                    return (
                                        <TableRow key={p.id} hover>
                                            <TableCell>{p.doctor?.full_name || '-'}</TableCell>
                                            <TableCell>{p.patient?.full_name || '-'}</TableCell>
                                            <TableCell>{p.diagnosis ? (p.diagnosis.length > 40 ? p.diagnosis.slice(0, 40) + '...' : p.diagnosis) : '-'}</TableCell>
                                            <TableCell>{p.medicines?.length || 0} items</TableCell>
                                            <TableCell>
                                                <Chip size="small" label={chip.label} color={chip.color} variant="outlined" />
                                            </TableCell>
                                            <TableCell>{p.issue_date || p.created_at?.split('T')[0]}</TableCell>
                                            <TableCell align="right">
                                                <Tooltip title="View prescription">
                                                    <IconButton size="small" color="primary"
                                                        onClick={() => window.open(`/dashboard/admin/prescription-approvals/${p.id}/review`, '_blank')}>
                                                        <VisibilityIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                                {isPending && (
                                                    <>
                                                        <Tooltip title="Approve">
                                                            <IconButton size="small" color="success" onClick={() => handleApprove(p.id)}>
                                                                <CheckCircleIcon fontSize="small" />
                                                            </IconButton>
                                                        </Tooltip>
                                                        <Tooltip title="Reject">
                                                            <IconButton size="small" color="error"
                                                                onClick={() => setRejectDialog({ open: true, id: p.id })}>
                                                                <CancelIcon fontSize="small" />
                                                            </IconButton>
                                                        </Tooltip>
                                                    </>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                                {!prescriptions.length && (
                                    <TableRow>
                                        <TableCell colSpan={7} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                            No prescriptions in this bucket.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                        <TablePagination
                            component="div" count={pagination.total || 0}
                            page={page} onPageChange={(_, p) => setPage(p)}
                            rowsPerPage={rowsPerPage}
                            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value)); setPage(0); }}
                        />
                    </>
                )}
            </TableContainer>

            {/* Reject Dialog */}
            <Dialog open={rejectDialog.open} onClose={() => setRejectDialog({ open: false, id: null })} maxWidth="sm" fullWidth>
                <DialogTitle>Reject Prescription</DialogTitle>
                <DialogContent>
                    <TextField autoFocus fullWidth multiline rows={3} sx={{ mt: 1 }}
                        label="Reason for rejection"
                        value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Please provide a reason..." />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRejectDialog({ open: false, id: null })}>Cancel</Button>
                    <Button variant="contained" color="error" onClick={handleReject}>Reject</Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({ ...snack, open: false })}>
                <Alert severity={snack.sev}>{snack.msg}</Alert>
            </Snackbar>
        </Box>
    );
};

export default PrescriptionApprovalsPage;
