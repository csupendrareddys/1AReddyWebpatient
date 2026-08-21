import {
    Box, Container, Typography, Paper, Button, Alert, CircularProgress, IconButton, 
    Chip, Tooltip, Snackbar, Tabs, Tab, Dialog, DialogTitle, DialogContent, 
    DialogActions, Select, MenuItem, FormControl, InputLabel
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import VisibilityIcon from '@mui/icons-material/Visibility';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import PreviewIcon from '@mui/icons-material/Preview';
import PublishIcon from '@mui/icons-material/Publish';
import RefreshIcon from '@mui/icons-material/Refresh';
import HistoryIcon from '@mui/icons-material/History';

import usePageConfigEditor from './hooks/usePageConfigEditor';
import EditorTab from './components/EditorTab/EditorTab';
import PreviewTab from './components/PreviewTab/PreviewTab';
import HistoryTab from './components/HistoryTab/HistoryTab';
import { PAGE_TYPE_LABELS } from '../../../api/pageConfigEndpoints';
import './PageConfigEditor.css';

const PageConfigEditor = () => {
    const navigate = useNavigate();
    const {
        hasFullAccess,
        hasViewAccess,
        hasEditAccess,
        selectedPageType,
        configs,
        draft,
        loading,
        error,
        setError,
        successMessage,
        setSuccessMessage,
        hasChanges,
        activeTab,
        setActiveTab,
        showPublishDialog,
        setShowPublishDialog,
        versionHistory,
        auditLogs,
        isSaving,
        handlePageTypeChange,
        handleSaveDraft,
        handleDraftChange,
        handlePromoteToPreview,
        handlePublish,
        handleRestoreVersion,
        handleAssetUpload,
        refetchConfigs
    } = usePageConfigEditor();

    if (!hasViewAccess) {
        return (
            <Container maxWidth="md" sx={{ py: 4 }}>
                <Alert severity="error">
                    You do not have permission to access the page configuration editor.
                </Alert>
                <Button onClick={() => navigate('/dashboard/admin')} sx={{ mt: 2 }}>
                    Return to Dashboard
                </Button>
            </Container>
        );
    }

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    // Tab indices shift based on edit access
    // With edit access: 0=Editor, 1=Preview, 2=History
    // Without edit access (view-only): 0=Preview, 1=History
    const previewTabIndex = hasEditAccess ? 1 : 0;
    const historyTabIndex = hasEditAccess ? 2 : 1;

    return (
        <Box className="page-config-editor-root">
            {/* Header */}
            <Paper elevation={2} sx={{ p: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <IconButton onClick={() => navigate('/dashboard/admin')}>
                            <ArrowBackIcon />
                        </IconButton>
                        <Typography variant="h5" fontWeight="bold">
                            Page Configuration {hasEditAccess ? 'Editor' : 'Viewer'}
                        </Typography>
                        {!hasEditAccess && <Chip label="View Only" color="info" size="small" />}
                        {hasEditAccess && hasChanges && <Chip label="Unsaved Changes" color="warning" size="small" />}
                    </Box>

                    {/* Page Type Selector */}
                    <FormControl size="small" sx={{ minWidth: 200 }}>
                        <InputLabel>Page Type</InputLabel>
                        <Select
                            value={selectedPageType}
                            label="Page Type"
                            onChange={handlePageTypeChange}
                        >
                            {Object.entries(PAGE_TYPE_LABELS).map(([key, label]) => (
                                <MenuItem key={key} value={key}>{label}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Tooltip title="Refresh">
                            <IconButton onClick={refetchConfigs} disabled={loading || isSaving}>
                                <RefreshIcon />
                            </IconButton>
                        </Tooltip>
                        {hasEditAccess && (
                            <>
                                <Button
                                    variant="outlined"
                                    startIcon={<PreviewIcon />}
                                    onClick={handlePromoteToPreview}
                                    disabled={isSaving || !draft}
                                >
                                    Preview
                                </Button>
                                <Button
                                    variant="contained"
                                    color="success"
                                    startIcon={<PublishIcon />}
                                    onClick={() => setShowPublishDialog(true)}
                                    disabled={!configs.preview || isSaving}
                                >
                                    Publish
                                </Button>
                                <Button
                                    variant="contained"
                                    startIcon={isSaving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
                                    onClick={handleSaveDraft}
                                    disabled={isSaving || !hasChanges}
                                >
                                    Save Draft
                                </Button>
                            </>
                        )}
                    </Box>
                </Box>

                {/* Status chips */}
                <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {hasEditAccess && <Chip label="Draft" color={configs.draft ? 'primary' : 'default'} variant={configs.draft ? 'filled' : 'outlined'} size="small" />}
                    <Chip label="Preview" color={configs.preview ? 'warning' : 'default'} variant={configs.preview ? 'filled' : 'outlined'} size="small" />
                    <Chip label="Live" color={configs.live ? 'success' : 'default'} variant={configs.live ? 'filled' : 'outlined'} size="small" />
                    {configs.live && (
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 1, alignSelf: 'center' }}>
                            v{configs.live.version} published
                        </Typography>
                    )}
                </Box>
            </Paper>

            <Container maxWidth="xl" sx={{ pb: 4 }}>
                {error && (
                    <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
                        {error}
                    </Alert>
                )}

                <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)} sx={{ mb: 3 }}>
                    {hasEditAccess && <Tab label="Editor" icon={<TextFieldsIcon />} iconPosition="start" />}
                    <Tab label="Live Preview" icon={<VisibilityIcon />} iconPosition="start" />
                    <Tab label="History" icon={<HistoryIcon />} iconPosition="start" />
                </Tabs>

                {/* Editor Tab — only for users with edit access */}
                {hasEditAccess && activeTab === 0 && (
                    <EditorTab 
                        draft={draft} 
                        handleDraftChange={handleDraftChange} 
                        handleAssetUpload={handleAssetUpload}
                        selectedPageType={selectedPageType}
                    />
                )}

                {/* Live Preview Tab */}
                {activeTab === previewTabIndex && (
                    <PreviewTab 
                        selectedPageType={selectedPageType} 
                        draft={draft || configs.preview || configs.live}
                    />
                )}

                {/* History Tab */}
                {activeTab === historyTabIndex && (
                    <HistoryTab 
                        versionHistory={versionHistory} 
                        auditLogs={auditLogs} 
                        handleRestoreVersion={hasEditAccess ? handleRestoreVersion : undefined}
                        saving={isSaving}
                    />
                )}
            </Container>

            {/* Publish Confirmation Dialog — only for editors */}
            {hasEditAccess && (
                <Dialog open={showPublishDialog} onClose={() => setShowPublishDialog(false)}>
                    <DialogTitle>Publish Configuration?</DialogTitle>
                    <DialogContent>
                        <Typography>
                            This will make the preview configuration live for all users on the {PAGE_TYPE_LABELS[selectedPageType]} page.
                        </Typography>
                        <Alert severity="warning" sx={{ mt: 2 }}>
                            The current live configuration will be archived.
                        </Alert>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setShowPublishDialog(false)}>Cancel</Button>
                        <Button onClick={handlePublish} variant="contained" color="success" disabled={isSaving}>
                            {isSaving ? <CircularProgress size={20} /> : 'Publish'}
                        </Button>
                    </DialogActions>
                </Dialog>
            )}

            {/* Success Snackbar */}
            <Snackbar
                open={!!successMessage}
                autoHideDuration={3000}
                onClose={() => setSuccessMessage('')}
                message={successMessage}
            />
        </Box>
    );
};

export default PageConfigEditor;
