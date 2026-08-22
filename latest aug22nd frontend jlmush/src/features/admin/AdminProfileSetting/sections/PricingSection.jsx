/**
 * Admin PricingSection — Placeholder only (no backend interaction).
 * Mirrors the doctor's Consultation Pricing tab structure.
 */
import { useEffect } from 'react';
import { Box, Paper, Typography, Grid, Chip, TextField, InputAdornment } from '@mui/material';
import CurrencyRupeeIcon from '@mui/icons-material/CurrencyRupee';
import ConstructionIcon from '@mui/icons-material/Construction';

const PRICING_SLOTS = [
    { label: '0–10 min', description: 'Quick consultation', price: '—' },
    { label: '10–20 min', description: 'Short consultation', price: '—' },
    { label: '20–30 min', description: 'Standard consultation', price: '—' },
    { label: '30–45 min', description: 'Extended consultation', price: '—' },
    { label: '45–60 min', description: 'Detailed consultation', price: '—' },
    { label: '60+ min', description: 'Comprehensive consultation', price: '—' },
];

const PricingSection = ({ previewMode = false, registerSave }) => {
    useEffect(() => {
        if (registerSave) {
            registerSave(null, 'Consultation Pricing', true);
        }
    }, [registerSave]);

    return (
        <Box>
            <Paper sx={{ p: 4, mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                    <CurrencyRupeeIcon color="primary" />
                    <Typography variant="h6" fontWeight={600}>Consultation Pricing</Typography>
                    <Chip label="Placeholder" size="small" color="warning" variant="outlined" sx={{ ml: 'auto' }} />
                </Box>

                <Grid container spacing={2}>
                    {PRICING_SLOTS.map((slot) => (
                        <Grid item xs={12} sm={6} md={4} key={slot.label}>
                            <Paper variant="outlined" sx={{ p: 2 }}>
                                <Typography variant="subtitle2" fontWeight={600} gutterBottom>{slot.label}</Typography>
                                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>{slot.description}</Typography>
                                <TextField
                                    size="small"
                                    fullWidth
                                    disabled
                                    placeholder="Price"
                                    value=""
                                    InputProps={{
                                        startAdornment: <InputAdornment position="start">₹</InputAdornment>,
                                    }}
                                />
                            </Paper>
                        </Grid>
                    ))}
                </Grid>
            </Paper>

            <Paper sx={{ p: 6, textAlign: 'center' }}>
                <ConstructionIcon sx={{ fontSize: 48, color: 'grey.400', mb: 2 }} />
                <Typography variant="body1" color="text.secondary">
                    This module is a placeholder. Backend endpoints and database interaction will be implemented when this feature is activated.
                </Typography>
            </Paper>
        </Box>
    );
};

export default PricingSection;
