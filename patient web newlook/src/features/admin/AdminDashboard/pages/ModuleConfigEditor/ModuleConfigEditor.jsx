/**
 * ModuleConfigEditor — editor for one dynamic module.
 *
 * Per-instance ACL lives here: the backend gates every mutation on
 * ``landing_module:edit`` with ``resource_id = moduleId``. A sub-admin scoped
 * to one module cannot navigate to another module's editor.
 *
 * No publish/promote button at this level — landing publish snapshots
 * everything atomically.
 */
import {
    Box, Container, Typography, Paper, Button, Alert, CircularProgress,
    IconButton, Chip, Snackbar, Tabs, Tab,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import VisibilityIcon from '@mui/icons-material/Visibility';
import HistoryIcon from '@mui/icons-material/History';

import useModuleConfigEditor from './hooks/useModuleConfigEditor';
import EditorTab from './components/EditorTab/EditorTab';
import PreviewTab from './components/PreviewTab/PreviewTab';
import HistoryTab from './components/HistoryTab/HistoryTab';

const ModuleConfigEditor = () => {
    const navigate = useNavigate();
    const {
        moduleId, isPlatform, permissions, loading, module,
        history, hasChanges, activeTab, setActiveTab,
        snack, setSnack, isSaving, actions,
    } = useModuleConfigEditor();

    // Back-button target — depends on which landing surface this module
    // belongs to, so that pressing Back from a platform module returns
    // to the platform editor (not the tenant editor).
    const parentEditorPath = isPlatform
        ? '/dashboard/platform/landing-config'
        : '/dashboard/admin/tenant-landing';

    const { canView, canEdit } = permissions;

    if (!canView) {
        return (
            <Container maxWidth="md" sx={{ py: 4 }}>
                <Alert severity="error">
                    You do not have permission to access this module.
                </Alert>
                <Button onClick={() => navigate(parentEditorPath)} sx={{ mt: 2 }}>
                    Back to landing editor
                </Button>
            </Container>
        );
    }

    if (loading || !module) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    const previewIdx = canEdit ? 1 : 0;
    const historyIdx = canEdit ? 2 : 1;

    return (
        <Box>
            <Paper elevation={2} sx={{ p: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between',
                           alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <IconButton
                            onClick={() => navigate(parentEditorPath)}
                        >
                            <ArrowBackIcon />
                        </IconButton>
                        <Box>
                            <Typography variant="overline" color="text.secondary">
                                Landing › Module
                            </Typography>
                            <Typography variant="h5" fontWeight="bold">
                                {module.name}
                            </Typography>
                        </Box>
                        {!canEdit && <Chip label="View Only" color="info" size="small" />}
                        {canEdit && hasChanges && (
                            <Chip label="Unsaved Changes" color="warning" size="small" />
                        )}
                    </Box>

                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <IconButton onClick={actions.refetch} disabled={loading || isSaving}>
                            <RefreshIcon />
                        </IconButton>
                        {canEdit && (
                            <Button
                                variant="contained"
                                startIcon={isSaving
                                    ? <CircularProgress size={20} color="inherit" />
                                    : <SaveIcon />}
                                onClick={actions.handleSave}
                                disabled={isSaving || !hasChanges}
                            >
                                Save Draft
                            </Button>
                        )}
                    </Box>
                </Box>

                <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip size="small"
                          label={module.is_visible ? 'Visible on landing' : 'Hidden'}
                          color={module.is_visible ? 'success' : 'default'}
                          variant={module.is_visible ? 'filled' : 'outlined'} />
                    <Chip size="small" variant="outlined"
                          label={`${(module.features || []).length} feature(s)`} />
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1, alignSelf: 'center' }}>
                        Publish is atomic at the landing level — Save Draft here, then promote +
                        publish from the landing editor.
                    </Typography>
                </Box>
            </Paper>

            <Container maxWidth="xl" sx={{ pb: 4 }}>
                <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 3 }}>
                    {canEdit && <Tab label="Editor" icon={<TextFieldsIcon />} iconPosition="start" />}
                    <Tab label="Preview" icon={<VisibilityIcon />} iconPosition="start" />
                    <Tab label="History" icon={<HistoryIcon />} iconPosition="start" />
                </Tabs>

                {canEdit && activeTab === 0 && (
                    <EditorTab module={module} canEdit={canEdit} patchModule={actions.patchModule} />
                )}
                {activeTab === previewIdx && <PreviewTab module={module} />}
                {activeTab === historyIdx && (
                    <HistoryTab
                        moduleId={moduleId} history={history}
                        onRestore={actions.handleRestoreSnapshot}
                        canEdit={canEdit} isSaving={isSaving}
                    />
                )}
            </Container>

            <Snackbar
                open={!!snack.open} autoHideDuration={4000}
                onClose={() => setSnack((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))}>
                    {snack.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default ModuleConfigEditor;
