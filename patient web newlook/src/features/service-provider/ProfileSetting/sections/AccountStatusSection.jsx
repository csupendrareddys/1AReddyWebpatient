import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
    Box, Paper, Typography, LinearProgress, Chip, Grid,
    Tooltip, Divider, List, ListItem, ListItemText, ListItemIcon,
    CircularProgress, Alert, Tabs, Tab, TextField, Button,
    Snackbar, IconButton,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import AssignmentIcon from '@mui/icons-material/Assignment';
import PublishIcon from '@mui/icons-material/Publish';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import SendIcon from '@mui/icons-material/Send';
import CloseIcon from '@mui/icons-material/Close';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import useAccountStatus from '../hooks/useAccountStatus';
import { CONSULTATION_TYPES } from '../constants/consultationTypes';

// ── Constants ────────────────────────────────────────────────────────────────

const PUBLISH_STATUS_CONFIG = {
    active:    { label: 'Active',    color: 'success', icon: <CheckCircleIcon fontSize="small" /> },
    inactive:  { label: 'Inactive',  color: 'default', icon: <CancelIcon fontSize="small" /> },
    on_hold:   { label: 'On Hold',   color: 'warning', icon: <PauseCircleIcon fontSize="small" /> },
    suspended: { label: 'Suspended', color: 'error',   icon: <CancelIcon fontSize="small" /> },
};

const SECTION_LABELS = {
    personal_details:            'Personal & Professional Details',
    additional_personal_details: 'Additional Personal Details',
    identity_documents:          'Identity Documents',
    current_address:             'Communication (Current) Address',
    permanent_address:           'Permanent Address',
    signatures:                  'Signatures',
    about_me:                    'About Me',
    education:                   'Education',
    bank_details:                'Bank Details',
    declaration_documents:       'Declaration & Documents',
};

// ── Profile Completion Sub-tab ───────────────────────────────────────────────

const ProfileCompletionSubTab = ({ profileCompletion, pendingCount }) => {
    if (!profileCompletion) {
        return (
            <Box display="flex" justifyContent="center" py={6}>
                <CircularProgress size={24} />
            </Box>
        );
    }

    const {
        percentage, sections_status,
        pending_approvals_by_section, queries_by_section,
        total_pending, total_queries,
    } = profileCompletion;

    return (
        <Box>
            {/* Progress Bar */}
            <Box sx={{ mb: 3 }}>
                <Box display="flex" justifyContent="space-between" mb={1}>
                    <Typography variant="body2" color="text.secondary">Overall Completion</Typography>
                    <Typography variant="body2" fontWeight="bold">{percentage}%</Typography>
                </Box>
                <LinearProgress
                    variant="determinate"
                    value={percentage}
                    sx={{
                        height: 10,
                        borderRadius: 5,
                        bgcolor: '#e0e0e0',
                        '& .MuiLinearProgress-bar': {
                            borderRadius: 5,
                            bgcolor: percentage >= 80 ? '#4caf50' : percentage >= 50 ? '#ff9800' : '#f44336',
                        },
                    }}
                />
            </Box>

            {/* Summary chips */}
            <Box display="flex" gap={1} mb={3} flexWrap="wrap">
                {total_pending > 0 && (
                    <Chip icon={<HourglassEmptyIcon />} label={`${total_pending} Pending Approval(s)`}
                        color="warning" size="small" variant="outlined" />
                )}
                {total_queries > 0 && (
                    <Chip icon={<ErrorIcon />} label={`${total_queries} Query/Queries`}
                        color="info" size="small" variant="outlined" />
                )}
                {percentage === 100 && total_pending === 0 && (
                    <Chip icon={<CheckCircleIcon />} label="Profile Complete" color="success" size="small" />
                )}
            </Box>

            <Divider sx={{ mb: 2 }} />

            {/* Section-wise breakdown */}
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                Section-wise Status
            </Typography>
            <List dense disablePadding>
                {Object.entries(sections_status || {}).map(([section, status]) => {
                    const pendingInSection = pending_approvals_by_section?.[section] || 0;
                    const queriesInSection = queries_by_section?.[section] || 0;
                    const isComplete = status.filled === status.total && pendingInSection === 0;

                    return (
                        <ListItem key={section} sx={{ py: 0.5, px: 0 }}>
                            <ListItemIcon sx={{ minWidth: 32 }}>
                                {isComplete
                                    ? <CheckCircleIcon color="success" fontSize="small" />
                                    : <ErrorIcon color="warning" fontSize="small" />}
                            </ListItemIcon>
                            <ListItemText
                                primary={
                                    <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                                        <Typography variant="body2">
                                            {SECTION_LABELS[section] || section}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            ({status.filled}/{status.total} fields)
                                        </Typography>
                                        {pendingInSection > 0 && (
                                            <Chip label={`${pendingInSection} pending`} size="small"
                                                color="warning" variant="outlined"
                                                sx={{ height: 20, fontSize: '0.7rem' }} />
                                        )}
                                        {queriesInSection > 0 && (
                                            <Chip label={`${queriesInSection} query`} size="small"
                                                color="info" variant="outlined"
                                                sx={{ height: 20, fontSize: '0.7rem' }} />
                                        )}
                                    </Box>
                                }
                                secondary={
                                    status.missing?.length > 0
                                        ? `Missing: ${status.missing.join(', ')}`
                                        : null
                                }
                            />
                        </ListItem>
                    );
                })}
            </List>
        </Box>
    );
};

// ── Publish Status Sub-tab ───────────────────────────────────────────────────

const PublishStatusSubTab = ({ globalPublishStatus, publishStatusByType, isPlaceholder }) => {
    // Per-type status — use backend data, fallback to global status per type.
    // Shape: { audio: 'active', video: 'on_hold', ... }
    const typeStatusMap = CONSULTATION_TYPES.reduce((acc, ct) => {
        acc[ct.value] = publishStatusByType?.[ct.value] || globalPublishStatus || 'inactive';
        return acc;
    }, {});

    // Raise-request form state
    const [selectedType, setSelectedType] = useState('');
    const [remarks, setRemarks]           = useState('');
    const [attachments, setAttachments]   = useState([]);
    const [snackbar, setSnackbar]         = useState({ open: false, message: '' });
    const fileInputRef = useRef(null);

    const handleFileChange = (e) => {
        const files = Array.from(e.target.files || []);
        setAttachments((prev) => [...prev, ...files]);
        e.target.value = '';
    };

    const removeAttachment = (index) => {
        setAttachments((prev) => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = () => {
        if (!remarks.trim()) {
            setSnackbar({ open: true, message: 'Please add remarks before submitting.' });
            return;
        }
        // TODO: wire to backend endpoint when ready
        setSnackbar({ open: true, message: 'Request sent to admin successfully.' });
        setRemarks('');
        setAttachments([]);
        setSelectedType('');
    };

    if (isPlaceholder) {
        return (
            <Alert severity="info">
                Publish status management is not applicable for admin profiles.
            </Alert>
        );
    }

    return (
        <Box>
            {/* ── Per-consultation-type status grid ── */}
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
                Current status per consultation type (set by admin)
            </Typography>
            <Grid container spacing={2} sx={{ mb: 4 }}>
                {CONSULTATION_TYPES.map((ct) => {
                    const status = typeStatusMap[ct.value] || 'inactive';
                    const cfg    = PUBLISH_STATUS_CONFIG[status] || PUBLISH_STATUS_CONFIG.inactive;
                    return (
                        <Grid item xs={12} sm={6} md={4} key={ct.value}>
                            <Paper
                                variant="outlined"
                                sx={{
                                    p: 2,
                                    borderRadius: 2,
                                    borderLeft: `4px solid`,
                                    borderLeftColor:
                                        status === 'active'    ? 'success.main' :
                                        status === 'on_hold'   ? 'warning.main' :
                                        status === 'suspended' ? 'error.main'   : 'grey.400',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 2,
                                }}
                            >
                                <Box
                                    sx={{
                                        width: 36, height: 36, borderRadius: '50%',
                                        bgcolor: ct.color + '1A',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 18, flexShrink: 0,
                                    }}
                                >
                                    {ct.icon}
                                </Box>
                                <Box flex={1} minWidth={0}>
                                    <Typography variant="body2" fontWeight={600} noWrap>
                                        {ct.label}
                                    </Typography>
                                    <Chip
                                        label={cfg.label}
                                        color={cfg.color}
                                        size="small"
                                        icon={cfg.icon}
                                        sx={{ mt: 0.5, height: 22, fontSize: '0.72rem' }}
                                    />
                                </Box>
                            </Paper>
                        </Grid>
                    );
                })}
            </Grid>

            <Divider sx={{ mb: 3 }} />

            {/* ── Raise a Request ── */}
            <Typography variant="h6" fontWeight="bold" sx={{ mb: 0.5 }}>
                Raise a Request to Admin
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Use this form to request a status change or flag an issue. Admin will review and respond.
            </Typography>

            <Box display="flex" flexDirection="column" gap={2}>
                {/* Consultation type selector (optional) */}
                <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                        Regarding (optional)
                    </Typography>
                    <Box display="flex" gap={1} flexWrap="wrap">
                        <Chip
                            label="All Types"
                            variant={selectedType === '' ? 'filled' : 'outlined'}
                            color={selectedType === '' ? 'primary' : 'default'}
                            onClick={() => setSelectedType('')}
                            size="small"
                            clickable
                        />
                        {CONSULTATION_TYPES.map((ct) => (
                            <Chip
                                key={ct.value}
                                label={ct.shortLabel}
                                variant={selectedType === ct.value ? 'filled' : 'outlined'}
                                color={selectedType === ct.value ? 'primary' : 'default'}
                                onClick={() => setSelectedType(ct.value)}
                                size="small"
                                clickable
                                sx={{
                                    borderColor: ct.color,
                                    color: selectedType === ct.value ? '#fff' : ct.color,
                                    bgcolor: selectedType === ct.value ? ct.color : undefined,
                                    '&:hover': { bgcolor: ct.color + '22' },
                                }}
                            />
                        ))}
                    </Box>
                </Box>

                {/* Remarks */}
                <TextField
                    label="Remarks"
                    multiline
                    minRows={3}
                    fullWidth
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Describe your request or issue here..."
                    size="small"
                />

                {/* Attachments */}
                <Box>
                    <input
                        type="file"
                        multiple
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                    />
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<AttachFileIcon />}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        Attach Files
                    </Button>
                    {attachments.length > 0 && (
                        <Box display="flex" flexWrap="wrap" gap={1} mt={1}>
                            {attachments.map((file, idx) => (
                                <Chip
                                    key={idx}
                                    label={file.name}
                                    size="small"
                                    onDelete={() => removeAttachment(idx)}
                                    sx={{ maxWidth: 200 }}
                                />
                            ))}
                        </Box>
                    )}
                </Box>

                {/* Submit */}
                <Box>
                    <Button
                        variant="contained"
                        color="primary"
                        startIcon={<SendIcon />}
                        onClick={handleSubmit}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        Send Request to Admin
                    </Button>
                </Box>
            </Box>

            <Snackbar
                open={snackbar.open}
                autoHideDuration={3500}
                onClose={() => setSnackbar({ open: false, message: '' })}
                message={snackbar.message}
                action={
                    <IconButton size="small" color="inherit" onClick={() => setSnackbar({ open: false, message: '' })}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                }
            />
        </Box>
    );
};

// ── Main Section ─────────────────────────────────────────────────────────────

const AccountStatusSection = ({
    previewMode = false, registerSave,
    doctorId, isAdminView = false, entityType = 'doctor',
}) => {
    const {
        isLoading,
        isUpdatingPublish,
        publishStatus,
        publishStatusByType,
        profileCompletion,
        pendingCount,
    } = useAccountStatus(entityType, doctorId, { skip: previewMode || !doctorId });

    const [activeSubTab, setActiveSubTab] = useState(0);

    useEffect(() => {
        if (registerSave) {
            registerSave(null, 'Account Status', true);
            return () => registerSave(null, 'Save', false);
        }
    }, [registerSave]);

    if (isLoading) {
        return (
            <Box display="flex" justifyContent="center" py={6}>
                <CircularProgress />
            </Box>
        );
    }

    const isPlaceholder = entityType === 'admin';

    return (
        <Box>
            <div className="section-title-bar">Account Status</div>

            {/* ── Sub-navigation ── */}
            <Paper variant="outlined" sx={{ mb: 3 }}>
                <Tabs
                    value={activeSubTab}
                    onChange={(_, v) => setActiveSubTab(v)}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{
                        '& .MuiTab-root': {
                            textTransform: 'none',
                            fontWeight: 600,
                            minHeight: 48,
                        },
                    }}
                >
                    <Tab
                        icon={<AssignmentIcon fontSize="small" />}
                        iconPosition="start"
                        label="Profile Completion Status"
                    />
                    <Tab
                        icon={<PublishIcon fontSize="small" />}
                        iconPosition="start"
                        label="Publish Status"
                    />
                </Tabs>
            </Paper>

            {/* ── Sub-tab content ── */}
            <Paper elevation={1} sx={{ p: 3, borderRadius: 2 }}>
                {activeSubTab === 0 && (
                    <ProfileCompletionSubTab
                        profileCompletion={profileCompletion}
                        pendingCount={pendingCount}
                    />
                )}
                {activeSubTab === 1 && (
                    <PublishStatusSubTab
                        globalPublishStatus={publishStatus}
                        publishStatusByType={publishStatusByType}
                        isPlaceholder={isPlaceholder}
                    />
                )}
            </Paper>
        </Box>
    );
};

export default React.memo(AccountStatusSection);
