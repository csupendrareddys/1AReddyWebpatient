import React, { useState, useEffect, useMemo } from 'react';
import {
    Box, Typography, Paper, Chip, CircularProgress, Alert,
    Tabs, Tab, Grid, Card, CardActionArea, CardContent,
    Snackbar, Button,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';

import {
    useGetDoctorSymptomsQuery,
    useGetAvailableSymptomsQuery,
    useUpdateDoctorSymptomsMutation,
} from '../../api/scopedDoctorApi';

const TreatableSymptomsSection = ({ previewMode = false, registerSave }) => {
    const { data: currentSymptoms = [], isLoading: loadingCurrent } = useGetDoctorSymptomsQuery(undefined, { skip: previewMode });
    const { data: availableData, isLoading: loadingAvailable } = useGetAvailableSymptomsQuery(undefined, { skip: previewMode });
    const [updateSymptoms, { isLoading: saving }] = useUpdateDoctorSymptomsMutation();

    const allSymptoms = availableData?.symptoms || [];
    const categories = availableData?.categories || [];

    const [selectedIds, setSelectedIds] = useState(new Set());
    const [activeTab, setActiveTab] = useState(0);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
    const [dirty, setDirty] = useState(false);

    // Initialize selected from current doctor symptoms
    useEffect(() => {
        if (currentSymptoms.length > 0) {
            setSelectedIds(new Set(currentSymptoms.map((s) => s.symptom_id)));
        }
    }, [currentSymptoms]);

    // Group available symptoms by category
    const groupedSymptoms = useMemo(() => {
        const groups = {};
        allSymptoms.forEach((s) => {
            const cat = s.category || 'Uncategorized';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(s);
        });
        return groups;
    }, [allSymptoms]);

    const displayCategories = categories.length > 0 ? categories : Object.keys(groupedSymptoms);

    const toggleSymptom = (symptomId) => {
        if (previewMode) return;
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(symptomId)) {
                next.delete(symptomId);
            } else {
                next.add(symptomId);
            }
            return next;
        });
        setDirty(true);
    };

    const handleSave = async () => {
        try {
            await updateSymptoms([...selectedIds]).unwrap();
            setSnackbar({ open: true, message: 'Treatable symptoms saved', severity: 'success' });
            setDirty(false);
        } catch (err) {
            setSnackbar({ open: true, message: 'Failed to save symptoms', severity: 'error' });
        }
    };

    // Register save handler with parent
    useEffect(() => {
        if (registerSave) {
            registerSave(handleSave, dirty ? 'Save Symptoms' : 'Saved', !dirty);
        }
    }, [registerSave, dirty, selectedIds]);

    if (loadingCurrent || loadingAvailable) {
        return <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>;
    }

    return (
        <Box>
            <Paper sx={{ p: 3, mb: 2 }}>
                <Typography variant="h6" fontWeight="bold" mb={1}>
                    Symptoms I Treat
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                    Select the symptoms you specialise in treating. Patients searching by symptoms will be matched to you.
                </Typography>

                {/* Selected count */}
                <Chip
                    label={`${selectedIds.size} symptom${selectedIds.size !== 1 ? 's' : ''} selected`}
                    color="primary"
                    variant="outlined"
                    size="small"
                    sx={{ mb: 2 }}
                />
            </Paper>

            {/* Category tabs */}
            {displayCategories.length > 0 && (
                <Paper sx={{ mb: 2 }}>
                    <Tabs
                        value={activeTab}
                        onChange={(_, v) => setActiveTab(v)}
                        variant="scrollable"
                        scrollButtons="auto"
                    >
                        {displayCategories.map((cat) => (
                            <Tab
                                key={cat}
                                label={
                                    <Box display="flex" alignItems="center" gap={0.5}>
                                        {cat}
                                        {(groupedSymptoms[cat] || []).some((s) => selectedIds.has(s.id)) && (
                                            <Chip
                                                label={(groupedSymptoms[cat] || []).filter((s) => selectedIds.has(s.id)).length}
                                                size="small"
                                                color="primary"
                                                sx={{ height: 18, fontSize: '0.65rem' }}
                                            />
                                        )}
                                    </Box>
                                }
                            />
                        ))}
                    </Tabs>
                </Paper>
            )}

            {/* Symptoms grid for active category */}
            <Grid container spacing={1.5}>
                {(groupedSymptoms[displayCategories[activeTab]] || []).map((symptom) => {
                    const selected = selectedIds.has(symptom.id);
                    return (
                        <Grid item xs={6} sm={4} md={3} key={symptom.id}>
                            <Card
                                variant="outlined"
                                sx={{
                                    borderColor: selected ? 'primary.main' : 'divider',
                                    borderWidth: selected ? 2 : 1,
                                    bgcolor: selected ? 'primary.50' : 'transparent',
                                    cursor: previewMode ? 'default' : 'pointer',
                                }}
                            >
                                <CardActionArea
                                    onClick={() => toggleSymptom(symptom.id)}
                                    disabled={previewMode}
                                    sx={{ p: 1 }}
                                >
                                    <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                                        <Box display="flex" alignItems="center" gap={1}>
                                            {selected ? (
                                                <CheckCircleIcon sx={{ fontSize: 20, color: 'primary.main' }} />
                                            ) : (
                                                <RadioButtonUncheckedIcon sx={{ fontSize: 20, color: 'action.disabled' }} />
                                            )}
                                            <Box>
                                                <Typography variant="body2" fontWeight={selected ? 'bold' : 'normal'}>
                                                    {symptom.name}
                                                </Typography>
                                                {symptom.description && (
                                                    <Typography variant="caption" color="text.secondary">
                                                        {symptom.description}
                                                    </Typography>
                                                )}
                                            </Box>
                                        </Box>
                                    </CardContent>
                                </CardActionArea>
                            </Card>
                        </Grid>
                    );
                })}
            </Grid>

            {allSymptoms.length === 0 && (
                <Alert severity="info" sx={{ mt: 2 }}>
                    No symptoms available in the system yet. Contact admin to add symptoms.
                </Alert>
            )}

            {/* Inline save button for convenience */}
            {!previewMode && dirty && (
                <Box display="flex" justifyContent="flex-end" mt={3}>
                    <Button
                        variant="contained"
                        onClick={handleSave}
                        disabled={saving}
                    >
                        {saving ? 'Saving...' : 'Save Symptoms'}
                    </Button>
                </Box>
            )}

            <Snackbar
                open={snackbar.open}
                autoHideDuration={3000}
                onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                message={snackbar.message}
            />
        </Box>
    );
};

export default TreatableSymptomsSection;
