/**
 * VideosTab — admin CRUD for the landing-page video gallery.
 *
 * Mounted as a tab inside ``LandingConfigEditor``. This is the only place
 * the videos collection is edited — the legacy standalone manager page
 * has been removed.
 *
 * Each video accepts EITHER an external URL (YouTube / Vimeo / direct mp4)
 * OR an uploaded video asset, plus an optional thumbnail and a free-form
 * ``category`` used to group videos on ``/gallery/videos``. Edits go LIVE
 * immediately.
 *
 * The public landing page renders the first 3 visible videos and shows a
 * "More videos" CTA when the visible total exceeds 3.
 */
import { useMemo, useState } from 'react';
import {
    Box, Card, CardContent, Typography, Button, Table, TableContainer, TableHead, TableRow,
    TableCell, TableBody, IconButton, TextField, Switch, Alert, Dialog,
    DialogTitle, DialogContent, DialogActions, Tooltip, Stack, CircularProgress,
    Chip, MenuItem,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import {
    useListLandingVideosQuery,
    useCreateLandingVideoMutation,
    useUpdateLandingVideoMutation,
    useDeleteLandingVideoMutation,
    useReorderLandingVideosMutation,
} from '../../../../../api/landingPageConfigEndpoints';
import {
    useListPlatformLandingVideosQuery,
    useCreatePlatformLandingVideoMutation,
    useUpdatePlatformLandingVideoMutation,
    useDeletePlatformLandingVideoMutation,
} from '../../../../../api/platformLandingEndpoints';
import { uploadAsset } from '../../../../../api/pageConfigEndpoints';

const EMPTY = {
    title: '', description: '', category: '',
    video_url: '',
    // ``*_asset_id`` / ``*_url`` are the *persisted* asset (loaded when
    // editing an existing row, or set after a successful upload).
    video_asset_id: null, video_asset_url: null,
    thumbnail_asset_id: null, thumbnail_url: null,
    // ``*_file`` is the locally-staged File object — kept in memory until
    // the admin clicks Create, at which point it's uploaded to S3 and the
    // asset_id is filled in. Cancel discards the file with no S3 round-trip.
    video_file: null,
    thumbnail_file: null,
    is_visible: true,
};

const URL_RE = /^https?:\/\/[^\s]+$/;
// Mirror the backend caps in ``S3Service._PER_TYPE_RULES`` so admins get
// instant feedback in the picker instead of waiting for the upload round-
// trip to fail. Backend remains the source of truth.
const VIDEO_MAX_BYTES = 5 * 1024 * 1024;
const VIDEO_MAX_LABEL = '5 MB';
const THUMBNAIL_MAX_BYTES = 1 * 1024 * 1024;
const THUMBNAIL_MAX_LABEL = '1 MB';
const THUMBNAIL_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp';

const formatFileSize = (bytes) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
};

export default function VideosTab({
    canEdit, canCreate, canDelete, mode = 'tenant', scope = 'marketing',
}) {
    const isPlatform = mode === 'platform';

    const tenantList = useListLandingVideosQuery(undefined, { skip: isPlatform });
    const platformList = useListPlatformLandingVideosQuery(scope, { skip: !isPlatform });
    const items = (isPlatform ? platformList.data : tenantList.data) || [];
    const isLoading = isPlatform ? platformList.isLoading : tenantList.isLoading;

    const [createTenant, createTenantState] = useCreateLandingVideoMutation();
    const [updateTenant, updateTenantState] = useUpdateLandingVideoMutation();
    const [deleteTenant] = useDeleteLandingVideoMutation();
    const [reorderTenant] = useReorderLandingVideosMutation();
    const [createPlatform, createPlatformState] = useCreatePlatformLandingVideoMutation();
    const [updatePlatform, updatePlatformState] = useUpdatePlatformLandingVideoMutation();
    const [deletePlatform] = useDeletePlatformLandingVideoMutation();

    const createItem = isPlatform
        ? (payload) => createPlatform({ scope, data: payload })
        : createTenant;
    const updateItem = isPlatform ? updatePlatform : updateTenant;
    const deleteItem = isPlatform ? deletePlatform : deleteTenant;
    const createState = isPlatform ? createPlatformState : createTenantState;
    const updateState = isPlatform ? updatePlatformState : updateTenantState;
    // No reorder endpoint on platform videos — same as recognitions.
    const supportsReorder = !isPlatform;

    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(EMPTY);
    // ``isUploading`` is true while the deferred upload(s) are in flight on
    // Create. ``videoFileError`` / ``thumbnailFileError`` carry pre-upload
    // size / type validation so admins see the problem immediately at pick
    // time without waiting for the Create round-trip.
    const [isUploading, setIsUploading] = useState(false);
    const [videoFileError, setVideoFileError] = useState('');
    const [thumbnailFileError, setThumbnailFileError] = useState('');

    const isSaving = isUploading || createState.isLoading || updateState.isLoading;

    const sorted = useMemo(
        () => [...items].sort((a, b) => (a.display_order || 0) - (b.display_order || 0)),
        [items],
    );

    const existingCategories = useMemo(() => {
        const set = new Set();
        items.forEach((v) => v.category && set.add(v.category.trim()));
        return Array.from(set).filter(Boolean);
    }, [items]);

    const closeEditor = () => {
        setEditorOpen(false);
        setVideoFileError('');
        setThumbnailFileError('');
    };

    const openCreate = () => {
        setEditing(null);
        setForm(EMPTY);
        setVideoFileError('');
        setThumbnailFileError('');
        setEditorOpen(true);
    };

    const openEdit = (item) => {
        setEditing(item);
        setForm({
            ...EMPTY,
            title: item.title || '',
            description: item.description || '',
            category: item.category || '',
            video_url: item.video_url || '',
            video_asset_id: item.video_asset_id || null,
            video_asset_url: item.video_asset_url || null,
            thumbnail_asset_id: item.thumbnail_asset_id || null,
            thumbnail_url: item.thumbnail_url || null,
            is_visible: item.is_visible !== false,
        });
        setVideoFileError('');
        setThumbnailFileError('');
        setEditorOpen(true);
    };

    // Picking a file STAGES it locally — no S3 upload yet. The actual upload
    // runs inside ``handleSave`` only when the admin clicks Create, so an
    // abandoned dialog leaves no orphaned S3 objects or DB asset rows.
    const handleVideoFilePick = (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setVideoFileError('');
        if (file.size > VIDEO_MAX_BYTES) {
            setVideoFileError(
                `Video is too large (${formatFileSize(file.size)}). Max allowed: ${VIDEO_MAX_LABEL}.`,
            );
            return;
        }
        setForm((p) => ({
            ...p,
            video_file: file,
            // Picking an upload clears the URL field — they're mutually
            // exclusive on the same record.
            video_url: '',
            // Also clear any previously-attached asset so editing replaces
            // cleanly when Save runs.
            video_asset_id: null,
            video_asset_url: null,
        }));
    };

    const handleThumbnailFilePick = (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setThumbnailFileError('');
        if (file.size > THUMBNAIL_MAX_BYTES) {
            setThumbnailFileError(
                `Thumbnail is too large (${formatFileSize(file.size)}). Max allowed: ${THUMBNAIL_MAX_LABEL}.`,
            );
            return;
        }
        setForm((p) => ({
            ...p,
            thumbnail_file: file,
            thumbnail_asset_id: null,
            thumbnail_url: null,
        }));
    };

    const clearStagedVideo = () => {
        setVideoFileError('');
        setForm((p) => ({
            ...p, video_file: null, video_asset_id: null, video_asset_url: null,
        }));
    };
    const clearStagedThumbnail = () => {
        setThumbnailFileError('');
        setForm((p) => ({
            ...p, thumbnail_file: null, thumbnail_asset_id: null, thumbnail_url: null,
        }));
    };

    const handleSave = async () => {
        // Step 1: Upload any locally-staged files first, in parallel. This is
        // the deferred S3 round-trip — picking a file earlier was free.
        let videoAssetId = form.video_asset_id;
        let thumbnailAssetId = form.thumbnail_asset_id;
        try {
            setIsUploading(true);
            const tasks = [];
            if (form.video_file) {
                tasks.push(
                    uploadAsset(form.video_file, 'video', form.video_file.name)
                        .then((resp) => {
                            const asset = resp?.data || resp;
                            const id = asset?.id || asset?.asset_id;
                            if (!id) throw new Error('Video upload returned no asset id.');
                            videoAssetId = id;
                        }),
                );
            }
            if (form.thumbnail_file) {
                tasks.push(
                    uploadAsset(form.thumbnail_file, 'thumbnail', form.thumbnail_file.name)
                        .then((resp) => {
                            const asset = resp?.data || resp;
                            const id = asset?.id || asset?.asset_id;
                            if (!id) throw new Error('Thumbnail upload returned no asset id.');
                            thumbnailAssetId = id;
                        }),
                );
            }
            if (tasks.length) await Promise.all(tasks);
        } catch (err) {
            setIsUploading(false);
            // Surface the upload error inline rather than letting it bubble —
            // the create/update mutation never ran, so there's nothing to
            // roll back. Backend message wins (it knows the actual cause:
            // wrong type, too big, bucket misconfigured, etc.).
            const msg = err?.response?.data?.error || err?.message || 'File upload failed.';
            if (form.video_file) setVideoFileError(msg);
            else if (form.thumbnail_file) setThumbnailFileError(msg);
            return;
        }
        setIsUploading(false);

        // Step 2: Persist the video record with the (possibly newly assigned)
        // asset ids.
        const payload = {
            title: form.title.trim(),
            description: form.description.trim() || null,
            category: form.category.trim() || null,
            video_url: form.video_url.trim() || null,
            video_asset_id: videoAssetId || null,
            thumbnail_asset_id: thumbnailAssetId || null,
            is_visible: !!form.is_visible,
        };
        try {
            if (editing) {
                await updateItem({ videoId: editing.id, data: payload }).unwrap();
            } else {
                await createItem({ ...payload, display_order: sorted.length }).unwrap();
            }
            closeEditor();
        } catch { /* surfaced via mutation state */ }
    };

    const handleToggleVisible = async (item) => {
        try {
            await updateItem({
                videoId: item.id,
                data: { is_visible: !item.is_visible },
            }).unwrap();
        } catch { /* swallow */ }
    };

    const handleDelete = async (item) => {
        if (!window.confirm(`Delete video "${item.title}"?`)) return;
        try { await deleteItem(item.id).unwrap(); } catch { /* swallow */ }
    };

    const moveItem = async (index, direction) => {
        if (!supportsReorder) return;
        const target = index + direction;
        if (target < 0 || target >= sorted.length) return;
        const reordered = [...sorted];
        const [moved] = reordered.splice(index, 1);
        reordered.splice(target, 0, moved);
        try {
            await reorderTenant(
                reordered.map((it, i) => ({ id: it.id, display_order: i })),
            ).unwrap();
        } catch { /* swallow */ }
    };

    const formError = (() => {
        const t = form.title.trim();
        if (!t) return 'Title is required.';
        if (t.length > 200) return 'Title must be 200 characters or fewer.';
        const url = form.video_url.trim();
        if (url && !URL_RE.test(url)) return 'Video URL must start with http:// or https://';
        // Treat a locally-staged file as satisfying the source requirement —
        // it's about to be uploaded the moment Create is clicked.
        if (!url && !form.video_asset_id && !form.video_file) {
            return 'Provide a video URL or upload a video file.';
        }
        if (videoFileError) return videoFileError;
        if (thumbnailFileError) return thumbnailFileError;
        return null;
    })();

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Card>
                <CardContent>
                    <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap">
                        <Typography variant="h6">Video gallery</Typography>
                        <Box sx={{ flex: 1 }} />
                        <Button
                            variant="outlined" size="small" startIcon={<OpenInNewIcon />}
                            onClick={() => window.open('/gallery/videos', '_blank', 'noopener')}
                        >
                            View public gallery
                        </Button>
                        <Button
                            variant="contained" startIcon={<AddIcon />}
                            onClick={openCreate} disabled={!canCreate}
                        >
                            New video
                        </Button>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                        First 3 visible videos render on the landing page strip; when
                        more than 3 exist, a "More videos" CTA links to ``/gallery/videos``
                        which lists every visible video grouped by ``Category``. Each
                        video can be a YouTube / Vimeo / mp4 URL OR an uploaded file.
                    </Typography>

                    <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell width={110}>Order</TableCell>
                                <TableCell>Title</TableCell>
                                <TableCell>Source</TableCell>
                                <TableCell>Category</TableCell>
                                <TableCell align="center" width={90}>Visible</TableCell>
                                <TableCell align="right" width={120}>Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {isLoading && (
                                <TableRow>
                                    <TableCell colSpan={6} align="center">
                                        <CircularProgress size={24} sx={{ my: 2 }} />
                                    </TableCell>
                                </TableRow>
                            )}
                            {!isLoading && sorted.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} sx={{ color: 'text.secondary', py: 4 }} align="center">
                                        No videos yet — click "New video" to add one.
                                    </TableCell>
                                </TableRow>
                            )}
                            {sorted.map((item, idx) => (
                                <TableRow key={item.id} hover>
                                    <TableCell>
                                        <IconButton
                                            size="small"
                                            disabled={!canEdit || !supportsReorder || idx === 0}
                                            onClick={() => moveItem(idx, -1)}
                                        >
                                            <ArrowUpwardIcon fontSize="inherit" />
                                        </IconButton>
                                        <IconButton
                                            size="small"
                                            disabled={!canEdit || !supportsReorder || idx === sorted.length - 1}
                                            onClick={() => moveItem(idx, 1)}
                                        >
                                            <ArrowDownwardIcon fontSize="inherit" />
                                        </IconButton>
                                    </TableCell>
                                    <TableCell>
                                        <Typography fontWeight={600}>{item.title}</Typography>
                                        {item.description && (
                                            <Typography
                                                variant="caption" color="text.secondary"
                                                sx={{
                                                    display: '-webkit-box', WebkitLineClamp: 1,
                                                    WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                                    maxWidth: 360,
                                                }}
                                            >
                                                {item.description}
                                            </Typography>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {item.video_asset_id ? (
                                            <Chip label="Uploaded" size="small" color="primary" variant="outlined" />
                                        ) : item.video_url ? (
                                            <Chip
                                                label={hostnameOf(item.video_url) || 'External URL'}
                                                size="small" variant="outlined"
                                            />
                                        ) : (
                                            <Chip label="No source" size="small" color="warning" variant="outlined" />
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2" color="text.secondary">
                                            {item.category || '—'}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="center">
                                        <Switch
                                            size="small" checked={!!item.is_visible}
                                            disabled={!canEdit}
                                            onChange={() => handleToggleVisible(item)}
                                        />
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title="Edit">
                                            <IconButton onClick={() => openEdit(item)} disabled={!canEdit}>
                                                <EditIcon />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete">
                                            <span>
                                                <IconButton
                                                    color="error"
                                                    onClick={() => handleDelete(item)}
                                                    disabled={!canDelete}
                                                >
                                                    <DeleteIcon />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    </TableContainer>
                </CardContent>
            </Card>

            <Dialog open={editorOpen} onClose={isSaving ? undefined : closeEditor} maxWidth="sm" fullWidth>
                <DialogTitle>{editing ? 'Edit video' : 'New video'}</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2.5}>
                        <TextField
                            fullWidth size="small" label="Title" required
                            value={form.title}
                            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                        />
                        <TextField
                            fullWidth size="small" label="Description (optional)"
                            multiline minRows={2} maxRows={4}
                            value={form.description}
                            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                        />

                        <TextField
                            fullWidth size="small" label="Video URL (YouTube / Vimeo / direct mp4)"
                            placeholder="https://www.youtube.com/watch?v=…"
                            value={form.video_url}
                            onChange={(e) => setForm((p) => ({
                                ...p, video_url: e.target.value,
                                ...(e.target.value
                                    ? { video_asset_id: null, video_asset_url: null }
                                    : {}),
                            }))}
                            helperText={`Or upload an mp4 / webm below (max ${VIDEO_MAX_LABEL}).`}
                        />
                        {/* Video file — staged locally, uploaded only on Create. */}
                        <Box>
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                <Button
                                    component="label"
                                    variant="outlined"
                                    size="small"
                                    disabled={isSaving}
                                >
                                    {form.video_file || form.video_asset_id ? 'Replace video' : 'Upload video file'}
                                    <input
                                        type="file"
                                        accept=".mp4,.webm,.mov,.m4v,.ogg,video/mp4,video/webm,video/quicktime,video/ogg"
                                        hidden
                                        onChange={handleVideoFilePick}
                                    />
                                </Button>
                                {form.video_file && (
                                    <>
                                        <Typography variant="caption" color="info.main">
                                            ✓ {form.video_file.name} ({formatFileSize(form.video_file.size)}) — uploads on Create
                                        </Typography>
                                        <IconButton
                                            size="small" aria-label="clear staged video"
                                            onClick={clearStagedVideo} disabled={isSaving}
                                        >
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </>
                                )}
                                {!form.video_file && form.video_asset_id && (
                                    <Typography variant="caption" color="success.main">
                                        ✓ Video already uploaded.
                                    </Typography>
                                )}
                            </Stack>
                            {videoFileError && (
                                <Alert severity="error" sx={{ mt: 1 }} onClose={() => setVideoFileError('')}>
                                    {videoFileError}
                                </Alert>
                            )}
                        </Box>

                        {/* Thumbnail — same staged-then-upload pattern as the
                            video. Inline here (not LogoUploader) because the
                            shared LogoUploader uploads on pick, which is the
                            exact behaviour we're moving away from. */}
                        <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                Thumbnail (optional) — PNG / JPG / WEBP, max {THUMBNAIL_MAX_LABEL}.
                            </Typography>
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                <Button
                                    component="label"
                                    variant="outlined"
                                    size="small"
                                    disabled={isSaving}
                                >
                                    {form.thumbnail_file || form.thumbnail_asset_id ? 'Replace thumbnail' : 'Upload thumbnail'}
                                    <input
                                        type="file"
                                        accept={THUMBNAIL_ACCEPT}
                                        hidden
                                        onChange={handleThumbnailFilePick}
                                    />
                                </Button>
                                {form.thumbnail_file && (
                                    <>
                                        <Typography variant="caption" color="info.main">
                                            ✓ {form.thumbnail_file.name} ({formatFileSize(form.thumbnail_file.size)}) — uploads on Create
                                        </Typography>
                                        <IconButton
                                            size="small" aria-label="clear staged thumbnail"
                                            onClick={clearStagedThumbnail} disabled={isSaving}
                                        >
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </>
                                )}
                                {!form.thumbnail_file && form.thumbnail_url && (
                                    <Box
                                        component="img"
                                        src={form.thumbnail_url}
                                        alt="thumbnail preview"
                                        sx={{
                                            width: 48, height: 48, borderRadius: 1,
                                            objectFit: 'cover', border: '1px solid', borderColor: 'grey.200',
                                        }}
                                    />
                                )}
                            </Stack>
                            {thumbnailFileError && (
                                <Alert severity="error" sx={{ mt: 1 }} onClose={() => setThumbnailFileError('')}>
                                    {thumbnailFileError}
                                </Alert>
                            )}
                        </Box>

                        <TextField
                            select fullWidth size="small" label="Category (optional)"
                            value={existingCategories.includes(form.category) ? form.category : ''}
                            onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                            SelectProps={{ displayEmpty: true }}
                            helperText="Used to group videos on the gallery page."
                        >
                            <MenuItem value="">(uncategorised)</MenuItem>
                            {existingCategories.map((c) => (
                                <MenuItem key={c} value={c}>{c}</MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            fullWidth size="small" label="Or new category name"
                            placeholder="e.g. Patient Stories"
                            value={existingCategories.includes(form.category) ? '' : form.category}
                            onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                        />

                        <Stack direction="row" alignItems="center" spacing={1}>
                            <Switch
                                size="small"
                                checked={!!form.is_visible}
                                onChange={(e) => setForm((p) => ({ ...p, is_visible: e.target.checked }))}
                            />
                            <Typography variant="body2">Visible on public landing</Typography>
                        </Stack>

                        {formError && <Alert severity="warning">{formError}</Alert>}

                        {/* Backend save errors — these were previously
                            swallowed by the catch block, which made Save
                            look like a no-op when the request 4xx/5xx'd
                            (e.g. URL validator rejected the YouTube link
                            for a subtle format reason). Surfacing them
                            here is the difference between "video saved
                            but not appearing" and "save actually failed
                            and you can see why". */}
                        {(createState.error || updateState.error) && (
                            <Alert severity="error">
                                {extractError(createState.error || updateState.error)}
                            </Alert>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeEditor} disabled={isSaving}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleSave}
                        disabled={isSaving || !!formError}
                        startIcon={isSaving ? <CircularProgress size={16} /> : null}
                    >
                        {isSaving
                            ? (isUploading ? 'Uploading…' : 'Saving…')
                            : (editing ? 'Save changes' : 'Create')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

function hostnameOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}

/** Best-effort: pull a human message out of an RTK Query error envelope.
 *  Marshmallow validation errors come back as
 *  ``{errors: {field: ['msg', ...]}}``; generic failures use ``message``
 *  or ``error`` strings. We collapse all into one readable line. */
function extractError(rtkError) {
    if (!rtkError) return 'Save failed.';
    const env = rtkError.data || rtkError;
    if (env?.errors && typeof env.errors === 'object') {
        return Object.entries(env.errors)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : v}`)
            .join(' • ');
    }
    if (typeof env?.error === 'string') return env.error;
    if (typeof env?.message === 'string') return env.message;
    return `Save failed (${rtkError.status || 'unknown'}). Check the network tab for details.`;
}
