/**
 * MyMarketplace — Doctor's personal marketplace management.
 * Doctors select products from the admin-defined catalog and set their own prices.
 */
import React, { useState } from 'react';
import {
    Box, Typography, Button, Paper, Table, TableHead, TableRow, TableCell,
    TableBody, TableContainer, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Snackbar, Alert, Chip, CircularProgress, Stack, Grid,
    Card, CardContent, Divider, Tabs, Tab
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import StorefrontIcon from '@mui/icons-material/Storefront';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';

import {
    useGetDoctorMarketplaceProductsQuery,
    useSelectMarketplaceProductMutation,
    useUpdateMarketplaceProductMutation,
    useRemoveMarketplaceProductMutation,
} from '../../../../marketplace/api/marketplaceApi';
import { useGetAdminProductsQuery } from '../../../../admin/api/marketplaceEndpoints';
import MarketplaceOrders from '../MarketplaceOrders/MarketplaceOrders';

const WEEK = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];

/**
 * ServiceConstraints — the admin-configured limits on a catalog service that a
 * doctor should see before adding it: allowed modes (video / voice / chat) with
 * their min–max durations + consultation counts, working hours, and tax. Reads
 * the fields already returned by the admin DoctorProduct serializer.
 */
const ServiceConstraints = ({ product: p }) => {
    if (!p) return null;
    const rows = [];
    if (p.video_enabled) {
        rows.push(['Video', `${p.video_min_duration ?? '—'}–${p.video_max_duration ?? '—'} min`,
            `${p.video_min_consultations ?? '—'}–${p.video_max_consultations ?? '—'} consults`]);
    }
    if (p.voice_enabled) {
        rows.push(['Voice / Audio', `${p.voice_min_duration ?? '—'}–${p.voice_max_duration ?? '—'} min`,
            `${p.audio_min_consultations ?? '—'}–${p.audio_max_consultations ?? '—'} consults`]);
    }
    if (p.chat_enabled) rows.push(['Chat', '—', '—']);

    const wh = p.working_hours || {};
    const hasWH = wh && Object.keys(wh).length > 0;
    const taxLabel = p.tax_mode && p.tax_mode !== 'none'
        ? `${p.tax_mode.replace('_', '-')} · CGST ${p.cgst_rate || 0}% / SGST ${p.sgst_rate || 0}%`
        : 'No GST';

    return (
        <Box sx={{ bgcolor: '#f8f9fa', p: 1.5, borderRadius: 1 }}>
            <Typography variant="subtitle2" gutterBottom>Service details (set by admin)</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                <Chip size="small" label={`Consultations ${p.min_consultations ?? '—'}–${p.max_consultations ?? '—'}`} variant="outlined" />
                <Chip size="small" label={taxLabel} variant="outlined" />
            </Stack>
            {rows.length > 0 ? (
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell><b>Mode</b></TableCell><TableCell><b>Duration</b></TableCell><TableCell><b>Consultations</b></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map(([m, dur, cons]) => (
                            <TableRow key={m}><TableCell>{m}</TableCell><TableCell>{dur}</TableCell><TableCell>{cons}</TableCell></TableRow>
                        ))}
                    </TableBody>
                </Table>
            ) : (
                <Typography variant="caption" color="text.secondary">No consultation modes configured.</Typography>
            )}
            {hasWH && (
                <Box sx={{ mt: 1 }}>
                    <Typography variant="caption" fontWeight={600}>Working hours</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {WEEK.map(([k, lbl]) => {
                            const d = wh[k];
                            return `${lbl}: ${!d || d.closed ? 'Closed' : `${d.open || '—'}–${d.close || '—'}`}`;
                        }).join('  ·  ')}
                    </Typography>
                </Box>
            )}
        </Box>
    );
};

const MyMarketplace = () => {
    const [activeTab, setActiveTab] = useState(0);
    // Queries
    const { data: myProducts = [], isLoading: isMyLoading } = useGetDoctorMarketplaceProductsQuery();
    const { data: adminProducts = [], isLoading: isAdminLoading } = useGetAdminProductsQuery();
    
    // Mutations
    const [selectProduct] = useSelectMarketplaceProductMutation();
    const [updateProduct] = useUpdateMarketplaceProductMutation();
    const [removeProduct] = useRemoveMarketplaceProductMutation();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editMode, setEditMode] = useState(false); // true if editing existing selection, false if adding new
    const [selectedAdminProduct, setSelectedAdminProduct] = useState(null);
    const [mpId, setMpId] = useState(null); // marketplace product id for updates
    const [form, setForm] = useState({ price: '', description: '' });
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

    const openSelect = (p) => {
        const existing = myProducts.find(mp => mp.product_id === p.id);
        if (existing) {
            openEdit(existing);
            return;
        }
        setEditMode(false);
        setSelectedAdminProduct(p);
        setForm({ price: p.min_price, description: p.description || '' });
        setDialogOpen(true);
    };

    const openEdit = (mp) => {
        setEditMode(true);
        setMpId(mp.id);
        const adminP = adminProducts.find(ap => ap.id === mp.product_id);
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
                    severity: 'warning' 
                });
                return;
            }

            const payload = {
                doctor_price: priceNum,
                doctor_description: form.description.trim(),
            };

            if (editMode) {
                await updateProduct({ id: mpId, ...payload }).unwrap();
                setSnackbar({ open: true, message: 'Marketplace product updated', severity: 'success' });
            } else {
                await selectProduct({ product_id: selectedAdminProduct.id, ...payload }).unwrap();
                setSnackbar({ open: true, message: 'Product added to your marketplace', severity: 'success' });
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

    if (isMyLoading || isAdminLoading) {
        return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
    }

    return (
        <Box sx={{ p: 4 }}>
            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                <StorefrontIcon color="primary" sx={{ fontSize: 32 }} />
                <Typography variant="h4" fontWeight="bold">My Marketplace</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" mb={3}>
                Manage your selling catalog and fulfill patient orders.
            </Typography>

            {/* Tabs */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 4 }}>
                <Tabs value={activeTab} onChange={(e, val) => setActiveTab(val)}>
                    <Tab label="My Products" icon={<StorefrontIcon fontSize="small" />} iconPosition="start" />
                    <Tab label="Sales & Orders" icon={<ReceiptLongIcon fontSize="small" />} iconPosition="start" />
                </Tabs>
            </Box>

            {activeTab === 0 ? (
                <Grid container spacing={4}>
                {/* Left: Current Active Products */}
                <Grid item xs={12} md={8}>
                    <Paper sx={{ p: 3, borderRadius: 2 }}>
                        <Typography variant="h6" gutterBottom fontWeight="600">
                            Selling Products
                        </Typography>
                        <Divider sx={{ mb: 2 }} />

                        <TableContainer>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell><b>Product</b></TableCell>
                                    <TableCell align="right"><b>My Price (₹)</b></TableCell>
                                    <TableCell><b>My Description</b></TableCell>
                                    <TableCell align="center"><b>Actions</b></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {myProducts.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={4} align="center">
                                            <Typography color="text.secondary" py={2}>
                                                You haven't selected any products to sell yet.
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                                {myProducts.map((mp) => (
                                    <TableRow key={mp.id}>
                                        <TableCell>
                                            <Typography variant="subtitle2">{mp.product_name}</Typography>
                                        </TableCell>
                                        <TableCell align="right">
                                            <Typography variant="body2" fontWeight="600">₹{mp.doctor_price}</Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 200, noWrap: true }}>
                                                {mp.doctor_description || 'No custom description'}
                                            </Typography>
                                        </TableCell>
                                        <TableCell align="center">
                                            <IconButton size="small" onClick={() => openEdit(mp)}>
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                            <IconButton size="small" color="error" onClick={() => handleDelete(mp.id)}>
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
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
                        <Typography variant="h6" gutterBottom fontWeight="600">
                            Available Catalog
                        </Typography>
                        <Typography variant="body2" color="text.secondary" mb={2}>
                            Select items from the admin catalog to sell on your profile.
                        </Typography>
                        <Divider sx={{ mb: 2 }} />

                        <Stack spacing={2}>
                            {adminProducts.filter(ap => ap.is_active).map(ap => {
                                const isSelected = myProducts.some(mp => mp.product_id === ap.id);
                                return (
                                    <Card key={ap.id} sx={{ boxShadow: 'none', border: '1px solid #e0e0e0', opacity: isSelected ? 0.7 : 1 }}>
                                        <CardContent sx={{ p: '16px !important' }}>
                                            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                                                <Box>
                                                    <Typography variant="subtitle1" fontWeight="600">{ap.name}</Typography>
                                                    <Typography variant="caption" color="text.secondary" display="block">
                                                        Range: ₹{ap.min_price} - ₹{ap.max_price}
                                                    </Typography>
                                                </Box>
                                                <Button 
                                                    size="small" 
                                                    variant={isSelected ? "outlined" : "contained"}
                                                    startIcon={isSelected ? <EditIcon /> : <AddIcon />}
                                                    onClick={() => openSelect(ap)}
                                                >
                                                    {isSelected ? 'Edit' : 'Add'}
                                                </Button>
                                            </Stack>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </Stack>
                    </Paper>
                </Grid>
            </Grid>
            ) : (
                <MarketplaceOrders />
            )}

            {/* Selection/Edit Dialog */}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>
                    {editMode ? 'Update Product Details' : 'Add Product to Marketplace'}
                </DialogTitle>
                <DialogContent>
                    <Stack spacing={3} mt={1}>
                        <Box>
                            <Typography variant="subtitle2" color="primary">Base Product</Typography>
                            <Typography variant="h6">{selectedAdminProduct?.name}</Typography>
                            <Typography variant="body2" color="text.secondary">
                                {selectedAdminProduct?.description}
                            </Typography>
                        </Box>

                        {selectedAdminProduct && <ServiceConstraints product={selectedAdminProduct} />}

                        <Divider />

                        <Box>
                            <Typography variant="subtitle2" gutterBottom>
                                Set Your Selling Price (Allowed: ₹{selectedAdminProduct?.min_price} - ₹{selectedAdminProduct?.max_price})
                            </Typography>
                            <TextField
                                label="Selling Price (₹)"
                                type="number"
                                fullWidth
                                value={form.price}
                                onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))}
                                inputProps={{ min: selectedAdminProduct?.min_price, max: selectedAdminProduct?.max_price }}
                                helperText={`Admin price range: ${selectedAdminProduct?.min_price} - ${selectedAdminProduct?.max_price}`}
                            />
                        </Box>

                        <TextField
                            label="Custom Description (Optional)"
                            fullWidth
                            multiline
                            rows={3}
                            value={form.description}
                            onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                            placeholder="Add specifics about your service..."
                        />
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleSave}>
                        {editMode ? 'Update' : 'Add to My Store'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar 
                open={snackbar.open} 
                autoHideDuration={4000} 
                onClose={() => setSnackbar(s => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default MyMarketplace;
