/**
 * AdminProfileConfigEditor — Main page for super admins to configure the Sub-Admin Profile page.
 * Tabs: EDITOR | LIVE PREVIEW | HISTORY
 * Mirrors DoctorProfileConfigEditor but scoped to admin_profile page type.
 */
import { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, Tabs, Tab, Button, Alert, Card, CardContent,
    TextField, CircularProgress, Breadcrumbs, Link, Dialog, DialogTitle,
    DialogContent, DialogActions, Chip, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Collapse, IconButton, Accordion,
    AccordionSummary, AccordionDetails
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
import DrawIcon from '@mui/icons-material/Draw';
import InfoIcon from '@mui/icons-material/Info';
import SchoolIcon from '@mui/icons-material/School';
import ScheduleIcon from '@mui/icons-material/Schedule';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import GavelIcon from '@mui/icons-material/Gavel';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import EventNoteIcon from '@mui/icons-material/EventNote';
import StorageIcon from '@mui/icons-material/Storage';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useAdminProfileConfigEditor from '../../hooks/useAdminProfileConfigEditor';

// Reuse SectionEditor and MasterDataManager from doctor config
import SectionEditor from '../../../DoctorProfileConfig/pages/DoctorProfileConfigEditor/components/SectionEditor';
import MasterDataManager from '../../../DoctorProfileConfig/pages/DoctorProfileConfigEditor/components/MasterDataManager';
import AdminProfilePreviewTab from './components/AdminProfilePreviewTab';

// Section groups matching the admin profile page tab structure
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
        sections: ['admin_analytics'],
    },
    {
        key: 'attendance_activity',
        label: 'Attendance & Activity',
        icon: <EventNoteIcon />,
        color: '#f1f8e9',
        sections: ['admin_attendance'],
    },
];

const AdminProfileConfigEditor = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const sectionParam = searchParams.get('section');
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
        handleDraftChange,
        handleSectionChange,
        handleFieldConfigChange,
        handleSaveDraft,
        handlePromoteToPreview,
        handlePublish,
        handleRestore,
    } = useAdminProfileConfigEditor(sectionGroupForApi);

    const [expandedGroups, setExpandedGroups] = useState(
        TAB_GROUPS.reduce((acc, g) => ({ ...acc, [g.key]: true }), {})
    );

    useEffect(() => {
        const tabParam = searchParams.get('tab');
        if (tabParam === 'preview') setActiveTab(1);
        else if (tabParam === 'history') setActiveTab(2);
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
        return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>;
    }

    const sections = localDraft?.fields?.sections || [];
    const getSectionsForGroup = (groupSectionKeys) =>
        sections.filter((s) => groupSectionKeys.includes(s.key));

    const handlePreviewClick = async () => {
        await handlePromoteToPreview();
        setActiveTab(1);
    };

    const renderPageSettings = () => (
        <Card sx={{ mb: 3 }}>
            <CardContent>
                <Typography variant="h6" gutterBottom>Page Settings</Typography>
                <Typography color="text.secondary" sx={{ mb: 2 }} variant="body2">
                    Configure colors, titles, and branding for the Sub-Admin Profile page.
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
                    { key: 'background_color', label: 'Background Color', type: 'color' },
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
                        <Typography variant="h6" fontWeight="bold">{group.label}</Typography>
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
                                disabled={!hasEditAccess}
                            />
                        ))}
                    </Box>
                </Collapse>
            </Card>
        );
    };

    const renderEditorTab = () => {
        if (sectionParam) {
            if (sectionParam === 'page_settings') return <Box>{renderPageSettings()}</Box>;
            if (sectionParam === 'master_data') {
                return (
                    <Box>
                        <Accordion defaultExpanded sx={{ mt: 0 }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: '#f5f5f5' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <StorageIcon color="action" />
                                    <Typography variant="h6" fontWeight="bold">Master Data (Colleges & Specializations)</Typography>
                                </Box>
                            </AccordionSummary>
                            <AccordionDetails>
                                <MasterDataManager />
                            </AccordionDetails>
                        </Accordion>
                    </Box>
                );
            }
            const targetGroup = TAB_GROUPS.find((g) => g.key === sectionParam);
            if (targetGroup) return <Box>{renderGroupCard(targetGroup)}</Box>;
            return <Alert severity="warning">Unknown section: {sectionParam}</Alert>;
        }

        return (
            <Box>
                {renderPageSettings()}
                <Typography variant="h6" sx={{ mb: 2 }}>Dynamic Fields by Section</Typography>
                {TAB_GROUPS.map((group) => renderGroupCard(group))}
                <Accordion sx={{ mt: 3 }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: '#f5f5f5' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <StorageIcon color="action" />
                            <Typography variant="h6" fontWeight="bold">Master Data (Colleges & Specializations)</Typography>
                        </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                        <MasterDataManager />
                    </AccordionDetails>
                </Accordion>
            </Box>
        );
    };

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
                                    <TableCell>{v.published_at ? new Date(v.published_at).toLocaleString() : '—'}</TableCell>
                                    <TableCell>{v.created_at ? new Date(v.created_at).toLocaleString() : '—'}</TableCell>
                                    <TableCell align="center">
                                        {v.status !== 'draft' && hasEditAccess && (
                                            <Button size="small" startIcon={<RestoreIcon />} onClick={() => handleRestore(v.id)} sx={{ textTransform: 'none' }}>
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
                                <TableCell><Chip label={log.action} size="small" variant="outlined" /></TableCell>
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
            <Paper sx={{ mb: 2, py: 1.5, px: 2 }}>
                <Breadcrumbs>
                    <Link component="button" underline="hover" color="inherit" onClick={() => navigate('/dashboard/admin')} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <HomeIcon fontSize="small" /> Dashboard
                    </Link>
                    <Link component="button" underline="hover" color="inherit" onClick={() => navigate('/dashboard/admin/page-controls')}>
                        Page Controls
                    </Link>
                    <Link component="button" underline="hover" color="inherit" onClick={() => navigate('/dashboard/admin/admin-profile-config')}>
                        Sub-Admin Profile Module
                    </Link>
                    <Typography color="primary" fontWeight="bold">Editor</Typography>
                </Breadcrumbs>
            </Paper>

            {/* Unified Draft / Preview / Publish header — mirrors the
                landing canonical so this editor is visually consistent
                with the other page-config surfaces. */}
            <ConfigEditorHeader
                title="Sub-Admin Profile — Page Controls"
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

            <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
                <Tab label="Editor" icon={<TextFieldsIcon />} iconPosition="start" sx={{ textTransform: 'none', fontWeight: 'bold' }} />
                <Tab label="Live Preview" icon={<VisibilityIcon />} iconPosition="start" sx={{ textTransform: 'none', fontWeight: 'bold' }} />
                <Tab label="History" icon={<HistoryIcon />} iconPosition="start" sx={{ textTransform: 'none', fontWeight: 'bold' }} />
            </Tabs>

            {activeTab === 0 && renderEditorTab()}
            {activeTab === 1 && <AdminProfilePreviewTab localDraft={localDraft} localFieldConfigs={localFieldConfigs} />}
            {activeTab === 2 && renderHistoryTab()}

            <Dialog open={showPublishDialog} onClose={() => setShowPublishDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Publish Configuration</DialogTitle>
                <DialogContent>
                    <Typography>
                        Are you sure you want to publish the current preview to live?
                        This will replace the current live configuration and affect all sub-admin users immediately.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowPublishDialog(false)}>Cancel</Button>
                    <Button onClick={handlePublish} variant="contained" color="success" disabled={isPublishing}>
                        {isPublishing ? 'Publishing...' : 'Confirm Publish'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default AdminProfileConfigEditor;
