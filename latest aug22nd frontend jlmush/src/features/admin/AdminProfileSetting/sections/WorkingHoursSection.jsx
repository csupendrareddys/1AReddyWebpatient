/**
 * Admin WorkingHoursSection — Placeholder only (no backend interaction).
 * Mirrors the doctor's Working Hours tab structure.
 */
import { useEffect } from 'react';
import { Box, Paper, Typography, Grid, Chip, Switch, FormControlLabel } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ConstructionIcon from '@mui/icons-material/Construction';

const CONSULTATION_TYPES = [
    { key: 'video', label: 'Video Consultation', color: '#1976d2' },
    { key: 'audio', label: 'Audio Consultation', color: '#388e3c' },
    { key: 'chat', label: 'Chat Consultation', color: '#f57c00' },
    { key: 'text', label: 'Text Consultation', color: '#7b1fa2' },
];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const WorkingHoursSection = ({ previewMode = false, registerSave }) => {
    useEffect(() => {
        if (registerSave) {
            registerSave(null, 'Working Hours', true);
        }
    }, [registerSave]);

    return (
        <Box>
            <Paper sx={{ p: 4, mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                    <AccessTimeIcon color="primary" />
                    <Typography variant="h6" fontWeight={600}>Working Hours Configuration</Typography>
                    <Chip label="Placeholder" size="small" color="warning" variant="outlined" sx={{ ml: 'auto' }} />
                </Box>

                {/* Consultation type tabs placeholder */}
                <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
                    {CONSULTATION_TYPES.map((ct, idx) => (
                        <Chip
                            key={ct.key}
                            label={ct.label}
                            variant={idx === 0 ? 'filled' : 'outlined'}
                            sx={{ bgcolor: idx === 0 ? ct.color : undefined, color: idx === 0 ? '#fff' : undefined }}
                        />
                    ))}
                </Box>

                {/* Weekly schedule placeholder */}
                <Grid container spacing={1}>
                    {DAYS.map((day) => (
                        <Grid item xs={12} key={day}>
                            <Paper variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 200 }}>
                                    <FormControlLabel
                                        control={<Switch checked={day !== 'Sunday'} disabled />}
                                        label={<Typography variant="body2" fontWeight={500}>{day}</Typography>}
                                    />
                                </Box>
                                <Typography variant="body2" color="text.secondary">
                                    {day !== 'Sunday' ? '09:00 AM — 05:00 PM' : 'Off'}
                                </Typography>
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

export default WorkingHoursSection;
