/**
 * ConfigEditorHeader — the canonical Draft / Preview / Publish header
 * shared by every page-config editor with a publish lifecycle (landing
 * page, login/signup page-config, doctor-profile, admin-profile,
 * patient-profile, patient-appointment-config, doctor-signup-config).
 *
 * Why a shared component:
 *   * Multiple editors had drifted into incompatible chip labels and
 *     button orderings (some used "No Draft / Preview Ready / Not
 *     Published" with warning/info/success colors; landing used plain
 *     "Draft / Preview / Live" with primary/warning/success colors and
 *     a "v{n} published" caption). Operators bouncing between editors
 *     had to re-learn the row every time.
 *   * The behaviour underneath is identical — three rows on the
 *     backend (draft / preview / live), three buttons that walk the
 *     lifecycle (Save Draft → Preview → Publish), and three tabs
 *     (Editor / Live Preview / History). Surfacing one shared header
 *     lets each editor focus on its tab content.
 *
 * Props are deliberately granular booleans so each editor's existing
 * hook shape can drive it without reshaping:
 *
 *   <ConfigEditorHeader
 *     title="Doctor Profile — Page Controls"
 *     onBack={() => navigate('/dashboard/admin')}
 *     canEdit={hasEditAccess}
 *     hasChanges={hasUnsavedChanges}
 *     draftExists={!!configs.draft}
 *     previewExists={!!configs.preview}
 *     live={configs.live}
 *     draftVersion={configs.draft?.version}
 *     isSaving={isSaving || isPromoting || isPublishing}
 *     onSaveDraft={handleSaveDraft}
 *     onPreview={handlePreviewClick}
 *     onPublish={() => setShowPublishDialog(true)}
 *     onRefresh={refetchConfigs}
 *   />
 */
import {
    Box, Button, Chip, CircularProgress, IconButton, Paper, Tooltip,
    Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import PreviewIcon from '@mui/icons-material/Preview';
import PublishIcon from '@mui/icons-material/Publish';


const ConfigEditorHeader = ({
    /** Page heading text (renders as h5). */
    title,
    /** Optional callback for the back-arrow IconButton; omit to hide. */
    onBack,
    /** Whether the caller has edit permissions — when false, buttons hide
     *  and the title gets a "Viewer" suffix instead of "Editor". */
    canEdit = true,
    /** Whether the editing surface has unsaved local changes (gates
     *  Save Draft button + renders the "Unsaved changes" chip). */
    hasChanges = false,
    /** Whether a DRAFT row exists in the DB (gates Preview button +
     *  fills the Draft chip). Distinct from ``hasChanges`` — a saved
     *  draft has ``draftExists=true && hasChanges=false``. */
    draftExists = false,
    /** Whether a PREVIEW row exists (gates Publish button + fills the
     *  Preview chip). */
    previewExists = false,
    /** The LIVE row (or null). The header reads ``.version`` for the
     *  "v{n} published" caption. */
    live = null,
    /** Saved-draft version for the "v{n} draft" caption — optional. */
    draftVersion = null,
    /** Single rolled-up isSaving — disables every action button. Pass
     *  ``isSaving || isPromoting || isPublishing`` if your hook
     *  separates the three. */
    isSaving = false,
    /** Action handlers. Each is optional — omit to hide the matching
     *  button (e.g. ``onPreview={undefined}`` on the doctor-signup
     *  editor which historically only had Save + Publish). */
    onSaveDraft,
    onPreview,
    onPublish,
    onRefresh,
    /** Extra chips / nodes rendered to the right of the status chips —
     *  e.g. a "Showing: education" preview filter chip. */
    rightStatusSlot = null,
    /** Extra buttons rendered between Refresh and the lifecycle buttons —
     *  e.g. the landing editor's "Reset" button. */
    leftButtonSlot = null,
}) => {
    return (
        <Paper elevation={2} sx={{ p: 2, mb: 3 }}>
            {/* Row 1: title + lifecycle buttons */}
            <Box
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 2,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {onBack && (
                        <IconButton onClick={onBack} aria-label="Back">
                            <ArrowBackIcon />
                        </IconButton>
                    )}
                    <Typography variant="h5" fontWeight="bold">
                        {title} {canEdit ? '— Editor' : '— Viewer'}
                    </Typography>
                    {!canEdit && (
                        <Chip label="View Only" color="info" size="small" />
                    )}
                    {canEdit && hasChanges && (
                        <Chip
                            label="Unsaved changes"
                            color="warning"
                            size="small"
                        />
                    )}
                </Box>

                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    {onRefresh && (
                        <Tooltip title="Refresh">
                            <span>
                                <IconButton
                                    onClick={onRefresh}
                                    disabled={isSaving}
                                    aria-label="Refresh"
                                >
                                    <RefreshIcon />
                                </IconButton>
                            </span>
                        </Tooltip>
                    )}
                    {leftButtonSlot}
                    {canEdit && onPreview && (
                        <Button
                            variant="outlined"
                            startIcon={<PreviewIcon />}
                            onClick={onPreview}
                            disabled={isSaving || !draftExists}
                        >
                            Preview
                        </Button>
                    )}
                    {canEdit && onPublish && (
                        <Button
                            variant="contained"
                            color="success"
                            startIcon={<PublishIcon />}
                            onClick={onPublish}
                            disabled={isSaving || !previewExists}
                        >
                            Publish
                        </Button>
                    )}
                    {canEdit && onSaveDraft && (
                        <Button
                            variant="contained"
                            startIcon={
                                isSaving
                                    ? <CircularProgress
                                        size={18} color="inherit"
                                      />
                                    : <SaveIcon />
                            }
                            onClick={onSaveDraft}
                            disabled={isSaving || !hasChanges}
                        >
                            Save Draft
                        </Button>
                    )}
                </Box>
            </Box>

            {/* Row 2: status chips */}
            <Box
                sx={{
                    mt: 2,
                    display: 'flex',
                    gap: 1,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                }}
            >
                {canEdit && (
                    <Chip
                        label="Draft"
                        size="small"
                        color={draftExists ? 'primary' : 'default'}
                        variant={draftExists ? 'filled' : 'outlined'}
                    />
                )}
                <Chip
                    label="Preview"
                    size="small"
                    color={previewExists ? 'warning' : 'default'}
                    variant={previewExists ? 'filled' : 'outlined'}
                />
                <Chip
                    label="Live"
                    size="small"
                    color={live ? 'success' : 'default'}
                    variant={live ? 'filled' : 'outlined'}
                />
                {/* Version caption next to whichever chip is filled.
                    Live takes precedence over Draft when both exist — the
                    operator most cares about what their audience sees. */}
                {live?.version != null && (
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ ml: 0.5 }}
                    >
                        v{live.version} published
                    </Typography>
                )}
                {!live && draftVersion != null && (
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ ml: 0.5 }}
                    >
                        draft v{draftVersion}
                    </Typography>
                )}
                {rightStatusSlot}
            </Box>
        </Paper>
    );
};


export default ConfigEditorHeader;
