/**
 * FeatureConfigEditor — editor for one feature under a module.
 *
 * Permission scope inherits from the parent module: a sub-admin scoped to a
 * specific module instance can edit every feature under it but not features
 * in other modules. Backend enforces this via ``rbac_required('landing_module',
 * 'edit', resource_id_kwarg='module_id')`` on every feature write route.
 */
import {
    Box, Container, Typography, Paper, Button, Alert, CircularProgress,
    IconButton, Chip, Snackbar, Tabs, Tab, Breadcrumbs, Link as MLink,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import VisibilityIcon from '@mui/icons-material/Visibility';
import HistoryIcon from '@mui/icons-material/History';

import useFeatureConfigEditor from './hooks/useFeatureConfigEditor';
import EditorTab from './components/EditorTab/EditorTab';
import PreviewTab from './components/PreviewTab/PreviewTab';
import HistoryTab from './components/HistoryTab/HistoryTab';

const FeatureConfigEditor = () => {
    const navigate = useNavigate();
    const {
        moduleId, isPlatform, permissions, loading, feature, parentModule,
        history, hasChanges, activeTab, setActiveTab,
        snack, setSnack, isSaving, actions,
    } = useFeatureConfigEditor();

    // Parent paths derive from which landing surface we're under, so the
    // back arrow / breadcrumbs round-trip correctly for both platform and
    // tenant feature edits.
    const editorRootPath = isPlatform
        ? '/dashboard/platform/landing-config'
        : '/dashboard/admin/tenant-landing';
    const moduleEditorPath = `${editorRootPath}/modules/${moduleId}`;

    const { canView, canEdit } = permissions;

    if (!canView) {
        return (
            <Container maxWidth="md" sx={{ py: 4 }}>
                <Alert severity="error">
                    You do not have permission to access this feature.
                </Alert>
                <Button onClick={() => navigate(editorRootPath)} sx={{ mt: 2 }}>
                    Back to landing editor
                </Button>
            </Container>
        );
    }

    if (loading || !feature) {
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
                        <IconButton onClick={() => navigate(moduleEditorPath)}>
                            <ArrowBackIcon />
                        </IconButton>
                        <Box>
                            <Breadcrumbs separator="›">
                                <MLink
                                    component="button" underline="hover" color="inherit"
                                    onClick={() => navigate(editorRootPath)}
                                >
                                    Landing
                                </MLink>
                                <MLink
                                    component="button" underline="hover" color="inherit"
                                    onClick={() => navigate(moduleEditorPath)}
                                >
                                    {parentModule?.name || moduleId}
                                </MLink>
                                <Typography color="text.primary">{feature.title}</Typography>
                            </Breadcrumbs>
                            <Typography variant="h5" fontWeight="bold">{feature.title}</Typography>
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
                          label={feature.is_visible ? 'Visible' : 'Hidden'}
                          color={feature.is_visible ? 'success' : 'default'}
                          variant={feature.is_visible ? 'filled' : 'outlined'} />
                    {feature.starting_price && (
                        <Chip size="small" variant="outlined" label={feature.starting_price} />
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1, alignSelf: 'center' }}>
                        Save Draft here. The landing editor publishes everything atomically.
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
                    <EditorTab feature={feature} canEdit={canEdit} patchFeature={actions.patchFeature} />
                )}
                {activeTab === previewIdx && <PreviewTab feature={feature} />}
                {activeTab === historyIdx && (
                    <HistoryTab
                        history={history}
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

export default FeatureConfigEditor;
