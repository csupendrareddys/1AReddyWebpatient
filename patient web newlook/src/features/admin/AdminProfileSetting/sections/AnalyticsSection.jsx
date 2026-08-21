/**
 * Admin AnalyticsSection — Placeholder only (no backend interaction).
 * Mirrors the doctor's Analytics tab structure.
 */
import { useEffect } from 'react';
import { Box, Paper, Typography, Grid, Chip } from '@mui/material';
import BarChartIcon from '@mui/icons-material/BarChart';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import PeopleIcon from '@mui/icons-material/People';
import StarIcon from '@mui/icons-material/Star';
import ConstructionIcon from '@mui/icons-material/Construction';

const METRIC_CARDS = [
    { label: 'Total Appointments', value: '—', icon: <BarChartIcon />, color: '#1976d2' },
    { label: 'Revenue This Month', value: '—', icon: <TrendingUpIcon />, color: '#388e3c' },
    { label: 'Active Patients', value: '—', icon: <PeopleIcon />, color: '#f57c00' },
    { label: 'Average Rating', value: '—', icon: <StarIcon />, color: '#7b1fa2' },
];

const AnalyticsSection = ({ previewMode = false, registerSave }) => {
    useEffect(() => {
        if (registerSave) {
            registerSave(null, 'Analytics', true);
        }
    }, [registerSave]);

    return (
        <Box>
            <Paper sx={{ p: 4, mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                    <BarChartIcon color="primary" />
                    <Typography variant="h6" fontWeight={600}>Analytics Overview</Typography>
                    <Chip label="Placeholder" size="small" color="warning" variant="outlined" sx={{ ml: 'auto' }} />
                </Box>

                <Grid container spacing={3}>
                    {METRIC_CARDS.map((card) => (
                        <Grid item xs={12} sm={6} md={3} key={card.label}>
                            <Paper
                                variant="outlined"
                                sx={{ p: 3, textAlign: 'center', borderLeft: `4px solid ${card.color}` }}
                            >
                                <Box sx={{ color: card.color, mb: 1 }}>{card.icon}</Box>
                                <Typography variant="h4" fontWeight={700} color="text.secondary">{card.value}</Typography>
                                <Typography variant="body2" color="text.secondary">{card.label}</Typography>
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

export default AnalyticsSection;
