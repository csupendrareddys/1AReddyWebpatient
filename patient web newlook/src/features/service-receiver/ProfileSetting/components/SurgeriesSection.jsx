import React, { useState, useCallback, useRef } from 'react';
import {
    Box, Grid, TextField, Button, Typography, Paper, Chip,
    Dialog, DialogTitle, DialogContent, DialogActions,
    Select, MenuItem, FormControl, InputLabel, IconButton,
    CircularProgress, Stack, Tooltip, LinearProgress,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteIcon from '@mui/icons-material/Delete';
import DescriptionIcon from '@mui/icons-material/Description';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import usePatientProfilePageConfig from '../hooks/usePatientProfilePageConfig';
import {
    useGetSurgeriesQuery,
    useAddSurgeryMutation,
    useUploadHealthRecordAttachmentMutation,
    useDeleteHealthRecordAttachmentMutation,
} from '../api/scopedPatientApi';
import { toLocalDateString } from '../../../../common/utils/date';

// Normalise data-source items to { value, label } regardless of backend format
const norm = (opt) => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return { value: opt.value ?? opt.id ?? '', label: opt.label ?? opt.name ?? '' };
};

const EMPTY_SURGERY = {
    surgery_type: '',
    surgery_date: null,
    hospital: '',
    surgeon_name: '',
    notes: '',
};

/** Inline attachment manager for a surgery record */
const SurgeryAttachmentList = ({ surgery }) => {
    const [uploadAttachment, { isLoading: isUploading }] = useUploadHealthRecordAttachmentMutation();
    const [deleteAttachment] = useDeleteHealthRecordAttachmentMutation();
    const [showUpload, setShowUpload] = useState(false);
    const [description, setDescription] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const fileInputRef = useRef(null);

    const attachments = surgery.attachment_links || [];

    const handleUpload = useCallback(async () => {
        if (!selectedFile) return;
        try {
            await uploadAttachment({
                recordId: surgery.id,
                file: selectedFile,
                description,
            }).unwrap();
            setSelectedFile(null);
            setDescription('');
            setShowUpload(false);
        } catch (err) {
            console.error('Failed to upload surgery attachment:', err);
        }
    }, [surgery.id, selectedFile, description, uploadAttachment]);

    const handleDelete = useCallback(async (attachmentId) => {
        if (!window.confirm('Delete this attachment?')) return;
        try {
            await deleteAttachment({ recordId: surgery.id, attachmentId }).unwrap();
        } catch (err) {
            console.error('Failed to delete surgery attachment:', err);
        }
    }, [surgery.id, deleteAttachment]);

    return (
        <Box sx={{ mt: 1 }}>
            {attachments.length > 0 && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                    {attachments.map((att) => (
                        <Chip
                            key={att.id}
                            icon={<DescriptionIcon fontSize="small" />}
                            label={att.description || att.filename || 'Attachment'}
                            size="small"
                            variant="outlined"
                            onClick={() => {
                                if (att.url) window.open(att.url, '_blank');
                            }}
                            onDelete={() => handleDelete(att.id)}
                            deleteIcon={
                                <Tooltip title="Delete attachment">
                                    <DeleteIcon fontSize="small" />
                                </Tooltip>
                            }
                            sx={{ maxWidth: 220 }}
                        />
                    ))}
                </Stack>
            )}

            {!showUpload ? (
                <Button
                    size="small"
                    startIcon={<AttachFileIcon />}
                    onClick={() => setShowUpload(true)}
                    sx={{ textTransform: 'none' }}
                >
                    Add Attachment
                </Button>
            ) : (
                <Box sx={{ p: 1.5, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
                    <Stack spacing={1.5}>
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
                            placeholder="e.g. Discharge summary, surgery report"
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
                                {isUploading ? 'Uploading...' : 'Upload'}
                            </Button>
                            <Button
                                size="small"
                                onClick={() => {
                                    setShowUpload(false);
                                    setSelectedFile(null);
                                    setDescription('');
                                }}
                            >
                                Cancel
                            </Button>
                        </Stack>
                    </Stack>
                </Box>
            )}
        </Box>
    );
};

const SurgeriesSection = ({ configOverride }) => {
    const cfg = usePatientProfilePageConfig('en', 'patient', configOverride);
    const { data: surgeriesData, isLoading } = useGetSurgeriesQuery();
    const [addSurgery, { isLoading: isAdding }] = useAddSurgeryMutation();
    const [uploadAttachment] = useUploadHealthRecordAttachmentMutation();

    const dataSources = cfg.dataSources || {};
    const surgeryTypes = dataSources?.surgery_types || [];

    const surgeries = surgeriesData?.surgeries || surgeriesData?.data?.surgeries || surgeriesData?.data || surgeriesData || [];

    const [dialogOpen, setDialogOpen] = useState(false);
    const [newSurgery, setNewSurgery] = useState({ ...EMPTY_SURGERY });
    // Attachment state for the dialog
    const [dialogAttachments, setDialogAttachments] = useState([]);
    const dialogFileRef = useRef(null);
    const [dialogAttDesc, setDialogAttDesc] = useState('');

    const handleOpenDialog = useCallback(() => {
        setNewSurgery({ ...EMPTY_SURGERY });
        setDialogAttachments([]);
        setDialogAttDesc('');
        setDialogOpen(true);
    }, []);

    const handleCloseDialog = useCallback(() => {
        setDialogOpen(false);
    }, []);

    const handleFormChange = useCallback((e) => {
        const { name, value } = e.target;
        setNewSurgery((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleDateChange = useCallback((date) => {
        setNewSurgery((prev) => ({ ...prev, surgery_date: date }));
    }, []);

    const handleAddDialogAttachment = useCallback(() => {
        const file = dialogFileRef.current?.files?.[0];
        if (!file) return;
        setDialogAttachments((prev) => [...prev, { file, description: dialogAttDesc }]);
        setDialogAttDesc('');
        if (dialogFileRef.current) dialogFileRef.current.value = '';
    }, [dialogAttDesc]);

    const handleRemoveDialogAttachment = useCallback((idx) => {
        setDialogAttachments((prev) => prev.filter((_, i) => i !== idx));
    }, []);

    const handleSubmit = useCallback(async () => {
        try {
            const payload = { ...newSurgery };
            if (payload.surgery_date) {
                payload.surgery_date = toLocalDateString(payload.surgery_date);
            }
            const result = await addSurgery(payload).unwrap();
            const createdId = result?.data?.id || result?.id;

            // Upload any attachments queued in the dialog
            if (createdId && dialogAttachments.length > 0) {
                for (const att of dialogAttachments) {
                    try {
                        await uploadAttachment({
                            recordId: createdId,
                            file: att.file,
                            description: att.description,
                        }).unwrap();
                    } catch (uploadErr) {
                        console.error('Failed to upload attachment during surgery creation:', uploadErr);
                    }
                }
            }

            setDialogOpen(false);
        } catch (err) {
            console.error('Failed to add surgery:', err);
        }
    }, [newSurgery, addSurgery, dialogAttachments, uploadAttachment]);

    if (!cfg.isSectionVisible('surgeries')) return null;

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns}>
            <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="body2" color="text.secondary">
                        {Array.isArray(surgeries) ? surgeries.length : 0} surgery record(s)
                    </Typography>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={handleOpenDialog}
                        size="small"
                    >
                        Add Surgery
                    </Button>
                </Box>

                {isLoading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                        <CircularProgress size={24} />
                    </Box>
                )}

                {/* Surgery List */}
                {Array.isArray(surgeries) && surgeries.map((surgery, index) => (
                    <Paper
                        key={surgery.id || index}
                        variant="outlined"
                        sx={{ p: 2, mb: 1.5 }}
                    >
                        <Grid container spacing={1}>
                            <Grid item xs={12} sm={6}>
                                <Typography variant="subtitle2">
                                    {surgery.surgery_type || surgery.details?.surgery_type || 'Unknown Type'}
                                </Typography>
                            </Grid>
                            <Grid item xs={12} sm={6} sx={{ textAlign: { sm: 'right' } }}>
                                <Chip
                                    label={surgery.surgery_date || surgery.record_date || 'No date'}
                                    size="small"
                                    variant="outlined"
                                />
                            </Grid>
                            {(surgery.hospital || surgery.details?.hospital) && (
                                <Grid item xs={12} sm={6}>
                                    <Typography variant="body2" color="text.secondary">
                                        Hospital: {surgery.hospital || surgery.details?.hospital}
                                    </Typography>
                                </Grid>
                            )}
                            {(surgery.surgeon_name || surgery.details?.surgeon_name) && (
                                <Grid item xs={12} sm={6}>
                                    <Typography variant="body2" color="text.secondary">
                                        Surgeon: {surgery.surgeon_name || surgery.details?.surgeon_name}
                                    </Typography>
                                </Grid>
                            )}
                            {(surgery.notes || surgery.details?.notes) && (
                                <Grid item xs={12}>
                                    <Typography variant="body2" color="text.secondary">
                                        Notes: {surgery.notes || surgery.details?.notes}
                                    </Typography>
                                </Grid>
                            )}
                            {/* Attachments section */}
                            <Grid item xs={12}>
                                <SurgeryAttachmentList surgery={surgery} />
                            </Grid>
                        </Grid>
                    </Paper>
                ))}

                {!isLoading && Array.isArray(surgeries) && surgeries.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                        No surgery records found. Click &quot;Add Surgery&quot; to add one.
                    </Typography>
                )}

                {/* Add Surgery Dialog */}
                <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
                    <DialogTitle>Add Surgery</DialogTitle>
                    <DialogContent dividers>
                        <Grid container spacing={2} sx={{ mt: 0.5 }}>
                            {/* Surgery Type */}
                            {cfg.isFieldVisible('surgery_type') && (
                                <Grid item xs={12}>
                                    {surgeryTypes.length > 0 ? (
                                        <FormControl fullWidth required={cfg.isFieldRequired('surgery_type')}>
                                            <InputLabel>
                                                {cfg.getFieldLabel('surgery_type', 'Surgery Type')}
                                            </InputLabel>
                                            <Select
                                                name="surgery_type"
                                                value={newSurgery.surgery_type}
                                                label={cfg.getFieldLabel('surgery_type', 'Surgery Type')}
                                                onChange={handleFormChange}
                                            >
                                                {surgeryTypes.map((st) => {
                                                    const n = norm(st);
                                                    return (
                                                        <MenuItem key={n.value} value={n.value}>
                                                            {n.label}
                                                        </MenuItem>
                                                    );
                                                })}
                                            </Select>
                                        </FormControl>
                                    ) : (
                                        <TextField
                                            fullWidth
                                            label={cfg.getFieldLabel('surgery_type', 'Surgery Type')}
                                            name="surgery_type"
                                            value={newSurgery.surgery_type}
                                            onChange={handleFormChange}
                                            required={cfg.isFieldRequired('surgery_type')}
                                        />
                                    )}
                                </Grid>
                            )}

                            {/* Surgery Date */}
                            {cfg.isFieldVisible('surgery_date') && (
                                <Grid item xs={12} sm={6}>
                                    <DatePicker
                                        label={cfg.getFieldLabel('surgery_date', 'Surgery Date')}
                                        value={newSurgery.surgery_date}
                                        onChange={handleDateChange}
                                        slotProps={{
                                            textField: {
                                                fullWidth: true,
                                                required: cfg.isFieldRequired('surgery_date'),
                                            },
                                        }}
                                    />
                                </Grid>
                            )}

                            {/* Hospital */}
                            {cfg.isFieldVisible('hospital') && (
                                <Grid item xs={12} sm={6}>
                                    <TextField
                                        fullWidth
                                        label={cfg.getFieldLabel('hospital', 'Hospital')}
                                        name="hospital"
                                        value={newSurgery.hospital}
                                        onChange={handleFormChange}
                                        required={cfg.isFieldRequired('hospital')}
                                    />
                                </Grid>
                            )}

                            {/* Surgeon Name */}
                            {cfg.isFieldVisible('surgeon_name') && (
                                <Grid item xs={12} sm={6}>
                                    <TextField
                                        fullWidth
                                        label={cfg.getFieldLabel('surgeon_name', 'Surgeon Name')}
                                        name="surgeon_name"
                                        value={newSurgery.surgeon_name}
                                        onChange={handleFormChange}
                                        required={cfg.isFieldRequired('surgeon_name')}
                                    />
                                </Grid>
                            )}

                            {/* Notes */}
                            {cfg.isFieldVisible('notes') && (
                                <Grid item xs={12}>
                                    <TextField
                                        fullWidth
                                        label={cfg.getFieldLabel('notes', 'Notes')}
                                        name="notes"
                                        value={newSurgery.notes}
                                        onChange={handleFormChange}
                                        multiline
                                        rows={3}
                                    />
                                </Grid>
                            )}

                            {/* Attachments in dialog */}
                            <Grid item xs={12}>
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                    Attachments
                                </Typography>

                                {dialogAttachments.length > 0 && (
                                    <Stack spacing={0.5} sx={{ mb: 1.5 }}>
                                        {dialogAttachments.map((att, idx) => (
                                            <Chip
                                                key={idx}
                                                icon={<DescriptionIcon fontSize="small" />}
                                                label={`${att.file.name}${att.description ? ` - ${att.description}` : ''}`}
                                                size="small"
                                                variant="outlined"
                                                onDelete={() => handleRemoveDialogAttachment(idx)}
                                                sx={{ maxWidth: '100%' }}
                                            />
                                        ))}
                                    </Stack>
                                )}

                                <Stack direction="row" spacing={1} alignItems="flex-end">
                                    <input
                                        ref={dialogFileRef}
                                        type="file"
                                        style={{ display: 'none' }}
                                    />
                                    <Button
                                        variant="outlined"
                                        size="small"
                                        startIcon={<CloudUploadIcon />}
                                        onClick={() => dialogFileRef.current?.click()}
                                        sx={{ textTransform: 'none', flexShrink: 0 }}
                                    >
                                        Choose File
                                    </Button>
                                    <TextField
                                        size="small"
                                        label="Description"
                                        value={dialogAttDesc}
                                        onChange={(e) => setDialogAttDesc(e.target.value)}
                                        placeholder="Optional description"
                                        sx={{ flex: 1 }}
                                    />
                                    <Button
                                        size="small"
                                        variant="contained"
                                        onClick={handleAddDialogAttachment}
                                        sx={{ flexShrink: 0 }}
                                    >
                                        Add
                                    </Button>
                                </Stack>
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                                    Files will be uploaded when you save the surgery record.
                                </Typography>
                            </Grid>
                        </Grid>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleCloseDialog}>Cancel</Button>
                        <Button
                            variant="contained"
                            onClick={handleSubmit}
                            disabled={isAdding || !newSurgery.surgery_type}
                        >
                            {isAdding ? 'Adding...' : 'Add Surgery'}
                        </Button>
                    </DialogActions>
                </Dialog>
            </Box>
        </LocalizationProvider>
    );
};

export default React.memo(SurgeriesSection);
