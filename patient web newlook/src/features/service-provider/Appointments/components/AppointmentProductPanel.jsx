/**
 * AppointmentProductPanel — Inline panel for attaching / managing a marketplace
 * product on a single appointment (doctor side).
 *
 * Usage:  <AppointmentProductPanel appointmentId={appt.id} existingProduct={appt.appointment_product} />
 */
import React, { useState } from 'react';
import {
    Box, Typography, Button, MenuItem, Select, FormControl,
    InputLabel, TextField, Chip, Stack, Alert, CircularProgress,
} from '@mui/material';
import StorefrontIcon from '@mui/icons-material/Storefront';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import {
    useGetDoctorProductsQuery,
    useAttachAppointmentProductMutation,
    useUpdateAppointmentProductMutation,
    useCompleteAppointmentProductMutation,
} from '../../api/doctorEndpoints';

const AppointmentProductPanel = ({ appointmentId, existingProduct }) => {
    const { data: products = [], isLoading: productsLoading } = useGetDoctorProductsQuery();
    const [attachProduct] = useAttachAppointmentProductMutation();
    const [updateProduct] = useUpdateAppointmentProductMutation();
    const [completeProduct] = useCompleteAppointmentProductMutation();

    const [selectedProductId, setSelectedProductId] = useState('');
    const [doctorPrice, setDoctorPrice] = useState('');
    const [doctorDescription, setDoctorDescription] = useState('');
    const [feedback, setFeedback] = useState(null);
    const [editing, setEditing] = useState(false);

    // If product is already attached, show it
    if (existingProduct && !editing) {
        return (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1, border: '1px solid', borderColor: 'grey.200' }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <StorefrontIcon color="primary" fontSize="small" />
                    <Typography variant="subtitle2" fontWeight="bold">Attached Product</Typography>
                    {existingProduct.is_completed && (
                        <Chip label="Completed" color="success" size="small" icon={<CheckCircleIcon />} />
                    )}
                </Stack>
                <Typography variant="body2"><b>{existingProduct.product_name || 'Product'}</b></Typography>
                <Typography variant="body2">Price: ₹{existingProduct.doctor_price}</Typography>
                {existingProduct.doctor_description && (
                    <Typography variant="body2" color="text.secondary">{existingProduct.doctor_description}</Typography>
                )}
                {!existingProduct.is_completed && (
                    <Stack direction="row" spacing={1} mt={1}>
                        <Button size="small" variant="outlined" onClick={() => {
                            setDoctorPrice(existingProduct.doctor_price);
                            setDoctorDescription(existingProduct.doctor_description || '');
                            setEditing(true);
                        }}>Edit</Button>
                        <Button size="small" variant="contained" color="success" onClick={async () => {
                            try {
                                await completeProduct(appointmentId).unwrap();
                                setFeedback({ severity: 'success', message: 'Product marked complete' });
                            } catch (err) {
                                setFeedback({ severity: 'error', message: err?.data?.message || 'Failed' });
                            }
                        }}>Mark Complete</Button>
                    </Stack>
                )}
                {feedback && <Alert severity={feedback.severity} sx={{ mt: 1 }}>{feedback.message}</Alert>}
            </Box>
        );
    }

    // Edit mode or new attachment
    const handleSubmit = async () => {
        try {
            if (editing) {
                await updateProduct({
                    appointmentId,
                    doctor_price: parseFloat(doctorPrice),
                    doctor_description: doctorDescription,
                }).unwrap();
                setFeedback({ severity: 'success', message: 'Product updated' });
            } else {
                if (!selectedProductId) { setFeedback({ severity: 'warning', message: 'Select a product' }); return; }
                await attachProduct({
                    appointmentId,
                    product_id: selectedProductId,
                    doctor_price: parseFloat(doctorPrice),
                    doctor_description: doctorDescription,
                }).unwrap();
                setFeedback({ severity: 'success', message: 'Product attached' });
            }
            setEditing(false);
        } catch (err) {
            setFeedback({ severity: 'error', message: err?.data?.message || 'Failed' });
        }
    };

    if (productsLoading) return <CircularProgress size={18} sx={{ mt: 1 }} />;

    const selectedCatalogItem = products.find(p => p.id === selectedProductId);

    return (
        <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1, border: '1px dashed', borderColor: 'grey.300' }}>
            <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                <StorefrontIcon color="action" fontSize="small" />
                <Typography variant="subtitle2">{editing ? 'Edit Product' : 'Add Product / Service'}</Typography>
            </Stack>

            <Stack spacing={1.5}>
                {!editing && (
                    <FormControl size="small" fullWidth>
                        <InputLabel>Product</InputLabel>
                        <Select value={selectedProductId} label="Product" onChange={(e) => setSelectedProductId(e.target.value)}>
                            {products.map(p => (
                                <MenuItem key={p.id} value={p.id}>{p.name} (₹{p.min_price} – ₹{p.max_price})</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                )}

                {selectedCatalogItem && (
                    <Typography variant="caption" color="text.secondary">
                        Allowed range: ₹{selectedCatalogItem.min_price} – ₹{selectedCatalogItem.max_price}
                    </Typography>
                )}

                <Stack direction="row" spacing={1}>
                    <TextField size="small" label="Your Price (₹)" type="number" value={doctorPrice}
                        onChange={(e) => setDoctorPrice(e.target.value)} sx={{ flex: 1 }} />
                    <TextField size="small" label="Description (optional)" value={doctorDescription}
                        onChange={(e) => setDoctorDescription(e.target.value)} sx={{ flex: 2 }} />
                </Stack>

                <Stack direction="row" spacing={1}>
                    <Button size="small" variant="contained" onClick={handleSubmit}>
                        {editing ? 'Update' : 'Attach'}
                    </Button>
                    {editing && <Button size="small" onClick={() => setEditing(false)}>Cancel</Button>}
                </Stack>
            </Stack>

            {feedback && <Alert severity={feedback.severity} sx={{ mt: 1 }}>{feedback.message}</Alert>}
        </Box>
    );
};

export default AppointmentProductPanel;
