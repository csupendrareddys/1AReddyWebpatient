import React, { useEffect } from 'react';
import {
    Box, Container, Typography, Paper, Avatar, Grid,
    CircularProgress, Card, CardActionArea, CardContent, Alert,
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import PersonIcon from '@mui/icons-material/Person';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';

import {
    useGetDoctorDetailQuery,
    useGetDoctorAvailableConsultationTypesQuery,
} from '../../api/scopedBookingApi';
import {
    CONSULTATION_TYPES,
} from '../../../service-provider/ProfileSetting/constants/consultationTypes';
import { usePatientScope } from '../../ProfileSetting/context/PatientScopeContext';

const ChooseConsultationType = () => {
    const { doctorId } = useParams();
    const navigate = useNavigate();
    const { basePath } = usePatientScope();

    const { data: doctor, isLoading: doctorLoading } = useGetDoctorDetailQuery(doctorId, { skip: !doctorId });
    const { data: availability, isLoading: availabilityLoading } =
        useGetDoctorAvailableConsultationTypesQuery(doctorId, { skip: !doctorId });

    const isLoading = doctorLoading || availabilityLoading;

    const doctorData = doctor?.data || doctor || {};
    const doctorName = doctorData?.full_name || `${doctorData?.first_name || ''} ${doctorData?.last_name || ''}`.trim();

    // Only surface types the doctor actually offers right now: schedulable
    // types with real slots, plus Marketplace when an admin has activated it.
    const availableTypes = availability?.types || [];
    const availableCards = CONSULTATION_TYPES.filter((ct) => availableTypes.includes(ct.value));

    // Marketplace is status-only (no calendar) — it points at the doctor's
    // products page; every other card opens the slot calendar for its type.
    const selectType = (ct) => {
        if (ct.value === 'marketplace') {
            navigate(`${basePath}/marketplace?doctor=${encodeURIComponent(doctorName)}`);
        } else {
            navigate(`${basePath}/book/${doctorId}/${ct.value}`);
        }
    };

    // If the only thing on offer is a single *bookable* type, skip this
    // screen and drop the patient straight onto its calendar. Marketplace
    // never triggers this — it has no calendar. ``replace`` keeps the empty
    // selection page out of history so back lands on the doctor list.
    const onlySchedulableCard =
        availableCards.length === 1 && availableCards[0].schedulable !== false;
    useEffect(() => {
        if (isLoading) return;
        if (onlySchedulableCard) {
            navigate(`${basePath}/book/${doctorId}/${availableCards[0].value}`, { replace: true });
        }
    }, [isLoading, onlySchedulableCard, availableCards, doctorId, navigate]);

    // Spinner while loading, and while the single-type redirect is in flight
    // so the full card grid never flashes.
    if (isLoading || onlySchedulableCard) {
        return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
    }

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 10 }}>
            {/* Doctor Info */}
            <Paper sx={{ p: 3, mb: 3, display: 'flex', gap: 2, alignItems: 'center' }}>
                <Avatar src={doctorData?.profile_image} sx={{ width: 72, height: 72, bgcolor: 'primary.main' }}>
                    <PersonIcon />
                </Avatar>
                <Box>
                    <Typography variant="h5" fontWeight="bold">Book Appointment</Typography>
                    <Typography variant="h6" color="primary">Dr. {doctorName}</Typography>
                    {doctorData?.specializations?.length > 0 && (
                        <Typography variant="body2" color="textSecondary">
                            {doctorData.specializations.join(', ')}
                        </Typography>
                    )}
                </Box>
            </Paper>

            {/* Consultation Type Selection */}
            <Paper sx={{ p: 3 }}>
                <Typography variant="h6" fontWeight="bold" mb={3}>
                    Choose Consultation Type
                </Typography>

                {availableCards.length === 0 ? (
                    <Alert severity="info">
                        This doctor has no consultation slots available right now.
                        Please check back later.
                    </Alert>
                ) : (
                    <Grid container spacing={2}>
                        {availableCards.map((ct) => (
                            <Grid item xs={12} sm={6} key={ct.value} sx={{ display: 'flex' }}>
                                <Card
                                    variant="outlined"
                                    sx={{
                                        width: '100%',
                                        borderColor: ct.color,
                                        borderWidth: 2,
                                        transition: 'all 0.2s',
                                        '&:hover': {
                                            boxShadow: `0 4px 20px ${ct.color}40`,
                                            transform: 'translateY(-2px)',
                                        },
                                    }}
                                >
                                    <CardActionArea
                                        onClick={() => selectType(ct)}
                                        sx={{ height: '100%', p: 1 }}
                                    >
                                        <CardContent sx={{ height: '100%' }}>
                                            <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} sx={{ height: '100%' }}>
                                                <Box display="flex" alignItems="center" gap={2} sx={{ minWidth: 0 }}>
                                                    <Box
                                                        sx={{
                                                            flexShrink: 0,
                                                            width: 48,
                                                            height: 48,
                                                            borderRadius: '50%',
                                                            bgcolor: `${ct.color}20`,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            fontSize: '1.5rem',
                                                        }}
                                                    >
                                                        {ct.icon}
                                                    </Box>
                                                    <Box sx={{ minWidth: 0 }}>
                                                        <Typography variant="subtitle1" fontWeight="bold">
                                                            {ct.label}
                                                        </Typography>
                                                        <Typography variant="body2" color="text.secondary">
                                                            {ct.description}
                                                        </Typography>
                                                    </Box>
                                                </Box>
                                                <ArrowForwardIosIcon sx={{ color: ct.color, fontSize: 18, flexShrink: 0 }} />
                                            </Box>
                                        </CardContent>
                                    </CardActionArea>
                                </Card>
                            </Grid>
                        ))}
                    </Grid>
                )}
            </Paper>
        </Container>
    );
};

export default ChooseConsultationType;
