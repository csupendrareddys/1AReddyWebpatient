/**
 * DoctorProfileConfigEditor — Main page for configuring the Doctor Profile page.
 * Tabs: EDITOR | LIVE PREVIEW | HISTORY
 * Follows same pattern as PageConfigEditor.jsx (login module)
 */
import { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, Tabs, Tab, Button, Alert, Card, CardContent,
    TextField, CircularProgress, Breadcrumbs, Link, Dialog, DialogTitle,
    DialogContent, DialogActions, Chip, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Collapse, IconButton, Accordion,
    AccordionSummary, AccordionDetails, Snackbar,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import PreviewIcon from '@mui/icons-material/Preview';
import PublishIcon from '@mui/icons-material/Publish';
import HomeIcon from '@mui/icons-material/Home';
import ConfigEditorHeader from '../../../../../common/components/ConfigEditorHeader/ConfigEditorHeader';
import WarningIcon from '@mui/icons-material/Warning';
import RestoreIcon from '@mui/icons-material/Restore';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import VisibilityIcon from '@mui/icons-material/Visibility';
import HistoryIcon from '@mui/icons-material/History';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PersonIcon from '@mui/icons-material/Person';
import DrawIcon from '@mui/icons-material/Draw';
import InfoIcon from '@mui/icons-material/Info';
import SchoolIcon from '@mui/icons-material/School';
import ScheduleIcon from '@mui/icons-material/Schedule';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import GavelIcon from '@mui/icons-material/Gavel';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import EventNoteIcon from '@mui/icons-material/EventNote';
import SickIcon from '@mui/icons-material/Sick';
import StorageIcon from '@mui/icons-material/Storage';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useDoctorProfileConfigEditor from '../../hooks/useDoctorProfileConfigEditor';
import SectionEditor from './components/SectionEditor';
import MasterDataManager from './components/MasterDataManager';
import DoctorProfilePreviewTab from './components/DoctorProfilePreviewTab';
// Round 9, Phase 4 — per-module DRAFT/PREVIEW/LIVE controls.
// Renders above the section accordions; the legacy page-wide
// ConfigEditorHeader still works during the migration window.
import DoctorProfileModulesPanel from './components/DoctorProfileModulesPanel';
import { useDeleteDoctorProfileFieldConfigMutation } from '../../../api/doctorProfileConfigEndpoints';

// ── Section groups matching the doctor profile page tab structure ──
const TAB_GROUPS = [
    {
        key: 'personal_professional',
        label: 'Personal & Professional',
        icon: <PersonIcon />,
        color: '#e3f2fd',
        sections: ['personal_details', 'additional_personal_details', 'identity_documents', 'female_health_details', 'current_address', 'permanent_address'],
    },
    {
        key: 'signatures',
        label: 'Signatures',
        icon: <DrawIcon />,
        color: '#f3e5f5',
        sections: ['signatures'],
    },
    {
        key: 'about_me',
        label: 'About Me',
        icon: <InfoIcon />,
        color: '#e8f5e9',
        sections: ['about_me'],
    },
    {
        key: 'education',
        label: 'Education',
        icon: <SchoolIcon />,
        color: '#fff3e0',
        sections: ['education_graduation', 'education_post_graduation', 'education_super_speciality', 'education_other_certification'],
    },
    {
        key: 'bank_details',
        label: 'Bank Details',
        icon: <AccountBalanceIcon />,
        color: '#e8eaf6',
        sections: ['bank_details'],
    },
    {
        key: 'declaration_documents',
        label: 'Declaration & Documents',
        icon: <GavelIcon />,
        color: '#fbe9e7',
        sections: ['declaration_documents'],
    },
    {
        key: 'working_hours',
        label: 'Working Days & Hours',
        icon: <ScheduleIcon />,
        color: '#e0f2f1',
        sections: ['working_days_hours'],
    },
    {
        key: 'pricing',
        label: 'Consultation Pricing',
        icon: <AttachMoneyIcon />,
        color: '#fce4ec',
        sections: ['consultation_pricing'],
    },
    {
        key: 'analytics',
        label: 'Analytics',
        icon: <AnalyticsIcon />,
        color: '#e1f5fe',
        sections: ['doctor_analytics'],
    },
    {
        key: 'attendance_activity',
        label: 'Attendance & Activity',
        icon: <EventNoteIcon />,
        color: '#f1f8e9',
        sections: ['doctor_attendance'],
    },
    {
        key: 'treatable_symptoms',
        label: 'Treatable Symptoms',
        icon: <SickIcon />,
        color: '#fce4ec',
        sections: ['treatable_symptoms'],
    },
];

const DoctorProfileConfigEditor = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // Read section targeting from URL: ?section=analytics, ?section=attendance_activity, etc.
    const sectionParam = searchParams.get('section');

    // Pass section to hook so backend only sends that group's field configs
    const sectionGroupForApi = (sectionParam && sectionParam !== 'page_settings' && sectionParam !== 'master_data')
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
        auditLogs,
        isLoading,
        isSaving,
        isPromoting,
        isPublishing,
        isLoadingHistory,
        hasUnsavedChanges,
        showPublishDialog,
        setShowPublishDialog,
        snack,
        closeSnack,
        handleDraftChange,
        handleSectionChange,
        handleFieldConfigChange,
        handleSaveDraft,
        handlePromoteToPreview,
        handlePublish,
        handleRestore,
        registerOptionsFlusher,
    } = useDoctorProfileConfigEditor(sectionGroupForApi);

    const [deleteFieldConfig] = useDeleteDoctorProfileFieldConfigMutation();
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

    // Free-text comment the operator can attach when clicking Publish.
    // Forwarded to the backend's audit-log row for that release.
    // Cleared whenever the dialog opens or closes.
    const [publishNote, setPublishNote] = useState('');

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
        setActiveTab(1); // Switch to LIVE PREVIEW tab
    };

    // ── Page Settings Card (reusable) ──
    const renderPageSettings = () => (
        <Card sx={{ mb: 3 }}>
            <CardContent>
                <Typography variant="h6" gutterBottom>Page Settings</Typography>
                <Typography color="text.secondary" sx={{ mb: 2 }} variant="body2">
                    Configure colors, titles, and branding for the Doctor Profile page.
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
                                onRemoveField={handleRemoveField}
                                dataSources={dataSources}
                                disabled={!hasEditAccess}
                                registerOptionsFlusher={registerOptionsFlusher}
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
            // Page Settings — show only the page-level config card
            if (sectionParam === 'page_settings') {
                return <Box>{renderPageSettings()}</Box>;
            }
            // Master Data — show only the master data accordion
            if (sectionParam === 'master_data') {
                return (
                    <Box>
                        <Accordion defaultExpanded sx={{ mt: 0 }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: '#f5f5f5' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <StorageIcon color="action" />
                                    <Typography variant="h6" fontWeight="bold">Master Data (Symptoms)</Typography>
                                </Box>
                            </AccordionSummary>
                            <AccordionDetails>
                                <MasterDataManager symptomsOnly />
                            </AccordionDetails>
                        </Accordion>
                    </Box>
                );
            }
            // Specific section group — show only that group's card
            const targetGroup = TAB_GROUPS.find((g) => g.key === sectionParam);
            if (targetGroup) {
                return <Box>{renderGroupCard(targetGroup)}</Box>;
            }
            // Fallback: unknown section param
            return <Alert severity="warning">Unknown section: {sectionParam}</Alert>;
        }

        // No section targeting — show everything (full editor view)
        return (
            <Box>
                {/* Per-module DRAFT/PREVIEW/LIVE controls (Round 9, Phase 4).
                    Sits above the per-section editor so operators can
                    publish one module at a time. The legacy page-wide
                    ConfigEditorHeader at the top of the page still works. */}
                <DoctorProfileModulesPanel canEdit={hasEditAccess} />
                {renderPageSettings()}
                <Typography variant="h6" sx={{ mb: 2 }}>Dynamic Fields by Section</Typography>
                {TAB_GROUPS.map((group) => renderGroupCard(group))}
                <Accordion sx={{ mt: 3 }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: '#f5f5f5' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <StorageIcon color="action" />
                            <Typography variant="h6" fontWeight="bold">Master Data (Symptoms)</Typography>
                        </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                        <MasterDataManager symptomsOnly />
                    </AccordionDetails>
                </Accordion>
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
                                <TableCell sx={{ fontWeight: 'bold' }}>Note</TableCell>
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
                                    <TableCell>{v.published_at ? new Date(v.published_at).toLocaleString() : '—'}</TableCell>
                                    <TableCell>{v.created_at ? new Date(v.created_at).toLocaleString() : '—'}</TableCell>
                                    <TableCell
                                        sx={{
                                            maxWidth: 280,
                                            whiteSpace: 'pre-wrap',
                                            color: v.publish_note ? 'text.primary' : 'text.disabled',
                                            fontStyle: v.publish_note ? 'normal' : 'italic',
                                        }}
                                    >
                                        {v.publish_note || '—'}
                                    </TableCell>
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

            <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>Audit Logs</Typography>
            <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                    <TableHead>
                        <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                            <TableCell sx={{ fontWeight: 'bold' }}>Action</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>User</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>Timestamp</TableCell>
                            <TableCell sx={{ fontWeight: 'bold' }}>Notes</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {(auditLogs || []).map((log) => (
                            <TableRow key={log.id} hover>
                                <TableCell>
                                    <Chip label={log.action} size="small" variant="outlined" />
                                </TableCell>
                                <TableCell>{log.user_name || '—'}</TableCell>
                                <TableCell>{log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}</TableCell>
                                <TableCell>{log.notes || '—'}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
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
                        onClick={() => navigate('/dashboard/admin/doctor-profile-config')}
                    >
                        Doctor Profile Module
                    </Link>
                    <Typography color="primary" fontWeight="bold">
                        Editor
                    </Typography>
                </Breadcrumbs>
            </Paper>

            {/* Unified Draft / Preview / Publish header. Mirrors the
                Landing-page canonical so operators bouncing between
                editors don't have to re-learn the chips + button row. */}
            <ConfigEditorHeader
                title="Doctor Profile — Page Controls"
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

            {/* Inline reminder when there are unsaved local edits — the
                chip above also signals this, but a full-width Alert
                makes the consequence (no preview / publish until saved)
                explicit. */}
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
                <DoctorProfilePreviewTab
                    localDraft={localDraft}
                    localFieldConfigs={localFieldConfigs}
                    sectionFilter={sectionParam}
                    // Lifecycle source toggle — operator can flip
                    // between previewing the DRAFT (default), the
                    // currently-promoted PREVIEW row, or what's LIVE.
                    // Matches the Landing-page editor's preview UX.
                    preview={configs.preview}
                    live={configs.live}
                />
            )}
            {activeTab === 2 && renderHistoryTab()}

            {/* Publish Confirmation Dialog */}
            <Dialog open={showPublishDialog} onClose={() => { setShowPublishDialog(false); setPublishNote(''); }} maxWidth="sm" fullWidth>
                <DialogTitle>Publish Configuration</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 2 }}>
                        Are you sure you want to publish the current preview to live?
                        This will replace the current live configuration and affect all users immediately.
                    </Typography>
                    {/* Optional note — same as Landing's publish flow.
                        Persisted on the audit row so the History tab can
                        show what changed in this release. */}
                    <TextField
                        autoFocus
                        fullWidth
                        multiline
                        minRows={2}
                        maxRows={5}
                        label="Publish note (optional)"
                        placeholder="e.g. 'Updated Education section labels for clarity'"
                        value={publishNote}
                        onChange={(e) => setPublishNote(e.target.value)}
                        helperText="Stored on the audit log alongside this version."
                        sx={{ mt: 1 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => { setShowPublishDialog(false); setPublishNote(''); }}>Cancel</Button>
                    <Button
                        onClick={async () => { await handlePublish(publishNote); setPublishNote(''); }}
                        variant="contained"
                        color="success"
                        disabled={isPublishing}
                    >
                        {isPublishing ? 'Publishing...' : 'Confirm Publish'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Save / promote / publish / restore feedback. Without this
                the operator saw a silent dialog close after clicking
                Publish — that was the "no publish message" complaint. */}
            <Snackbar
                open={snack.open}
                autoHideDuration={snack.severity === 'error' ? 8000 : 4000}
                onClose={closeSnack}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert
                    severity={snack.severity}
                    onClose={closeSnack}
                    sx={{ width: '100%' }}
                >
                    {snack.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default DoctorProfileConfigEditor;
