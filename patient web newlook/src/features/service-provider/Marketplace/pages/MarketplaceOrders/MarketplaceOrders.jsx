/**
 * MarketplaceOrders — Doctor view of their marketplace sales.
 * Doctors can manage status, mark as completed, and send notes/queries to patients.
 *
 * Also mounted by admin Operations (via "My Appointments / Service List"), which
 * is why the two hooks come from ``scopedDoctorApi`` rather than straight from
 * ``marketplaceApi``: there, they have to answer for the doctor being managed,
 * not for the admin.
 */
import React, { useState } from 'react';
import {
    Box, Typography, Paper, Table, TableHead, TableRow, TableCell,
    TableBody, TableContainer, Chip, CircularProgress, Stack, Divider, IconButton,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField,
    Button, Snackbar, Alert, Tooltip, Tabs, Tab, Link
} from '@mui/material';
import EditNoteIcon from '@mui/icons-material/EditNote';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import CancelIcon from '@mui/icons-material/Cancel';

import {
    useGetDoctorMarketplaceSalesQuery,
    useUpdateMarketplaceOrderMutation,
} from '../../../api/scopedDoctorApi';

const MarketplaceOrders = () => {
    const { data: sales = [], isLoading } = useGetDoctorMarketplaceSalesQuery();
    const [updateOrder] = useUpdateMarketplaceOrderMutation();

    const [editDialog, setEditDialog] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [form, setForm] = useState({ status: '', doctor_notes: '' });
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
    const [filter, setFilter] = useState('all');

    const handleOpenEdit = (order) => {
        setSelectedOrder(order);
        setForm({ status: order.status, doctor_notes: order.doctor_notes || '' });
        setEditDialog(true);
    };

    const handleUpdate = async (statusOverride = null) => {
        try {
            const payload = {
                id: selectedOrder.id,
                status: statusOverride || form.status,
                doctor_notes: form.doctor_notes
            };
            await updateOrder(payload).unwrap();
            setSnackbar({ open: true, message: 'Order updated successfully', severity: 'success' });
            setEditDialog(false);
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Update failed', severity: 'error' });
        }
    };

    const handleAccept = async (order) => {
        try {
            // The patient has already paid (status 'paid'). Accepting moves it to
            // 'under_process' and opens the service chat channel(s).
            await updateOrder({ id: order.id, status: 'under_process' }).unwrap();
            setSnackbar({ open: true, message: 'Order accepted — the service channel is now open.', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Update failed', severity: 'error' });
        }
    };

    const handleReject = async (order) => {
        if (!window.confirm('Reject this order? The patient will be notified (refunds are handled separately).')) return;
        try {
            await updateOrder({ id: order.id, status: 'rejected' }).unwrap();
            setSnackbar({ open: true, message: 'Order rejected.', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Update failed', severity: 'error' });
        }
    };

    const handleMarkDelivered = async (order) => {
        if (!window.confirm('Mark this order as delivered / completed?')) return;
        try {
            await updateOrder({ id: order.id, status: 'completed' }).unwrap();
            setSnackbar({ open: true, message: 'Order marked as delivered', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Update failed', severity: 'error' });
        }
    };

    if (isLoading) {
        return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
    }

    const getStatusColor = (status) => {
        switch (status?.toLowerCase()) {
            case 'pending': return 'warning';
            case 'accepted': return 'info';
            case 'paid': return 'success';
            case 'under_process': return 'secondary';
            case 'completed': return 'info';
            case 'cancelled': return 'error';
            case 'rejected': return 'error';
            default: return 'default';
        }
    };

    const prettyStatus = (s) => {
        const v = (s || '').toLowerCase();
        if (v === 'paid') return 'PAID · REVIEW';
        if (v === 'under_process') return 'ACCEPTED';
        return (s || '').replace('_', ' ').toUpperCase();
    };

    const FILTERS = [
        { key: 'all', label: 'All' },
        { key: 'paid', label: 'To Review' },
        { key: 'under_process', label: 'Accepted' },
        { key: 'completed', label: 'Completed' },
        { key: 'rejected', label: 'Rejected' },
    ];
    const filteredSales = filter === 'all'
        ? sales
        : sales.filter((o) => (o.status || '').toLowerCase() === filter);

    return (
        <Box sx={{ p: 0 }}>
            <Paper sx={{ p: 3, borderRadius: 2 }}>
                <Typography variant="h6" gutterBottom fontWeight="600">
                    Marketplace Sales (Incoming Orders)
                </Typography>
                <Divider sx={{ mb: 2 }} />

                <Tabs value={filter} onChange={(_, v) => setFilter(v)} sx={{ mb: 2 }}
                    variant="scrollable" scrollButtons="auto">
                    {FILTERS.map((f) => {
                        const count = f.key === 'all' ? sales.length
                            : sales.filter((o) => (o.status || '').toLowerCase() === f.key).length;
                        return <Tab key={f.key} value={f.key} label={`${f.label} (${count})`} />;
                    })}
                </Tabs>

                <TableContainer>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell><b>Order ID</b></TableCell>
                            <TableCell><b>Patient</b></TableCell>
                            <TableCell><b>Product</b></TableCell>
                            <TableCell align="right"><b>Earnings (₹)</b></TableCell>
                            <TableCell><b>Status</b></TableCell>
                            <TableCell><b>Query/Notes</b></TableCell>
                            <TableCell align="center"><b>Actions</b></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {filteredSales.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={7} align="center">
                                    <Typography color="text.secondary" py={4}>
                                        No orders in this bucket.
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        )}
                        {filteredSales.map((order) => (
                            <TableRow key={order.id}>
                                <TableCell>
                                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                        {order.id.substring(0, 8)}...
                                    </Typography>
                                </TableCell>
                                <TableCell>
                                    <Typography variant="subtitle2">{order.patient_name}</Typography>
                                </TableCell>
                                <TableCell>
                                    <Typography variant="body2">{order.product_name}</Typography>
                                    {order.group_id && (
                                        <Tooltip title={(order.serving_doctors || []).join(', ')}>
                                            <Chip label="Group" size="small" color="secondary" variant="outlined" sx={{ mt: 0.5 }} />
                                        </Tooltip>
                                    )}
                                </TableCell>
                                <TableCell align="right">
                                    <Typography variant="body2" fontWeight="600">₹{order.price_at_purchase}</Typography>
                                </TableCell>
                                <TableCell>
                                    <Chip
                                        label={prettyStatus(order.status)}
                                        color={getStatusColor(order.status)}
                                        size="small"
                                    />
                                </TableCell>
                                <TableCell>
                                    {order.patient_data && (
                                        <Typography variant="caption" sx={{ display: 'block', maxWidth: 220 }}>
                                            <b>Patient:</b> {order.patient_data}
                                        </Typography>
                                    )}
                                    {order.patient_attachment_link && (
                                        <Typography variant="caption" sx={{ display: 'block' }}>
                                            <Link href={order.patient_attachment_link} target="_blank" rel="noopener">
                                                View attachment
                                            </Link>
                                        </Typography>
                                    )}
                                    {order.doctor_notes && (
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 220 }}>
                                            <b>Your note:</b> {order.doctor_notes}
                                        </Typography>
                                    )}
                                    {!order.patient_data && !order.patient_attachment_link && !order.doctor_notes && (
                                        <Typography variant="caption" color="text.secondary">—</Typography>
                                    )}
                                </TableCell>
                                <TableCell align="center">
                                    <Stack direction="row" spacing={1} justifyContent="center">
                                        <Tooltip title="Update Order / Send Query">
                                            <IconButton size="small" color="primary" onClick={() => handleOpenEdit(order)}>
                                                <EditNoteIcon />
                                            </IconButton>
                                        </Tooltip>
                                        {order.status === 'paid' && (
                                            <>
                                                <Tooltip title="Accept (opens the service channel)">
                                                    <IconButton size="small" color="secondary" onClick={() => handleAccept(order)}>
                                                        <PlayArrowIcon />
                                                    </IconButton>
                                                </Tooltip>
                                                <Tooltip title="Reject this request">
                                                    <IconButton size="small" color="error" onClick={() => handleReject(order)}>
                                                        <CancelIcon />
                                                    </IconButton>
                                                </Tooltip>
                                            </>
                                        )}
                                        {order.status === 'under_process' && (
                                            <Tooltip title="Mark as Delivered">
                                                <IconButton size="small" color="success" onClick={() => handleMarkDelivered(order)}>
                                                    <LocalShippingIcon />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                    </Stack>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                </TableContainer>
            </Paper>

            {/* Update Dialog */}
            <Dialog open={editDialog} onClose={() => setEditDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Order Management</DialogTitle>
                <DialogContent>
                    <Stack spacing={3} mt={1}>
                        <Box>
                            <Typography variant="subtitle2" color="text.secondary">Target Patient</Typography>
                            <Typography variant="h6">{selectedOrder?.patient_name}</Typography>
                            <Typography variant="body2">Item: {selectedOrder?.product_name}</Typography>
                        </Box>

                        <Divider />

                        <Box>
                            <Typography variant="subtitle2" gutterBottom>Change Status</Typography>
                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                {['pending', 'under_process', 'completed', 'cancelled', 'rejected'].map(s => (
                                    <Chip
                                        key={s}
                                        label={prettyStatus(s)}
                                        onClick={() => setForm(f => ({ ...f, status: s }))}
                                        color={form.status === s ? getStatusColor(s) : 'default'}
                                        variant={form.status === s ? 'filled' : 'outlined'}
                                    />
                                ))}
                            </Stack>
                        </Box>

                        <Box>
                            <Typography variant="subtitle2" gutterBottom>
                                Send Query / Request Information
                            </Typography>
                            <TextField
                                fullWidth
                                multiline
                                rows={4}
                                placeholder="Example: Please upload your previous medical report for verification."
                                value={form.doctor_notes}
                                onChange={(e) => setForm(f => ({ ...f, doctor_notes: e.target.value }))}
                                variant="outlined"
                            />
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                This note will be visible to the patient on their "My Purchases" page.
                            </Typography>
                        </Box>
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ p: 3 }}>
                    <Button onClick={() => setEditDialog(false)}>Cancel</Button>
                    <Button variant="contained" onClick={() => handleUpdate()}>Save Changes</Button>
                </DialogActions>
            </Dialog>

            <Snackbar 
                open={snackbar.open} 
                autoHideDuration={4000} 
                onClose={() => setSnackbar(s => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert severity={snackbar.severity} variant="filled">{snackbar.message}</Alert>
            </Snackbar>
        </Box>
    );
};

export default MarketplaceOrders;
