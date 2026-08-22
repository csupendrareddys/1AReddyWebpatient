/**
 * ModuleLifecyclePanel — per-module DRAFT / PREVIEW / LIVE control row.
 *
 * Round 9, Phase 4 introduces per-module publishing — instead of one
 * page-wide DRAFT → PREVIEW → LIVE cycle, each "Control" (module) on
 * the editor sidebar gets its own. This component is the inline
 * lifecycle widget the editor renders next to each module accordion
 * (or section card) — it surfaces:
 *
 *   * a row of status chips ("Draft v3" / "Preview Ready" / "v2 Live")
 *   * an inline note + timestamp for the LIVE version
 *   * the three lifecycle buttons (Save / Preview / Publish), each
 *     gated by the same "is there a draft / preview to act on?"
 *     rules as the page-wide ``ConfigEditorHeader``
 *   * a History expandable that lists archived versions inline
 *
 * It is intentionally hook-shape-agnostic: each page_type's editor
 * passes the RTK Query mutations and queries it needs as props,
 * so this file does not import anything page-type-specific.
 *
 * Usage from doctor_profile editor (one panel per module):
 *
 *   <ModuleLifecyclePanel
 *     moduleKey="education"
 *     moduleLabel="Education"
 *     draft={moduleStates['education']?.draft}
 *     preview={moduleStates['education']?.preview}
 *     live={moduleStates['education']?.live}
 *     hasUnsavedChanges={hasChangesByModule.education}
 *     onSaveDraft={() => updateDoctorProfileModuleFields({
 *         moduleKey: 'education',
 *         fields: pendingFields,
 *     })}
 *     onPromoteToPreview={() => promoteDoctorProfileModuleToPreview('education')}
 *     onPublish={(note) => publishDoctorProfileModule({
 *         moduleKey: 'education', note,
 *     })}
 *     history={historyForEducation}
 *     onRestore={(versionId) => restoreDoctorProfileModuleVersion({
 *         moduleKey: 'education', versionId,
 *     })}
 *   />
 */
import { useState } from 'react';
import {
    Accordion, AccordionDetails, AccordionSummary,
    Box, Button, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogContentText, DialogTitle, IconButton,
    List, ListItem, ListItemText, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HistoryIcon from '@mui/icons-material/History';
import PreviewIcon from '@mui/icons-material/Preview';
import PublishIcon from '@mui/icons-material/Publish';
import RestoreIcon from '@mui/icons-material/Restore';
import SaveIcon from '@mui/icons-material/Save';


function StatusChip({ draft, preview, live }) {
    // Compact three-chip row. Empty slot → muted "—" chip so the row
    // alignment stays predictable.
    return (
        <Stack direction="row" spacing={1} alignItems="center">
            <Chip
                size="small"
                label={draft ? `Draft v${draft.version}` : 'No draft'}
                color={draft ? 'primary' : 'default'}
                variant={draft ? 'filled' : 'outlined'}
            />
            <Chip
                size="small"
                label={preview ? `Preview v${preview.version}` : 'No preview'}
                color={preview ? 'warning' : 'default'}
                variant={preview ? 'filled' : 'outlined'}
            />
            <Chip
                size="small"
                label={live ? `v${live.version} Live` : 'Not published'}
                color={live ? 'success' : 'default'}
                variant={live ? 'filled' : 'outlined'}
            />
        </Stack>
    );
}


const ModuleLifecyclePanel = ({
    moduleKey,
    moduleLabel,
    /** Per-status ModuleConfig dicts. Each has ``.id``, ``.version``,
     *  ``.status``, ``.note``, ``.published_at`` (live only). */
    draft = null,
    preview = null,
    live = null,
    /** Whether the editor surface has unsaved local changes for this
     *  module — gates the Save Draft button. */
    hasUnsavedChanges = false,
    /** Single rolled-up "in flight" boolean — disables all action
     *  buttons. Pass `saving || promoting || publishing`. */
    isBusy = false,
    /** Edit permission gate. When false, action buttons hide. */
    canEdit = true,
    /** Lifecycle callbacks. Omit any to hide its button. */
    onSaveDraft,
    onPromoteToPreview,
    onPublish,            // async (note: string) => void
    onRestore,            // async (versionId: string) => void
    /** Optional ``ModuleConfig[]`` for the History accordion (newest first). */
    history = [],
}) => {
    const [publishOpen, setPublishOpen] = useState(false);
    const [publishNote, setPublishNote] = useState('');

    const handlePublishConfirm = async () => {
        await onPublish?.(publishNote);
        setPublishOpen(false);
        setPublishNote('');
    };

    return (
        <Accordion
            sx={{
                mb: 1,
                '&::before': { display: 'none' },
                border: '1px solid',
                borderColor: hasUnsavedChanges ? 'warning.light' : 'divider',
            }}
        >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        width: '100%',
                        gap: 2,
                        pr: 2,
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Typography fontWeight="bold">
                            {moduleLabel || moduleKey}
                        </Typography>
                        {hasUnsavedChanges && (
                            <Chip
                                size="small"
                                label="Unsaved"
                                color="warning"
                            />
                        )}
                    </Box>
                    <StatusChip draft={draft} preview={preview} live={live} />
                </Box>
            </AccordionSummary>

            <AccordionDetails>
                {/* LIVE note + published_at */}
                {live && (live.note || live.published_at) && (
                    <Box sx={{ mb: 2 }}>
                        <Typography variant="caption" color="text.secondary">
                            Last published
                            {live.published_at
                                ? ` ${new Date(live.published_at).toLocaleString()}`
                                : ''}
                        </Typography>
                        {live.note && (
                            <Typography variant="body2" sx={{ mt: 0.5 }}>
                                <strong>Release notes:</strong> {live.note}
                            </Typography>
                        )}
                    </Box>
                )}

                {/* Lifecycle action buttons */}
                {canEdit && (
                    <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap">
                        {onSaveDraft && (
                            <Button
                                size="small"
                                variant="contained"
                                startIcon={
                                    isBusy
                                        ? <CircularProgress
                                            size={16} color="inherit"
                                          />
                                        : <SaveIcon />
                                }
                                onClick={onSaveDraft}
                                disabled={isBusy || !hasUnsavedChanges}
                            >
                                Save Draft
                            </Button>
                        )}
                        {onPromoteToPreview && (
                            <Button
                                size="small"
                                variant="outlined"
                                startIcon={<PreviewIcon />}
                                onClick={onPromoteToPreview}
                                disabled={isBusy || !draft}
                            >
                                Promote to Preview
                            </Button>
                        )}
                        {onPublish && (
                            <Tooltip
                                title={
                                    !preview
                                        ? 'No preview to publish — promote a draft first'
                                        : ''
                                }
                            >
                                <span>
                                    <Button
                                        size="small"
                                        variant="contained"
                                        color="success"
                                        startIcon={<PublishIcon />}
                                        onClick={() => setPublishOpen(true)}
                                        disabled={isBusy || !preview}
                                    >
                                        Publish
                                    </Button>
                                </span>
                            </Tooltip>
                        )}
                    </Stack>
                )}

                {/* History expandable — module-scoped */}
                {history.length > 0 && (
                    <Accordion sx={{ boxShadow: 'none' }}>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Stack direction="row" alignItems="center" spacing={1}>
                                <HistoryIcon fontSize="small" />
                                <Typography variant="body2">
                                    History ({history.length})
                                </Typography>
                            </Stack>
                        </AccordionSummary>
                        <AccordionDetails sx={{ p: 0 }}>
                            <List dense>
                                {history.map((v) => (
                                    <ListItem
                                        key={v.id}
                                        secondaryAction={
                                            v.status === 'archived' && onRestore && canEdit ? (
                                                <Tooltip title="Restore this version into a new draft">
                                                    <IconButton
                                                        edge="end"
                                                        size="small"
                                                        onClick={() => onRestore(v.id)}
                                                        disabled={isBusy}
                                                    >
                                                        <RestoreIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            ) : null
                                        }
                                    >
                                        <ListItemText
                                            primary={
                                                <Stack
                                                    direction="row"
                                                    spacing={1}
                                                    alignItems="center"
                                                >
                                                    <Typography
                                                        variant="body2"
                                                        fontWeight="bold"
                                                    >
                                                        v{v.version}
                                                    </Typography>
                                                    <Chip
                                                        size="small"
                                                        label={v.status}
                                                        color={
                                                            v.status === 'live'
                                                                ? 'success'
                                                                : v.status === 'preview'
                                                                    ? 'warning'
                                                                    : v.status === 'draft'
                                                                        ? 'primary'
                                                                        : 'default'
                                                        }
                                                    />
                                                    {v.publish_note && (
                                                        <Typography
                                                            variant="caption"
                                                            color="text.secondary"
                                                        >
                                                            — {v.publish_note}
                                                        </Typography>
                                                    )}
                                                </Stack>
                                            }
                                            secondary={
                                                v.published_at
                                                    ? `Published ${new Date(v.published_at).toLocaleString()}`
                                                    : v.created_at
                                                        ? `Created ${new Date(v.created_at).toLocaleString()}`
                                                        : null
                                            }
                                        />
                                    </ListItem>
                                ))}
                            </List>
                        </AccordionDetails>
                    </Accordion>
                )}
            </AccordionDetails>

            {/* Publish dialog — captures the optional release note */}
            <Dialog
                open={publishOpen}
                onClose={() => setPublishOpen(false)}
                fullWidth
                maxWidth="sm"
            >
                <DialogTitle>
                    Publish {moduleLabel || moduleKey}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        This promotes the current PREVIEW to LIVE for the
                        <strong> {moduleLabel || moduleKey}</strong> module.
                        Sibling modules are unaffected.
                    </DialogContentText>
                    <TextField
                        label="Release notes (optional)"
                        placeholder="What changed in this version?"
                        fullWidth
                        multiline
                        rows={3}
                        value={publishNote}
                        onChange={(e) => setPublishNote(e.target.value)}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPublishOpen(false)} disabled={isBusy}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handlePublishConfirm}
                        variant="contained"
                        color="success"
                        disabled={isBusy}
                        startIcon={
                            isBusy
                                ? <CircularProgress size={16} color="inherit" />
                                : <PublishIcon />
                        }
                    >
                        Publish
                    </Button>
                </DialogActions>
            </Dialog>
        </Accordion>
    );
};


export default ModuleLifecyclePanel;
