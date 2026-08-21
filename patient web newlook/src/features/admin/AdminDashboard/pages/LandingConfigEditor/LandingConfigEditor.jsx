/**
 * LandingConfigEditor — top-level editor for the per-tenant landing page.
 *
 * Structure mirrors :file:`PageConfigEditor.jsx` intentionally: Editor /
 * Preview / History tabs with a status-chip header row. This is the ONLY
 * editor that carries a full draft → preview → live lifecycle; module and
 * feature editors mutate draft in place.
 */
import {
    Box, Container, Typography, Paper, Button, Alert, CircularProgress,
    IconButton, Chip, Tooltip, Snackbar, Tabs, Tab, Dialog, DialogTitle,
    DialogContent, DialogActions, TextField,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import VisibilityIcon from '@mui/icons-material/Visibility';
import PublishIcon from '@mui/icons-material/Publish';
import PreviewIcon from '@mui/icons-material/Preview';
import RefreshIcon from '@mui/icons-material/Refresh';
import HistoryIcon from '@mui/icons-material/History';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import RateReviewIcon from '@mui/icons-material/RateReview';
import VerifiedIcon from '@mui/icons-material/Verified';

import useLandingConfigEditor from './hooks/useLandingConfigEditor';
import usePermissions from '../../../../../common/hooks/usePermissions';
import EditorTab from './components/EditorTab/EditorTab';
import PreviewTab from './components/PreviewTab/PreviewTab';
import HistoryTab from './components/HistoryTab/HistoryTab';
import RecognitionsTab from './components/RecognitionsTab/RecognitionsTab';
import VideosTab from './components/VideosTab/VideosTab';
import DoctorsTab from './components/DoctorsTab/DoctorsTab';
import ReviewsTab from './components/ReviewsTab/ReviewsTab';
import BrandsTab from './components/BrandsTab/BrandsTab';

/**
 * Scoped publish-confirmation dialog. Owns its own ``publishNote``
 * local state so keystrokes inside the TextField only re-render this
 * Dialog tree — NOT the entire LandingConfigEditor page (tabs, header
 * chips, status indicators, all tab-content children).
 */
const PublishDialog = ({ open, onClose, onPublish, isSaving }) => {
    const [note, setNote] = useState('');
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Publish landing configuration?</DialogTitle>
            <DialogContent>
                <Typography gutterBottom>
                    This atomically snapshots the current PREVIEW tree (hero, modules, features)
                    and replaces the LIVE configuration. The prior LIVE row is archived.
                </Typography>
                <Alert severity="warning" sx={{ mt: 2, mb: 2 }}>
                    You cannot publish partial edits — the whole landing tree goes live.
                </Alert>
                <TextField
                    fullWidth size="small" label="Publish note (optional)"
                    value={note} onChange={(e) => setNote(e.target.value)}
                    helperText="Shown in the History tab next to this version."
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained" color="success"
                    onClick={() => { onPublish(note); setNote(''); }}
                    disabled={isSaving}
                >
                    {isSaving ? <CircularProgress size={18} /> : 'Publish'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

/**
 * @param {object} props
 * @param {'platform'|'tenant'|'legacy'} [props.mode]
 *   Drives the heading copy. Data + permissions are unchanged across modes —
 *   the underlying ``landing_configs`` table scopes by ``tenant_id`` already,
 *   so ``platform`` (platform_owner editing larazen.in) and ``tenant``
 *   (super_admin editing their clinic landing) just look at different rows.
 */
const LandingConfigEditor = ({ mode = 'legacy' } = {}) => {
    const navigate = useNavigate();
    const isPlatform = mode === 'platform';
    // Plan gate. Tenants whose subscription doesn't include
    // ``admin.landing_builder`` shouldn't even mount the editor; the
    // backend rejects every read/write with 403 ``feature_disabled``,
    // which would otherwise leave the page spinning on a never-
    // resolving query. Platform mode (platform-owner editing the
    // marketing apex / default template) is exempt — they're the
    // people who configure plans.
    const { hasFeature, isPlatformOwner } = usePermissions();
    const planGated =
        !isPlatform
        && !isPlatformOwner
        && !hasFeature('admin.landing_builder');

    const {
        permissions, loading, error, draft, draftExists, preview, live, history,
        hasChanges, hasPendingPublish, activeTab, setActiveTab,
        snack, setSnack, publishDialogOpen, setPublishDialogOpen,
        isSaving, actions, scope,
    } = useLandingConfigEditor({ mode, skip: planGated });


    // Plan-gated short-circuit. Show a friendly "not on your plan"
    // panel instead of letting RTK Query fire requests that 403 in a
    // loop. Backend's ``@feature_required`` is the actual security
    // boundary; this is UX so the user knows WHY they can't proceed.
    if (planGated) {
        return (
            <Container maxWidth="md" sx={{ py: 4 }}>
                <Alert severity="info" sx={{ mb: 2 }}>
                    <Typography variant="subtitle1" fontWeight={600}>
                        Landing-page editor isn’t included on your plan
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                        Your subscription doesn’t include the landing-page
                        builder. Ask your platform administrator to upgrade
                        your plan or attach an add-on that includes
                        <code> admin.landing_builder</code>.
                    </Typography>
                </Alert>
                <Button onClick={() => navigate('/dashboard/admin')}>
                    Return to Dashboard
                </Button>
            </Container>
        );
    }

    // Heading copy is the only place ``scope`` is user-visible — platform
    // has two flavours (apex marketing vs new-tenant seed template) toggled
    // by ``?scope=`` in the URL.
    const headingPrefix = (() => {
        if (isPlatform) {
            return scope === 'default_template'
                ? 'Tenants Default Landing Configuration'
                : 'Our Landing Page Configuration';
        }
        if (mode === 'tenant') return 'Tenants Deemed Landing Page';
        return 'Landing Page Configuration';
    })();

    const { canView, canEdit } = permissions;

    if (!canView) {
        return (
            <Container maxWidth="md" sx={{ py: 4 }}>
                <Alert severity="error">
                    You do not have permission to access the landing page editor.
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

    // Backend rejected at least one of the editor's reads. The most
    // common case: ``feature_disabled`` from ``@feature_required``
    // when the tenant's plan doesn't include ``admin.landing_builder``
    // (which the page-level guard above SHOULD have caught — but
    // belt-and-braces in case feature_paths weren't on /auth/me yet
    // for some reason). Surface a friendly message instead of letting
    // the editor render with empty data and look hung.
    const errorCode = error?.data?.code;
    if (errorCode === 'feature_disabled') {
        return (
            <Container maxWidth="md" sx={{ py: 4 }}>
                <Alert severity="info" sx={{ mb: 2 }}>
                    <Typography variant="subtitle1" fontWeight={600}>
                        Landing-page editor isn’t included on your plan
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                        Your subscription doesn’t include the landing-page
                        builder. Ask your platform administrator to upgrade
                        your plan.
                    </Typography>
                </Alert>
                <Button onClick={() => navigate('/dashboard/admin')}>
                    Return to Dashboard
                </Button>
            </Container>
        );
    }
    if (errorCode === 'no_active_subscription') {
        return (
            <Container maxWidth="md" sx={{ py: 4 }}>
                <Alert severity="warning" sx={{ mb: 2 }}>
                    <Typography variant="subtitle1" fontWeight={600}>
                        No active subscription
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                        Your tenant doesn’t have an active subscription.
                        Contact your platform administrator.
                    </Typography>
                </Alert>
                <Button onClick={() => navigate('/dashboard/admin')}>
                    Return to Dashboard
                </Button>
            </Container>
        );
    }
    if (error) {
        return (
            <Container maxWidth="md" sx={{ py: 4 }}>
                <Alert severity="error">
                    {error?.data?.error || error?.data?.message
                        || 'Failed to load the landing editor.'}
                </Alert>
                <Button onClick={() => navigate('/dashboard/admin')} sx={{ mt: 2 }}>
                    Return to Dashboard
                </Button>
            </Container>
        );
    }

    // Tab indices depend on edit access (mode no longer matters):
    //   canEdit:    0 Editor / 1 Recognitions / 2 Videos / 3 Doctors /
    //               4 Reviews / 5 Brands / 6 Preview / 7 History.
    //   view-only:  0 Preview / 1 History.
    //
    // Why platform mode now shows the collection tabs (Doctors /
    // Reviews / Brands): originally these were "per-clinic" concepts
    // hidden in platform mode. In practice the platform marketing
    // landing (larazen.in) ALSO benefits from showing example
    // doctors, partner brands, and customer testimonials — same UX
    // surface tenant clinics use, just authored by the platform team
    // and rendered on the apex landing. Backend collections store
    // them on the resolved tenant context (default tenant for the
    // platform marketing path), so the existing tenant endpoints
    // serve the right data when the platform_owner is the caller.
    const showCollectionTabs = canEdit;
    const recognitionsTabIndex = canEdit ? 1 : -1;
    const videosTabIndex       = canEdit ? 2 : -1;
    const doctorsTabIndex      = showCollectionTabs ? 3 : -1;
    const reviewsTabIndex      = showCollectionTabs ? 4 : -1;
    const brandsTabIndex       = showCollectionTabs ? 5 : -1;
    const previewTabIndex      = canEdit ? 6 : 0;
    const historyTabIndex      = canEdit ? 7 : 1;

    return (
        <Box>
            {/* Header row ------------------------------------------------- */}
            <Paper elevation={2} sx={{ p: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between',
                           alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <IconButton onClick={() => navigate('/dashboard/admin')}>
                            <ArrowBackIcon />
                        </IconButton>
                        <Typography variant="h5" fontWeight="bold">
                            {headingPrefix} {canEdit ? '— Editor' : '— Viewer'}
                        </Typography>
                        {!canEdit && <Chip label="View Only" color="info" size="small" />}
                        {canEdit && hasChanges && (
                            <Chip label="Unsaved Changes" color="warning" size="small" />
                        )}
                    </Box>

                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Tooltip title="Refresh">
                            <span>
                                <IconButton onClick={actions.refetch} disabled={loading || isSaving}>
                                    <RefreshIcon />
                                </IconButton>
                            </span>
                        </Tooltip>
                        {canEdit && (
                            <>
                                {/* Three buttons matching the Page Config Editor
                                    standard, identical for tenant and platform
                                    modes now that both surfaces share the
                                    DRAFT → PREVIEW → LIVE flow. Promote (=
                                    "Preview") needs an actual DB DRAFT row to
                                    flip, so it gates on draftExists — not on
                                    the editing surface (which falls back to
                                    LIVE content). */}
                                <Button
                                    variant="outlined" startIcon={<PreviewIcon />}
                                    onClick={actions.handlePromote}
                                    disabled={isSaving || !draftExists}
                                >
                                    Preview
                                </Button>
                                <Button
                                    variant="contained" color="success"
                                    startIcon={<PublishIcon />}
                                    onClick={() => setPublishDialogOpen(true)}
                                    disabled={isSaving || !hasPendingPublish}
                                >
                                    Publish
                                </Button>
                                <Button
                                    variant="contained"
                                    startIcon={isSaving
                                        ? <CircularProgress size={20} color="inherit" />
                                        : <SaveIcon />
                                    }
                                    onClick={actions.handleSave}
                                    disabled={isSaving || !hasChanges}
                                >
                                    Save Draft
                                </Button>
                            </>
                        )}
                    </Box>
                </Box>

                <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {/* Status chips — same three rows the page-config and
                        tenant landing editors render: Draft / Preview /
                        Live, with the row's existence driving fill vs
                        outline. */}
                    {canEdit && (
                        <Chip label="Draft" size="small"
                              color={draftExists ? 'primary' : 'default'}
                              variant={draftExists ? 'filled' : 'outlined'} />
                    )}
                    <Chip label="Preview" size="small"
                          color={preview ? 'warning' : 'default'}
                          variant={preview ? 'filled' : 'outlined'} />
                    <Chip label="Live" size="small"
                          color={live ? 'success' : 'default'}
                          variant={live ? 'filled' : 'outlined'} />
                    {live && live.version && (
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 1, alignSelf: 'center' }}>
                            v{live.version} published
                        </Typography>
                    )}
                </Box>
            </Paper>

            <Container maxWidth="xl" sx={{ pb: 4 }}>
                <Tabs
                    value={activeTab} onChange={(_, v) => setActiveTab(v)}
                    sx={{ mb: 3 }}
                    variant="scrollable" scrollButtons="auto"
                >
                    {canEdit && <Tab label="Editor" icon={<TextFieldsIcon />} iconPosition="start" />}
                    {canEdit && <Tab label="Recognitions" icon={<EmojiEventsIcon />} iconPosition="start" />}
                    {canEdit && <Tab label="Videos" icon={<VideoLibraryIcon />} iconPosition="start" />}
                    {showCollectionTabs && <Tab label="Doctors" icon={<LocalHospitalIcon />} iconPosition="start" />}
                    {showCollectionTabs && <Tab label="Reviews" icon={<RateReviewIcon />} iconPosition="start" />}
                    {showCollectionTabs && <Tab label="Brands" icon={<VerifiedIcon />} iconPosition="start" />}
                    <Tab label="Preview" icon={<VisibilityIcon />} iconPosition="start" />
                    <Tab label="History" icon={<HistoryIcon />} iconPosition="start" />
                </Tabs>

                {canEdit && activeTab === 0 && (
                    <EditorTab
                        draft={draft}
                        canEdit={canEdit}
                        patchHero={actions.patchHero}
                        mode={mode}
                    />
                )}
                {activeTab === recognitionsTabIndex && (
                    <RecognitionsTab
                        canEdit={canEdit}
                        canCreate={canEdit}
                        canDelete={canEdit}
                        mode={mode}
                        scope={scope}
                    />
                )}
                {activeTab === videosTabIndex && (
                    <VideosTab
                        canEdit={canEdit}
                        canCreate={canEdit}
                        canDelete={canEdit}
                        mode={mode}
                        scope={scope}
                    />
                )}
                {activeTab === doctorsTabIndex && (
                    <DoctorsTab
                        canEdit={canEdit}
                        canCreate={canEdit}
                        canDelete={canEdit}
                    />
                )}
                {activeTab === reviewsTabIndex && (
                    <ReviewsTab
                        canEdit={canEdit}
                        canCreate={canEdit}
                        canDelete={canEdit}
                    />
                )}
                {activeTab === brandsTabIndex && (
                    <BrandsTab
                        canEdit={canEdit}
                        canCreate={canEdit}
                        canDelete={canEdit}
                    />
                )}
                {activeTab === previewTabIndex && (
                    <PreviewTab
                        draft={draft}
                        preview={preview}
                        live={live}
                        hasChanges={hasChanges}
                        mode={mode}
                        scope={scope}
                    />
                )}
                {activeTab === historyTabIndex && (
                    <HistoryTab
                        history={history}
                        onRestore={actions.handleRestoreSnapshot}
                        canEdit={canEdit}
                        isSaving={isSaving}
                    />
                )}
            </Container>

            {/* Publish confirmation dialog — own component to scope
                publishNote state so keystrokes don't re-render the
                entire page tree (tabs, header, chips, all children). */}
            {canEdit && (
                <PublishDialog
                    open={publishDialogOpen}
                    onClose={() => setPublishDialogOpen(false)}
                    onPublish={actions.handlePublish}
                    isSaving={isSaving}
                />
            )}

            <Snackbar
                open={!!snack.open}
                autoHideDuration={4000}
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

export default LandingConfigEditor;
