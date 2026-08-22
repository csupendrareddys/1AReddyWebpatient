import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    Box, Container, Typography, Paper, CircularProgress, Grid,
    Card, CardActionArea, CardContent, IconButton, Button, TextField,
    Chip, Divider, Tabs, Tab, Switch,
    Accordion, AccordionSummary, AccordionDetails,
    List, ListItem, ListItemText, ListItemSecondaryAction,
    Alert, Stack, Tooltip, LinearProgress,
    Dialog, DialogTitle, DialogContent, DialogActions,
    FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteIcon from '@mui/icons-material/Delete';
import DescriptionIcon from '@mui/icons-material/Description';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import NoteAddIcon from '@mui/icons-material/NoteAdd';

import { useGetSymptomsQuery, useUpdateAppointmentContextMutation } from '../../api/scopedBookingApi';
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
import useBookingFlow from '../../hooks/useBookingFlow';
import usePageConfig from '../../../auth/hooks/usePageConfig';
import { toLocalDateString, todayLocalDateString } from '../../../../common/utils/date';

// ─── Constants ───
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
    const [replaceId, setReplaceId] = useState(null);
    const fileInputRef = useRef(null);

    const handleUpload = useCallback(async () => {
        if (!selectedFile) return;
        try {
            if (replaceId) {
                try {
                    await deleteAttachment({ recordId, attachmentId: replaceId }).unwrap();
                } catch { /* ignore delete failure on replace */ }
            }
            await uploadAttachment({ recordId, file: selectedFile, description }).unwrap();
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
            {attachments.length > 0 && (
                <Stack spacing={0.5} sx={{ mb: 1 }}>
                    {attachments.map((att) => (
                        <Box
                            key={att.id}
                            sx={{
                                display: 'flex', alignItems: 'center', gap: 0.5,
                                p: 0.5, px: 1, bgcolor: 'grey.50', borderRadius: 1,
                                border: '1px solid', borderColor: 'divider',
                            }}
                        >
                            <DescriptionIcon fontSize="small" color="action" />
                            <Typography variant="caption" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {att.description || att.filename || 'Attachment'}
                                {att.file_size_bytes && (
                                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                                        ({(att.file_size_bytes / 1024).toFixed(0)} KB)
                                    </Typography>
                                )}
                            </Typography>
                            <Tooltip title="View / Download">
                                <IconButton size="small" onClick={() => att.url && window.open(att.url, '_blank')} disabled={!att.url}>
                                    <OpenInNewIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Replace file">
                                <IconButton size="small" onClick={() => handleReplace(att.id)}>
                                    <SwapHorizIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete">
                                <IconButton size="small" color="error" onClick={() => handleDelete(att.id)}>
                                    <DeleteIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    ))}
                </Stack>
            )}

            {!showUpload ? (
                <Button
                    size="small" startIcon={<AttachFileIcon />}
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
                        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
                        <Button variant="outlined" size="small" startIcon={<CloudUploadIcon />} onClick={() => fileInputRef.current?.click()} sx={{ textTransform: 'none' }}>
                            {selectedFile ? selectedFile.name : 'Choose File'}
                        </Button>
                        <TextField size="small" label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Blood test results, X-Ray image" fullWidth />
                        {isUploading && <LinearProgress />}
                        <Stack direction="row" spacing={1}>
                            <Button size="small" variant="contained" onClick={handleUpload} disabled={!selectedFile || isUploading}>
                                {isUploading ? 'Uploading...' : replaceId ? 'Replace' : 'Upload'}
                            </Button>
                            <Button size="small" onClick={handleCancelUpload}>Cancel</Button>
                        </Stack>
                    </Stack>
                </Box>
            )}
        </Box>
    );
};

/* ─────────── Dialog Attachment Queue ─────────── */
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
                            key={idx} icon={<DescriptionIcon fontSize="small" />}
                            label={`${att.file.name}${att.description ? ` — ${att.description}` : ''}`}
                            size="small" variant="outlined" onDelete={() => onRemove(idx)}
                            sx={{ maxWidth: '100%' }}
                        />
                    ))}
                </Stack>
            )}
            <Stack direction="row" spacing={1} alignItems="flex-end">
                <input ref={fileRef} type="file" style={{ display: 'none' }} />
                <Button variant="outlined" size="small" startIcon={<CloudUploadIcon />} onClick={() => fileRef.current?.click()} sx={{ textTransform: 'none', flexShrink: 0 }}>
                    Choose File
                </Button>
                <TextField size="small" label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional" sx={{ flex: 1 }} />
                <Button size="small" variant="contained" onClick={handleAdd} sx={{ flexShrink: 0 }}>Add</Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                Files will be uploaded when you save the record.
            </Typography>
        </Box>
    );
};

/* ═══════════════ Main Component ═══════════════ */
/**
 * Symptoms + medical-records screen. Renders either:
 *  - as a full page (legacy standalone route), or
 *  - as a popup (`asDialog`) launched from the Matched Doctors page.
 * In dialog mode it saves to the medical context + Redux and calls `onSaved`
 * / `onClose` instead of navigating to the next step.
 */
const SymptomsAndRecordsPage = ({ asDialog = false, open = false, onClose, onSaved }) => {
    const {
        consultationType,
        medicalContextId,
        bookingFor,
        selectedMember,
        additionalDetails: savedDetails,
        selectedSymptoms: savedSymptoms,
        customSymptoms: savedCustomSymptoms,
        additionalVitals: savedAdditionalVitals,
        sharingToggles: savedSharingToggles,
        sectionVisibility: savedSectionVisibility,
        handleCompleteSymptomsAndRecords,
        saveSymptoms,
        handleGoBack,
        setAdditionalDetails: persistDetails,
        persistSharingToggles,
        persistSectionVisibility,
    } = useBookingFlow();

    const [updateContext, { isLoading: isSaving }] = useUpdateAppointmentContextMutation();

    // ─── Symptoms data ───
    const { data: symptomsResp, isLoading: isLoadingSymptoms } = useGetSymptomsQuery();
    const { config: symptomsConfig } = usePageConfig('patient_appointment_symptoms');
    const symptoms = symptomsResp?.data?.symptoms || symptomsResp?.symptoms || symptomsResp || [];

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
    const [selectedSymptoms, setSelectedSymptoms] = useState(savedSymptoms || []);
    const [customSymptoms, setCustomSymptoms] = useState(
        Array.isArray(savedCustomSymptoms) ? savedCustomSymptoms.join(', ') : (savedCustomSymptoms || '')
    );

    const toggleSymptom = (symptom) => {
        setSelectedSymptoms((prev) => {
            const exists = prev.find((s) => s.id === symptom.id);
            if (exists) return prev.filter((s) => s.id !== symptom.id);
            return [...prev, { id: symptom.id, name: symptom.name, category: symptom.category, severity: 'moderate' }];
        });
    };

    const isSelected = (symptomId) => selectedSymptoms.some((s) => s.id === symptomId);

    // ─── Add More Details ───
    const [details, setDetails] = useState({ description: savedDetails?.description || '', remarks: savedDetails?.remarks || '' });
    const [detailsAttachments, setDetailsAttachments] = useState([]);
    const detailsFileRef = useRef(null);

    const handleAddDetailsAttachment = () => {
        const file = detailsFileRef.current?.files?.[0];
        if (!file) return;
        setDetailsAttachments((prev) => [...prev, file]);
        if (detailsFileRef.current) detailsFileRef.current.value = '';
    };

    // ─── Medical Records data ───
    const { data: vitalsResp, isLoading: isLoadingVitals } = useGetVitalsQuery();
    const { data: habitsResp, isLoading: isLoadingHabits } = useGetHabitsQuery();
    const { data: recordsResp, isLoading: isLoadingRecords } = useGetHealthRecordsQuery({});
    const { data: surgeriesResp, isLoading: isLoadingSurgeries } = useGetSurgeriesQuery();

    const [addRecord, { isLoading: isAddingRecord }] = useAddHealthRecordMutation();
    const [addSurgery, { isLoading: isAddingSurgery }] = useAddSurgeryMutation();
    const [uploadAttachment] = useUploadHealthRecordAttachmentMutation();

    const vitals = vitalsResp?.vitals || vitalsResp?.data?.vitals || vitalsResp || {};
    const habits = habitsResp?.habits || habitsResp?.data?.habits || habitsResp || {};
    const healthRecords = recordsResp?.health_records || recordsResp?.data?.health_records || recordsResp?.records || recordsResp?.data?.records || [];
    const surgeries = surgeriesResp?.surgeries || surgeriesResp?.data?.surgeries || surgeriesResp || [];

    const isLoading = isLoadingSymptoms || isLoadingVitals || isLoadingHabits || isLoadingRecords || isLoadingSurgeries;

    // ─── Sharing toggles (restore from Redux if navigating back) ───
    const [vitalsSharing, setVitalsSharing] = useState(savedSharingToggles?.vitals || {});
    const [habitsSharing, setHabitsSharing] = useState(savedSharingToggles?.habits || {});
    const [recordsSharing, setRecordsSharing] = useState(savedSharingToggles?.records || {});
    const [surgeriesSharing, setSurgeriesSharing] = useState(savedSharingToggles?.surgeries || {});
    const [additionalVitals, setAdditionalVitals] = useState(savedAdditionalVitals || {});
    const [showAddVitals, setShowAddVitals] = useState(false);
    const hasSavedToggles = !!savedSharingToggles;

    const [sectionVisibility, setSectionVisibility] = useState(
        savedSectionVisibility || { vitals: true, habits: true, health_records: true, surgeries: true }
    );

    // ─── Add Health Record Dialog ───
    const [recordDialogOpen, setRecordDialogOpen] = useState(false);
    const [newRecord, setNewRecord] = useState({ record_type: '', record_date: null, title: '', notes: '' });
    const [recordDialogAttachments, setRecordDialogAttachments] = useState([]);

    // ─── Add Surgery Dialog ───
    const [surgeryDialogOpen, setSurgeryDialogOpen] = useState(false);
    const [newSurgery, setNewSurgery] = useState({ surgery_type: '', surgery_date: null, hospital: '', surgeon_name: '', notes: '' });
    const [surgeryDialogAttachments, setSurgeryDialogAttachments] = useState([]);

    // Initialize toggles only on first visit (no saved Redux state).
    // When navigating back, the useState defaults already restored from Redux.
    useEffect(() => {
        if (hasSavedToggles) return; // already restored from Redux
        if (typeof vitals === 'object' && vitals !== null && !Array.isArray(vitals)) {
            const toggles = {};
            Object.entries(vitals).forEach(([key, value]) => {
                if (value != null && value !== '' && VITAL_LABELS[key]) toggles[key] = true;
            });
            if (Object.keys(toggles).length > 0) setVitalsSharing(toggles);
        }
    }, [vitals, hasSavedToggles]);

    useEffect(() => {
        if (hasSavedToggles) return;
        if (typeof habits === 'object' && habits !== null && !Array.isArray(habits)) {
            const toggles = {};
            Object.entries(habits).forEach(([key, value]) => {
                if (value != null && value !== '' && HABIT_LABELS[key]) toggles[key] = true;
            });
            if (Object.keys(toggles).length > 0) setHabitsSharing(toggles);
        }
    }, [habits, hasSavedToggles]);

    useEffect(() => {
        if (hasSavedToggles) return;
        if (Array.isArray(healthRecords) && healthRecords.length > 0) {
            const toggles = {};
            healthRecords.forEach((r) => { toggles[r.id] = true; });
            setRecordsSharing(toggles);
        }
    }, [healthRecords, hasSavedToggles]);

    useEffect(() => {
        if (hasSavedToggles) return;
        if (Array.isArray(surgeries) && surgeries.length > 0) {
            const toggles = {};
            surgeries.forEach((s) => { toggles[s.id] = true; });
            setSurgeriesSharing(toggles);
        }
    }, [surgeries, hasSavedToggles]);

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
            if (createdId && recordDialogAttachments.length > 0) {
                for (const att of recordDialogAttachments) {
                    try { await uploadAttachment({ recordId: createdId, file: att.file, description: att.description }).unwrap(); }
                    catch (uploadErr) { console.error('Failed to upload attachment:', uploadErr); }
                }
            }
            setRecordDialogOpen(false);
        } catch (err) { console.error('Failed to add health record:', err); }
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
            if (payload.surgery_date) payload.surgery_date = toLocalDateString(payload.surgery_date);
            const result = await addSurgery(payload).unwrap();
            const createdId = result?.data?.id || result?.id;
            if (createdId && surgeryDialogAttachments.length > 0) {
                for (const att of surgeryDialogAttachments) {
                    try { await uploadAttachment({ recordId: createdId, file: att.file, description: att.description }).unwrap(); }
                    catch (uploadErr) { console.error('Failed to upload surgery attachment:', uploadErr); }
                }
            }
            setSurgeryDialogOpen(false);
        } catch (err) { console.error('Failed to add surgery:', err); }
    }, [newSurgery, addSurgery, surgeryDialogAttachments, uploadAttachment]);

    // ─── Continue: save everything and proceed ───
    const handleContinue = async () => {
        const customList = customSymptoms.split(',').map((s) => s.trim()).filter(Boolean);

        if (medicalContextId) {
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
                    // Symptoms
                    selected_symptoms: selectedSymptoms.map((s) => ({ symptom_id: s.id, severity: s.severity, notes: '' })),
                    selected_custom_symptoms: customList,
                    // Medical records sharing
                    shared_vitals: sharedVitals,
                    shared_habits: sharedHabits,
                    shared_health_records: sharedRecords,
                    shared_prescriptions: sharedSurgeries,
                    additional_vitals: Object.keys(additionalVitals).length > 0 ? additionalVitals : null,
                    // Additional details
                    additional_details: {
                        description: details.description,
                        remarks: details.remarks,
                    },
                }).unwrap();
            } catch (err) {
                console.error('Failed to save context:', err);
            }
        }

        // Persist all local state to Redux (for back-navigation / reopening).
        persistDetails({ description: details.description, remarks: details.remarks });
        persistSharingToggles({
            vitals: vitalsSharing,
            habits: habitsSharing,
            records: recordsSharing,
            surgeries: surgeriesSharing,
        });
        persistSectionVisibility(sectionVisibility);

        if (asDialog) {
            // Popup mode: save symptoms to Redux and hand control back to the
            // Matched Doctors page (which re-runs the match query).
            saveSymptoms(selectedSymptoms, customList);
            onSaved?.(selectedSymptoms, customList);
            onClose?.();
        } else {
            handleCompleteSymptomsAndRecords(selectedSymptoms, customList);
        }
    };

    // Filtered entries
    const vitalEntries = Object.entries(vitals || {}).filter(([key, value]) => value != null && value !== '' && VITAL_LABELS[key]);
    const habitEntries = Object.entries(habits || {}).filter(([key, value]) => value != null && value !== '' && HABIT_LABELS[key]);
    const recordsList = Array.isArray(healthRecords) ? healthRecords : [];
    const surgeriesList = Array.isArray(surgeries) ? surgeries : [];

    // Dialog header (popup mode) — mirrors the page header's copy.
    const dialogTitle = (
        <DialogTitle component="div" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <Box flex={1}>
                <Typography variant="h6" fontWeight="bold">Symptoms &amp; Medical Records</Typography>
                <Typography variant="body2" color="text.secondary">
                    Select your symptoms, add details, and choose which medical records to share.
                </Typography>
                {bookingFor !== 'self' && selectedMember && (
                    <Chip
                        label={`Booking for: ${selectedMember.first_name} ${selectedMember.last_name || ''}`}
                        size="small" color="primary" variant="outlined" sx={{ mt: 0.5 }}
                    />
                )}
            </Box>
            <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
        </DialogTitle>
    );

    if (isLoading) {
        const spinner = <Box display="flex" justifyContent="center" my={8}><CircularProgress /></Box>;
        if (asDialog) {
            return (
                <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
                    {dialogTitle}
                    <DialogContent dividers>{spinner}</DialogContent>
                </Dialog>
            );
        }
        return spinner;
    }

    const mainContent = (
        <>
                {/* Header (page mode only — dialog uses its own title) */}
                {!asDialog && (
                <Paper sx={{ p: 3, mb: 3 }}>
                    <Box display="flex" alignItems="center" gap={2}>
                        <IconButton onClick={() => handleGoBack(3)}>
                            <ArrowBackIcon />
                        </IconButton>
                        <Box>
                            <Typography variant="h5" fontWeight="bold">
                                Symptoms & Medical Records
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Select your symptoms, add details, and choose which medical records to share with the doctor.
                            </Typography>
                            {bookingFor !== 'self' && selectedMember && (
                                <Chip
                                    label={`Booking for: ${selectedMember.first_name} ${selectedMember.last_name || ''}`}
                                    size="small" color="primary" variant="outlined" sx={{ mt: 0.5 }}
                                />
                            )}
                        </Box>
                    </Box>
                </Paper>
                )}

                {/* ═══════════ SECTION A: SYMPTOMS ═══════════ */}
                <Typography variant="h6" fontWeight="bold" sx={{ mb: 1.5 }}>
                    Select Symptoms
                </Typography>

                {/* Selected Symptoms Summary */}
                {selectedSymptoms.length > 0 && (
                    <Paper sx={{ p: 2, mb: 2 }}>
                        <Typography variant="subtitle2" fontWeight="bold" mb={1}>
                            Selected ({selectedSymptoms.length})
                        </Typography>
                        <Box display="flex" gap={0.5} flexWrap="wrap">
                            {selectedSymptoms.map((s) => (
                                <Chip key={s.id} label={s.name} size="small" color="primary" variant="outlined" onDelete={() => toggleSymptom(s)} />
                            ))}
                        </Box>
                    </Paper>
                )}

                {/* Category Tabs */}
                {categories.length > 0 && (
                    <Paper sx={{ mb: 2 }}>
                        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto">
                            {categories.map((cat) => <Tab key={cat} label={cat} />)}
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
                                    <Card variant="outlined" sx={{
                                        borderColor: selected ? 'primary.main' : 'divider',
                                        borderWidth: selected ? 2 : 1,
                                        bgcolor: selected ? 'primary.50' : 'transparent',
                                    }}>
                                        <CardActionArea onClick={() => toggleSymptom(symptom)} sx={{ p: 1 }}>
                                            <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                                                <Box display="flex" flexDirection="column" alignItems="center" textAlign="center">
                                                    {symptom.image_url && (
                                                        <Box component="img" src={symptom.image_url} alt={symptom.name}
                                                            sx={{ width: 48, height: 48, borderRadius: 2, objectFit: 'cover', mb: 0.5 }} />
                                                    )}
                                                    <Typography variant="caption" fontWeight={selected ? 'bold' : 'normal'}>
                                                        {symptom.name}
                                                    </Typography>
                                                    {selected
                                                        ? <CheckCircleIcon sx={{ fontSize: 16, color: 'primary.main', mt: 0.25 }} />
                                                        : <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: 'action.disabled', mt: 0.25 }} />
                                                    }
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
                <Paper sx={{ p: 2, mt: 2 }}>
                    <Typography variant="subtitle2" fontWeight="bold" mb={1}>Other Symptoms</Typography>
                    <TextField fullWidth multiline rows={2} placeholder="Describe any other symptoms (separate with commas)..."
                        value={customSymptoms} onChange={(e) => setCustomSymptoms(e.target.value)} variant="outlined" size="small" />
                </Paper>

                <Divider sx={{ my: 4 }} />

                {/* ═══════════ SECTION B: ADD MORE DETAILS ═══════════ */}
                <Paper sx={{ p: 3, mb: 3 }}>
                    <Box display="flex" alignItems="center" gap={1} mb={2}>
                        <NoteAddIcon color="primary" />
                        <Typography variant="h6" fontWeight="bold">Add More Details</Typography>
                    </Box>

                    <Stack spacing={2.5}>
                        <TextField
                            fullWidth multiline rows={3}
                            label="Description"
                            placeholder="Describe your condition or concern in detail..."
                            value={details.description}
                            onChange={(e) => setDetails((prev) => ({ ...prev, description: e.target.value }))}
                            variant="outlined"
                        />

                        <TextField
                            fullWidth multiline rows={2}
                            label="Remarks"
                            placeholder="Any additional remarks or notes for the doctor..."
                            value={details.remarks}
                            onChange={(e) => setDetails((prev) => ({ ...prev, remarks: e.target.value }))}
                            variant="outlined"
                        />

                        {/* Attachments */}
                        <Box>
                            <Typography variant="subtitle2" fontWeight="bold" mb={1}>Attachments</Typography>
                            {detailsAttachments.length > 0 && (
                                <Stack spacing={0.5} sx={{ mb: 1.5 }}>
                                    {detailsAttachments.map((file, idx) => (
                                        <Chip
                                            key={idx} icon={<DescriptionIcon fontSize="small" />}
                                            label={`${file.name} (${(file.size / 1024).toFixed(0)} KB)`}
                                            size="small" variant="outlined"
                                            onDelete={() => setDetailsAttachments((prev) => prev.filter((_, i) => i !== idx))}
                                        />
                                    ))}
                                </Stack>
                            )}
                            <input ref={detailsFileRef} type="file" style={{ display: 'none' }} onChange={handleAddDetailsAttachment} />
                            <Button variant="outlined" size="small" startIcon={<CloudUploadIcon />}
                                onClick={() => detailsFileRef.current?.click()} sx={{ textTransform: 'none' }}>
                                Add Attachment
                            </Button>
                        </Box>
                    </Stack>
                </Paper>

                <Divider sx={{ my: 4 }} />

                {/* ═══════════ SECTION C: MEDICAL RECORDS ═══════════ */}
                <Typography variant="h6" fontWeight="bold" sx={{ mb: 1.5 }}>
                    Medical Records
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Choose what to share with the doctor. Toggle individual items on/off.
                </Typography>

                {/* ── Vitals Section ── */}
                <Accordion defaultExpanded>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Box display="flex" alignItems="center" gap={1} width="100%">
                            <Typography variant="subtitle1" fontWeight="bold" flex={1}>
                                Vitals
                                {vitalEntries.length > 0 && <Chip label={vitalEntries.length} size="small" sx={{ ml: 1, height: 20 }} />}
                            </Typography>
                            <Switch checked={sectionVisibility.vitals} onChange={() => toggleSectionVisibility('vitals')}
                                onClick={(e) => e.stopPropagation()} size="small" />
                        </Box>
                    </AccordionSummary>
                    {sectionVisibility.vitals && (
                        <AccordionDetails>
                            <Box mb={1}>
                                <Button size="small" onClick={() => toggleAllInSection(setVitalsSharing, vitalsSharing)}>
                                    {Object.values(vitalsSharing).every(Boolean) ? 'Hide All' : 'Share All'}
                                </Button>
                            </Box>
                            {vitalEntries.length === 0 ? (
                                <Alert severity="info" variant="outlined" sx={{ mb: 1 }}>
                                    No vitals recorded yet. You can add them in Profile Settings, or add for this consultation below.
                                </Alert>
                            ) : (
                                <List dense disablePadding>
                                    {vitalEntries.map(([key, value]) => (
                                        <React.Fragment key={key}>
                                            <ListItem sx={{ bgcolor: vitalsSharing[key] ? 'transparent' : 'action.hover', borderRadius: 1, opacity: vitalsSharing[key] ? 1 : 0.6 }}>
                                                <ListItemText
                                                    primary={VITAL_LABELS[key] || key.replace(/_/g, ' ')} secondary={String(value)}
                                                    primaryTypographyProps={{ fontWeight: 500, fontSize: '0.9rem' }}
                                                    secondaryTypographyProps={{ fontWeight: 600, color: 'text.primary' }}
                                                />
                                                <ListItemSecondaryAction>
                                                    <IconButton edge="end" onClick={() => setVitalsSharing((prev) => ({ ...prev, [key]: !prev[key] }))}>
                                                        {vitalsSharing[key] ? <VisibilityIcon color="primary" fontSize="small" /> : <VisibilityOffIcon color="disabled" fontSize="small" />}
                                                    </IconButton>
                                                </ListItemSecondaryAction>
                                            </ListItem>
                                            <Divider component="li" />
                                        </React.Fragment>
                                    ))}
                                </List>
                            )}
                            {showAddVitals ? (
                                <Box sx={{ p: 2, bgcolor: '#f5f5f5', borderRadius: 1, mt: 2 }}>
                                    <Typography variant="subtitle2" fontWeight="bold" mb={1.5}>Add vitals for this consultation</Typography>
                                    <Grid container spacing={1.5}>
                                        {[
                                            { key: 'blood_pressure', label: 'Blood Pressure' },
                                            { key: 'temperature', label: 'Temperature (°F)' },
                                            { key: 'heart_rate', label: 'Heart Rate (bpm)' },
                                            { key: 'blood_sugar', label: 'Blood Sugar (mg/dL)' },
                                            { key: 'spo2', label: 'SpO2 (%)' },
                                        ].map((v) => (
                                            <Grid item xs={6} sm={4} key={v.key}>
                                                <TextField label={v.label} size="small" fullWidth value={additionalVitals[v.key] || ''}
                                                    onChange={(e) => setAdditionalVitals((prev) => ({ ...prev, [v.key]: e.target.value }))} />
                                            </Grid>
                                        ))}
                                    </Grid>
                                </Box>
                            ) : (
                                <Button size="small" startIcon={<AddIcon />} onClick={() => setShowAddVitals(true)} sx={{ mt: 1 }}>
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
                                {habitEntries.length > 0 && <Chip label={habitEntries.length} size="small" sx={{ ml: 1, height: 20 }} />}
                            </Typography>
                            <Switch checked={sectionVisibility.habits} onChange={() => toggleSectionVisibility('habits')}
                                onClick={(e) => e.stopPropagation()} size="small" />
                        </Box>
                    </AccordionSummary>
                    {sectionVisibility.habits && (
                        <AccordionDetails>
                            <Box mb={1}>
                                <Button size="small" onClick={() => toggleAllInSection(setHabitsSharing, habitsSharing)}>
                                    {Object.values(habitsSharing).every(Boolean) ? 'Hide All' : 'Share All'}
                                </Button>
                            </Box>
                            {habitEntries.length === 0 ? (
                                <Alert severity="info" variant="outlined">No habits recorded yet. You can add them in Profile Settings.</Alert>
                            ) : (
                                <List dense disablePadding>
                                    {habitEntries.map(([key, value]) => (
                                        <React.Fragment key={key}>
                                            <ListItem sx={{ bgcolor: habitsSharing[key] ? 'transparent' : 'action.hover', borderRadius: 1, opacity: habitsSharing[key] ? 1 : 0.6 }}>
                                                <ListItemText
                                                    primary={HABIT_LABELS[key] || key.replace(/_/g, ' ')}
                                                    secondary={typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                                                    primaryTypographyProps={{ fontWeight: 500, fontSize: '0.9rem' }}
                                                    secondaryTypographyProps={{ fontWeight: 600, color: 'text.primary' }}
                                                />
                                                <ListItemSecondaryAction>
                                                    <IconButton edge="end" onClick={() => setHabitsSharing((prev) => ({ ...prev, [key]: !prev[key] }))}>
                                                        {habitsSharing[key] ? <VisibilityIcon color="primary" fontSize="small" /> : <VisibilityOffIcon color="disabled" fontSize="small" />}
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
                                {recordsList.length > 0 && <Chip label={recordsList.length} size="small" sx={{ ml: 1, height: 20 }} />}
                            </Typography>
                            <Switch checked={sectionVisibility.health_records} onChange={() => toggleSectionVisibility('health_records')}
                                onClick={(e) => e.stopPropagation()} size="small" />
                        </Box>
                    </AccordionSummary>
                    {sectionVisibility.health_records && (
                        <AccordionDetails>
                            <Box mb={1} display="flex" justifyContent="space-between" alignItems="center">
                                <Button size="small" onClick={() => toggleAllInSection(setRecordsSharing, recordsSharing)}>
                                    {Object.values(recordsSharing).every(Boolean) ? 'Hide All' : 'Share All'}
                                </Button>
                                <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={handleOpenRecordDialog}>
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
                                        <Paper key={record.id} variant="outlined" sx={{
                                            p: 1.5, bgcolor: recordsSharing[record.id] ? 'transparent' : 'action.hover',
                                            opacity: recordsSharing[record.id] ? 1 : 0.6, transition: 'all 0.2s',
                                        }}>
                                            <Box display="flex" alignItems="flex-start" gap={1}>
                                                <Box flex={1}>
                                                    <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                                                        <Chip label={getRecordTypeLabel(record.record_type)} size="small" color={RECORD_TYPE_COLORS[record.record_type] || 'default'} />
                                                        <Typography variant="caption" color="text.secondary">
                                                            {record.record_date || record.created_at?.split('T')[0] || ''}
                                                        </Typography>
                                                    </Box>
                                                    <Typography variant="body2" fontWeight={500}>{record.details?.title || record.notes || '—'}</Typography>
                                                    {record.notes && record.details?.title && (
                                                        <Typography variant="caption" color="text.secondary">{record.notes}</Typography>
                                                    )}
                                                    <AttachmentManager recordId={record.id} attachments={record.attachment_links || []} />
                                                </Box>
                                                <IconButton onClick={() => setRecordsSharing((prev) => ({ ...prev, [record.id]: !prev[record.id] }))}>
                                                    {recordsSharing[record.id] ? <VisibilityIcon color="primary" /> : <VisibilityOffIcon color="disabled" />}
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
                                {surgeriesList.length > 0 && <Chip label={surgeriesList.length} size="small" sx={{ ml: 1, height: 20 }} />}
                            </Typography>
                            <Switch checked={sectionVisibility.surgeries} onChange={() => toggleSectionVisibility('surgeries')}
                                onClick={(e) => e.stopPropagation()} size="small" />
                        </Box>
                    </AccordionSummary>
                    {sectionVisibility.surgeries && (
                        <AccordionDetails>
                            <Box mb={1} display="flex" justifyContent="space-between" alignItems="center">
                                <Button size="small" onClick={() => toggleAllInSection(setSurgeriesSharing, surgeriesSharing)}>
                                    {Object.values(surgeriesSharing).every(Boolean) ? 'Hide All' : 'Share All'}
                                </Button>
                                <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={handleOpenSurgeryDialog}>
                                    Add Surgery
                                </Button>
                            </Box>
                            {surgeriesList.length === 0 ? (
                                <Alert severity="info" variant="outlined">No surgery records found. Click "Add Surgery" to add one.</Alert>
                            ) : (
                                <Stack spacing={1.5}>
                                    {surgeriesList.map((surgery) => (
                                        <Paper key={surgery.id} variant="outlined" sx={{
                                            p: 1.5, bgcolor: surgeriesSharing[surgery.id] ? 'transparent' : 'action.hover',
                                            opacity: surgeriesSharing[surgery.id] ? 1 : 0.6, transition: 'all 0.2s',
                                        }}>
                                            <Box display="flex" alignItems="flex-start" gap={1}>
                                                <Box flex={1}>
                                                    <Typography variant="body2" fontWeight={600}>
                                                        {surgery.details?.surgery_type || surgery.surgery_type || 'Surgery'}
                                                    </Typography>
                                                    <Box display="flex" gap={2} flexWrap="wrap" mt={0.5}>
                                                        <Typography variant="caption" color="text.secondary">
                                                            Date: {surgery.details?.surgery_date || surgery.record_date || '—'}
                                                        </Typography>
                                                        {surgery.details?.hospital && (
                                                            <Typography variant="caption" color="text.secondary">Hospital: {surgery.details.hospital}</Typography>
                                                        )}
                                                        {surgery.details?.surgeon_name && (
                                                            <Typography variant="caption" color="text.secondary">Surgeon: {surgery.details.surgeon_name}</Typography>
                                                        )}
                                                    </Box>
                                                    {(surgery.notes || surgery.details?.notes) && (
                                                        <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                                                            {surgery.notes || surgery.details.notes}
                                                        </Typography>
                                                    )}
                                                    <AttachmentManager recordId={surgery.id} attachments={surgery.attachment_links || []} />
                                                </Box>
                                                <IconButton onClick={() => setSurgeriesSharing((prev) => ({ ...prev, [surgery.id]: !prev[surgery.id] }))}>
                                                    {surgeriesSharing[surgery.id] ? <VisibilityIcon color="primary" /> : <VisibilityOffIcon color="disabled" />}
                                                </IconButton>
                                            </Box>
                                        </Paper>
                                    ))}
                                </Stack>
                            )}
                        </AccordionDetails>
                    )}
                </Accordion>

        </>
    );

    // Nested "add record" / "add surgery" popups — shared by both modes.
    const nestedDialogs = (
        <>
                {/* ═══ Add Health Record Dialog ═══ */}
                <Dialog open={recordDialogOpen} onClose={() => setRecordDialogOpen(false)} maxWidth="sm" fullWidth>
                    <DialogTitle>Add Health Record</DialogTitle>
                    <DialogContent dividers>
                        <Grid container spacing={2} sx={{ mt: 0.5 }}>
                            <Grid item xs={12}>
                                <FormControl fullWidth required>
                                    <InputLabel>Record Type</InputLabel>
                                    <Select value={newRecord.record_type} label="Record Type"
                                        onChange={(e) => setNewRecord((p) => ({ ...p, record_type: e.target.value }))}>
                                        {RECORD_TYPES.map((rt) => <MenuItem key={rt.value} value={rt.value}>{rt.label}</MenuItem>)}
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <DatePicker label="Record Date" value={newRecord.record_date}
                                    onChange={(d) => setNewRecord((p) => ({ ...p, record_date: d }))}
                                    slotProps={{ textField: { fullWidth: true, required: true } }} />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField fullWidth label="Title / Description" value={newRecord.title}
                                    onChange={(e) => setNewRecord((p) => ({ ...p, title: e.target.value }))}
                                    placeholder="e.g. CBC Report, X-Ray Chest" />
                            </Grid>
                            <Grid item xs={12}>
                                <TextField fullWidth label="Notes" value={newRecord.notes}
                                    onChange={(e) => setNewRecord((p) => ({ ...p, notes: e.target.value }))} multiline rows={2} />
                            </Grid>
                            <Grid item xs={12}>
                                <DialogAttachmentQueue attachments={recordDialogAttachments}
                                    onAdd={(att) => setRecordDialogAttachments((p) => [...p, att])}
                                    onRemove={(idx) => setRecordDialogAttachments((p) => p.filter((_, i) => i !== idx))} />
                            </Grid>
                        </Grid>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setRecordDialogOpen(false)}>Cancel</Button>
                        <Button variant="contained" onClick={handleSubmitRecord} disabled={isAddingRecord || !newRecord.record_type}>
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
                                <TextField fullWidth required label="Surgery Type" value={newSurgery.surgery_type}
                                    onChange={(e) => setNewSurgery((p) => ({ ...p, surgery_type: e.target.value }))}
                                    placeholder="e.g. Appendectomy, Knee Replacement" />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <DatePicker label="Surgery Date" value={newSurgery.surgery_date}
                                    onChange={(d) => setNewSurgery((p) => ({ ...p, surgery_date: d }))}
                                    slotProps={{ textField: { fullWidth: true } }} />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField fullWidth label="Hospital" value={newSurgery.hospital}
                                    onChange={(e) => setNewSurgery((p) => ({ ...p, hospital: e.target.value }))} />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField fullWidth label="Surgeon Name" value={newSurgery.surgeon_name}
                                    onChange={(e) => setNewSurgery((p) => ({ ...p, surgeon_name: e.target.value }))} />
                            </Grid>
                            <Grid item xs={12}>
                                <TextField fullWidth label="Notes" value={newSurgery.notes}
                                    onChange={(e) => setNewSurgery((p) => ({ ...p, notes: e.target.value }))} multiline rows={2} />
                            </Grid>
                            <Grid item xs={12}>
                                <DialogAttachmentQueue attachments={surgeryDialogAttachments}
                                    onAdd={(att) => setSurgeryDialogAttachments((p) => [...p, att])}
                                    onRemove={(idx) => setSurgeryDialogAttachments((p) => p.filter((_, i) => i !== idx))} />
                            </Grid>
                        </Grid>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setSurgeryDialogOpen(false)}>Cancel</Button>
                        <Button variant="contained" onClick={handleSubmitSurgery} disabled={isAddingSurgery || !newSurgery.surgery_type}>
                            {isAddingSurgery ? 'Adding...' : 'Add Surgery'}
                        </Button>
                    </DialogActions>
                </Dialog>
        </>
    );

    // ─── Popup (dialog) mode ───
    if (asDialog) {
        return (
            <LocalizationProvider dateAdapter={AdapterDateFns}>
                <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
                    {dialogTitle}
                    <DialogContent dividers>{mainContent}</DialogContent>
                    <DialogActions sx={{ px: 3, py: 2 }}>
                        <Button onClick={onClose}>Cancel</Button>
                        <Button variant="contained" onClick={handleContinue} disabled={isSaving}>
                            {isSaving ? 'Saving…' : 'Save'}
                        </Button>
                    </DialogActions>
                </Dialog>
                {nestedDialogs}
            </LocalizationProvider>
        );
    }

    // ─── Full-page (legacy standalone route) mode ───
    return (
        <LocalizationProvider dateAdapter={AdapterDateFns}>
            <Container maxWidth="md" sx={{ mt: 4, mb: 10 }}>
                {mainContent}
                {/* Continue Button */}
                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                    <Button variant="contained" size="large" onClick={handleContinue} disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Continue to Find Doctors'}
                    </Button>
                </Box>
                {nestedDialogs}
            </Container>
        </LocalizationProvider>
    );
};

export default SymptomsAndRecordsPage;
