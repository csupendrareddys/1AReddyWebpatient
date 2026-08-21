/**
 * MarketplaceProductApprovals — Admin page to review/approve/reject individual
 * doctor marketplace products (a doctor selling a catalog item at their own
 * price). Mirrors ServiceGroupApprovals; products are only bookable by patients
 * once approved.
 */
import React, { useState } from 'react';
import {
    Box, Typography, Paper, Table, TableContainer, TableHead, TableRow, TableCell,
    TableBody, IconButton, Chip, Button, Dialog, DialogTitle,
    DialogContent, DialogActions, TextField, Snackbar, Alert,
    CircularProgress, Tooltip, Tabs, Tab, MenuItem, Stack, Divider,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

import {
    useGetAdminMarketplaceProductsQuery,
    useApproveMarketplaceProductAdminMutation,
    useRejectMarketplaceProductAdminMutation,
} from '../../../api/marketplaceEndpoints';

const TABS = [
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'all', label: 'All' },
];

const STATUS_CHIP = {
    pending: { label: 'Pending', color: 'warning' },
    approved: { label: 'Approved', color: 'success' },
    rejected: { label: 'Rejected', color: 'error' },
};

const MarketplaceProductApprovals = () => {
    const [tabIdx, setTabIdx] = useState(0);
    const activeTab = TABS[tabIdx];
    const { data: products = [], isLoading } = useGetAdminMarketplaceProductsQuery(activeTab.key);
    const [approveProduct] = useApproveMarketplaceProductAdminMutation();
    const [rejectProduct] = useRejectMarketplaceProductAdminMutation();

    const [rejectDialog, setRejectDialog] = useState({ open: false, mpId: null });
    const [rejectReason, setRejectReason] = useState('');
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
    const [approveDialog, setApproveDialog] = useState({ open: false, mp: null });
    const [approveInsts, setApproveInsts] = useState([]);

    // Open the approve dialog, pre-filled with this vendor's current override.
    const openApprove = (mp) => {
        setApproveInsts((mp.payout_installments || []).map((i) => ({
            payment_type: i.payment_type || 'percentage',
            amount: i.amount ?? '', percentage: i.percentage ?? '',
            due_after_days: i.due_after_days ?? 0,
        })));
        setApproveDialog({ open: true, mp });
    };
    const addInst = () => setApproveInsts((a) => [...a, { payment_type: 'percentage', percentage: 100, amount: '', due_after_days: 0 }]);
    const updInst = (idx, patch) => setApproveInsts((a) => a.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
    const rmInst = (idx) => setApproveInsts((a) => a.filter((_, i) => i !== idx));

    const confirmApprove = async () => {
        try {
            const payload = approveInsts.map((i) => ({
                payment_type: i.payment_type,
                amount: i.payment_type === 'fixed' ? Number(i.amount) || 0 : null,
                percentage: i.payment_type === 'percentage' ? Number(i.percentage) || 0 : null,
                due_after_days: Math.max(0, parseInt(i.due_after_days, 10) || 0),
            }));
            await approveProduct({ mpId: approveDialog.mp.id, payout_installments: payload }).unwrap();
            setSnackbar({ open: true, message: 'Product approved', severity: 'success' });
            setApproveDialog({ open: false, mp: null });
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Approve failed', severity: 'error' });
        }
    };

    const handleReject = async () => {
        try {
            await rejectProduct({ mpId: rejectDialog.mpId, reason: rejectReason }).unwrap();
            setSnackbar({ open: true, message: 'Product rejected', severity: 'success' });
            setRejectDialog({ open: false, mpId: null });
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
            <Typography variant="h5" fontWeight="bold" mb={2}>Service / Product Approvals</Typography>

            <Tabs value={tabIdx} onChange={(_, v) => setTabIdx(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
                {TABS.map((t) => <Tab key={t.key} label={t.label} />)}
            </Tabs>

            {products.length === 0 ? (
                <Alert severity="info">No products in the {activeTab.label.toLowerCase()} bucket.</Alert>
            ) : (
                <TableContainer component={Paper}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell><b>Product</b></TableCell>
                                <TableCell><b>Doctor</b></TableCell>
                                <TableCell align="right"><b>Price (₹)</b></TableCell>
                                <TableCell><b>Description</b></TableCell>
                                <TableCell><b>Status</b></TableCell>
                                <TableCell align="center"><b>Actions</b></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {products.map((mp) => {
                                const status = (mp.approval_status || 'pending').toLowerCase();
                                const chip = STATUS_CHIP[status] || { label: status, color: 'default' };
                                const isPending = status === 'pending';
                                return (
                                    <TableRow key={mp.id}>
                                        <TableCell><Typography variant="subtitle2">{mp.product_name}</Typography></TableCell>
                                        <TableCell>{mp.doctor_name || '—'}</TableCell>
                                        <TableCell align="right">₹{mp.doctor_price}</TableCell>
                                        <TableCell>
                                            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 260 }}>
                                                {mp.doctor_description || '—'}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Tooltip title={status === 'rejected' && mp.rejection_reason ? mp.rejection_reason : ''}>
                                                <Chip label={chip.label} size="small" color={chip.color} variant="outlined" />
                                            </Tooltip>
                                        </TableCell>
                                        <TableCell align="center">
                                            {isPending ? (
                                                <>
                                                    <Tooltip title="Approve (set installments)">
                                                        <IconButton color="success" onClick={() => openApprove(mp)}>
                                                            <CheckCircleIcon />
                                                        </IconButton>
                                                    </Tooltip>
                                                    <Tooltip title="Reject">
                                                        <IconButton color="error" onClick={() => setRejectDialog({ open: true, mpId: mp.id })}>
                                                            <CancelIcon />
                                                        </IconButton>
                                                    </Tooltip>
                                                </>
                                            ) : (
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

            {/* Approve with a per-vendor installment override */}
            <Dialog open={approveDialog.open} onClose={() => setApproveDialog({ open: false, mp: null })} maxWidth="md" fullWidth>
                <DialogTitle>Approve — {approveDialog.mp?.product_name} ({approveDialog.mp?.doctor_name})</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        Override this vendor's payout installments before approving. Leave empty to
                        pay in one settlement. Each installment is a % of the fee or a fixed ₹, released
                        after the given number of days.
                    </Typography>
                    <Stack spacing={1}>
                        {approveInsts.map((inst, idx) => (
                            <Stack key={idx} direction="row" spacing={1} alignItems="center">
                                <TextField select size="small" label="Type" sx={{ minWidth: 120 }}
                                    value={inst.payment_type}
                                    onChange={(e) => updInst(idx, { payment_type: e.target.value })}>
                                    <MenuItem value="percentage">% of fee</MenuItem>
                                    <MenuItem value="fixed">Fixed ₹</MenuItem>
                                </TextField>
                                {inst.payment_type === 'percentage' ? (
                                    <TextField size="small" type="number" label="Percent" sx={{ width: 110 }}
                                        value={inst.percentage} onChange={(e) => updInst(idx, { percentage: e.target.value })} />
                                ) : (
                                    <TextField size="small" type="number" label="Amount ₹" sx={{ width: 110 }}
                                        value={inst.amount} onChange={(e) => updInst(idx, { amount: e.target.value })} />
                                )}
                                <TextField size="small" type="number" label="Pay after (days)" sx={{ width: 150 }}
                                    value={inst.due_after_days} onChange={(e) => updInst(idx, { due_after_days: e.target.value })} />
                                <IconButton size="small" color="error" onClick={() => rmInst(idx)}><DeleteIcon fontSize="small" /></IconButton>
                            </Stack>
                        ))}
                        <Button size="small" startIcon={<AddIcon />} onClick={addInst} sx={{ alignSelf: 'flex-start' }}>
                            Add installment
                        </Button>
                    </Stack>
                    <Divider sx={{ my: 1.5 }} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setApproveDialog({ open: false, mp: null })}>Cancel</Button>
                    <Button variant="contained" color="success" onClick={confirmApprove}>Approve</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={rejectDialog.open} onClose={() => setRejectDialog({ open: false, mpId: null })} maxWidth="sm" fullWidth>
                <DialogTitle>Reject Product</DialogTitle>
                <DialogContent>
                    <TextField label="Rejection Reason" multiline rows={3} fullWidth value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)} sx={{ mt: 1 }}
                        placeholder="Explain why this product is being rejected..." />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRejectDialog({ open: false, mpId: null })}>Cancel</Button>
                    <Button variant="contained" color="error" onClick={handleReject} disabled={!rejectReason.trim()}>Reject</Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
            </Snackbar>
        </Box>
    );
};

export default MarketplaceProductApprovals;
