import React, { useState, useCallback } from 'react';
import {
    Box, Typography, Paper, Grid, Chip, Alert, CircularProgress, Stack,
    Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Tooltip, Divider,
} from '@mui/material';
import MedicationIcon from '@mui/icons-material/Medication';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import usePatientProfilePageConfig from '../hooks/usePatientProfilePageConfig';
import DynamicFieldRenderer from './DynamicFieldRenderer';
import {
    useGetHealthRecordsByTypeQuery,
    useAddHealthRecordMutation,
    useDeleteHealthRecordMutation,
} from '../api/scopedPatientApi';

const EMPTY_FORM = {
    doctor_name: '',
    prescription_date: '',
    medications: '',
    diagnosis: '',
    notes: '',
};

const PrescriptionsSection = ({ configOverride }) => {
    const cfg = usePatientProfilePageConfig('en', 'patient', configOverride);

    const {
        data: recordsData,
        isLoading,
    } = useGetHealthRecordsByTypeQuery('prescription');

    const [addRecord, { isLoading: isAdding }] = useAddHealthRecordMutation();
    const [deleteRecord, { isLoading: isDeleting }] = useDeleteHealthRecordMutation();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [attachments, setAttachments] = useState([]); // { file, description }[]
    const [deletingId, setDeletingId] = useState(null);

    const prescriptions = Array.isArray(recordsData?.records)
        ? recordsData.records
        : Array.isArray(recordsData)
            ? recordsData
            : [];

    // --- handlers ---

    const handleOpenDialog = useCallback(() => {
        setForm(EMPTY_FORM);
        setAttachments([]);
        setDialogOpen(true);
    }, []);

    const handleCloseDialog = useCallback(() => {
        setDialogOpen(false);
    }, []);

    const handleFieldChange = useCallback((e) => {
        const { name, value } = e.target;
        setForm((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleAddAttachment = useCallback((e) => {
        const files = Array.from(e.target.files || []);
        const newAttachments = files.map((file) => ({ file, description: '' }));
        setAttachments((prev) => [...prev, ...newAttachments]);
        // Reset file input so re-selecting same file works
        e.target.value = '';
    }, []);

    const handleAttachmentDescChange = useCallback((index, desc) => {
        setAttachments((prev) =>
            prev.map((a, i) => (i === index ? { ...a, description: desc } : a))
        );
    }, []);

    const handleRemoveAttachment = useCallback((index) => {
        setAttachments((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const handleSubmit = useCallback(async () => {
        const medicationsRaw = form.medications.trim();
        const medicationsList = medicationsRaw
            ? medicationsRaw.split(/[,\n]+/).map((m) => m.trim()).filter(Boolean)
            : [];

        const payload = {
            record_type: 'prescription',
            data: {
                doctor_name: form.doctor_name.trim(),
                prescription_date: form.prescription_date,
                medications: medicationsList,
                diagnosis: form.diagnosis.trim(),
                notes: form.notes.trim(),
                attachment_count: attachments.length,
                attachments: attachments.map((a) => ({
                    filename: a.file.name,
                    description: a.description,
                    size: a.file.size,
                })),
            },
        };

        try {
            await addRecord(payload).unwrap();
            setDialogOpen(false);
        } catch {
            // Error is surfaced by RTK Query; component stays open so user can retry
        }
    }, [form, attachments, addRecord]);

    const handleDelete = useCallback(async (recordId) => {
        setDeletingId(recordId);
        try {
            await deleteRecord(recordId).unwrap();
        } catch {
            // Error surfaced by RTK Query
        } finally {
            setDeletingId(null);
        }
    }, [deleteRecord]);

    if (!cfg.isSectionVisible('previous_prescriptions')) return null;

    // --- helpers to read nested data ---
    const getData = (rx) => rx?.data || rx || {};

    const formatMedications = (meds) => {
        if (Array.isArray(meds)) return meds.join(', ');
        if (typeof meds === 'string') return meds;
        return '';
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'No date';
        try {
            return new Date(dateStr).toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric',
            });
        } catch {
            return dateStr;
        }
    };

    const canSubmit =
        form.doctor_name.trim().length > 0 &&
        form.prescription_date.length > 0;

    return (
        <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                    My Prescriptions
                </Typography>
                <Button
                    variant="contained"
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={handleOpenDialog}
                >
                    Add Prescription
                </Button>
            </Stack>

            <Alert severity="info" sx={{ mb: 2 }}>
                Add prescriptions from doctors or hospitals outside the platform so your care providers have a complete picture.
            </Alert>

            {isLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                    <CircularProgress size={24} />
                </Box>
            )}

            {prescriptions.length > 0 ? (
                prescriptions.map((rx) => {
                    const d = getData(rx);
                    const rxId = rx.id || rx._id;
                    const meds = formatMedications(d.medications);
                    const attCount = d.attachment_count || d.attachments?.length || 0;

                    return (
                        <Paper key={rxId} variant="outlined" sx={{ p: 2, mb: 1.5 }}>
                            <Grid container spacing={1} alignItems="center">
                                <Grid item xs="auto">
                                    <MedicationIcon color="primary" />
                                </Grid>
                                <Grid item xs>
                                    <Typography variant="subtitle2">
                                        {d.doctor_name || 'Unknown Doctor'}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {formatDate(d.prescription_date)}
                                    </Typography>
                                </Grid>

                                {attCount > 0 && (
                                    <Grid item xs="auto">
                                        <Chip
                                            icon={<AttachFileIcon />}
                                            label={`${attCount} file${attCount > 1 ? 's' : ''}`}
                                            size="small"
                                            variant="outlined"
                                        />
                                    </Grid>
                                )}

                                <Grid item xs="auto">
                                    <Tooltip title="Delete prescription">
                                        <IconButton
                                            size="small"
                                            color="error"
                                            disabled={isDeleting && deletingId === rxId}
                                            onClick={() => handleDelete(rxId)}
                                        >
                                            {isDeleting && deletingId === rxId ? (
                                                <CircularProgress size={18} />
                                            ) : (
                                                <DeleteIcon fontSize="small" />
                                            )}
                                        </IconButton>
                                    </Tooltip>
                                </Grid>

                                {meds && (
                                    <Grid item xs={12}>
                                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                                            <strong>Medications:</strong> {meds}
                                        </Typography>
                                    </Grid>
                                )}

                                {d.diagnosis && (
                                    <Grid item xs={12}>
                                        <Typography variant="body2" color="text.secondary">
                                            <strong>Diagnosis:</strong> {d.diagnosis}
                                        </Typography>
                                    </Grid>
                                )}

                                {d.notes && (
                                    <Grid item xs={12}>
                                        <Typography variant="body2" color="text.secondary">
                                            {d.notes}
                                        </Typography>
                                    </Grid>
                                )}
                            </Grid>
                        </Paper>
                    );
                })
            ) : (
                !isLoading && (
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                        No prescriptions added yet. Tap "Add Prescription" to record prescriptions from outside the platform.
                    </Typography>
                )
            )}

            {/* Dynamic custom fields added by admin */}
            <Grid container spacing={2} sx={{ mt: 1 }}>
                <DynamicFieldRenderer
                    sectionKey="previous_prescriptions"
                    cfg={cfg}
                    excludeKeys={[]}
                    formData={{}}
                    onFieldChange={() => {}}
                />
            </Grid>

            {/* ---- Add Prescription Dialog ---- */}
            <Dialog
                open={dialogOpen}
                onClose={handleCloseDialog}
                fullWidth
                maxWidth="sm"
            >
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Add Prescription
                    <IconButton size="small" onClick={handleCloseDialog}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </DialogTitle>

                <DialogContent dividers>
                    <Stack spacing={2} sx={{ mt: 0.5 }}>
                        <TextField
                            name="doctor_name"
                            label="Doctor / Hospital Name"
                            value={form.doctor_name}
                            onChange={handleFieldChange}
                            required
                            fullWidth
                            size="small"
                        />

                        <TextField
                            name="prescription_date"
                            label="Prescription Date"
                            type="date"
                            value={form.prescription_date}
                            onChange={handleFieldChange}
                            required
                            fullWidth
                            size="small"
                            InputLabelProps={{ shrink: true }}
                        />

                        <TextField
                            name="medications"
                            label="Medications (one per line or comma-separated)"
                            value={form.medications}
                            onChange={handleFieldChange}
                            multiline
                            minRows={2}
                            fullWidth
                            size="small"
                        />

                        <TextField
                            name="diagnosis"
                            label="Diagnosis / Condition"
                            value={form.diagnosis}
                            onChange={handleFieldChange}
                            fullWidth
                            size="small"
                        />

                        <TextField
                            name="notes"
                            label="Notes"
                            value={form.notes}
                            onChange={handleFieldChange}
                            multiline
                            minRows={2}
                            fullWidth
                            size="small"
                        />

                        {/* Attachments */}
                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                Attachments
                            </Typography>

                            <Button
                                component="label"
                                variant="outlined"
                                size="small"
                                startIcon={<AttachFileIcon />}
                            >
                                Choose Files
                                <input
                                    type="file"
                                    hidden
                                    multiple
                                    accept="image/*,.pdf,.doc,.docx"
                                    onChange={handleAddAttachment}
                                />
                            </Button>

                            {attachments.length > 0 && (
                                <Stack spacing={1} sx={{ mt: 1.5 }}>
                                    {attachments.map((att, idx) => (
                                        <Paper key={idx} variant="outlined" sx={{ p: 1.5 }}>
                                            <Stack direction="row" spacing={1} alignItems="center">
                                                <AttachFileIcon fontSize="small" color="action" />
                                                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {att.file.name}
                                                </Typography>
                                                <IconButton size="small" onClick={() => handleRemoveAttachment(idx)}>
                                                    <CloseIcon fontSize="small" />
                                                </IconButton>
                                            </Stack>
                                            <TextField
                                                placeholder="Description (optional)"
                                                value={att.description}
                                                onChange={(e) => handleAttachmentDescChange(idx, e.target.value)}
                                                fullWidth
                                                size="small"
                                                sx={{ mt: 1 }}
                                            />
                                        </Paper>
                                    ))}
                                </Stack>
                            )}
                        </Box>
                    </Stack>
                </DialogContent>

                <DialogActions>
                    <Button onClick={handleCloseDialog}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleSubmit}
                        disabled={!canSubmit || isAdding}
                        startIcon={isAdding ? <CircularProgress size={16} /> : null}
                    >
                        {isAdding ? 'Saving...' : 'Save Prescription'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default React.memo(PrescriptionsSection);
