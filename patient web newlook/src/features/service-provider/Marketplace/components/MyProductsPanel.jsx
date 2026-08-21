/**
 * MyProductsPanel — doctor's individual product selling catalog.
 * Extracted from MyMarketplace so it can be reused inside the merged
 * "My Appointments / Service List" page. Doctors pick products from the
 * admin catalog and set their own price.
 */
import React, { useState } from 'react';
import {
    Box, Typography, Button, Paper, Table, TableHead, TableRow, TableCell,
    TableBody, TableContainer, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Snackbar, Alert, CircularProgress, Stack, Grid, Card,
    CardContent, Divider, Chip, Tooltip, Tabs, Tab,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

// Approval-status buckets, mirroring the Group Offerings panel so a doctor
// can see which products are live vs waiting on / rejected by admin review.
const STATUS_TABS = [
    { key: 'waiting', label: 'Waiting for Approval', statuses: ['pending'] },
    { key: 'approved', label: 'Approved', statuses: ['approved'] },
    { key: 'rejected', label: 'Rejected', statuses: ['rejected'] },
    { key: 'all', label: 'All', statuses: null },
];
const STATUS_COLOR = { pending: 'warning', approved: 'success', rejected: 'error' };

// Scope-aware: an admin in Operations drives this panel on a doctor's behalf
// through the act-on-behalf proxy. Unscoped these are the exact same hooks.
import {
    useGetDoctorMarketplaceProductsQuery,
    useSelectMarketplaceProductMutation,
    useUpdateMarketplaceProductMutation,
    useRemoveMarketplaceProductMutation,
    useGetDoctorProductsQuery,
} from '../../api/scopedDoctorApi';
// The admin catalog is already an admin endpoint and takes no doctor — it's
// only read here to resolve a base product's price range, so it stays direct.
import { useGetAdminProductsQuery } from '../../../admin/api/marketplaceEndpoints';
import ServiceDetailsDialog from './ServiceDetailsDialog';

const MyProductsPanel = () => {
    const { data: myProducts = [], isLoading: isMyLoading } = useGetDoctorMarketplaceProductsQuery();
    // Full admin catalog — used ONLY to resolve a base product's price range
    // when editing an already-added product (an owned product a doctor no
    // longer qualifies for must still be editable).
    const { data: adminProducts = [], isLoading: isAdminLoading } = useGetAdminProductsQuery();
    // Products this doctor is ACTUALLY allowed to offer (backend applies the
    // same specialization gate as "Add to My Store"). Drives the catalog so a
    // doctor is never shown an Add button for a product the add endpoint would
    // reject with 403.
    const { data: availableProducts = [], isLoading: isAvailLoading } = useGetDoctorProductsQuery();

    const [selectProduct] = useSelectMarketplaceProductMutation();
    const [updateProduct] = useUpdateMarketplaceProductMutation();
    const [removeProduct] = useRemoveMarketplaceProductMutation();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [selectedAdminProduct, setSelectedAdminProduct] = useState(null);
    const [mpId, setMpId] = useState(null);
    const [form, setForm] = useState({ price: '', description: '' });
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
    const [statusTab, setStatusTab] = useState(0);
    const [detailsProduct, setDetailsProduct] = useState(null);

    const openSelect = (p) => {
        const existing = myProducts.find((mp) => mp.product_id === p.id);
        if (existing) { openEdit(existing); return; }
        setEditMode(false);
        setSelectedAdminProduct(p);
        setForm({ price: p.min_price, description: p.description || '' });
        setDialogOpen(true);
    };

    const openEdit = (mp) => {
        setEditMode(true);
        setMpId(mp.id);
        const adminP = adminProducts.find((ap) => ap.id === mp.product_id);
        setSelectedAdminProduct(adminP);
        setForm({ price: mp.doctor_price, description: mp.doctor_description || '' });
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!form.price) {
            setSnackbar({ open: true, message: 'Price is required', severity: 'warning' });
            return;
        }
        try {
            const priceNum = parseFloat(form.price);
            if (priceNum < selectedAdminProduct.min_price || priceNum > selectedAdminProduct.max_price) {
                setSnackbar({
                    open: true,
                    message: `Price must be between ₹${selectedAdminProduct.min_price} and ₹${selectedAdminProduct.max_price}`,
                    severity: 'warning',
                });
                return;
            }
            const payload = {
                doctor_price: priceNum,
                doctor_description: form.description.trim(),
            };
            if (editMode) {
                await updateProduct({ id: mpId, ...payload }).unwrap();
                setSnackbar({ open: true, message: 'Product updated — pending admin approval', severity: 'success' });
            } else {
                await selectProduct({ product_id: selectedAdminProduct.id, ...payload }).unwrap();
                setSnackbar({ open: true, message: 'Product submitted for admin approval', severity: 'success' });
            }
            setDialogOpen(false);
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Operation failed', severity: 'error' });
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Remove this product from your marketplace?')) return;
        try {
            await removeProduct(id).unwrap();
            setSnackbar({ open: true, message: 'Product removed', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Removal failed', severity: 'error' });
        }
    };

    if (isMyLoading || isAdminLoading || isAvailLoading) {
        return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
    }

    const inBucket = (t, mp) => !t.statuses
        || t.statuses.includes((mp.approval_status || 'pending').toLowerCase());
    const activeStatusTab = STATUS_TABS[statusTab] || STATUS_TABS[STATUS_TABS.length - 1];
    const visibleProducts = myProducts.filter((mp) => inBucket(activeStatusTab, mp));

    return (
        <>
            <Grid container spacing={4}>
                {/* Left: Current Active Products */}
                <Grid item xs={12} md={8}>
                    <Paper sx={{ p: 3, borderRadius: 2 }}>
                        <Typography variant="h6" gutterBottom fontWeight="600">Selling Products</Typography>
                        <Typography variant="body2" color="text.secondary" mb={1}>
                            Products you add go live only after an admin approves them.
                        </Typography>
                        <Divider sx={{ mb: 1 }} />

                        <Tabs
                            value={statusTab}
                            onChange={(_, v) => setStatusTab(v)}
                            variant="scrollable"
                            scrollButtons="auto"
                            sx={{ mb: 1 }}
                        >
                            {STATUS_TABS.map((t) => {
                                const n = myProducts.filter((mp) => inBucket(t, mp)).length;
                                return <Tab key={t.key} label={`${t.label} (${n})`} />;
                            })}
                        </Tabs>

                        <TableContainer>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell><b>Product</b></TableCell>
                                    <TableCell align="right"><b>My Price (₹)</b></TableCell>
                                    <TableCell><b>My Description</b></TableCell>
                                    <TableCell><b>Status</b></TableCell>
                                    <TableCell align="center"><b>Actions</b></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {visibleProducts.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} align="center">
                                            <Typography color="text.secondary" py={2}>
                                                No products in this view.
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                                {visibleProducts.map((mp) => (
                                    <TableRow key={mp.id}>
                                        <TableCell><Typography variant="subtitle2">{mp.product_name}</Typography></TableCell>
                                        <TableCell align="right"><Typography variant="body2" fontWeight="600">₹{mp.doctor_price}</Typography></TableCell>
                                        <TableCell>
                                            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 200 }}>
                                                {mp.doctor_description || 'No custom description'}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Tooltip title={mp.approval_status === 'rejected' && mp.rejection_reason ? mp.rejection_reason : ''}>
                                                <Chip
                                                    label={(mp.approval_status || 'pending').toUpperCase()}
                                                    color={STATUS_COLOR[mp.approval_status] || 'default'}
                                                    size="small"
                                                />
                                            </Tooltip>
                                        </TableCell>
                                        <TableCell align="center">
                                            <IconButton size="small" onClick={() => openEdit(mp)}><EditIcon fontSize="small" /></IconButton>
                                            <IconButton size="small" color="error" onClick={() => handleDelete(mp.id)}><DeleteIcon fontSize="small" /></IconButton>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </TableContainer>
                    </Paper>
                </Grid>

                {/* Right: Available from Admin Catalog */}
                <Grid item xs={12} md={4}>
                    <Paper sx={{ p: 3, borderRadius: 2, bgcolor: '#f8f9fa' }}>
                        <Typography variant="h6" gutterBottom fontWeight="600">Available Catalog</Typography>
                        <Typography variant="body2" color="text.secondary" mb={2}>
                            Select items from the admin catalog to sell on your profile.
                        </Typography>
                        <Divider sx={{ mb: 2 }} />
                        <Stack spacing={2}>
                            {availableProducts.filter((ap) => ap.is_active && !ap.is_group_service).length === 0 && (
                                <Typography variant="body2" color="text.secondary">
                                    No services in the catalog yet.
                                </Typography>
                            )}
                            {availableProducts.filter((ap) => ap.is_active && !ap.is_group_service).map((ap) => {
                                const isSelected = myProducts.some((mp) => mp.product_id === ap.id);
                                // eligible is undefined on older payloads → treat as allowed.
                                const eligible = ap.eligible !== false;
                                return (
                                    <Card key={ap.id} sx={{ boxShadow: 'none', border: '1px solid #e0e0e0', opacity: (isSelected || !eligible) ? 0.7 : 1 }}>
                                        <CardContent sx={{ p: '16px !important' }}>
                                            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                                                <Box sx={{ pr: 1 }}>
                                                    <Typography variant="subtitle1" fontWeight="600">{ap.name}</Typography>
                                                    <Typography variant="caption" color="text.secondary" display="block">
                                                        Range: ₹{ap.min_price} - ₹{ap.max_price}
                                                    </Typography>
                                                    {!eligible && (
                                                        <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
                                                            {ap.ineligible_reason || 'You are not eligible to offer this service.'}
                                                        </Typography>
                                                    )}
                                                </Box>
                                                <Stack spacing={0.5} alignItems="flex-end">
                                                    {isSelected ? (
                                                        <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={() => openSelect(ap)}>Edit</Button>
                                                    ) : (
                                                        <Tooltip title={eligible ? '' : (ap.ineligible_reason || 'Not eligible')}>
                                                            <span>
                                                                <Button size="small" variant="contained" startIcon={<AddIcon />}
                                                                    disabled={!eligible} onClick={() => openSelect(ap)}>Add</Button>
                                                            </span>
                                                        </Tooltip>
                                                    )}
                                                    <Button size="small" onClick={() => setDetailsProduct(ap)}>Details</Button>
                                                </Stack>
                                            </Stack>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </Stack>
                    </Paper>
                </Grid>
            </Grid>

            {/* Selection/Edit Dialog */}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{editMode ? 'Update Product Details' : 'Add Product to Marketplace'}</DialogTitle>
                <DialogContent>
                    <Stack spacing={3} mt={1}>
                        <Box>
                            <Typography variant="subtitle2" color="primary">Base Product</Typography>
                            <Typography variant="h6">{selectedAdminProduct?.name}</Typography>
                            <Typography variant="body2" color="text.secondary">{selectedAdminProduct?.description}</Typography>
                        </Box>
                        <Divider />
                        <Box>
                            <Typography variant="subtitle2" gutterBottom>
                                Set Your Selling Price (Allowed: ₹{selectedAdminProduct?.min_price} - ₹{selectedAdminProduct?.max_price})
                            </Typography>
                            <TextField label="Selling Price (₹)" type="number" fullWidth value={form.price}
                                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                                inputProps={{ min: selectedAdminProduct?.min_price, max: selectedAdminProduct?.max_price }}
                                helperText={`Admin price range: ${selectedAdminProduct?.min_price} - ${selectedAdminProduct?.max_price}`} />
                        </Box>
                        <TextField label="Custom Description (Optional)" fullWidth multiline rows={3} value={form.description}
                            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                            placeholder="Add specifics about your service..." />

                        <Alert severity="info" variant="outlined">
                            Consultation limits, call durations and applicable taxes for this service are
                            set by the admin. You only choose your selling price and description.
                        </Alert>
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleSave}>{editMode ? 'Update' : 'Add to My Store'}</Button>
                </DialogActions>
            </Dialog>

            <ServiceDetailsDialog open={!!detailsProduct} product={detailsProduct} onClose={() => setDetailsProduct(null)} />

            <Snackbar open={snackbar.open} autoHideDuration={4000}
                onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>{snackbar.message}</Alert>
            </Snackbar>
        </>
    );
};

export default MyProductsPanel;
