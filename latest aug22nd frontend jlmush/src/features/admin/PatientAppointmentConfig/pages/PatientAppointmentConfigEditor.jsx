/**
 * PatientAppointmentConfigEditor — Main page for configuring Patient Appointment pages.
 * Supports two page types: patient_appointment_filter and patient_appointment_symptoms.
 * Tabs: EDITOR | PREVIEW (placeholder) | HISTORY
 * Reuses SectionEditor from DoctorProfileConfig.
 */
import { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, Tabs, Tab, Button, Alert, Card, CardContent,
    TextField, CircularProgress, Breadcrumbs, Link, Dialog, DialogTitle,
    DialogContent, DialogActions, Chip, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Collapse, IconButton,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import PreviewIcon from '@mui/icons-material/Preview';
import PublishIcon from '@mui/icons-material/Publish';
import HomeIcon from '@mui/icons-material/Home';
import WarningIcon from '@mui/icons-material/Warning';
import ConfigEditorHeader from '../../../../common/components/ConfigEditorHeader/ConfigEditorHeader';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import VisibilityIcon from '@mui/icons-material/Visibility';
import HistoryIcon from '@mui/icons-material/History';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FilterListIcon from '@mui/icons-material/FilterList';
import TuneIcon from '@mui/icons-material/Tune';
import SettingsIcon from '@mui/icons-material/Settings';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import { useNavigate, useParams } from 'react-router-dom';
import usePatientAppointmentConfigEditor from '../hooks/usePatientAppointmentConfigEditor';
import SectionEditor from '../../DoctorProfileConfig/pages/DoctorProfileConfigEditor/components/SectionEditor';
import { useDeletePatientAppointmentFieldConfigMutation } from '../../api/patientAppointmentConfigEndpoints';

// ── Section groups matching patient appointment page tab structure ──
const TAB_GROUPS_BY_PAGE_TYPE = {
    patient_appointment_filter: [
        { key: 'filters_general', label: 'General Filters', icon: <FilterListIcon />, color: '#e3f2fd', sections: ['filter_general'] },
        { key: 'filters_preferences', label: 'Preference Filters', icon: <TuneIcon />, color: '#f3e5f5', sections: ['filter_preferences'] },
    ],
    patient_appointment_symptoms: [
        { key: 'symptoms_display', label: 'Display Settings', icon: <SettingsIcon />, color: '#e8f5e9', sections: ['symptoms_display'] },
        { key: 'symptoms_categories', label: 'Symptom Categories', icon: <LocalHospitalIcon />, color: '#fce4ec', sections: ['symptoms_categories'] },
    ],
};

const PAGE_TYPE_LABELS = {
    patient_appointment_filter: 'Appointment Filter',
    patient_appointment_symptoms: 'Appointment Symptoms',
};

const PatientAppointmentConfigEditor = () => {
    const navigate = useNavigate();
    const { pageType } = useParams();

    const {
        hasViewAccess,
        hasEditAccess,
        activeTab,
        setActiveTab,
        localDraft,
        localFieldConfigs,
        dataSources,
        history,
        isLoading,
        isSaving,
        isPromoting,
        isPublishing,
        isLoadingHistory,
        hasUnsavedChanges,
        showPublishDialog,
        setShowPublishDialog,
        handleDraftChange,
        handleSectionChange,
        handleFieldConfigChange,
        handleSaveDraft,
        handlePromoteToPreview,
        handlePublish,
    } = usePatientAppointmentConfigEditor(pageType);

    const [deleteFieldConfig] = useDeletePatientAppointmentFieldConfigMutation();
    const handleRemoveField = async (fieldId) => {
        try {
            await deleteFieldConfig({ pageType, fieldId }).unwrap();
        } catch (e) {
            console.error('Failed to delete field:', e);
        }
    };

    const TAB_GROUPS = TAB_GROUPS_BY_PAGE_TYPE[pageType] || [];

    // Track which tab groups are expanded
    const [expandedGroups, setExpandedGroups] = useState(
        TAB_GROUPS.reduce((acc, g) => ({ ...acc, [g.key]: true }), {})
    );

    // Reset expanded groups when page type changes
    useEffect(() => {
        const groups = TAB_GROUPS_BY_PAGE_TYPE[pageType] || [];
        setExpandedGroups(groups.reduce((acc, g) => ({ ...acc, [g.key]: true }), {}));
    }, [pageType]);

    const toggleGroup = (key) => {
        setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    if (!pageType || !TAB_GROUPS_BY_PAGE_TYPE[pageType]) {
        return (
            <Paper sx={{ textAlign: 'center', py: 4, px: 2 }}>
                <Typography variant="h6" color="error">Invalid Page Type</Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>
                    Supported types: patient_appointment_filter, patient_appointment_symptoms
                </Typography>
            </Paper>
        );
    }

    if (!hasViewAccess) {
        return (
            <Paper sx={{ textAlign: 'center', py: 4, px: 2 }}>
                <Typography variant="h6" color="error">Access Denied</Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>
                    You do not have permission to access this page.
                </Typography>
            </Paper>
        );
    }

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                <CircularProgress />
            </Box>
        );
    }

    const sections = localDraft?.fields?.sections || [];

    // Helper: get sections belonging to a tab group
    const getSectionsForGroup = (groupSectionKeys) =>
        sections.filter((s) => groupSectionKeys.includes(s.key));

    // ── Preview button handler: auto-save -> promote -> switch to preview tab ──
    const handlePreviewClick = async () => {
        await handlePromoteToPreview();
        setActiveTab(1);
    };

    // ── Page Settings Card ──
    const renderPageSettings = () => (
        <Card sx={{ mb: 3 }}>
            <CardContent>
                <Typography variant="h6" gutterBottom>Page Settings</Typography>
                <Typography color="text.secondary" sx={{ mb: 2 }} variant="body2">
                    Configure colors, titles, and branding for the {PAGE_TYPE_LABELS[pageType]} page.
                </Typography>

                <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: 560 }}>
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: '50px 200px 1fr 150px',
                    gap: 1,
                    alignItems: 'center',
                    bgcolor: 'primary.main',
                    color: 'white',
                    p: 1.5,
                    borderRadius: '4px 4px 0 0',
                }}>
                    <Typography fontWeight="bold" textAlign="center" fontSize="0.85rem">S.No</Typography>
                    <Typography fontWeight="bold" fontSize="0.85rem">Field Name</Typography>
                    <Typography fontWeight="bold" fontSize="0.85rem">Value</Typography>
                    <Typography fontWeight="bold" textAlign="center" fontSize="0.85rem">Display</Typography>
                </Box>

                {[
                    { key: 'primary_color', label: 'Primary Color', type: 'color' },
                    { key: 'secondary_color', label: 'Secondary Color', type: 'color' },
                    { key: 'background_color', label: 'Page Background Color', type: 'color' },
                    { key: 'card_background_color', label: 'Card / Section Background Color', type: 'color' },
                    { key: 'page_title', label: 'Page Title', type: 'text' },
                    { key: 'page_subtitle', label: 'Page Subtitle', type: 'text' },
                    { key: 'primary_button_text', label: 'Primary Button Text', type: 'text' },
                ].map((field, index) => (
                    <Box
                        key={field.key}
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: '50px 200px 1fr 150px',
                            gap: 1,
                            alignItems: 'center',
                            p: 1,
                            borderBottom: '1px solid',
                            borderLeft: '1px solid',
                            borderRight: '1px solid',
                            borderColor: 'divider',
                            bgcolor: index % 2 === 0 ? '#fafafa' : 'white',
                        }}
                    >
                        <Typography textAlign="center" fontWeight="500">
                            {String(index + 1).padStart(2, '0')}
                        </Typography>
                        <Typography fontWeight="500">{field.label}</Typography>
                        <Box>
                            {field.type === 'color' && (
                                <TextField
                                    type="color"
                                    size="small"
                                    value={localDraft?.[field.key] || '#000000'}
                                    onChange={(e) => handleDraftChange(field.key, e.target.value)}
                                    disabled={!hasEditAccess}
                                    sx={{ width: 100 }}
                                />
                            )}
                            {field.type === 'text' && (
                                <TextField
                                    size="small"
                                    fullWidth
                                    value={localDraft?.[field.key] || ''}
                                    onChange={(e) => handleDraftChange(field.key, e.target.value)}
                                    disabled={!hasEditAccess}
                                />
                            )}
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                            <Typography variant="caption" color="text.disabled">Always Visible</Typography>
                        </Box>
                    </Box>
                ))}
                </Box>
                </Box>
            </CardContent>
        </Card>
    );

    // ── Render a single section group card ──
    const renderGroupCard = (group) => {
        const groupSections = getSectionsForGroup(group.sections);
        if (groupSections.length === 0) return null;

        return (
            <Card key={group.key} sx={{ mb: 3, border: '2px solid', borderColor: 'divider' }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        p: 2,
                        bgcolor: group.color,
                        cursor: 'pointer',
                        borderBottom: expandedGroups[group.key] ? '1px solid' : 'none',
                        borderColor: 'divider',
                    }}
                    onClick={() => toggleGroup(group.key)}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        {group.icon}
                        <Typography variant="h6" fontWeight="bold">
                            {group.label}
                        </Typography>
                        <Chip
                            label={`${groupSections.length} section${groupSections.length > 1 ? 's' : ''}`}
                            size="small"
                            variant="outlined"
                        />
                    </Box>
                    <IconButton size="small">
                        {expandedGroups[group.key] ? <ExpandMoreIcon sx={{ transform: 'rotate(180deg)' }} /> : <ExpandMoreIcon />}
                    </IconButton>
                </Box>
                <Collapse in={expandedGroups[group.key]}>
                    <Box sx={{ p: 2 }}>
                        {groupSections.map((section) => (
                            <SectionEditor
                                key={section.key}
                                section={section}
                                fieldConfigs={localFieldConfigs}
                                onSectionChange={handleSectionChange}
                                onFieldChange={handleFieldConfigChange}
                                onRemoveField={handleRemoveField}
                                dataSources={dataSources}
                                disabled={!hasEditAccess}
                            />
                        ))}
                    </Box>
                </Collapse>
            </Card>
        );
    };

    // ── EDITOR TAB ──
    const renderEditorTab = () => (
        <Box>
            {renderPageSettings()}
            <Typography variant="h6" sx={{ mb: 2 }}>Dynamic Fields by Section</Typography>
            {TAB_GROUPS.map((group) => renderGroupCard(group))}
        </Box>
    );

    // ── PREVIEW TAB (placeholder) ──
    const renderPreviewTab = () => (
        <Box sx={{ textAlign: 'center', py: 6 }}>
            <VisibilityIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h6" color="text.secondary">
                Live Preview
            </Typography>
            <Typography color="text.disabled" sx={{ mt: 1 }}>
                A live preview of the {PAGE_TYPE_LABELS[pageType]} page will be rendered here
                once draft is promoted to preview.
            </Typography>
        </Box>
    );

    // ── HISTORY TAB ──
    const renderHistoryTab = () => (
        <Box>
            <Typography variant="h6" gutterBottom>Version History</Typography>
            {isLoadingHistory ? (
                <CircularProgress size={24} />
            ) : (
                <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                                <TableCell sx={{ fontWeight: 'bold' }}>Version</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Published At</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Created At</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {(history || []).map((v) => (
                                <TableRow key={v.id} hover>
                                    <TableCell>v{v.version}</TableCell>
                                    <TableCell>
                                        <Chip
                                            label={v.status}
                                            size="small"
                                            color={v.status === 'live' ? 'success' : v.status === 'draft' ? 'warning' : 'default'}
                                        />
                                    </TableCell>
                                    <TableCell>{v.published_at ? new Date(v.published_at).toLocaleString() : '\u2014'}</TableCell>
                                    <TableCell>{v.created_at ? new Date(v.created_at).toLocaleString() : '\u2014'}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Box>
    );

    return (
        <Box>
            {/* Breadcrumbs */}
            <Paper sx={{ mb: 2, py: 1.5, px: 2 }}>
                <Breadcrumbs>
                    <Link
                        component="button"
                        underline="hover"
                        color="inherit"
                        onClick={() => navigate('/dashboard/admin')}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                    >
                        <HomeIcon fontSize="small" />
                        Dashboard
                    </Link>
                    <Link
                        component="button"
                        underline="hover"
                        color="inherit"
                        onClick={() => navigate('/dashboard/admin/page-controls')}
                    >
                        Page Controls
                    </Link>
                    <Typography color="primary" fontWeight="bold">
                        {PAGE_TYPE_LABELS[pageType]} Editor
                    </Typography>
                </Breadcrumbs>
            </Paper>

            {/* Unified Draft / Preview / Publish header. NB: this editor
                still runs on the single-row lifecycle (draft row carries
                a ``status`` flag instead of a separate ``live`` row), so
                ``previewExists`` is derived from ``localDraft.status``
                and there's no ``live`` row to surface here. Backend
                roundtrip to a true three-row model would unify this with
                the rest, but a UI-only harmonisation gets the look-and-
                feel parity the operator asked for without schema
                changes. */}
            <ConfigEditorHeader
                title={`${PAGE_TYPE_LABELS[pageType]} — Page Controls`}
                onBack={() => navigate('/dashboard/admin')}
                canEdit={hasEditAccess}
                hasChanges={hasUnsavedChanges}
                draftExists={!!localDraft}
                previewExists={localDraft?.status === 'preview'}
                live={null}
                draftVersion={localDraft?.version}
                isSaving={isSaving || isPromoting || isPublishing}
                onSaveDraft={handleSaveDraft}
                onPreview={handlePreviewClick}
                onPublish={() => setShowPublishDialog(true)}
            />

            {hasUnsavedChanges && (
                <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2 }}>
                    You have unsaved changes. Save your draft before promoting or publishing.
                </Alert>
            )}

            {/* Tabs — EDITOR | LIVE PREVIEW | HISTORY */}
            <Tabs
                value={activeTab}
                onChange={(_, v) => setActiveTab(v)}
                sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
            >
                <Tab
                    label="Editor"
                    icon={<TextFieldsIcon />}
                    iconPosition="start"
                    sx={{ textTransform: 'none', fontWeight: 'bold' }}
                />
                <Tab
                    label="Live Preview"
                    icon={<VisibilityIcon />}
                    iconPosition="start"
                    sx={{ textTransform: 'none', fontWeight: 'bold' }}
                />
                <Tab
                    label="History"
                    icon={<HistoryIcon />}
                    iconPosition="start"
                    sx={{ textTransform: 'none', fontWeight: 'bold' }}
                />
            </Tabs>

            {/* Tab Content */}
            {activeTab === 0 && renderEditorTab()}
            {activeTab === 1 && renderPreviewTab()}
            {activeTab === 2 && renderHistoryTab()}

            {/* Publish Confirmation Dialog */}
            <Dialog open={showPublishDialog} onClose={() => setShowPublishDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Publish Configuration</DialogTitle>
                <DialogContent>
                    <Typography>
                        Are you sure you want to publish the current preview to live?
                        This will replace the current live configuration and affect all users immediately.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowPublishDialog(false)}>Cancel</Button>
                    <Button
                        onClick={handlePublish}
                        variant="contained"
                        color="success"
                        disabled={isPublishing}
                    >
                        {isPublishing ? 'Publishing...' : 'Confirm Publish'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default PatientAppointmentConfigEditor;
