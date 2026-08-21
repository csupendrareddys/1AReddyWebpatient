
import React from 'react';
import {
    Box, Typography, Checkbox, FormControlLabel, TextField,
    Alert, Chip, CircularProgress, Paper, Divider
} from '@mui/material';
import { useGetAdminProductsQuery } from '../../../admin/api/marketplaceEndpoints';

/**
 * ProductPricingSlots
 *
 * Shows admin-defined products as selectable rows.
 * Doctor ticks the ones they offer and sets:
 *   - price (must be within admin min_price–max_price range)
 *   - description/label
 *
 * Props:
 *   selectedProducts : [{ product_id, price, description }]
 *   onChange(newArray): update selections
 */
const ProductPricingSlots = ({ selectedProducts = [], onChange }) => {
    const { data: products = [], isLoading, isError } = useGetAdminProductsQuery();

    const getSelection = (productId) =>
        selectedProducts.find((s) => s.product_id === productId);

    const isSelected = (productId) => !!getSelection(productId);

    const handleToggle = (product) => {
        if (isSelected(product.id)) {
            // Deselect
            onChange(selectedProducts.filter((s) => s.product_id !== product.id));
        } else {
            // Select with default price = min_price
            onChange([
                ...selectedProducts,
                {
                    product_id: product.id,
                    name: product.name,
                    price: product.min_price ?? '',
                    description: product.description ?? '',
                },
            ]);
        }
    };

    const handleFieldChange = (productId, field, value) => {
        onChange(
            selectedProducts.map((s) =>
                s.product_id === productId ? { ...s, [field]: value } : s
            )
        );
    };

    const getPriceError = (product) => {
        const sel = getSelection(product.id);
        if (!sel) return null;
        const price = Number(sel.price);
        if (!sel.price && sel.price !== 0) return null; // empty, let HTML required handle it
        if (price < product.min_price)
            return `Min allowed: ₹${product.min_price}`;
        if (price > product.max_price)
            return `Max allowed: ₹${product.max_price}`;
        return null;
    };

    if (isLoading) {
        return (
            <Box display="flex" alignItems="center" gap={2} py={2}>
                <CircularProgress size={20} />
                <Typography variant="body2">Loading available services…</Typography>
            </Box>
        );
    }

    if (isError) {
        return (
            <Alert severity="warning">
                Could not load service catalog. Please refresh to try again.
            </Alert>
        );
    }

    if (products.length === 0) {
        return (
            <Alert severity="info">
                No services have been defined by the admin yet. Check back later.
            </Alert>
        );
    }

    return (
        <Box>
            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Services Offered
            </Typography>
            <Typography variant="body2" color="textSecondary" mb={2}>
                Select the services you offer and set your price within the allowed range. These are defined by your admin.
            </Typography>

            <Box display="flex" flexDirection="column" gap={1.5}>
                {products.map((product) => {
                    const checked = isSelected(product.id);
                    const sel = getSelection(product.id);
                    const priceError = checked ? getPriceError(product) : null;

                    return (
                        <Paper
                            key={product.id}
                            variant="outlined"
                            sx={{
                                p: 2,
                                borderColor: checked ? 'primary.main' : undefined,
                                bgcolor: checked ? 'primary.50' : 'background.paper',
                                transition: 'border-color 0.2s',
                            }}
                        >
                            {/* Product header row */}
                            <Box display="flex" alignItems="flex-start" justifyContent="space-between">
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={checked}
                                            onChange={() => handleToggle(product)}
                                            color="primary"
                                        />
                                    }
                                    label={
                                        <Box>
                                            <Typography fontWeight={checked ? 'bold' : 'normal'}>
                                                {product.name}
                                            </Typography>
                                            {product.description && (
                                                <Typography variant="caption" color="text.secondary">
                                                    {product.description}
                                                </Typography>
                                            )}
                                        </Box>
                                    }
                                />
                                <Chip
                                    label={`₹${product.min_price} – ₹${product.max_price}`}
                                    size="small"
                                    color="default"
                                    variant="outlined"
                                    sx={{ mt: 0.5 }}
                                />
                            </Box>

                            {/* Expanded fields when selected */}
                            {checked && (
                                <>
                                    <Divider sx={{ my: 1.5 }} />
                                    <Box display="flex" gap={2} flexWrap="wrap">
                                        <TextField
                                            label={`Your Price (₹${product.min_price}–₹${product.max_price})`}
                                            type="number"
                                            size="small"
                                            value={sel?.price ?? ''}
                                            onChange={(e) =>
                                                handleFieldChange(product.id, 'price', e.target.value)
                                            }
                                            inputProps={{ min: product.min_price, max: product.max_price, step: 1 }}
                                            error={!!priceError}
                                            helperText={priceError}
                                            required
                                            sx={{ width: 220 }}
                                        />
                                        <TextField
                                            label="Label / Description (optional)"
                                            size="small"
                                            value={sel?.description ?? ''}
                                            onChange={(e) =>
                                                handleFieldChange(product.id, 'description', e.target.value)
                                            }
                                            sx={{ flex: 1, minWidth: 180 }}
                                        />
                                    </Box>
                                </>
                            )}
                        </Paper>
                    );
                })}
            </Box>
        </Box>
    );
};

export default ProductPricingSlots;
