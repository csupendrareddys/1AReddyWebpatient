/**
 * PatientProfileConfigEditor — Main page for configuring the Patient Profile page.
 * Tabs: EDITOR | LIVE PREVIEW | HISTORY
 * Follows same pattern as DoctorProfileConfigEditor.
 * Supports dynamic field add/remove, field type changes, and N-language translations.
 */
import { useState, useEffect, useCallback } from 'react';
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
import ConfigEditorHeader from '../../../../../common/components/ConfigEditorHeader/ConfigEditorHeader';
import RestoreIcon from '@mui/icons-material/Restore';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import VisibilityIcon from '@mui/icons-material/Visibility';
import HistoryIcon from '@mui/icons-material/History';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PersonIcon from '@mui/icons-material/Person';
import ContactPhoneIcon from '@mui/icons-material/ContactPhone';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import SecurityIcon from '@mui/icons-material/Security';
import PregnantWomanIcon from '@mui/icons-material/PregnantWoman';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import HealingIcon from '@mui/icons-material/Healing';
import FolderSharedIcon from '@mui/icons-material/FolderShared';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import GroupIcon from '@mui/icons-material/Group';
import { useNavigate, useSearchParams } from 'react-router-dom';
import usePatientProfileConfigEditor from '../../hooks/usePatientProfileConfigEditor';
import SectionEditor from './components/SectionEditor';
import PatientProfilePreviewTab from './components/PatientProfilePreviewTab';
import { useDeletePatientProfileFieldConfigMutation } from '../../../../service-receiver/api/patientProfileConfigEndpoints';

// ── Section groups matching the patient profile page tab structure ──
const TAB_GROUPS = [
    {
        key: 'personal_details',
        label: 'Personal Details',
        icon: <PersonIcon />,
        color: '#e3f2fd',
        sections: ['personal_details'],
    },
    {
        key: 'contact_identity',
        label: 'Contact & Identity',
        icon: <ContactPhoneIcon />,
        color: '#f3e5f5',
        sections: ['contact_identity'],
    },
    {
        key: 'address',
        label: 'Address',
        icon: <HomeWorkIcon />,
        color: '#e8f5e9',
        sections: ['address'],
    },
    {
        key: 'emergency_contact',
        label: 'Emergency Contact',
        icon: <LocalHospitalIcon />,
        color: '#fff3e0',
        sections: ['emergency_contact'],
    },
    {
        key: 'insurance',
        label: 'Insurance',
        icon: <SecurityIcon />,
        color: '#e8eaf6',
        sections: ['insurance'],
    },
    {
        key: 'female_health',
        label: 'Female Health',
        icon: <PregnantWomanIcon />,
        color: '#fce4ec',
        sections: ['female_health'],
    },
    {
        key: 'vitals',
        label: 'Vitals',
        icon: <MonitorHeartIcon />,
        color: '#e0f2f1',
        sections: ['vitals'],
    },
    {
        key: 'habits',
        label: 'Habits & Lifestyle',
        icon: <FitnessCenterIcon />,
        color: '#fbe9e7',
        sections: ['habits'],
    },
    {
        key: 'surgeries',
        label: 'Surgeries',
        icon: <HealingIcon />,
        color: '#efebe9',
        sections: ['surgeries'],
    },
    {
        key: 'health_records',
        label: 'Health Records',
        icon: <FolderSharedIcon />,
        color: '#eceff1',
        sections: ['health_records'],
    },
    {
        key: 'prescriptions',
        label: 'Previous Prescriptions',
        icon: <ReceiptLongIcon />,
        color: '#e1f5fe',
        sections: ['previous_prescriptions'],
    },
    {
        key: 'family_group',
        label: 'House / Family Group',
        icon: <GroupIcon />,
        color: '#f1f8e9',
        sections: ['house_family_group'],
    },
];

const PatientProfileConfigEditor = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // Read section targeting from URL
    const sectionParam = searchParams.get('section');

    // Pass section to hook so backend only sends that group's field configs
    const sectionGroupForApi = (sectionParam && sectionParam !== 'page_settings')
        ? sectionParam : null;

    const {
        hasViewAccess,
        hasEditAccess,
        activeTab,
        setActiveTab,
        configs,
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
        handleRestore,
    } = usePatientProfileConfigEditor(sectionGroupForApi);

    const [deleteFieldConfig] = useDeletePatientProfileFieldConfigMutation();
    const handleRemoveField = async (fieldId) => {
        try {
            await deleteFieldConfig(fieldId).unwrap();
        } catch (e) {
            console.error('Failed to delete field:', e);
        }
    };

    // Track which tab groups are expanded
    const [expandedGroups, setExpandedGroups] = useState(
        TAB_GROUPS.reduce((acc, g) => ({ ...acc, [g.key]: true }), {})
    );

    // URL-driven tab targeting: ?tab=preview or ?tab=history
    useEffect(() => {
        const tabParam = searchParams.get('tab');
        if (tabParam === 'preview') {
            setActiveTab(1);
        } else if (tabParam === 'history') {
            setActiveTab(2);
        }
    }, [searchParams, setActiveTab]);

    const toggleGroup = (key) => {
        setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    // Handle adding a new field to a section (adds to localFieldConfigs)
    const handleAddField = useCallback((fieldData) => {
        // Generate a temporary ID for the new field
        const tempId = `new_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newField = {
            id: tempId,
            ...fieldData,
            is_present: true,
            translations: {},
            _isNew: true, // flag for backend to create rather than update
        };
        // We need to update localFieldConfigs directly — use the hook's handleFieldConfigChange pattern
        // Since the hook doesn't expose setLocalFieldConfigs, we'll use a workaround via handleFieldConfigChange
        // Actually, let's add it properly
        handleFieldConfigChange(tempId, '_addNew', newField);
    }, [handleFieldConfigChange]);

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

    // ── Preview button handler: auto-save → promote → switch to preview tab ──
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
                    Configure colors, titles, and branding for the Patient Profile page.
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
                    { key: 'primary_button_text', label: 'Save Button Text', type: 'text' },
                    { key: 'footer_text', label: 'Footer Text', type: 'textarea', visibilityKey: 'footer_is_present' },
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
                            {field.type === 'textarea' && (
                                <TextField
                                    size="small"
                                    fullWidth
                                    multiline
                                    rows={2}
                                    value={localDraft?.[field.key] || ''}
                                    onChange={(e) => handleDraftChange(field.key, e.target.value)}
                                    disabled={!hasEditAccess}
                                />
                            )}
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                            {field.visibilityKey ? (
                                <Typography variant="caption" color="text.disabled">Toggle</Typography>
                            ) : (
                                <Typography variant="caption" color="text.disabled">Always Visible</Typography>
                            )}
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
                                onAddField={hasEditAccess ? handleAddField : undefined}
                                onRemoveField={hasEditAccess ? handleRemoveField : undefined}
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
    const renderEditorTab = () => {
        // When a specific section is targeted via URL, show ONLY that section
        if (sectionParam) {
            // Page Settings
            if (sectionParam === 'page_settings') {
                return <Box>{renderPageSettings()}</Box>;
            }
            // Specific section group
            const targetGroup = TAB_GROUPS.find((g) => g.key === sectionParam);
            if (targetGroup) {
                return <Box>{renderGroupCard(targetGroup)}</Box>;
            }
            // Fallback
            return <Alert severity="warning">Unknown section: {sectionParam}</Alert>;
        }

        // No section targeting — show everything
        return (
            <Box>
                {renderPageSettings()}
                <Typography variant="h6" sx={{ mb: 2 }}>Dynamic Fields by Section</Typography>
                {TAB_GROUPS.map((group) => renderGroupCard(group))}
            </Box>
        );
    };

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
                                <TableCell sx={{ fontWeight: 'bold' }} align="center">Actions</TableCell>
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
                                    <TableCell align="center">
                                        {v.status !== 'draft' && hasEditAccess && (
                                            <Button
                                                size="small"
                                                startIcon={<RestoreIcon />}
                                                onClick={() => handleRestore(v.id)}
                                                sx={{ textTransform: 'none' }}
                                            >
                                                Restore
                                            </Button>
                                        )}
                                    </TableCell>
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
                    <Link
                        component="button"
                        underline="hover"
                        color="inherit"
                        onClick={() => navigate('/dashboard/admin/patient-profile-config')}
                    >
                        Patient Profile Module
                    </Link>
                    <Typography color="primary" fontWeight="bold">
                        Editor
                    </Typography>
                </Breadcrumbs>
            </Paper>

            {/* Unified Draft / Preview / Publish header. */}
            <ConfigEditorHeader
                title="Patient Profile — Page Controls"
                onBack={() => navigate('/dashboard/admin')}
                canEdit={hasEditAccess}
                hasChanges={hasUnsavedChanges}
                draftExists={!!configs.draft}
                previewExists={!!configs.preview}
                live={configs.live}
                draftVersion={configs.draft?.version}
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
            {activeTab === 1 && (
                <PatientProfilePreviewTab
                    localDraft={localDraft}
                    localFieldConfigs={localFieldConfigs}
                    sectionFilter={sectionParam}
                />
            )}
            {activeTab === 2 && renderHistoryTab()}

            {/* Publish Confirmation Dialog */}
            <Dialog open={showPublishDialog} onClose={() => setShowPublishDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Publish Configuration</DialogTitle>
                <DialogContent>
                    <Typography>
                        Are you sure you want to publish the current preview to live?
                        This will replace the current live configuration and affect all patients immediately.
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

export default PatientProfileConfigEditor;
