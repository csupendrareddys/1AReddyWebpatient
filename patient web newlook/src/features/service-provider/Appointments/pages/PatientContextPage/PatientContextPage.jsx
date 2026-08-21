import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box, Container, Typography, Chip, Paper, Accordion, AccordionSummary, AccordionDetails,
    CircularProgress, Stack, Divider, Button, IconButton, TextField, Grid, Snackbar, Alert,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import ScienceIcon from '@mui/icons-material/Science';
import PsychologyIcon from '@mui/icons-material/Psychology';
import DescriptionIcon from '@mui/icons-material/Description';
import PersonIcon from '@mui/icons-material/Person';
import LanguageIcon from '@mui/icons-material/Language';
import BloodtypeIcon from '@mui/icons-material/Bloodtype';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';

import { useGetAppointmentPatientContextQuery, useUpdatePatientVitalsMutation } from '../../../api/scopedDoctorApi';

const VITAL_LABELS = {
    height_cm: 'Height (cm)', weight_kg: 'Weight (kg)', bmi: 'BMI',
    blood_pressure_systolic: 'BP Systolic', blood_pressure_diastolic: 'BP Diastolic',
    heart_rate: 'Heart Rate', spo2: 'SpO2 (%)', temperature: 'Temp (F)',
    blood_sugar_fasting: 'Sugar - Fasting', blood_sugar_pp: 'Sugar - PP',
};

const VITAL_FIELDS = [
    { key: 'height_cm', label: 'Height (cm)', placeholder: 'e.g. 170' },
    { key: 'weight_kg', label: 'Weight (kg)', placeholder: 'e.g. 70' },
    { key: 'bmi', label: 'BMI', placeholder: 'Auto or manual' },
    { key: 'blood_pressure_systolic', label: 'BP Systolic', placeholder: 'e.g. 120' },
    { key: 'blood_pressure_diastolic', label: 'BP Diastolic', placeholder: 'e.g. 80' },
    { key: 'heart_rate', label: 'Heart Rate (bpm)', placeholder: 'e.g. 72' },
    { key: 'spo2', label: 'SpO2 (%)', placeholder: 'e.g. 98' },
    { key: 'temperature', label: 'Temperature (F)', placeholder: 'e.g. 98.6' },
    { key: 'blood_sugar_fasting', label: 'Blood Sugar - Fasting', placeholder: 'mg/dL' },
    { key: 'blood_sugar_pp', label: 'Blood Sugar - PP', placeholder: 'mg/dL' },
];

const HABIT_LABELS = {
    smoking: 'Smoking', alcohol: 'Alcohol', tobacco: 'Tobacco', drugs: 'Drugs',
    exercise: 'Exercise', diet: 'Diet', sleep_pattern: 'Sleep', caffeine: 'Caffeine',
};

const SEVERITY_COLORS = {
    mild: 'success', moderate: 'warning', severe: 'error',
};

/** Safely extract a display string from a language entry (could be string or {id, name, native} object) */
const langLabel = (lang) => {
    if (typeof lang === 'string') return lang;
    if (lang && typeof lang === 'object') return lang.name || lang.native || JSON.stringify(lang);
    return String(lang);
};

const PatientContextPage = () => {
    const { appointmentId } = useParams();
    const navigate = useNavigate();
    const { data, isLoading, isError } = useGetAppointmentPatientContextQuery(appointmentId, {
        skip: !appointmentId,
    });
    const [updateVitals, { isLoading: isSaving }] = useUpdatePatientVitalsMutation();

    const patientInfo = data?.patient_info || {};
    const ctx = data?.context;

    // Vitals form state
    const [vitalsForm, setVitalsForm] = useState({});
    const [vitalsExpanded, setVitalsExpanded] = useState(false);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    // Pre-fill form from existing vitals when data loads
    useEffect(() => {
        if (ctx?.shared_vitals) {
            setVitalsForm((prev) => {
                const merged = { ...prev };
                Object.entries(ctx.shared_vitals).forEach(([key, val]) => {
                    if (val != null && val !== '' && val !== false && merged[key] === undefined) {
                        merged[key] = String(val);
                    }
                });
                return merged;
            });
        }
    }, [ctx?.shared_vitals]);

    const handleVitalsChange = (key) => (e) => {
        const val = e.target.value;
        setVitalsForm((prev) => {
            const updated = { ...prev, [key]: val };
            // Auto-compute BMI when height and weight are present
            if ((key === 'height_cm' || key === 'weight_kg')) {
                const h = parseFloat(key === 'height_cm' ? val : updated.height_cm);
                const w = parseFloat(key === 'weight_kg' ? val : updated.weight_kg);
                if (h > 0 && w > 0) {
                    updated.bmi = (w / ((h / 100) ** 2)).toFixed(1);
                }
            }
            return updated;
        });
    };

    const handleSaveVitals = async () => {
        // Only send non-empty values
        const payload = {};
        Object.entries(vitalsForm).forEach(([key, val]) => {
            if (val != null && String(val).trim()) payload[key] = String(val).trim();
        });
        if (Object.keys(payload).length === 0) return;

        try {
            await updateVitals({ appointmentId, data: payload }).unwrap();
            setSnackbar({ open: true, message: 'Vitals updated successfully', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Failed to update vitals', severity: 'error' });
        }
    };

    return (
        <Container maxWidth="md" sx={{ mt: 4, mb: 10 }}>
            {/* Header */}
            <Paper sx={{ p: 3, mb: 3 }}>
                <Box display="flex" alignItems="center" gap={2}>
                    <IconButton onClick={() => navigate(-1)}>
                        <ArrowBackIcon />
                    </IconButton>
                    <Box flex={1}>
                        <Typography variant="h5" fontWeight="bold">
                            Patient Details & Medical Context
                        </Typography>
                        {patientInfo.full_name && (
                            <Typography variant="body2" color="text.secondary">
                                {patientInfo.full_name}
                            </Typography>
                        )}
                    </Box>
                </Box>
            </Paper>

            {isLoading ? (
                <Box display="flex" justifyContent="center" mt={4}>
                    <CircularProgress />
                </Box>
            ) : isError ? (
                <Paper sx={{ p: 3 }}>
                    <Typography color="error">Failed to load patient details. Please try again.</Typography>
                </Paper>
            ) : (
                <Stack spacing={3}>
                    {/* Patient Profile */}
                    <Paper sx={{ p: 3 }}>
                        <Box display="flex" alignItems="center" gap={1} mb={2}>
                            <PersonIcon color="primary" />
                            <Typography variant="h6" fontWeight="bold">Patient Profile</Typography>
                        </Box>
                        <Box display="flex" gap={1} flexWrap="wrap">
                            {patientInfo.gender && (
                                <Chip icon={<PersonIcon />} label={patientInfo.gender} size="small" variant="outlined" />
                            )}
                            {patientInfo.date_of_birth && (
                                <Chip label={`DOB: ${patientInfo.date_of_birth}`} size="small" variant="outlined" />
                            )}
                            {patientInfo.blood_group && (
                                <Chip icon={<BloodtypeIcon />} label={patientInfo.blood_group} size="small" color="error" variant="outlined" />
                            )}
                        </Box>
                        {patientInfo.languages_known?.length > 0 && (
                            <Box mt={1.5}>
                                <Box display="flex" alignItems="center" gap={0.5} mb={0.5}>
                                    <LanguageIcon fontSize="small" color="primary" />
                                    <Typography variant="caption" fontWeight="bold" color="text.secondary">Languages</Typography>
                                </Box>
                                <Box display="flex" gap={0.5} flexWrap="wrap">
                                    {patientInfo.languages_known.map((lang, i) => (
                                        <Chip key={i} label={langLabel(lang)} size="small" variant="outlined" />
                                    ))}
                                </Box>
                            </Box>
                        )}
                    </Paper>

                    {!ctx && (
                        <Paper sx={{ p: 3, textAlign: 'center' }}>
                            <Typography variant="body1" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                No medical context was shared for this appointment.
                            </Typography>
                        </Paper>
                    )}

                    {/* Symptoms */}
                    {ctx?.symptoms?.length > 0 && (
                        <Paper sx={{ p: 3 }}>
                            <Box display="flex" alignItems="center" gap={1} mb={2}>
                                <PsychologyIcon color="error" />
                                <Typography variant="h6" fontWeight="bold">
                                    Symptoms ({ctx.symptoms.length})
                                </Typography>
                            </Box>
                            <Box display="flex" gap={1} flexWrap="wrap">
                                {ctx.symptoms.map((s, i) => (
                                    <Chip
                                        key={i}
                                        label={`${s.name}${s.severity ? ` (${s.severity})` : ''}`}
                                        color={SEVERITY_COLORS[s.severity] || 'default'}
                                        variant="outlined"
                                    />
                                ))}
                            </Box>
                            {ctx.custom_symptoms?.length > 0 && (
                                <Box mt={1.5}>
                                    <Typography variant="caption" fontWeight="bold" color="text.secondary">Custom Symptoms</Typography>
                                    <Box display="flex" gap={0.5} flexWrap="wrap" mt={0.5}>
                                        {ctx.custom_symptoms.map((cs, i) => (
                                            <Chip key={i} label={cs} size="small" variant="outlined" color="secondary" />
                                        ))}
                                    </Box>
                                </Box>
                            )}
                        </Paper>
                    )}

                    {/* Vitals (Read-Only Display) */}
                    {ctx?.shared_vitals && Object.keys(ctx.shared_vitals).length > 0 && (
                        <Paper sx={{ p: 3 }}>
                            <Box display="flex" alignItems="center" gap={1} mb={2}>
                                <MonitorHeartIcon color="success" />
                                <Typography variant="h6" fontWeight="bold">Vitals</Typography>
                            </Box>
                            <Box display="flex" gap={1} flexWrap="wrap">
                                {Object.entries(ctx.shared_vitals).map(([key, val]) => {
                                    if (val == null || val === '' || val === false) return null;
                                    const label = VITAL_LABELS[key] || key.replace(/_/g, ' ');
                                    const displayVal = typeof val === 'boolean' ? 'Yes' : val;
                                    return (
                                        <Chip key={key} label={`${label}: ${displayVal}`} variant="outlined" />
                                    );
                                })}
                            </Box>
                            {ctx.additional_vitals && Object.keys(ctx.additional_vitals).length > 0 && (
                                <Box mt={2}>
                                    <Divider sx={{ mb: 1.5 }} />
                                    <Typography variant="subtitle2" fontWeight="bold" color="text.secondary" mb={1}>
                                        Additional Vitals (provided during booking)
                                    </Typography>
                                    <Box display="flex" gap={1} flexWrap="wrap">
                                        {Object.entries(ctx.additional_vitals).map(([key, val]) => (
                                            <Chip key={key} label={`${VITAL_LABELS[key] || key}: ${val}`} color="info" variant="outlined" />
                                        ))}
                                    </Box>
                                </Box>
                            )}
                        </Paper>
                    )}

                    {/* Update Vitals (Editable Form) */}
                    <Accordion
                        expanded={vitalsExpanded}
                        onChange={() => setVitalsExpanded(!vitalsExpanded)}
                        sx={{ border: '1px solid #c8e6c9', '&:before': { display: 'none' } }}
                    >
                        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: '#e8f5e9' }}>
                            <Box display="flex" alignItems="center" gap={1}>
                                <EditIcon color="success" fontSize="small" />
                                <Typography fontWeight="bold">Update Patient Vitals</Typography>
                            </Box>
                        </AccordionSummary>
                        <AccordionDetails sx={{ pt: 2 }}>
                            <Typography variant="body2" color="text.secondary" mb={2}>
                                Update vitals during the consultation. These will be saved to the patient's health records.
                            </Typography>
                            <Grid container spacing={2}>
                                {VITAL_FIELDS.map((field) => (
                                    <Grid item xs={6} sm={4} key={field.key}>
                                        <TextField
                                            fullWidth
                                            size="small"
                                            label={field.label}
                                            placeholder={field.placeholder}
                                            type="number"
                                            value={vitalsForm[field.key] || ''}
                                            onChange={handleVitalsChange(field.key)}
                                            inputProps={{ step: 'any', min: 0 }}
                                        />
                                    </Grid>
                                ))}
                            </Grid>
                            <Box display="flex" justifyContent="flex-end" mt={2}>
                                <Button
                                    variant="contained"
                                    color="success"
                                    startIcon={<SaveIcon />}
                                    onClick={handleSaveVitals}
                                    disabled={isSaving}
                                >
                                    {isSaving ? 'Saving...' : 'Save Vitals'}
                                </Button>
                            </Box>
                        </AccordionDetails>
                    </Accordion>

                    {/* Habits */}
                    {ctx?.shared_habits && (Array.isArray(ctx.shared_habits) ? ctx.shared_habits.length > 0 : Object.keys(ctx.shared_habits).length > 0) && (
                        <Paper sx={{ p: 3 }}>
                            <Box display="flex" alignItems="center" gap={1} mb={2}>
                                <ScienceIcon color="warning" />
                                <Typography variant="h6" fontWeight="bold">Habits</Typography>
                            </Box>
                            <Box display="flex" gap={1} flexWrap="wrap">
                                {Array.isArray(ctx.shared_habits)
                                    ? ctx.shared_habits.map((h, i) => {
                                        const habitKey = h.habit_key || (typeof h === 'string' ? h : '');
                                        const label = HABIT_LABELS[habitKey] || habitKey.replace(/_/g, ' ');
                                        const value = h.value;
                                        const displayLabel = value ? `${label}: ${value}` : label;
                                        return <Chip key={i} label={displayLabel} variant="outlined" />;
                                    })
                                    : Object.entries(ctx.shared_habits).map(([key, val]) => {
                                        if (val == null || val === '') return null;
                                        const label = HABIT_LABELS[key] || key.replace(/_/g, ' ');
                                        return <Chip key={key} label={`${label}: ${val}`} variant="outlined" />;
                                    })
                                }
                            </Box>
                        </Paper>
                    )}

                    {/* Additional Details (Description / Remarks) */}
                    {ctx?.additional_details && (ctx.additional_details.description || ctx.additional_details.remarks) && (
                        <Paper sx={{ p: 3 }}>
                            <Box display="flex" alignItems="center" gap={1} mb={2}>
                                <DescriptionIcon color="info" />
                                <Typography variant="h6" fontWeight="bold">Patient Notes</Typography>
                            </Box>
                            {ctx.additional_details.description && (
                                <Box mb={1.5}>
                                    <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">Description</Typography>
                                    <Typography variant="body1">{ctx.additional_details.description}</Typography>
                                </Box>
                            )}
                            {ctx.additional_details.remarks && (
                                <Box>
                                    <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">Remarks</Typography>
                                    <Typography variant="body1">{ctx.additional_details.remarks}</Typography>
                                </Box>
                            )}
                        </Paper>
                    )}

                    {/* Health Records */}
                    {ctx?.shared_health_records?.length > 0 && (
                        <Paper sx={{ p: 3 }}>
                            <Box display="flex" alignItems="center" gap={1} mb={2}>
                                <DescriptionIcon color="primary" />
                                <Typography variant="h6" fontWeight="bold">
                                    Health Records ({ctx.shared_health_records.length})
                                </Typography>
                            </Box>
                            <Stack spacing={2}>
                                {ctx.shared_health_records.map((rec) => (
                                    <Paper key={rec.id} variant="outlined" sx={{ p: 2 }}>
                                        <Box display="flex" justifyContent="space-between" alignItems="center">
                                            <Typography variant="subtitle1" fontWeight="bold">
                                                {rec.title || (rec.record_type || '').replace(/_/g, ' ')}
                                            </Typography>
                                            {rec.record_date && (
                                                <Typography variant="body2" color="text.secondary">{rec.record_date}</Typography>
                                            )}
                                        </Box>
                                        {rec.record_type && (
                                            <Chip label={rec.record_type.replace(/_/g, ' ')} size="small" sx={{ mt: 0.5 }} />
                                        )}
                                        {rec.notes && (
                                            <Typography variant="body2" color="text.secondary" mt={1}>{rec.notes}</Typography>
                                        )}
                                        {rec.details && typeof rec.details === 'object' && Object.keys(rec.details).length > 0 && (
                                            <Box mt={1}>
                                                <Typography variant="caption" fontWeight="bold" color="text.secondary">Details</Typography>
                                                <Box display="flex" gap={0.5} flexWrap="wrap" mt={0.5}>
                                                    {Object.entries(rec.details).map(([k, v]) => {
                                                        if (v == null || v === '' || k === 'title') return null;
                                                        return (
                                                            <Chip
                                                                key={k}
                                                                label={`${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`}
                                                                size="small"
                                                                variant="outlined"
                                                            />
                                                        );
                                                    })}
                                                </Box>
                                            </Box>
                                        )}
                                        {rec.attachments?.length > 0 && (
                                            <Box display="flex" gap={0.5} mt={1} flexWrap="wrap">
                                                {rec.attachments.map((att, idx) => {
                                                    const isString = typeof att === 'string';
                                                    const url = isString ? att : (att.url || att.link);
                                                    const label = isString ? `Attachment ${idx + 1}` : (att.description || att.filename || `Attachment ${idx + 1}`);
                                                    return (
                                                        <Chip
                                                            key={idx}
                                                            icon={<DescriptionIcon />}
                                                            label={label}
                                                            size="small"
                                                            variant="outlined"
                                                            onClick={() => url && window.open(url, '_blank')}
                                                            clickable={!!url}
                                                        />
                                                    );
                                                })}
                                            </Box>
                                        )}
                                    </Paper>
                                ))}
                            </Stack>
                        </Paper>
                    )}

                    {/* Surgeries */}
                    {ctx?.shared_surgeries?.length > 0 && (
                        <Paper sx={{ p: 3 }}>
                            <Box display="flex" alignItems="center" gap={1} mb={2}>
                                <LocalHospitalIcon color="secondary" />
                                <Typography variant="h6" fontWeight="bold">
                                    Surgeries ({ctx.shared_surgeries.length})
                                </Typography>
                            </Box>
                            <Stack spacing={2}>
                                {ctx.shared_surgeries.map((surg) => (
                                    <Paper key={surg.id} variant="outlined" sx={{ p: 2 }}>
                                        <Typography variant="subtitle1" fontWeight="bold">
                                            {(surg.surgery_type || '').replace(/_/g, ' ') || 'Surgery'}
                                        </Typography>
                                        <Box display="flex" gap={1} mt={0.5} flexWrap="wrap">
                                            {surg.surgery_date && <Chip label={surg.surgery_date} size="small" variant="outlined" />}
                                            {surg.hospital && <Chip label={surg.hospital} size="small" variant="outlined" />}
                                            {surg.surgeon_name && <Chip label={`Dr. ${surg.surgeon_name}`} size="small" variant="outlined" />}
                                        </Box>
                                        {surg.notes && (
                                            <Typography variant="body2" color="text.secondary" mt={1}>{surg.notes}</Typography>
                                        )}
                                        {surg.attachments?.length > 0 && (
                                            <Box display="flex" gap={0.5} mt={1} flexWrap="wrap">
                                                {surg.attachments.map((att, idx) => {
                                                    const isString = typeof att === 'string';
                                                    const url = isString ? att : (att.url || att.link);
                                                    const label = isString ? `Attachment ${idx + 1}` : (att.description || att.filename || `Attachment ${idx + 1}`);
                                                    return (
                                                        <Chip
                                                            key={idx}
                                                            icon={<DescriptionIcon />}
                                                            label={label}
                                                            size="small"
                                                            variant="outlined"
                                                            onClick={() => url && window.open(url, '_blank')}
                                                            clickable={!!url}
                                                        />
                                                    );
                                                })}
                                            </Box>
                                        )}
                                    </Paper>
                                ))}
                            </Stack>
                        </Paper>
                    )}
                </Stack>
            )}

            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    severity={snackbar.severity}
                    onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                    variant="filled"
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Container>
    );
};

export default PatientContextPage;
