/**
 * MediaListEditor — shared image/video gallery row editor for the landing
 * Module and Feature config editors.
 *
 * Two ways to add a row:
 *   * Upload a file — the file is STAGED in memory only (validated against the
 *     size cap at pick time). Nothing hits S3 here; the deferred upload runs
 *     inside the editor's Save Draft (see resolveStagedGalleryUploads +
 *     useModuleConfigEditor/useFeatureConfigEditor). So an abandoned edit
 *     leaves no orphaned S3 objects, and the asset only becomes real when the
 *     draft is saved.
 *   * Paste a hosted URL — for an already-hosted asset or an external link
 *     (YouTube/Vimeo/CDN). These carry no ``s3_key`` and are never deleted by
 *     the publish-time orphan reconciliation.
 *
 * Persisted row shape: `{ title, <urlField>, s3_key?, display_order,
 * is_visible }`. A staged (not-yet-uploaded) row instead holds `{ _file,
 * _fileName, ... }` and is resolved to the persisted shape on save.
 */
import { useRef, useState } from 'react';
import {
    Box, Grid, TextField, Button, List, ListItem, ListItemText,
    IconButton, Switch, Tooltip, Typography, Chip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';

const formatBytes = (b) => {
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${b} B`;
};

const MediaListEditor = ({
    value,                // the full { videos: [...] } / { images: [...] } object
    itemsKey,             // 'videos' | 'images'
    urlField,             // 'video_url' | 'image_url' — where the URL is stored
    urlLabel,             // 'Video URL' | 'Image URL'
    accept,               // file input accept filter
    maxBytes,             // client-side size cap (mirrors backend)
    maxLabel,             // '2 MB' / '5 MB' for messaging
    onChange,
    disabled,
}) => {
    const items = value?.[itemsKey] || [];
    const [title, setTitle] = useState('');
    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const fileRef = useRef(null);

    const commit = (nextItems) => onChange({ ...(value || {}), [itemsKey]: nextItems });

    const appendItem = (item) => {
        commit([...items, { display_order: items.length, is_visible: true, ...item }]);
    };

    const addUrl = () => {
        if (!url.trim()) return;
        appendItem({ title: title.trim(), [urlField]: url.trim() });
        setTitle('');
        setUrl('');
        setError('');
    };

    // Picking a file STAGES it — no S3 upload here. Size/type is validated up
    // front so the admin sees a problem immediately; the real upload happens
    // on Save Draft. Cancel/abandon leaves nothing behind.
    const stageFile = (e) => {
        const file = e.target.files?.[0];
        if (fileRef.current) fileRef.current.value = '';   // allow re-pick of same file
        if (!file) return;
        if (maxBytes && file.size > maxBytes) {
            setError(`File is ${formatBytes(file.size)} — max allowed is ${maxLabel}.`);
            return;
        }
        setError('');
        appendItem({ title: (title || file.name).trim(), _file: file, _fileName: file.name });
        setTitle('');
    };

    const removeItem = (idx) => commit(items.filter((_, i) => i !== idx));

    const move = (idx, dir) => {
        const target = idx + dir;
        if (target < 0 || target >= items.length) return;
        const next = [...items];
        const [item] = next.splice(idx, 1);
        next.splice(target, 0, item);
        commit(next);
    };

    const toggleVisible = (idx) => {
        const next = [...items];
        next[idx] = { ...next[idx], is_visible: !next[idx].is_visible };
        commit(next);
    };

    return (
        <Box>
            <Grid container spacing={1} sx={{ mb: 0.5 }} alignItems="center">
                <Grid item xs={12} sm={3}>
                    <TextField
                        fullWidth size="small" label="Title (optional)"
                        value={title} onChange={(e) => setTitle(e.target.value)}
                        disabled={disabled}
                    />
                </Grid>
                <Grid item xs={12} sm={5}>
                    <TextField
                        fullWidth size="small" label={urlLabel}
                        value={url} onChange={(e) => setUrl(e.target.value)}
                        disabled={disabled}
                        placeholder="https://... (external link)"
                    />
                </Grid>
                <Grid item xs={6} sm={2}>
                    <Button
                        fullWidth variant="outlined" startIcon={<AddIcon />}
                        onClick={addUrl} disabled={disabled || !url.trim()}
                    >
                        Add URL
                    </Button>
                </Grid>
                <Grid item xs={6} sm={2}>
                    <Button
                        fullWidth variant="contained" startIcon={<CloudUploadIcon />}
                        onClick={() => fileRef.current?.click()} disabled={disabled}
                    >
                        Upload
                    </Button>
                    <input ref={fileRef} type="file" hidden accept={accept} onChange={stageFile} />
                </Grid>
            </Grid>
            <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, display: 'block', mb: 1 }}>
                Max {maxLabel}. Uploaded files are saved to storage when you click Save Draft.
            </Typography>
            {error && (
                <Typography variant="caption" color="error" sx={{ px: 1, display: 'block', mb: 1 }}>
                    {error}
                </Typography>
            )}
            <List dense>
                {items.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
                        None yet.
                    </Typography>
                )}
                {items.map((item, i) => {
                    const staged = !!item._file;
                    return (
                        <ListItem
                            key={item.id || i}
                            secondaryAction={
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                    <Tooltip title={item.is_visible === false ? 'Hidden' : 'Visible'}>
                                        <Switch
                                            size="small"
                                            checked={item.is_visible !== false}
                                            onChange={() => toggleVisible(i)}
                                            disabled={disabled}
                                        />
                                    </Tooltip>
                                    <IconButton size="small" disabled={disabled || i === 0}
                                                onClick={() => move(i, -1)}>
                                        <ArrowUpwardIcon fontSize="inherit" />
                                    </IconButton>
                                    <IconButton size="small" disabled={disabled || i === items.length - 1}
                                                onClick={() => move(i, 1)}>
                                        <ArrowDownwardIcon fontSize="inherit" />
                                    </IconButton>
                                    <IconButton size="small" color="error" disabled={disabled}
                                                onClick={() => removeItem(i)}>
                                        <DeleteIcon fontSize="inherit" />
                                    </IconButton>
                                </Box>
                            }
                        >
                            <ListItemText
                                primary={
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <span>{item.title || <em>Untitled</em>}</span>
                                        {staged && (
                                            <Chip size="small" color="warning" variant="outlined"
                                                  label="Pending — saves on Save Draft" />
                                        )}
                                    </Box>
                                }
                                secondary={staged ? item._fileName : item[urlField]}
                            />
                        </ListItem>
                    );
                })}
            </List>
        </Box>
    );
};

// Client-side caps MIRROR the backend config (config.py
// MEDIA_UPLOAD_MAX_BYTES, the source of truth) for instant pick-time feedback.
// Image 2 MB / video 20 MB — keep in sync if the backend config changes.
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const VIDEO_MAX_BYTES = 20 * 1024 * 1024;

export const VideosEditor = (props) => (
    <MediaListEditor
        {...props}
        itemsKey="videos" urlField="video_url" urlLabel="Video URL"
        accept="video/*" maxBytes={VIDEO_MAX_BYTES} maxLabel="20 MB"
    />
);

export const ImagesEditor = (props) => (
    <MediaListEditor
        {...props}
        itemsKey="images" urlField="image_url" urlLabel="Image URL"
        accept="image/*" maxBytes={IMAGE_MAX_BYTES} maxLabel="2 MB"
    />
);

export default MediaListEditor;
