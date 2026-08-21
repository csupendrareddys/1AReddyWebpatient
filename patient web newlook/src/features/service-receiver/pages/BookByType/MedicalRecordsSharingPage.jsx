import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Box, Container, Typography, Paper, CircularProgress, Switch,
    Accordion, AccordionSummary, AccordionDetails,
    Button, IconButton, Chip, List, ListItem, ListItemText,
    ListItemSecondaryAction, Divider, TextField, Grid, Alert,
    Dialog, DialogTitle, DialogContent, DialogActions,
    FormControl, InputLabel, Select, MenuItem, Stack,
    Tooltip, LinearProgress,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteIcon from '@mui/icons-material/Delete';
import DescriptionIcon from '@mui/icons-material/Description';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';

import { useUpdateAppointmentContextMutation } from '../../api/scopedBookingApi';
import useBookingFlow from '../../hooks/useBookingFlow';

import {
    useGetVitalsQuery,
    useGetHabitsQuery,
    useGetHealthRecordsQuery,
    useGetSurgeriesQuery,
    useAddHealthRecordMutation,
    useAddSurgeryMutation,
    useUploadHealthRecordAttachmentMutation,
    useDeleteHealthRecordAttachmentMutation,
} from '../../ProfileSetting/api/scopedPatientApi';
import { toLocalDateString, todayLocalDateString } from '../../../../common/utils/date';

// Labels for vitals keys
const VITAL_LABELS = {
    height_cm: 'Height (cm)',
    weight_kg: 'Weight (kg)',
    bmi: 'BMI',
    blood_pressure_systolic: 'BP Systolic (mmHg)',
    blood_pressure_diastolic: 'BP Diastolic (mmHg)',
    heart_rate: 'Heart Rate (bpm)',
    spo2: 'SpO2 (%)',
    temperature: 'Temperature (°F)',
    blood_sugar_fasting: 'Blood Sugar - Fasting (mg/dL)',
    blood_sugar_pp: 'Blood Sugar - PP (mg/dL)',
};

// Labels for habit keys
const HABIT_LABELS = {
    smoking: 'Smoking',
    alcohol: 'Alcohol',
    tobacco: 'Tobacco',
    drugs: 'Drugs',
    exercise: 'Exercise',
    diet: 'Diet',
    sleep_pattern: 'Sleep Pattern',
    caffeine: 'Caffeine',
};

const RECORD_TYPES = [
    { value: 'lab_report', label: 'Lab Report' },
    { value: 'imaging', label: 'Imaging (X-Ray, MRI, CT)' },
    { value: 'discharge_summary', label: 'Discharge Summary' },
    { value: 'vaccination', label: 'Vaccination Record' },
    { value: 'allergy', label: 'Allergy' },
    { value: 'chronic_condition', label: 'Chronic Condition' },
    { value: 'prescription', label: 'Prescription' },
    { value: 'other', label: 'Other' },
];

const RECORD_TYPE_COLORS = {
    lab_report: 'success',
    imaging: 'warning',
    prescription: 'primary',
    discharge_summary: 'secondary',
    vaccination: 'info',
    allergy: 'error',
    chronic_condition: 'error',
    other: 'default',
};

const getRecordTypeLabel = (type) => {
    const found = RECORD_TYPES.find((r) => r.value === type);
    return found ? found.label : (type || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

/* ─────────── Inline Attachment Manager ─────────── */
const AttachmentManager = ({ recordId, attachments = [] }) => {
    const [uploadAttachment, { isLoading: isUploading }] = useUploadHealthRecordAttachmentMutation();
    const [deleteAttachment] = useDeleteHealthRecordAttachmentMutation();
    const [showUpload, setShowUpload] = useState(false);
    const [description, setDescription] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const [replaceId, setReplaceId] = useState(null); // attachment id being replaced
    const fileInputRef = useRef(null);

    const handleUpload = useCallback(async () => {
        if (!selectedFile) return;
        try {
            // If replacing, delete old first
            if (replaceId) {
                try {
                    await deleteAttachment({ recordId, attachmentId: replaceId }).unwrap();
                } catch { /* ignore delete failure on replace */ }
            }
            await uploadAttachment({
                recordId,
                file: selectedFile,
                description,
            }).unwrap();
            setSelectedFile(null);
            setDescription('');
            setShowUpload(false);
            setReplaceId(null);
        } catch (err) {
            console.error('Failed to upload attachment:', err);
        }
    }, [recordId, selectedFile, description, replaceId, uploadAttachment, deleteAttachment]);

    const handleDelete = useCallback(async (attachmentId) => {
        if (!window.confirm('Delete this attachment?')) return;
        try {
            await deleteAttachment({ recordId, attachmentId }).unwrap();
        } catch (err) {
            console.error('Failed to delete attachment:', err);
        }
    }, [recordId, deleteAttachment]);

    const handleReplace = useCallback((attachmentId) => {
        setReplaceId(attachmentId);
        setSelectedFile(null);
        setDescription('');
        setShowUpload(true);
    }, []);

    const handleCancelUpload = useCallback(() => {
        setShowUpload(false);
        setSelectedFile(null);
        setDescription('');
        setReplaceId(null);
    }, []);

    return (
        <Box sx={{ mt: 0.5 }}>
            {/* Existing attachments */}
            {attachments.length > 0 && (
                <Stack spacing={0.5} sx={{ mb: 1 }}>
                    {attachments.map((att) => (
                        <Box
                            key={att.id}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                p: 0.5,
                                px: 1,
                                bgcolor: 'grey.50',
                                borderRadius: 1,
                                border: '1px solid',
                                borderColor: 'divider',
                            }}
                        >
                            <DescriptionIcon fontSize="small" color="action" />
                            <Typography
                                variant="caption"
                                sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            >
                                {att.description || att.filename || 'Attachment'}
                                {att.file_size_bytes && (
                                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                                        ({(att.file_size_bytes / 1024).toFixed(0)} KB)
                                    </Typography>
                                )}
                            </Typography>
                            {/* View */}
                            <Tooltip title="View / Download">
                                <IconButton
                                    size="small"
                                    onClick={() => att.url && window.open(att.url, '_blank')}
                                    disabled={!att.url}
                                >
                                    <OpenInNewIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            {/* Re-upload */}
                            <Tooltip title="Replace file">
                                <IconButton size="small" onClick={() => handleReplace(att.id)}>
                                    <SwapHorizIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            {/* Delete */}
                            <Tooltip title="Delete">
                                <IconButton size="small" color="error" onClick={() => handleDelete(att.id)}>
                                    <DeleteIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    ))}
                </Stack>
            )}

            {/* Upload area */}
            {!showUpload ? (
                <Button
                    size="small"
                    startIcon={<AttachFileIcon />}
                    onClick={() => { setReplaceId(null); setShowUpload(true); }}
                    sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                >
                    Add Attachment
                </Button>
            ) : (
                <Box sx={{ p: 1.5, border: '1px dashed', borderColor: 'primary.light', borderRadius: 1, bgcolor: '#fafbff' }}>
                    {replaceId && (
                        <Alert severity="info" sx={{ mb: 1, py: 0 }} variant="outlined">
                            Replacing existing attachment. Upload new file below.
                        </Alert>
                    )}
                    <Stack spacing={1}>
                        <input
                            ref={fileInputRef}
                            type="file"
                            style={{ display: 'none' }}
                            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                        />
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<CloudUploadIcon />}
                            onClick={() => fileInputRef.current?.click()}
                            sx={{ textTransform: 'none' }}
                        >
                            {selectedFile ? selectedFile.name : 'Choose File'}
                        </Button>
                        <TextField
                            size="small"
                            label="Description (optional)"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="e.g. Blood test results, X-Ray image"
                            fullWidth
                        />
                        {isUploading && <LinearProgress />}
                        <Stack direction="row" spacing={1}>
                            <Button
                                size="small"
                                variant="contained"
                                onClick={handleUpload}
                                disabled={!selectedFile || isUploading}
                            >
                                {isUploading ? 'Uploading...' : replaceId ? 'Replace' : 'Upload'}
                            </Button>
                            <Button size="small" onClick={handleCancelUpload}>
                                Cancel
                            </Button>
                        </Stack>
                    </Stack>
                </Box>
            )}
        </Box>
    );
};

/* ─────────── Dialog Attachment Queue (for new record creation) ─────────── */
const DialogAttachmentQueue = ({ attachments, onAdd, onRemove }) => {
    const fileRef = useRef(null);
    const [desc, setDesc] = useState('');

    const handleAdd = () => {
        const file = fileRef.current?.files?.[0];
        if (!file) return;
        onAdd({ file, description: desc });
        setDesc('');
        if (fileRef.current) fileRef.current.value = '';
    };

    return (
        <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Attachments</Typography>
            {attachments.length > 0 && (
                <Stack spacing={0.5} sx={{ mb: 1.5 }}>
                    {attachments.map((att, idx) => (
                        <Chip
                            key={idx}
                            icon={<DescriptionIcon fontSize="small" />}
                            label={`${att.file.name}${att.description ? ` — ${att.description}` : ''}`}
                            size="small"
                            variant="outlined"
                            onDelete={() => onRemove(idx)}
                            sx={{ maxWidth: '100%' }}
                        />
                    ))}
                </Stack>
            )}
            <Stack direction="row" spacing={1} alignItems="flex-end">
                <input ref={fileRef} type="file" style={{ display: 'none' }} />
                <Button
                    variant="outlined" size="small"
                    startIcon={<CloudUploadIcon />}
                    onClick={() => fileRef.current?.click()}
                    sx={{ textTransform: 'none', flexShrink: 0 }}
                >
                    Choose File
                </Button>
                <TextField
                    size="small" label="Description" value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    placeholder="Optional" sx={{ flex: 1 }}
                />
                <Button size="small" variant="contained" onClick={handleAdd} sx={{ flexShrink: 0 }}>
                    Add
                </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                Files will be uploaded when you save the record.
            </Typography>
        </Box>
    );
};

/* ═══════════════ Main Component ═══════════════ */
const MedicalRecordsSharingPage = () => {
    const {
        consultationType,
        medicalContextId,
        bookingFor,
        selectedMember,
        handleCompleteMedicalSharing,
        handleGoBack,
    } = useBookingFlow();

    const [updateContext, { isLoading: isSaving }] = useUpdateAppointmentContextMutation();

    // Fetch from dedicated endpoints
    const { data: vitalsResp, isLoading: isLoadingVitals } = useGetVitalsQuery();
    const { data: habitsResp, isLoading: isLoadingHabits } = useGetHabitsQuery();
    const { data: recordsResp, isLoading: isLoadingRecords } = useGetHealthRecordsQuery({});
    const { data: surgeriesResp, isLoading: isLoadingSurgeries } = useGetSurgeriesQuery();

    // Mutations for adding records/surgeries inline
    const [addRecord, { isLoading: isAddingRecord }] = useAddHealthRecordMutation();
    const [addSurgery, { isLoading: isAddingSurgery }] = useAddSurgeryMutation();
    const [uploadAttachment] = useUploadHealthRecordAttachmentMutation();

    // ─── Extract data - handle response wrapper shapes ───
    const vitals = vitalsResp?.vitals || vitalsResp?.data?.vitals || vitalsResp || {};
    const habits = habitsResp?.habits || habitsResp?.data?.habits || habitsResp || {};
    // Backend returns { health_records: [...], pagination: {...} }
    const healthRecords = recordsResp?.health_records || recordsResp?.data?.health_records
        || recordsResp?.records || recordsResp?.data?.records || [];
    const surgeries = surgeriesResp?.surgeries || surgeriesResp?.data?.surgeries || surgeriesResp || [];

    const isLoading = isLoadingVitals || isLoadingHabits || isLoadingRecords || isLoadingSurgeries;

    // ─── Per-item sharing toggles ───
    const [vitalsSharing, setVitalsSharing] = useState({});
    const [habitsSharing, setHabitsSharing] = useState({});
    const [recordsSharing, setRecordsSharing] = useState({});
    const [surgeriesSharing, setSurgeriesSharing] = useState({});

    // Additional vitals for this appointment
    const [additionalVitals, setAdditionalVitals] = useState({});
    const [showAddVitals, setShowAddVitals] = useState(false);

    // Section-level toggles
    const [sectionVisibility, setSectionVisibility] = useState({
        vitals: true,
        habits: true,
        health_records: true,
        surgeries: true,
    });

    // ─── Add Health Record Dialog ───
    const [recordDialogOpen, setRecordDialogOpen] = useState(false);
    const [newRecord, setNewRecord] = useState({ record_type: '', record_date: null, title: '', notes: '' });
    const [recordDialogAttachments, setRecordDialogAttachments] = useState([]);

    // ─── Add Surgery Dialog ───
    const [surgeryDialogOpen, setSurgeryDialogOpen] = useState(false);
    const [newSurgery, setNewSurgery] = useState({ surgery_type: '', surgery_date: null, hospital: '', surgeon_name: '', notes: '' });
    const [surgeryDialogAttachments, setSurgeryDialogAttachments] = useState([]);

    // Initialize vitals toggles
    useEffect(() => {
        if (typeof vitals === 'object' && vitals !== null && !Array.isArray(vitals)) {
            const toggles = {};
            Object.entries(vitals).forEach(([key, value]) => {
                if (value != null && value !== '' && VITAL_LABELS[key]) {
                    toggles[key] = true;
                }
            });
            if (Object.keys(toggles).length > 0) setVitalsSharing(toggles);
        }
    }, [vitals]);

    // Initialize habits toggles
    useEffect(() => {
        if (typeof habits === 'object' && habits !== null && !Array.isArray(habits)) {
            const toggles = {};
            Object.entries(habits).forEach(([key, value]) => {
                if (value != null && value !== '' && HABIT_LABELS[key]) {
                    toggles[key] = true;
                }
            });
            if (Object.keys(toggles).length > 0) setHabitsSharing(toggles);
        }
    }, [habits]);

    // Initialize health records toggles
    useEffect(() => {
        if (Array.isArray(healthRecords) && healthRecords.length > 0) {
            const toggles = {};
            healthRecords.forEach((r) => { toggles[r.id] = true; });
            setRecordsSharing(toggles);
        }
    }, [healthRecords]);

    // Initialize surgeries toggles
    useEffect(() => {
        if (Array.isArray(surgeries) && surgeries.length > 0) {
            const toggles = {};
            surgeries.forEach((s) => { toggles[s.id] = true; });
            setSurgeriesSharing(toggles);
        }
    }, [surgeries]);

    const toggleSectionVisibility = (section) => {
        setSectionVisibility((prev) => ({ ...prev, [section]: !prev[section] }));
    };

    const toggleAllInSection = (stateSetter, currentState) => {
        const allOn = Object.values(currentState).every(Boolean);
        const updated = {};
        Object.keys(currentState).forEach((key) => { updated[key] = !allOn; });
        stateSetter(updated);
    };

    // ─── Add Health Record ───
    const handleOpenRecordDialog = useCallback(() => {
        setNewRecord({ record_type: '', record_date: null, title: '', notes: '' });
        setRecordDialogAttachments([]);
        setRecordDialogOpen(true);
    }, []);

    const handleSubmitRecord = useCallback(async () => {
        try {
            const payload = {
                record_type: newRecord.record_type,
                record_date: toLocalDateString(newRecord.record_date) || todayLocalDateString(),
                details: { title: newRecord.title, notes: newRecord.notes },
                notes: newRecord.notes,
            };
            const result = await addRecord(payload).unwrap();
            const createdId = result?.data?.id || result?.id;

            // Upload queued attachments
            if (createdId && recordDialogAttachments.length > 0) {
                for (const att of recordDialogAttachments) {
                    try {
                        await uploadAttachment({
                            recordId: createdId,
                            file: att.file,
                            description: att.description,
                        }).unwrap();
                    } catch (uploadErr) {
                        console.error('Failed to upload attachment:', uploadErr);
                    }
                }
            }
            setRecordDialogOpen(false);
        } catch (err) {
            console.error('Failed to add health record:', err);
        }
    }, [newRecord, addRecord, recordDialogAttachments, uploadAttachment]);

    // ─── Add Surgery ───
    const handleOpenSurgeryDialog = useCallback(() => {
        setNewSurgery({ surgery_type: '', surgery_date: null, hospital: '', surgeon_name: '', notes: '' });
        setSurgeryDialogAttachments([]);
        setSurgeryDialogOpen(true);
    }, []);

    const handleSubmitSurgery = useCallback(async () => {
        try {
            const payload = { ...newSurgery };
            if (payload.surgery_date) {
                payload.surgery_date = toLocalDateString(payload.surgery_date);
            }
            const result = await addSurgery(payload).unwrap();
            const createdId = result?.data?.id || result?.id;

            if (createdId && surgeryDialogAttachments.length > 0) {
                for (const att of surgeryDialogAttachments) {
                    try {
                        await uploadAttachment({
                            recordId: createdId,
                            file: att.file,
                            description: att.description,
                        }).unwrap();
                    } catch (uploadErr) {
                        console.error('Failed to upload surgery attachment:', uploadErr);
                    }
                }
            }
            setSurgeryDialogOpen(false);
        } catch (err) {
            console.error('Failed to add surgery:', err);
        }
    }, [newSurgery, addSurgery, surgeryDialogAttachments, uploadAttachment]);

    // ─── Continue / Save sharing preferences ───
    const handleContinue = async () => {
        if (!medicalContextId) {
            handleCompleteMedicalSharing();
            return;
        }

        try {
            const sharedVitals = sectionVisibility.vitals ? vitalsSharing : {};
            const sharedHabits = sectionVisibility.habits
                ? Object.entries(habitsSharing).map(([key, visible]) => ({ habit_key: key, visible }))
                : [];
            const sharedRecords = sectionVisibility.health_records
                ? Object.entries(recordsSharing).map(([id, visible]) => ({ record_id: id, visible }))
                : [];
            const sharedSurgeries = sectionVisibility.surgeries
                ? Object.entries(surgeriesSharing).map(([id, visible]) => ({ prescription_id: id, visible }))
                : [];

            await updateContext({
                contextId: medicalContextId,
                shared_vitals: sharedVitals,
                shared_habits: sharedHabits,
                shared_health_records: sharedRecords,
                shared_prescriptions: sharedSurgeries,
                additional_vitals: Object.keys(additionalVitals).length > 0 ? additionalVitals : null,
            }).unwrap();

            handleCompleteMedicalSharing();
        } catch (err) {
            console.error('Failed to save medical sharing preferences:', err);
        }
    };

    // Filter vitals/habits to only those with values
    const vitalEntries = Object.entries(vitals || {}).filter(
        ([key, value]) => value != null && value !== '' && VITAL_LABELS[key]
    );
    const habitEntries = Object.entries(habits || {}).filter(
        ([key, value]) => value != null && value !== '' && HABIT_LABELS[key]
    );

    // Ensure arrays
    const recordsList = Array.isArray(healthRecords) ? healthRecords : [];
    const surgeriesList = Array.isArray(surgeries) ? surgeries : [];

    if (isLoading) {
        return (
            <Box display="flex" justifyContent="center" mt={8}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns}>
            <Container maxWidth="md" sx={{ mt: 4, mb: 10 }}>
                {/* Header */}
                <Paper sx={{ p: 3, mb: 3 }}>
                    <Box display="flex" alignItems="center" gap={2}>
                        <IconButton onClick={() => handleGoBack(3)}>
                            <ArrowBackIcon />
                        </IconButton>
                        <Box>
                            <Typography variant="h5" fontWeight="bold">
                                Medical Records
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Choose what to share with the doctor. Toggle individual items on/off. You can also add new records and attach documents.
                            </Typography>
                            {bookingFor !== 'self' && selectedMember && (
                                <Chip
                                    label={`Booking for: ${selectedMember.first_name} ${selectedMember.last_name || ''}`}
                                    size="small"
                                    color="primary"
                                    variant="outlined"
                                    sx={{ mt: 0.5 }}
                                />
                            )}
                        </Box>
                    </Box>
                </Paper>

                {/* ── Vitals Section ── */}
                <Accordion defaultExpanded>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Box display="flex" alignItems="center" gap={1} width="100%">
                            <Typography variant="subtitle1" fontWeight="bold" flex={1}>
                                Vitals
                                {vitalEntries.length > 0 && (
                                    <Chip label={vitalEntries.length} size="small" sx={{ ml: 1, height: 20 }} />
                                )}
                            </Typography>
                            <Switch
                                checked={sectionVisibility.vitals}
                                onChange={() => toggleSectionVisibility('vitals')}
                                onClick={(e) => e.stopPropagation()}
                                size="small"
                            />
                        </Box>
                    </AccordionSummary>
                    {sectionVisibility.vitals && (
                        <AccordionDetails>
                            <Box mb={1}>
                                <Button
                                    size="small"
                                    onClick={() => toggleAllInSection(setVitalsSharing, vitalsSharing)}
                                >
                                    {Object.values(vitalsSharing).every(Boolean) ? 'Hide All' : 'Share All'}
                                </Button>
                            </Box>

                            {vitalEntries.length === 0 ? (
                                <Alert severity="info" variant="outlined" sx={{ mb: 1 }}>
                                    No vitals recorded yet. You can add them in Profile Settings → Vitals, or add for this consultation below.
                                </Alert>
                            ) : (
                                <List dense disablePadding>
                                    {vitalEntries.map(([key, value]) => (
                                        <React.Fragment key={key}>
                                            <ListItem sx={{
                                                bgcolor: vitalsSharing[key] ? 'transparent' : 'action.hover',
                                                borderRadius: 1,
                                                opacity: vitalsSharing[key] ? 1 : 0.6,
                                            }}>
                                                <ListItemText
                                                    primary={VITAL_LABELS[key] || key.replace(/_/g, ' ')}
                                                    secondary={String(value)}
                                                    primaryTypographyProps={{ fontWeight: 500, fontSize: '0.9rem' }}
                                                    secondaryTypographyProps={{ fontWeight: 600, color: 'text.primary' }}
                                                />
                                                <ListItemSecondaryAction>
                                                    <IconButton
                                                        edge="end"
                                                        onClick={() => setVitalsSharing((prev) => ({ ...prev, [key]: !prev[key] }))}
                                                    >
                                                        {vitalsSharing[key]
                                                            ? <VisibilityIcon color="primary" fontSize="small" />
                                                            : <VisibilityOffIcon color="disabled" fontSize="small" />
                                                        }
                                                    </IconButton>
                                                </ListItemSecondaryAction>
                                            </ListItem>
                                            <Divider component="li" />
                                        </React.Fragment>
                                    ))}
                                </List>
                            )}

                            {/* Add vitals for this call */}
                            {showAddVitals ? (
                                <Box sx={{ p: 2, bgcolor: '#f5f5f5', borderRadius: 1, mt: 2 }}>
                                    <Typography variant="subtitle2" fontWeight="bold" mb={1.5}>
                                        Add vitals for this consultation
                                    </Typography>
                                    <Grid container spacing={1.5}>
                                        {[
                                            { key: 'blood_pressure', label: 'Blood Pressure' },
                                            { key: 'temperature', label: 'Temperature (°F)' },
                                            { key: 'heart_rate', label: 'Heart Rate (bpm)' },
                                            { key: 'blood_sugar', label: 'Blood Sugar (mg/dL)' },
                                            { key: 'spo2', label: 'SpO2 (%)' },
                                        ].map((v) => (
                                            <Grid item xs={6} sm={4} key={v.key}>
                                                <TextField
                                                    label={v.label}
                                                    size="small"
                                                    fullWidth
                                                    value={additionalVitals[v.key] || ''}
                                                    onChange={(e) => setAdditionalVitals((prev) => ({
                                                        ...prev,
                                                        [v.key]: e.target.value,
                                                    }))}
                                                />
                                            </Grid>
                                        ))}
                                    </Grid>
                                </Box>
                            ) : (
                                <Button
                                    size="small"
                                    startIcon={<AddIcon />}
                                    onClick={() => setShowAddVitals(true)}
                                    sx={{ mt: 1 }}
                                >
                                    Add Vitals for This Consultation
                                </Button>
                            )}
                        </AccordionDetails>
                    )}
                </Accordion>

                {/* ── Habits Section ── */}
                <Accordion defaultExpanded>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Box display="flex" alignItems="center" gap={1} width="100%">
                            <Typography variant="subtitle1" fontWeight="bold" flex={1}>
                                Habits & Lifestyle
                                {habitEntries.length > 0 && (
                                    <Chip label={habitEntries.length} size="small" sx={{ ml: 1, height: 20 }} />
                                )}
                            </Typography>
                            <Switch
                                checked={sectionVisibility.habits}
                                onChange={() => toggleSectionVisibility('habits')}
                                onClick={(e) => e.stopPropagation()}
                                size="small"
                            />
                        </Box>
                    </AccordionSummary>
                    {sectionVisibility.habits && (
                        <AccordionDetails>
                            <Box mb={1}>
                                <Button
                                    size="small"
                                    onClick={() => toggleAllInSection(setHabitsSharing, habitsSharing)}
                                >
                                    {Object.values(habitsSharing).every(Boolean) ? 'Hide All' : 'Share All'}
                                </Button>
                            </Box>

                            {habitEntries.length === 0 ? (
                                <Alert severity="info" variant="outlined">
                                    No habits recorded yet. You can add them in Profile Settings → Habits & Lifestyle.
                                </Alert>
                            ) : (
                                <List dense disablePadding>
                                    {habitEntries.map(([key, value]) => (
                                        <React.Fragment key={key}>
                                            <ListItem sx={{
                                                bgcolor: habitsSharing[key] ? 'transparent' : 'action.hover',
                                                borderRadius: 1,
                                                opacity: habitsSharing[key] ? 1 : 0.6,
                                            }}>
                                                <ListItemText
                                                    primary={HABIT_LABELS[key] || key.replace(/_/g, ' ')}
                                                    secondary={typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                                                    primaryTypographyProps={{ fontWeight: 500, fontSize: '0.9rem' }}
                                                    secondaryTypographyProps={{ fontWeight: 600, color: 'text.primary' }}
                                                />
                                                <ListItemSecondaryAction>
                                                    <IconButton
                                                        edge="end"
                                                        onClick={() => setHabitsSharing((prev) => ({ ...prev, [key]: !prev[key] }))}
                                                    >
                                                        {habitsSharing[key]
                                                            ? <VisibilityIcon color="primary" fontSize="small" />
                                                            : <VisibilityOffIcon color="disabled" fontSize="small" />
                                                        }
                                                    </IconButton>
                                                </ListItemSecondaryAction>
                                            </ListItem>
                                            <Divider component="li" />
                                        </React.Fragment>
                                    ))}
                                </List>
                            )}
                        </AccordionDetails>
                    )}
                </Accordion>

                {/* ── Health Records Section ── */}
                <Accordion defaultExpanded>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Box display="flex" alignItems="center" gap={1} width="100%">
                            <Typography variant="subtitle1" fontWeight="bold" flex={1}>
                                Health Records
                                {recordsList.length > 0 && (
                                    <Chip label={recordsList.length} size="small" sx={{ ml: 1, height: 20 }} />
                                )}
                            </Typography>
                            <Switch
                                checked={sectionVisibility.health_records}
                                onChange={() => toggleSectionVisibility('health_records')}
                                onClick={(e) => e.stopPropagation()}
                                size="small"
                            />
                        </Box>
                    </AccordionSummary>
                    {sectionVisibility.health_records && (
                        <AccordionDetails>
                            <Box mb={1} display="flex" justifyContent="space-between" alignItems="center">
                                <Button
                                    size="small"
                                    onClick={() => toggleAllInSection(setRecordsSharing, recordsSharing)}
                                >
                                    {Object.values(recordsSharing).every(Boolean) ? 'Hide All' : 'Share All'}
                                </Button>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<AddIcon />}
                                    onClick={handleOpenRecordDialog}
                                >
                                    Add Record
                                </Button>
                            </Box>

                            {recordsList.length === 0 ? (
                                <Alert severity="info" variant="outlined">
                                    No health records found. Click "Add Record" to upload lab reports, prescriptions, imaging, etc.
                                </Alert>
                            ) : (
                                <Stack spacing={1.5}>
                                    {recordsList.map((record) => (
                                        <Paper
                                            key={record.id}
                                            variant="outlined"
                                            sx={{
                                                p: 1.5,
                                                bgcolor: recordsSharing[record.id] ? 'transparent' : 'action.hover',
                                                opacity: recordsSharing[record.id] ? 1 : 0.6,
                                                transition: 'all 0.2s',
                                            }}
                                        >
                                            <Box display="flex" alignItems="flex-start" gap={1}>
                                                <Box flex={1}>
                                                    <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                                                        <Chip
                                                            label={getRecordTypeLabel(record.record_type)}
                                                            size="small"
                                                            color={RECORD_TYPE_COLORS[record.record_type] || 'default'}
                                                        />
                                                        <Typography variant="caption" color="text.secondary">
                                                            {record.record_date || record.created_at?.split('T')[0] || ''}
                                                        </Typography>
                                                    </Box>
                                                    <Typography variant="body2" fontWeight={500}>
                                                        {record.details?.title || record.notes || '—'}
                                                    </Typography>
                                                    {record.notes && record.details?.title && (
                                                        <Typography variant="caption" color="text.secondary">
                                                            {record.notes}
                                                        </Typography>
                                                    )}

                                                    {/* Attachments */}
                                                    <AttachmentManager
                                                        recordId={record.id}
                                                        attachments={record.attachment_links || []}
                                                    />
                                                </Box>

                                                {/* Visibility toggle */}
                                                <IconButton
                                                    onClick={() => setRecordsSharing((prev) => ({
                                                        ...prev,
                                                        [record.id]: !prev[record.id],
                                                    }))}
                                                >
                                                    {recordsSharing[record.id]
                                                        ? <VisibilityIcon color="primary" />
                                                        : <VisibilityOffIcon color="disabled" />
                                                    }
                                                </IconButton>
                                            </Box>
                                        </Paper>
                                    ))}
                                </Stack>
                            )}
                        </AccordionDetails>
                    )}
                </Accordion>

                {/* ── Surgeries Section ── */}
                <Accordion defaultExpanded>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Box display="flex" alignItems="center" gap={1} width="100%">
                            <Typography variant="subtitle1" fontWeight="bold" flex={1}>
                                Previous Surgeries
                                {surgeriesList.length > 0 && (
                                    <Chip label={surgeriesList.length} size="small" sx={{ ml: 1, height: 20 }} />
                                )}
                            </Typography>
                            <Switch
                                checked={sectionVisibility.surgeries}
                                onChange={() => toggleSectionVisibility('surgeries')}
                                onClick={(e) => e.stopPropagation()}
                                size="small"
                            />
                        </Box>
                    </AccordionSummary>
                    {sectionVisibility.surgeries && (
                        <AccordionDetails>
                            <Box mb={1} display="flex" justifyContent="space-between" alignItems="center">
                                <Button
                                    size="small"
                                    onClick={() => toggleAllInSection(setSurgeriesSharing, surgeriesSharing)}
                                >
                                    {Object.values(surgeriesSharing).every(Boolean) ? 'Hide All' : 'Share All'}
                                </Button>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<AddIcon />}
                                    onClick={handleOpenSurgeryDialog}
                                >
                                    Add Surgery
                                </Button>
                            </Box>

                            {surgeriesList.length === 0 ? (
                                <Alert severity="info" variant="outlined">
                                    No surgery records found. Click "Add Surgery" to add one.
                                </Alert>
                            ) : (
                                <Stack spacing={1.5}>
                                    {surgeriesList.map((surgery) => (
                                        <Paper
                                            key={surgery.id}
                                            variant="outlined"
                                            sx={{
                                                p: 1.5,
                                                bgcolor: surgeriesSharing[surgery.id] ? 'transparent' : 'action.hover',
                                                opacity: surgeriesSharing[surgery.id] ? 1 : 0.6,
                                                transition: 'all 0.2s',
                                            }}
                                        >
                                            <Box display="flex" alignItems="flex-start" gap={1}>
                                                <Box flex={1}>
                                                    <Typography variant="body2" fontWeight={600}>
                                                        {surgery.details?.surgery_type || surgery.surgery_type || 'Surgery'}
                                                    </Typography>
                                                    <Box display="flex" gap={2} flexWrap="wrap" mt={0.5}>
                                                        <Typography variant="caption" color="text.secondary">
                                                            Date: {surgery.details?.surgery_date || surgery.record_date || '—'}
                                                        </Typography>
                                                        {(surgery.details?.hospital) && (
                                                            <Typography variant="caption" color="text.secondary">
                                                                Hospital: {surgery.details.hospital}
                                                            </Typography>
                                                        )}
                                                        {(surgery.details?.surgeon_name) && (
                                                            <Typography variant="caption" color="text.secondary">
                                                                Surgeon: {surgery.details.surgeon_name}
                                                            </Typography>
                                                        )}
                                                    </Box>
                                                    {(surgery.notes || surgery.details?.notes) && (
                                                        <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                                                            {surgery.notes || surgery.details.notes}
                                                        </Typography>
                                                    )}

                                                    {/* Attachments */}
                                                    <AttachmentManager
                                                        recordId={surgery.id}
                                                        attachments={surgery.attachment_links || []}
                                                    />
                                                </Box>

                                                {/* Visibility toggle */}
                                                <IconButton
                                                    onClick={() => setSurgeriesSharing((prev) => ({
                                                        ...prev,
                                                        [surgery.id]: !prev[surgery.id],
                                                    }))}
                                                >
                                                    {surgeriesSharing[surgery.id]
                                                        ? <VisibilityIcon color="primary" />
                                                        : <VisibilityOffIcon color="disabled" />
                                                    }
                                                </IconButton>
                                            </Box>
                                        </Paper>
                                    ))}
                                </Stack>
                            )}
                        </AccordionDetails>
                    )}
                </Accordion>

                {/* Continue Button */}
                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                        variant="contained"
                        size="large"
                        onClick={handleContinue}
                        disabled={isSaving}
                    >
                        {isSaving ? 'Saving...' : 'Continue to Symptoms'}
                    </Button>
                </Box>

                {/* ═══ Add Health Record Dialog ═══ */}
                <Dialog open={recordDialogOpen} onClose={() => setRecordDialogOpen(false)} maxWidth="sm" fullWidth>
                    <DialogTitle>Add Health Record</DialogTitle>
                    <DialogContent dividers>
                        <Grid container spacing={2} sx={{ mt: 0.5 }}>
                            <Grid item xs={12}>
                                <FormControl fullWidth required>
                                    <InputLabel>Record Type</InputLabel>
                                    <Select
                                        value={newRecord.record_type}
                                        label="Record Type"
                                        onChange={(e) => setNewRecord((p) => ({ ...p, record_type: e.target.value }))}
                                    >
                                        {RECORD_TYPES.map((rt) => (
                                            <MenuItem key={rt.value} value={rt.value}>{rt.label}</MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <DatePicker
                                    label="Record Date"
                                    value={newRecord.record_date}
                                    onChange={(d) => setNewRecord((p) => ({ ...p, record_date: d }))}
                                    slotProps={{ textField: { fullWidth: true, required: true } }}
                                />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    fullWidth
                                    label="Title / Description"
                                    value={newRecord.title}
                                    onChange={(e) => setNewRecord((p) => ({ ...p, title: e.target.value }))}
                                    placeholder="e.g. CBC Report, X-Ray Chest"
                                />
                            </Grid>
                            <Grid item xs={12}>
                                <TextField
                                    fullWidth
                                    label="Notes"
                                    value={newRecord.notes}
                                    onChange={(e) => setNewRecord((p) => ({ ...p, notes: e.target.value }))}
                                    multiline
                                    rows={2}
                                />
                            </Grid>
                            <Grid item xs={12}>
                                <DialogAttachmentQueue
                                    attachments={recordDialogAttachments}
                                    onAdd={(att) => setRecordDialogAttachments((p) => [...p, att])}
                                    onRemove={(idx) => setRecordDialogAttachments((p) => p.filter((_, i) => i !== idx))}
                                />
                            </Grid>
                        </Grid>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setRecordDialogOpen(false)}>Cancel</Button>
                        <Button
                            variant="contained"
                            onClick={handleSubmitRecord}
                            disabled={isAddingRecord || !newRecord.record_type}
                        >
                            {isAddingRecord ? 'Adding...' : 'Add Record'}
                        </Button>
                    </DialogActions>
                </Dialog>

                {/* ═══ Add Surgery Dialog ═══ */}
                <Dialog open={surgeryDialogOpen} onClose={() => setSurgeryDialogOpen(false)} maxWidth="sm" fullWidth>
                    <DialogTitle>Add Surgery</DialogTitle>
                    <DialogContent dividers>
                        <Grid container spacing={2} sx={{ mt: 0.5 }}>
                            <Grid item xs={12}>
                                <TextField
                                    fullWidth
                                    required
                                    label="Surgery Type"
                                    value={newSurgery.surgery_type}
                                    onChange={(e) => setNewSurgery((p) => ({ ...p, surgery_type: e.target.value }))}
                                    placeholder="e.g. Appendectomy, Knee Replacement"
                                />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <DatePicker
                                    label="Surgery Date"
                                    value={newSurgery.surgery_date}
                                    onChange={(d) => setNewSurgery((p) => ({ ...p, surgery_date: d }))}
                                    slotProps={{ textField: { fullWidth: true } }}
                                />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    fullWidth
                                    label="Hospital"
                                    value={newSurgery.hospital}
                                    onChange={(e) => setNewSurgery((p) => ({ ...p, hospital: e.target.value }))}
                                />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    fullWidth
                                    label="Surgeon Name"
                                    value={newSurgery.surgeon_name}
                                    onChange={(e) => setNewSurgery((p) => ({ ...p, surgeon_name: e.target.value }))}
                                />
                            </Grid>
                            <Grid item xs={12}>
                                <TextField
                                    fullWidth
                                    label="Notes"
                                    value={newSurgery.notes}
                                    onChange={(e) => setNewSurgery((p) => ({ ...p, notes: e.target.value }))}
                                    multiline
                                    rows={2}
                                />
                            </Grid>
                            <Grid item xs={12}>
                                <DialogAttachmentQueue
                                    attachments={surgeryDialogAttachments}
                                    onAdd={(att) => setSurgeryDialogAttachments((p) => [...p, att])}
                                    onRemove={(idx) => setSurgeryDialogAttachments((p) => p.filter((_, i) => i !== idx))}
                                />
                            </Grid>
                        </Grid>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setSurgeryDialogOpen(false)}>Cancel</Button>
                        <Button
                            variant="contained"
                            onClick={handleSubmitSurgery}
                            disabled={isAddingSurgery || !newSurgery.surgery_type}
                        >
                            {isAddingSurgery ? 'Adding...' : 'Add Surgery'}
                        </Button>
                    </DialogActions>
                </Dialog>
            </Container>
        </LocalizationProvider>
    );
};

export default MedicalRecordsSharingPage;
