/**
 * Admin AvailabilitySection — Placeholder only (no backend interaction).
 * Mirrors the doctor's Availability / Schedule tab structure.
 */
import { useEffect } from 'react';
import { Box, Paper, Typography, Grid, Chip } from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ConstructionIcon from '@mui/icons-material/Construction';

const PLACEHOLDER_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const AvailabilitySection = ({ previewMode = false, registerSave }) => {
    useEffect(() => {
        if (registerSave) {
            registerSave(null, 'Availability / Schedule', true);
        }
    }, [registerSave]);

    return (
        <Box>
            <Paper sx={{ p: 4, mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                    <CalendarMonthIcon color="primary" />
                    <Typography variant="h6" fontWeight={600}>Availability Calendar</Typography>
                    <Chip label="Placeholder" size="small" color="warning" variant="outlined" sx={{ ml: 'auto' }} />
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Calendar-based slot availability management. Sub-admins will be able to configure their available time slots here.
                </Typography>

                {/* Placeholder weekly schedule grid */}
                <Grid container spacing={2}>
                    {PLACEHOLDER_DAYS.map((day) => (
                        <Grid item xs={12} sm={6} md={4} key={day}>
                            <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50' }}>
                                <Typography variant="subtitle2" fontWeight={600} gutterBottom>{day}</Typography>
                                <Typography variant="body2" color="text.secondary">09:00 AM — 05:00 PM</Typography>
                                <Chip label="Available" size="small" color="success" variant="outlined" sx={{ mt: 1 }} />
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

export default AvailabilitySection;
