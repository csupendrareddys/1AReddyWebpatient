import React, { useState, useCallback, useRef } from 'react';
import {
    Box, Grid, TextField, Button, Typography, Paper, Chip,
    Dialog, DialogTitle, DialogContent, DialogActions,
    Select, MenuItem, FormControl, InputLabel, IconButton,
    CircularProgress, Alert, Tooltip, Stack, LinearProgress,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import FilterListIcon from '@mui/icons-material/FilterList';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DownloadIcon from '@mui/icons-material/Download';
import DescriptionIcon from '@mui/icons-material/Description';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import usePatientProfilePageConfig from '../hooks/usePatientProfilePageConfig';
import DynamicFieldRenderer from './DynamicFieldRenderer';
import { toLocalDateString, todayLocalDateString } from '../../../../common/utils/date';
import {
    useGetHealthRecordsQuery,
    useAddHealthRecordMutation,
    useDeleteHealthRecordMutation,
    useUploadHealthRecordAttachmentMutation,
    useDeleteHealthRecordAttachmentMutation,
} from '../api/scopedPatientApi';

const RECORD_TYPE_COLORS = {
    vitals: 'info',
    lab_report: 'success',
    imaging: 'warning',
    prescription: 'primary',
    discharge_summary: 'secondary',
    vaccination: 'info',
    allergy: 'error',
    chronic_condition: 'error',
    surgery_record: 'warning',
    other: 'default',
};

// Normalise data-source items to { value, label } regardless of backend format
const norm = (opt) => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return { value: opt.value ?? opt.id ?? '', label: opt.label ?? opt.name ?? '' };
};

const EMPTY_RECORD = {
    record_type: '',
    record_date: null,
    title: '',
    notes: '',
};

/** Small inline component for managing attachments on an existing record */
const AttachmentList = ({ record }) => {
    const [uploadAttachment, { isLoading: isUploading }] = useUploadHealthRecordAttachmentMutation();
    const [deleteAttachment] = useDeleteHealthRecordAttachmentMutation();
    const [showUpload, setShowUpload] = useState(false);
    const [description, setDescription] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const fileInputRef = useRef(null);

    const attachments = record.attachment_links || [];

    const handleUpload = useCallback(async () => {
        if (!selectedFile) return;
        try {
            await uploadAttachment({
                recordId: record.id,
                file: selectedFile,
                description,
            }).unwrap();
            setSelectedFile(null);
            setDescription('');
            setShowUpload(false);
        } catch (err) {
            console.error('Failed to upload attachment:', err);
        }
    }, [record.id, selectedFile, description, uploadAttachment]);

    const handleDelete = useCallback(async (attachmentId) => {
        if (!window.confirm('Delete this attachment?')) return;
        try {
            await deleteAttachment({ recordId: record.id, attachmentId }).unwrap();
        } catch (err) {
            console.error('Failed to delete attachment:', err);
        }
    }, [record.id, deleteAttachment]);

    return (
        <Box sx={{ mt: 1 }}>
            {/* Existing attachments */}
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

            {/* Upload toggle */}
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

const HealthRecordsSection = ({ configOverride }) => {
    const cfg = usePatientProfilePageConfig('en', 'patient', configOverride);
    const [filterType, setFilterType] = useState('');
    const { data: recordsData, isLoading } = useGetHealthRecordsQuery(
        filterType ? { recordType: filterType } : {}
    );
    const [addRecord, { isLoading: isAdding }] = useAddHealthRecordMutation();
    const [deleteRecord] = useDeleteHealthRecordMutation();

    const dataSources = cfg.dataSources || {};
    const recordTypes = dataSources?.record_types || [
        { id: 'lab_report', name: 'Lab Report' },
        { id: 'imaging', name: 'Imaging (X-Ray, MRI, CT)' },
        { id: 'discharge_summary', name: 'Discharge Summary' },
        { id: 'vaccination', name: 'Vaccination Record' },
        { id: 'allergy', name: 'Allergy' },
        { id: 'chronic_condition', name: 'Chronic Condition' },
        { id: 'other', name: 'Other' },
    ];

    const records = recordsData?.health_records || recordsData?.records || [];

    const [dialogOpen, setDialogOpen] = useState(false);
    const [newRecord, setNewRecord] = useState({ ...EMPTY_RECORD });
    // Attachment state for the "Add Record" dialog
    const [dialogAttachments, setDialogAttachments] = useState([]);
    const dialogFileRef = useRef(null);
    const [dialogAttDesc, setDialogAttDesc] = useState('');

    const handleOpenDialog = useCallback(() => {
        setNewRecord({ ...EMPTY_RECORD });
        setDialogAttachments([]);
        setDialogAttDesc('');
        setDialogOpen(true);
    }, []);

    const handleCloseDialog = useCallback(() => setDialogOpen(false), []);

    const handleFormChange = useCallback((e) => {
        const { name, value } = e.target;
        setNewRecord((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleDateChange = useCallback((date) => {
        setNewRecord((prev) => ({ ...prev, record_date: date }));
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

    const [uploadAttachment] = useUploadHealthRecordAttachmentMutation();

    const handleSubmit = useCallback(async () => {
        try {
            const payload = {
                record_type: newRecord.record_type,
                record_date: toLocalDateString(newRecord.record_date) || todayLocalDateString(),
                details: {
                    title: newRecord.title,
                    notes: newRecord.notes,
                },
                notes: newRecord.notes,
            };
            const result = await addRecord(payload).unwrap();
            const createdId = result?.data?.id || result?.id;

            // Upload any attachments that were queued in the dialog
            if (createdId && dialogAttachments.length > 0) {
                for (const att of dialogAttachments) {
                    try {
                        await uploadAttachment({
                            recordId: createdId,
                            file: att.file,
                            description: att.description,
                        }).unwrap();
                    } catch (uploadErr) {
                        console.error('Failed to upload attachment during record creation:', uploadErr);
                    }
                }
            }

            setDialogOpen(false);
        } catch (err) {
            console.error('Failed to add health record:', err);
        }
    }, [newRecord, addRecord, dialogAttachments, uploadAttachment]);

    const handleDelete = useCallback(async (recordId) => {
        if (!window.confirm('Delete this health record?')) return;
        try {
            await deleteRecord(recordId).unwrap();
        } catch (err) {
            console.error('Failed to delete record:', err);
        }
    }, [deleteRecord]);

    const getTypeLabel = (typeId) => {
        const found = recordTypes.find((t) => norm(t).value === typeId);
        return found ? norm(found).label : typeId;
    };

    if (!cfg.isSectionVisible('health_records')) return null;

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns}>
            <Box>
                {/* Header with filter and add */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <FilterListIcon fontSize="small" color="action" />
                        <FormControl size="small" sx={{ minWidth: 160 }}>
                            <InputLabel>Filter by Type</InputLabel>
                            <Select
                                value={filterType}
                                label="Filter by Type"
                                onChange={(e) => setFilterType(e.target.value)}
                            >
                                <MenuItem value="">All Records</MenuItem>
                                {recordTypes.map((rt) => {
                                    const n = norm(rt);
                                    return (
                                        <MenuItem key={n.value} value={n.value}>
                                            {n.label}
                                        </MenuItem>
                                    );
                                })}
                            </Select>
                        </FormControl>
                        <Typography variant="body2" color="text.secondary">
                            {Array.isArray(records) ? records.length : 0} record(s)
                        </Typography>
                    </Box>
                    <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenDialog} size="small">
                        Add Record
                    </Button>
                </Box>

                {isLoading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                        <CircularProgress size={24} />
                    </Box>
                )}

                {/* Records List */}
                {Array.isArray(records) && records.map((record, index) => (
                    <Paper key={record.id || index} variant="outlined" sx={{ p: 2, mb: 1.5 }}>
                        <Grid container spacing={1} alignItems="center">
                            <Grid item xs={12} sm={4}>
                                <Chip
                                    label={getTypeLabel(record.record_type)}
                                    size="small"
                                    color={RECORD_TYPE_COLORS[record.record_type] || 'default'}
                                />
                            </Grid>
                            <Grid item xs={12} sm={4}>
                                <Typography variant="body2" color="text.secondary">
                                    {record.record_date || 'No date'}
                                </Typography>
                            </Grid>
                            <Grid item xs={12} sm={3}>
                                <Typography variant="subtitle2">
                                    {record.details?.title || record.notes || '\u2014'}
                                </Typography>
                            </Grid>
                            <Grid item xs={12} sm={1} sx={{ textAlign: 'right' }}>
                                <IconButton size="small" color="error" onClick={() => handleDelete(record.id)}>
                                    <DeleteIcon fontSize="small" />
                                </IconButton>
                            </Grid>
                            {record.notes && (
                                <Grid item xs={12}>
                                    <Typography variant="body2" color="text.secondary">
                                        {record.notes}
                                    </Typography>
                                </Grid>
                            )}
                            {/* Attachments section */}
                            <Grid item xs={12}>
                                <AttachmentList record={record} />
                            </Grid>
                        </Grid>
                    </Paper>
                ))}

                {!isLoading && Array.isArray(records) && records.length === 0 && (
                    <Alert severity="info" sx={{ mt: 1 }}>
                        No health records found. Click &quot;Add Record&quot; to upload lab reports, imaging, vaccination records, etc.
                    </Alert>
                )}

                {/* Add Record Dialog */}
                <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
                    <DialogTitle>Add Health Record</DialogTitle>
                    <DialogContent dividers>
                        <Grid container spacing={2} sx={{ mt: 0.5 }}>
                            <Grid item xs={12}>
                                <FormControl fullWidth required>
                                    <InputLabel>Record Type</InputLabel>
                                    <Select
                                        name="record_type"
                                        value={newRecord.record_type}
                                        label="Record Type"
                                        onChange={handleFormChange}
                                    >
                                        {recordTypes.map((rt) => {
                                            const n = norm(rt);
                                            return (
                                                <MenuItem key={n.value} value={n.value}>
                                                    {n.label}
                                                </MenuItem>
                                            );
                                        })}
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <DatePicker
                                    label="Record Date"
                                    value={newRecord.record_date}
                                    onChange={handleDateChange}
                                    slotProps={{ textField: { fullWidth: true, required: true } }}
                                />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    fullWidth
                                    label="Title / Description"
                                    name="title"
                                    value={newRecord.title}
                                    onChange={handleFormChange}
                                    placeholder="e.g. CBC Report, X-Ray Chest"
                                />
                            </Grid>
                            <Grid item xs={12}>
                                <TextField
                                    fullWidth
                                    label="Notes"
                                    name="notes"
                                    value={newRecord.notes}
                                    onChange={handleFormChange}
                                    multiline
                                    rows={3}
                                />
                            </Grid>
                            {/* Dynamic custom fields added by admin */}
                            <DynamicFieldRenderer
                                sectionKey="health_records"
                                cfg={cfg}
                                excludeKeys={['record_type', 'record_date', 'title', 'notes']}
                                formData={newRecord}
                                onFieldChange={(fieldKey, value) => setNewRecord((prev) => ({ ...prev, [fieldKey]: value }))}
                            />

                            {/* Attachments in dialog */}
                            <Grid item xs={12}>
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                    Attachments
                                </Typography>

                                {/* Queued attachments */}
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
                                    Files will be uploaded when you save the record.
                                </Typography>
                            </Grid>
                        </Grid>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleCloseDialog}>Cancel</Button>
                        <Button
                            variant="contained"
                            onClick={handleSubmit}
                            disabled={isAdding || !newRecord.record_type}
                        >
                            {isAdding ? 'Adding...' : 'Add Record'}
                        </Button>
                    </DialogActions>
                </Dialog>
            </Box>
        </LocalizationProvider>
    );
};

export default React.memo(HealthRecordsSection);
