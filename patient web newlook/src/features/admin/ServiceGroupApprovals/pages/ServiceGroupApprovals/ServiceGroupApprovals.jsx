/**
 * ServiceGroupApprovals — Admin page to review/approve/reject multi-doctor
 * group service offerings. Mirrors AvailabilityApprovals.
 */
import React, { useState } from 'react';
import {
    Box, Typography, Paper, Table, TableContainer, TableHead, TableRow, TableCell,
    TableBody, IconButton, Chip, Button, Dialog, DialogTitle,
    DialogContent, DialogActions, TextField, Snackbar, Alert,
    CircularProgress, Tooltip, Tabs, Tab, Stack, Autocomplete,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import PersonAddIcon from '@mui/icons-material/PersonAdd';

import {
    useGetAdminServiceGroupsQuery,
    useApproveServiceGroupMutation,
    useRejectServiceGroupMutation,
    useLazyGetGroupCandidatesQuery,
    useAssignGroupMemberMutation,
} from '../../../api/marketplaceEndpoints';
import { useGetMasterSpecializationsByLevelQuery } from '../../../api/doctorSignupConfigEndpoints';

const TABS = [
    { key: 'awaiting_members', label: 'Awaiting members' },
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'all', label: 'All' },
];

const STATUS_CHIP = {
    awaiting_members: { label: 'Awaiting members', color: 'info' },
    pending: { label: 'Pending', color: 'warning' },
    approved: { label: 'Approved', color: 'success' },
    rejected: { label: 'Rejected', color: 'error' },
};

const MEMBER_COLOR = { accepted: 'success', invited: 'warning', declined: 'error' };

const ServiceGroupApprovals = () => {
    const [tabIdx, setTabIdx] = useState(0);
    const activeTab = TABS[tabIdx];
    const { data: groups = [], isLoading } = useGetAdminServiceGroupsQuery(activeTab.key);
    const [approveGroup] = useApproveServiceGroupMutation();
    const [rejectGroup] = useRejectServiceGroupMutation();
    const [assignMember] = useAssignGroupMemberMutation();
    const [fetchCandidates, { data: candidates = [], isFetching: loadingCand }] = useLazyGetGroupCandidatesQuery();
    const { data: specializations = [] } = useGetMasterSpecializationsByLevelQuery({});

    const [rejectDialog, setRejectDialog] = useState({ open: false, groupId: null });
    const [rejectReason, setRejectReason] = useState('');
    const [assignDialog, setAssignDialog] = useState({ open: false, groupId: null });
    const [assignSpec, setAssignSpec] = useState(null);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

    const openAssign = (groupId) => { setAssignDialog({ open: true, groupId }); setAssignSpec(null); };
    const pickSpec = (spec, groupId) => {
        setAssignSpec(spec);
        if (spec) fetchCandidates({ groupId, specializationId: spec.id || spec.category_id });
    };
    const doAssign = async (doctorId) => {
        try {
            await assignMember({ groupId: assignDialog.groupId, doctorId }).unwrap();
            setSnackbar({ open: true, message: 'Doctor assigned to the group', severity: 'success' });
            setAssignDialog({ open: false, groupId: null });
        } catch (e) {
            setSnackbar({ open: true, message: e?.data?.error || 'Assign failed', severity: 'error' });
        }
    };

    const handleApprove = async (groupId) => {
        try {
            await approveGroup(groupId).unwrap();
            setSnackbar({ open: true, message: 'Group offering approved', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Approve failed', severity: 'error' });
        }
    };

    const handleReject = async () => {
        try {
            await rejectGroup({ groupId: rejectDialog.groupId, reason: rejectReason }).unwrap();
            setSnackbar({ open: true, message: 'Group offering rejected', severity: 'success' });
            setRejectDialog({ open: false, groupId: null });
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
            <Typography variant="h5" fontWeight="bold" mb={2}>Group Offering Approvals</Typography>

            <Tabs value={tabIdx} onChange={(_, v) => setTabIdx(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
                {TABS.map((t) => <Tab key={t.key} label={t.label} />)}
            </Tabs>

            {groups.length === 0 ? (
                <Alert severity="info">No group offerings in the {activeTab.label.toLowerCase()} bucket.</Alert>
            ) : (
                <TableContainer component={Paper}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell><b>Service</b></TableCell>
                                <TableCell><b>Lead</b></TableCell>
                                <TableCell><b>Doctors</b></TableCell>
                                <TableCell align="right"><b>Price (₹)</b></TableCell>
                                <TableCell><b>Status</b></TableCell>
                                <TableCell align="center"><b>Actions</b></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {groups.map((g) => {
                                const status = (g.approval_status || 'pending').toLowerCase();
                                const chip = STATUS_CHIP[status] || { label: status, color: 'default' };
                                const isPending = status === 'pending';
                                const doctorNames = (g.members || []).map((m) => m.doctor_name).filter(Boolean).join(', ');
                                return (
                                    <TableRow key={g.id}>
                                        <TableCell>
                                            <Typography variant="subtitle2">{g.product_name}</Typography>
                                            {g.group_description && (
                                                <Typography variant="caption" color="text.secondary">{g.group_description}</Typography>
                                            )}
                                        </TableCell>
                                        <TableCell>{g.lead_name || '—'}</TableCell>
                                        <TableCell>
                                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ maxWidth: 300 }}>
                                                {(g.members || []).length === 0 ? '—' : (g.members || []).map((m) => (
                                                    <Chip key={m.id || m.doctor_id} size="small" variant="outlined"
                                                        label={`${m.doctor_name || '—'}${m.role === 'lead' ? ' (lead)' : ''}`}
                                                        color={MEMBER_COLOR[m.status] || 'default'} />
                                                ))}
                                            </Stack>
                                        </TableCell>
                                        <TableCell align="right">₹{g.group_price}</TableCell>
                                        <TableCell>
                                            <Tooltip title={status === 'rejected' && g.rejection_reason ? g.rejection_reason : ''}>
                                                <Chip label={chip.label} size="small" color={chip.color} variant="outlined" />
                                            </Tooltip>
                                        </TableCell>
                                        <TableCell align="center">
                                            {isPending && (
                                                <>
                                                    <Tooltip title="Approve">
                                                        <IconButton color="success" onClick={() => handleApprove(g.id)}>
                                                            <CheckCircleIcon />
                                                        </IconButton>
                                                    </Tooltip>
                                                    <Tooltip title="Reject">
                                                        <IconButton color="error" onClick={() => setRejectDialog({ open: true, groupId: g.id })}>
                                                            <CancelIcon />
                                                        </IconButton>
                                                    </Tooltip>
                                                </>
                                            )}
                                            {status === 'awaiting_members' && (
                                                <Tooltip title="Assign a doctor to fill a missing specialty">
                                                    <IconButton color="primary" onClick={() => openAssign(g.id)}>
                                                        <PersonAddIcon />
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                            {(status === 'approved' || status === 'rejected') && (
                                                <Typography variant="caption" color="text.secondary">—</Typography>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            <Dialog open={rejectDialog.open} onClose={() => setRejectDialog({ open: false, groupId: null })} maxWidth="sm" fullWidth>
                <DialogTitle>Reject Group Offering</DialogTitle>
                <DialogContent>
                    <TextField label="Rejection Reason" multiline rows={3} fullWidth value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)} sx={{ mt: 1 }}
                        placeholder="Explain why this group offering is being rejected..." />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRejectDialog({ open: false, groupId: null })}>Cancel</Button>
                    <Button variant="contained" color="error" onClick={handleReject} disabled={!rejectReason.trim()}>Reject</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={assignDialog.open} onClose={() => setAssignDialog({ open: false, groupId: null })} maxWidth="sm" fullWidth>
                <DialogTitle>Assign a doctor to fill a specialty</DialogTitle>
                <DialogContent>
                    <Autocomplete sx={{ mt: 1 }} options={specializations} getOptionLabel={(o) => o.name || ''}
                        value={assignSpec} onChange={(_, v) => pickSpec(v, assignDialog.groupId)}
                        renderInput={(params) => <TextField {...params} label="Specialization needed" />} />
                    {loadingCand && <Box sx={{ mt: 2, textAlign: 'center' }}><CircularProgress size={22} /></Box>}
                    {assignSpec && !loadingCand && (
                        <Box sx={{ mt: 2 }}>
                            {candidates.length === 0 ? (
                                <Alert severity="info">No matching doctors available for this specialization.</Alert>
                            ) : candidates.map((c) => (
                                <Stack key={c.id} direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.5 }}>
                                    <Typography variant="body2">{c.name}</Typography>
                                    <Button size="small" variant="contained" onClick={() => doAssign(c.id)}>Assign</Button>
                                </Stack>
                            ))}
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAssignDialog({ open: false, groupId: null })}>Close</Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
            </Snackbar>
        </Box>
    );
};

export default ServiceGroupApprovals;
