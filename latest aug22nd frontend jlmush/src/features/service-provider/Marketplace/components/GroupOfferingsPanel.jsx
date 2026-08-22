/**
 * GroupOfferingsPanel — doctor creates/manages multi-doctor group service
 * offerings. Co-doctors are picked from the doctor's care network (accepted
 * "Individual" connections). Each group requires admin approval before it is
 * bookable by patients.
 */
import React, { useState } from 'react';
import {
    Box, Typography, Button, Paper, Table, TableHead, TableRow, TableCell,
    TableBody, TableContainer, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Snackbar, Alert, Chip, CircularProgress, Stack, Divider,
    MenuItem, FormControl, InputLabel, Select, OutlinedInput, Checkbox,
    ListItemText, Tooltip, Tabs, Tab, Grid, Card, CardContent,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import GroupsIcon from '@mui/icons-material/Groups';

// Scope-aware: an admin in Operations drives this panel on a doctor's behalf
// through the act-on-behalf proxy. Unscoped these are the exact same hooks.
import {
    useGetServiceGroupsQuery,
    useCreateServiceGroupMutation,
    useUpdateServiceGroupMutation,
    useDeleteServiceGroupMutation,
    useGetGroupInvitationsQuery,
    useRespondGroupInviteMutation,
    useGetNetworkConnectionsQuery,
} from '../../api/scopedDoctorApi';
import { useGetAdminProductsQuery } from '../../../admin/api/marketplaceEndpoints';
import { useExpressServiceInterestMutation, useGetMyServiceInterestsQuery } from '../../api/doctorEndpoints';
import ServiceDetailsDialog from './ServiceDetailsDialog';

const STATUS_COLOR = { awaiting_members: 'info', pending: 'warning', approved: 'success', rejected: 'error' };
const MEMBER_COLOR = { accepted: 'success', invited: 'warning', declined: 'error' };

// Approval-status buckets, so the doctor can see what's approved vs waiting.
const STATUS_TABS = [
    { key: 'waiting', label: 'Waiting for Approval', statuses: ['awaiting_members', 'pending'] },
    { key: 'approved', label: 'Approved', statuses: ['approved'] },
    { key: 'rejected', label: 'Rejected', statuses: ['rejected'] },
    { key: 'all', label: 'All', statuses: null },
];

const GroupOfferingsPanel = () => {
    const { data: groups = [], isLoading } = useGetServiceGroupsQuery();
    const [statusTab, setStatusTab] = useState(0);
    const { data: adminProducts = [] } = useGetAdminProductsQuery();
    const { data: networkDoctors = [] } = useGetNetworkConnectionsQuery({ type: 'doctor' });
    const { data: invitations = [] } = useGetGroupInvitationsQuery();
    const [respondInvite] = useRespondGroupInviteMutation();

    const [createGroup] = useCreateServiceGroupMutation();
    const [updateGroup] = useUpdateServiceGroupMutation();
    const [deleteGroup] = useDeleteServiceGroupMutation();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editId, setEditId] = useState(null);
    const [form, setForm] = useState({ product_id: '', group_price: '', group_description: '', member_doctor_ids: [] });
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
    const [detailsProduct, setDetailsProduct] = useState(null);
    const { data: myInterestIds = [] } = useGetMyServiceInterestsQuery();
    const [expressInterest, { isLoading: expressing }] = useExpressServiceInterestMutation();

    const handleInterest = async (product) => {
        try {
            const res = await expressInterest({ product_id: product.id }).unwrap();
            notify(res?.message || 'Interest registered — an admin will review it.', 'success');
        } catch (e) {
            notify(e?.data?.error || e?.data?.message || 'Could not register interest', 'error');
        }
    };

    const notify = (message, severity = 'info') => setSnackbar({ open: true, message, severity });
    const selectedProduct = adminProducts.find((p) => p.id === form.product_id);

    const openCreate = (product = null) => {
        setEditId(null);
        setForm({
            product_id: product?.id || '',
            group_price: product?.min_price != null ? String(product.min_price) : '',
            group_description: '',
            member_doctor_ids: [],
        });
        setDialogOpen(true);
    };

    // Active group-service products the doctor can base an offering on.
    const groupCatalog = adminProducts.filter((p) => p.is_active && p.is_group_service);

    const openEdit = (g) => {
        setEditId(g.id);
        setForm({
            product_id: g.product_id,
            group_price: g.group_price,
            group_description: g.group_description || '',
            // members excluding the lead (lead is implicit / not selectable)
            member_doctor_ids: (g.members || [])
                .filter((m) => m.role !== 'lead')
                .map((m) => m.doctor_id),
        });
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!form.product_id || !form.group_price) {
            notify('Product and price are required', 'warning');
            return;
        }
        const price = parseFloat(form.group_price);
        if (selectedProduct && (price < selectedProduct.min_price || price > selectedProduct.max_price)) {
            notify(`Price must be between ₹${selectedProduct.min_price} and ₹${selectedProduct.max_price}`, 'warning');
            return;
        }
        try {
            const payload = {
                product_id: form.product_id,
                group_price: price,
                group_description: form.group_description.trim(),
                member_doctor_ids: form.member_doctor_ids,
            };
            if (editId) {
                await updateGroup({ id: editId, ...payload }).unwrap();
                notify('Group offering updated — pending admin approval', 'success');
            } else {
                await createGroup(payload).unwrap();
                notify('Group offering submitted for admin approval', 'success');
            }
            setDialogOpen(false);
        } catch (err) {
            notify(err?.data?.message || err?.data?.error || 'Operation failed', 'error');
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this group offering?')) return;
        try {
            await deleteGroup(id).unwrap();
            notify('Group offering deleted', 'success');
        } catch (err) {
            notify(err?.data?.message || 'Delete failed', 'error');
        }
    };

    if (isLoading) return <Box display="flex" justifyContent="center" mt={6}><CircularProgress /></Box>;

    const inBucket = (t, g) => !t.statuses
        || t.statuses.includes((g.approval_status || 'pending').toLowerCase());
    const activeStatusTab = STATUS_TABS[statusTab] || STATUS_TABS[STATUS_TABS.length - 1];
    const visibleGroups = groups.filter((g) => inBucket(activeStatusTab, g));

    return (
        <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                <Box>
                    <Typography variant="h6" fontWeight="600">Group Offerings</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Browse group services below and register your interest — an admin assigns you to the plan.
                    </Typography>
                </Box>
            </Stack>

            <Grid container spacing={3}>
              <Grid item xs={12} md={8}>
            {invitations.length > 0 && (
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2, borderColor: 'info.main' }}>
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                        Group invitations ({invitations.length})
                    </Typography>
                    {invitations.map((g) => (
                        <Stack key={g.id} direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ py: 0.5 }}>
                            <Typography variant="body2">
                                <strong>{g.lead_name || 'A doctor'}</strong> invited you to co-offer{' '}
                                <strong>{g.product_name}</strong> (₹{g.group_price})
                            </Typography>
                            <Stack direction="row" spacing={1}>
                                <Button size="small" variant="contained" color="success"
                                    onClick={() => respondInvite({ id: g.id, accept: true }).unwrap()
                                        .then(() => notify('Invitation accepted', 'success'))
                                        .catch((e) => notify(e?.data?.error || 'Failed', 'error'))}>Accept</Button>
                                <Button size="small" variant="outlined" color="error"
                                    onClick={() => respondInvite({ id: g.id, accept: false }).unwrap()
                                        .then(() => notify('Invitation declined', 'info'))
                                        .catch((e) => notify(e?.data?.error || 'Failed', 'error'))}>Decline</Button>
                            </Stack>
                        </Stack>
                    ))}
                </Paper>
            )}

            <Tabs
                value={statusTab}
                onChange={(_, v) => setStatusTab(v)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{ mb: 1 }}
            >
                {STATUS_TABS.map((t) => {
                    const n = groups.filter((g) => inBucket(t, g)).length;
                    return <Tab key={t.key} label={`${t.label} (${n})`} />;
                })}
            </Tabs>

            <TableContainer component={Paper} sx={{ p: 2, borderRadius: 2 }}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell><b>Service</b></TableCell>
                            <TableCell align="right"><b>Price (₹)</b></TableCell>
                            <TableCell><b>Doctors</b></TableCell>
                            <TableCell><b>Status</b></TableCell>
                            <TableCell align="center"><b>Actions</b></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {visibleGroups.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} align="center">
                                    <Box sx={{ py: 4, color: 'text.secondary' }}>
                                        <GroupsIcon sx={{ fontSize: 40, opacity: 0.3 }} />
                                        <Typography>No group offerings in this view.</Typography>
                                    </Box>
                                </TableCell>
                            </TableRow>
                        )}
                        {visibleGroups.map((g) => (
                            <TableRow key={g.id}>
                                <TableCell><Typography variant="subtitle2">{g.product_name}</Typography></TableCell>
                                <TableCell align="right">₹{g.group_price}</TableCell>
                                <TableCell>
                                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                        {(g.members || []).map((m) => (
                                            <Chip key={m.id || m.doctor_id} size="small" variant="outlined"
                                                label={`${m.doctor_name || '—'}${m.role === 'lead' ? ' (lead)' : ''}`}
                                                color={MEMBER_COLOR[m.status] || 'default'} />
                                        ))}
                                    </Stack>
                                </TableCell>
                                <TableCell>
                                    <Tooltip title={g.approval_status === 'rejected' && g.rejection_reason ? g.rejection_reason : ''}>
                                        <Chip label={(g.approval_status || 'pending').toUpperCase()}
                                            color={STATUS_COLOR[g.approval_status] || 'default'} size="small" />
                                    </Tooltip>
                                </TableCell>
                                <TableCell align="center">
                                    <IconButton size="small" color="error" onClick={() => handleDelete(g.id)}><DeleteIcon fontSize="small" /></IconButton>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
              </Grid>

              {/* Right: browsable catalog of group services to base an offering on */}
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 3, borderRadius: 2, bgcolor: '#f8f9fa' }}>
                    <Typography variant="h6" gutterBottom fontWeight="600">Available Group Services</Typography>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                        Group-service items from the admin catalog. Pick one to offer with your network.
                    </Typography>
                    <Divider sx={{ mb: 2 }} />
                    <Stack spacing={2}>
                        {groupCatalog.length === 0 && (
                            <Typography variant="body2" color="text.secondary">
                                No group services in the catalog yet.
                            </Typography>
                        )}
                        {groupCatalog.map((p) => (
                            <Card key={p.id} sx={{ boxShadow: 'none', border: '1px solid #e0e0e0' }}>
                                <CardContent sx={{ p: '16px !important' }}>
                                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                                        <Box sx={{ pr: 1 }}>
                                            <Typography variant="subtitle1" fontWeight="600">{p.name}</Typography>
                                            <Typography variant="caption" color="text.secondary" display="block">
                                                Range: ₹{p.min_price} - ₹{p.max_price}
                                            </Typography>
                                            {p.eligible === false && (
                                                <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
                                                    {p.ineligible_reason || 'You may not be eligible for this service.'}
                                                </Typography>
                                            )}
                                        </Box>
                                        <Stack spacing={0.5} alignItems="flex-end">
                                            {myInterestIds.includes(p.id) ? (
                                                <Chip size="small" color="success" variant="outlined" label="Interested" />
                                            ) : (
                                                <Button size="small" variant="contained" disabled={expressing}
                                                    onClick={() => handleInterest(p)}>Express interest</Button>
                                            )}
                                            <Button size="small" onClick={() => setDetailsProduct(p)}>Details</Button>
                                        </Stack>
                                    </Stack>
                                </CardContent>
                            </Card>
                        ))}
                    </Stack>
                </Paper>
              </Grid>
            </Grid>

            {/* Create/Edit dialog */}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{editId ? 'Edit Group Offering' : 'Create Group Offering'}</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={3} mt={0.5}>
                        <FormControl fullWidth>
                            <InputLabel>Service (from admin catalog)</InputLabel>
                            <Select label="Service (from admin catalog)" value={form.product_id}
                                onChange={(e) => setForm((f) => ({ ...f, product_id: e.target.value }))}>
                                {adminProducts.filter((p) => p.is_active && p.is_group_service).map((p) => (
                                    <MenuItem key={p.id} value={p.id}>{p.name} (₹{p.min_price}–₹{p.max_price})</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <TextField label="Group Price (₹)" type="number" fullWidth value={form.group_price}
                            onChange={(e) => setForm((f) => ({ ...f, group_price: e.target.value }))}
                            helperText={selectedProduct ? `Allowed: ₹${selectedProduct.min_price} – ₹${selectedProduct.max_price}` : 'Pick a service first'} />

                        <FormControl fullWidth>
                            <InputLabel>Co-doctors (from your network)</InputLabel>
                            <Select multiple label="Co-doctors (from your network)" value={form.member_doctor_ids}
                                onChange={(e) => setForm((f) => ({ ...f, member_doctor_ids: e.target.value }))}
                                input={<OutlinedInput label="Co-doctors (from your network)" />}
                                renderValue={(selected) => selected
                                    .map((id) => networkDoctors.find((d) => d.target_id === id)?.name)
                                    .filter(Boolean).join(', ')}>
                                {networkDoctors.length === 0 && (
                                    <MenuItem disabled>No network doctors — connect in My Network first</MenuItem>
                                )}
                                {networkDoctors.map((d) => (
                                    <MenuItem key={d.target_id} value={d.target_id}>
                                        <Checkbox checked={form.member_doctor_ids.indexOf(d.target_id) > -1} />
                                        <ListItemText primary={d.name} />
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <TextField label="Description (optional)" fullWidth multiline rows={2} value={form.group_description}
                            onChange={(e) => setForm((f) => ({ ...f, group_description: e.target.value }))} />

                        <Alert severity="info">You are the lead. This offering becomes bookable only after an admin approves it.</Alert>
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleSave}>{editId ? 'Update' : 'Submit for Approval'}</Button>
                </DialogActions>
            </Dialog>

            <ServiceDetailsDialog open={!!detailsProduct} product={detailsProduct} onClose={() => setDetailsProduct(null)} />

            <Snackbar open={snackbar.open} autoHideDuration={4000}
                onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snackbar.severity} variant="filled">{snackbar.message}</Alert>
            </Snackbar>
        </Box>
    );
};

export default GroupOfferingsPanel;
