import React, { useState, useMemo } from 'react';
import {
    Box, Container, Typography, Paper, CircularProgress, Grid,
    Card, CardActionArea, CardContent, IconButton, Button, TextField,
    Chip, Divider, Tabs, Tab,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';

import { useGetSymptomsQuery, useUpdateAppointmentContextMutation } from '../../api/scopedBookingApi';
import useBookingFlow from '../../hooks/useBookingFlow';
import usePageConfig from '../../../auth/hooks/usePageConfig';

const SymptomsSelectionPage = () => {
    const {
        consultationType,
        medicalContextId,
        handleCompleteSymptoms,
        handleGoBack,
    } = useBookingFlow();

    const { data: symptomsResp, isLoading: isLoadingSymptoms } = useGetSymptomsQuery();
    const [updateContext, { isLoading: isSaving }] = useUpdateAppointmentContextMutation();
    const { config: symptomsConfig } = usePageConfig('patient_appointment_symptoms');

    const symptoms = symptomsResp?.data?.symptoms || symptomsResp?.symptoms || symptomsResp || [];

    // Group symptoms by category
    const groupedSymptoms = useMemo(() => {
        const groups = {};
        (Array.isArray(symptoms) ? symptoms : []).forEach((s) => {
            const cat = s.category || 'General';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(s);
        });
        return groups;
    }, [symptoms]);

    const categories = Object.keys(groupedSymptoms);
    const [activeTab, setActiveTab] = useState(0);
    const [selectedSymptoms, setSelectedSymptoms] = useState([]);
    const [customSymptoms, setCustomSymptoms] = useState('');

    const toggleSymptom = (symptom) => {
        setSelectedSymptoms((prev) => {
            const exists = prev.find((s) => s.id === symptom.id);
            if (exists) {
                return prev.filter((s) => s.id !== symptom.id);
            }
            return [...prev, {
                id: symptom.id,
                name: symptom.name,
                category: symptom.category,
                severity: 'moderate',
            }];
        });
    };

    const isSelected = (symptomId) => selectedSymptoms.some((s) => s.id === symptomId);

    const handleContinue = async () => {
        const customList = customSymptoms
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

        // Save to backend context
        if (medicalContextId) {
            try {
                await updateContext({
                    contextId: medicalContextId,
                    selected_symptoms: selectedSymptoms.map((s) => ({
                        symptom_id: s.id,
                        severity: s.severity,
                        notes: '',
                    })),
                    selected_custom_symptoms: customList,
                }).unwrap();
            } catch (err) {
                console.error('Failed to save symptoms:', err);
            }
        }

        handleCompleteSymptoms(selectedSymptoms, customList);
    };

    if (isLoadingSymptoms) {
        return (
            <Box display="flex" justifyContent="center" mt={8}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 10 }}>
            {/* Header */}
            <Paper sx={{ p: 3, mb: 3 }}>
                <Box display="flex" alignItems="center" gap={2}>
                    <IconButton onClick={() => handleGoBack(4)}>
                        <ArrowBackIcon />
                    </IconButton>
                    <Box>
                        <Typography variant="h5" fontWeight="bold">
                            Select Symptoms
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Help the doctor understand your concerns
                        </Typography>
                    </Box>
                </Box>
            </Paper>

            {/* Selected Symptoms Summary */}
            {selectedSymptoms.length > 0 && (
                <Paper sx={{ p: 2, mb: 2 }}>
                    <Typography variant="subtitle2" fontWeight="bold" mb={1}>
                        Selected ({selectedSymptoms.length})
                    </Typography>
                    <Box display="flex" gap={0.5} flexWrap="wrap">
                        {selectedSymptoms.map((s) => (
                            <Chip
                                key={s.id}
                                label={s.name}
                                size="small"
                                color="primary"
                                variant="outlined"
                                onDelete={() => toggleSymptom(s)}
                            />
                        ))}
                    </Box>
                </Paper>
            )}

            {/* Category Tabs */}
            {categories.length > 0 && (
                <Paper sx={{ mb: 2 }}>
                    <Tabs
                        value={activeTab}
                        onChange={(_, v) => setActiveTab(v)}
                        variant="scrollable"
                        scrollButtons="auto"
                    >
                        {categories.map((cat, i) => (
                            <Tab key={cat} label={cat} />
                        ))}
                    </Tabs>
                </Paper>
            )}

            {/* Symptoms Grid */}
            {categories.length > 0 ? (
                <Grid container spacing={1.5}>
                    {(groupedSymptoms[categories[activeTab]] || []).map((symptom) => {
                        const selected = isSelected(symptom.id);
                        return (
                            <Grid item xs={6} sm={4} md={3} key={symptom.id}>
                                <Card
                                    variant="outlined"
                                    sx={{
                                        borderColor: selected ? 'primary.main' : 'divider',
                                        borderWidth: selected ? 2 : 1,
                                        bgcolor: selected ? 'primary.50' : 'transparent',
                                    }}
                                >
                                    <CardActionArea
                                        onClick={() => toggleSymptom(symptom)}
                                        sx={{ p: 1 }}
                                    >
                                        <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                                            <Box display="flex" flexDirection="column" alignItems="center" textAlign="center">
                                                {symptom.image_url && (
                                                    <Box
                                                        component="img"
                                                        src={symptom.image_url}
                                                        alt={symptom.name}
                                                        sx={{
                                                            width: 48,
                                                            height: 48,
                                                            borderRadius: 2,
                                                            objectFit: 'cover',
                                                            mb: 0.5,
                                                        }}
                                                    />
                                                )}
                                                <Typography variant="caption" fontWeight={selected ? 'bold' : 'normal'}>
                                                    {symptom.name}
                                                </Typography>
                                                {selected ? (
                                                    <CheckCircleIcon sx={{ fontSize: 16, color: 'primary.main', mt: 0.25 }} />
                                                ) : (
                                                    <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: 'action.disabled', mt: 0.25 }} />
                                                )}
                                            </Box>
                                        </CardContent>
                                    </CardActionArea>
                                </Card>
                            </Grid>
                        );
                    })}
                </Grid>
            ) : (
                <Paper sx={{ p: 3, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                        No symptom categories configured. You can describe your symptoms below.
                    </Typography>
                </Paper>
            )}

            {/* Custom Symptoms */}
            <Paper sx={{ p: 2, mt: 3 }}>
                <Typography variant="subtitle2" fontWeight="bold" mb={1}>
                    Other Symptoms
                </Typography>
                <TextField
                    fullWidth
                    multiline
                    rows={2}
                    placeholder="Describe any other symptoms (separate with commas)..."
                    value={customSymptoms}
                    onChange={(e) => setCustomSymptoms(e.target.value)}
                    variant="outlined"
                    size="small"
                />
            </Paper>

            {/* Continue */}
            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
                <Button
                    variant="text"
                    onClick={() => handleCompleteSymptoms([], [])}
                >
                    Skip
                </Button>
                <Button
                    variant="contained"
                    size="large"
                    onClick={handleContinue}
                    disabled={isSaving}
                >
                    {isSaving ? 'Saving...' : 'Continue to Find Doctors'}
                </Button>
            </Box>
        </Container>
    );
};

export default SymptomsSelectionPage;
