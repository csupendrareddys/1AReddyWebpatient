import React from 'react';
import {
    Box, Container, Typography, Paper, Grid, Card, CardActionArea,
    CardContent, CircularProgress, Chip,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';

import { useGetSlotAvailabilitySummaryQuery } from '../../api/scopedBookingApi';
import { CONSULTATION_TYPES } from '../../../service-provider/ProfileSetting/constants/consultationTypes';
import useBookingFlow from '../../hooks/useBookingFlow';
import { usePatientScope } from '../../ProfileSetting/context/PatientScopeContext';

// Only show these types in the landing page (no camp, no marketplace)
const BOOKING_TYPES = CONSULTATION_TYPES.filter(
    (ct) => ['audio', 'video', 'chat', 'complete', 'home_visit'].includes(ct.value)
);

const STATUS_COLORS = {
    red: '#f44336',
    orange: '#e65100',
    green: '#4caf50',
};

const STATUS_LABELS = {
    red: 'No Slots',
    orange: 'Limited Slots',
    green: 'Available',
};

const ConsultationTypeLanding = () => {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const { handleSelectConsultationType } = useBookingFlow();
    const { data: availability, isLoading } = useGetSlotAvailabilitySummaryQuery();

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 10 }}>
            <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="h5" fontWeight="bold" mb={1}>
                    Book a Consultation
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    Choose the type of consultation you'd like to book
                </Typography>
            </Paper>

            {isLoading ? (
                <Box display="flex" justifyContent="center" mt={4}>
                    <CircularProgress />
                </Box>
            ) : (
                <Grid container spacing={2}>
                    {BOOKING_TYPES.map((ct) => {
                        const slotInfo = availability?.[ct.value] || { count: 0, status: 'red' };
                        const isDisabled = slotInfo.status === 'red';
                        const statusColor = STATUS_COLORS[slotInfo.status] || STATUS_COLORS.red;

                        return (
                            <Grid item xs={12} sm={6} key={ct.value}>
                                <Card
                                    variant="outlined"
                                    sx={{
                                        borderColor: isDisabled ? '#e0e0e0' : ct.color,
                                        borderWidth: 2,
                                        opacity: isDisabled ? 0.5 : 1,
                                        transition: 'all 0.2s',
                                        position: 'relative',
                                        ...(!isDisabled && {
                                            '&:hover': {
                                                boxShadow: `0 4px 20px ${ct.color}40`,
                                                transform: 'translateY(-2px)',
                                            },
                                        }),
                                    }}
                                >
                                    {/* Slot availability indicator */}
                                    <Box
                                        sx={{
                                            position: 'absolute',
                                            top: 8,
                                            right: 8,
                                            zIndex: 1,
                                        }}
                                    >
                                        <Chip
                                            icon={<FiberManualRecordIcon sx={{ fontSize: 10, color: `${statusColor} !important` }} />}
                                            label={`${slotInfo.count} slots`}
                                            size="small"
                                            sx={{
                                                bgcolor: `${statusColor}15`,
                                                color: statusColor,
                                                fontWeight: 600,
                                                fontSize: '0.7rem',
                                            }}
                                        />
                                    </Box>

                                    <CardActionArea
                                        disabled={isDisabled}
                                        onClick={() => handleSelectConsultationType(ct.value)}
                                        sx={{ p: 1 }}
                                    >
                                        <CardContent>
                                            <Box display="flex" alignItems="center" justifyContent="space-between">
                                                <Box display="flex" alignItems="center" gap={2}>
                                                    <Box
                                                        sx={{
                                                            width: 48,
                                                            height: 48,
                                                            borderRadius: '50%',
                                                            bgcolor: isDisabled ? '#f5f5f5' : `${ct.color}20`,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            fontSize: '1.5rem',
                                                        }}
                                                    >
                                                        {ct.icon}
                                                    </Box>
                                                    <Box>
                                                        <Typography variant="subtitle1" fontWeight="bold">
                                                            {ct.label}
                                                        </Typography>
                                                        <Typography variant="body2" color="text.secondary" sx={{ pr: 6 }}>
                                                            {ct.description}
                                                        </Typography>
                                                    </Box>
                                                </Box>
                                                {!isDisabled && (
                                                    <ArrowForwardIosIcon sx={{ color: ct.color, fontSize: 18 }} />
                                                )}
                                            </Box>
                                        </CardContent>
                                    </CardActionArea>
                                </Card>
                            </Grid>
                        );
                    })}

                    {/* Choose a Doctor card */}
                    <Grid item xs={12} sm={6}>
                        <Card
                            variant="outlined"
                            sx={{
                                borderColor: '#1976d2',
                                borderWidth: 2,
                                transition: 'all 0.2s',
                                '&:hover': {
                                    boxShadow: '0 4px 20px #1976d240',
                                    transform: 'translateY(-2px)',
                                },
                            }}
                        >
                            <CardActionArea
                                onClick={() => navigate(`${basePath}/find-doctors`)}
                                sx={{ p: 1 }}
                            >
                                <CardContent>
                                    <Box display="flex" alignItems="center" justifyContent="space-between">
                                        <Box display="flex" alignItems="center" gap={2}>
                                            <Box
                                                sx={{
                                                    width: 48,
                                                    height: 48,
                                                    borderRadius: '50%',
                                                    bgcolor: '#1976d220',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                }}
                                            >
                                                <PersonSearchIcon sx={{ color: '#1976d2', fontSize: 28 }} />
                                            </Box>
                                            <Box>
                                                <Typography variant="subtitle1" fontWeight="bold">
                                                    Choose a Doctor
                                                </Typography>
                                                <Typography variant="body2" color="text.secondary">
                                                    Browse and select a specific doctor
                                                </Typography>
                                            </Box>
                                        </Box>
                                        <ArrowForwardIosIcon sx={{ color: '#1976d2', fontSize: 18 }} />
                                    </Box>
                                </CardContent>
                            </CardActionArea>
                        </Card>
                    </Grid>
                </Grid>
            )}
        </Container>
    );
};

export default ConsultationTypeLanding;
