/**
 * ChangesDiffView — Shows the proposed changes in an approval request.
 *
 * Renders each changed field as a side-by-side card: the previous value
 * on the left (red tint) and the requested value on the right (green
 * tint), so an admin can compare them at a glance instead of reading
 * two stacked JSON blobs.
 *
 * Image fields (signature, profile_image, logo, document scans, etc.)
 * render as actual images rather than raw URL strings — an admin
 * approving a signature change MUST be able to see the signature, not
 * a copy-pasteable S3 key. The image heuristic looks at both the
 * field name (``signature``, ``image``, ``photo``, ``logo``, ``avatar``,
 * ``picture``, ``document``) and the value shape (data: URI, http(s)://
 * with image extension, leading slash with image extension).
 *
 * Falls back to JSON.stringify for anything that isn't a primitive or
 * recognisable image — large objects render as a pretty-printed code
 * block so the admin can still see the structure.
 */
import { useState } from 'react';
import { Box, Typography, Paper, Stack, Divider } from '@mui/material';
import ImageNotSupportedIcon from '@mui/icons-material/ImageNotSupported';

// ── Image detection ────────────────────────────────────────────────
// Field name hints — case-insensitive substring match. Covers every
// image-bearing field we currently surface through the approvals
// queue (doctor signature, profile image, tenant logo, hospital /
// clinic registration certificate uploads, ID documents, etc.).
const IMAGE_FIELD_HINTS = [
    'signature', 'image', 'photo', 'logo', 'avatar', 'picture',
    'document', 'certificate', 'thumbnail', 'banner', 'icon',
];

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?$/i;

const looksLikeImageValue = (val) => {
    if (typeof val !== 'string' || !val) return false;
    if (val.startsWith('data:image/')) return true;
    // http(s) URL or absolute path with an image extension.
    if (/^https?:\/\//i.test(val) && IMAGE_EXT_RE.test(val)) return true;
    if (val.startsWith('/') && IMAGE_EXT_RE.test(val)) return true;
    return false;
};

const looksLikeImageField = (key) => {
    if (!key) return false;
    const k = String(key).toLowerCase();
    return IMAGE_FIELD_HINTS.some((hint) => k.includes(hint));
};

// ── Side renderer — one cell of the old/new pair ───────────────────
const ValueCell = ({ value, fieldKey, tone /* 'old' | 'new' */ }) => {
    const bg = tone === 'old' ? 'rgba(243, 139, 168, 0.10)' : 'rgba(166, 227, 161, 0.10)';
    const border = tone === 'old' ? 'rgba(243, 139, 168, 0.45)' : 'rgba(166, 227, 161, 0.45)';
    const label = tone === 'old' ? 'Previous' : 'Requested';
    const labelColor = tone === 'old' ? '#f38ba8' : '#a6e3a1';

    const showAsImage = looksLikeImageValue(value)
        || (looksLikeImageField(fieldKey) && typeof value === 'string' && value);

    return (
        <Box
            sx={{
                flex: 1,
                p: 1.5,
                borderRadius: 1,
                bgcolor: bg,
                border: `1px solid ${border}`,
                minHeight: 80,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
            }}
        >
            <Typography
                variant="caption"
                sx={{ color: labelColor, fontWeight: 600, letterSpacing: 0.5 }}
            >
                {label}
            </Typography>

            {value === undefined || value === null || value === '' ? (
                <Typography variant="body2" sx={{ color: '#888', fontStyle: 'italic' }}>
                    (empty)
                </Typography>
            ) : showAsImage ? (
                <ImagePreview src={value} alt={`${label} ${fieldKey}`} />
            ) : typeof value === 'object' ? (
                <Box
                    component="pre"
                    sx={{
                        m: 0,
                        fontFamily: 'monospace',
                        fontSize: '0.78rem',
                        color: '#cdd6f4',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                    }}
                >
                    {JSON.stringify(value, null, 2)}
                </Box>
            ) : (
                <Typography
                    variant="body2"
                    sx={{
                        color: '#cdd6f4',
                        wordBreak: 'break-word',
                        whiteSpace: 'pre-wrap',
                        fontFamily: typeof value === 'boolean' || typeof value === 'number'
                            ? 'monospace'
                            : 'inherit',
                    }}
                >
                    {String(value)}
                </Typography>
            )}
        </Box>
    );
};

// ── Image with safe fallback ───────────────────────────────────────
// Approval payloads sometimes carry stale S3 keys whose presigned URL
// has already expired, or values that look like image URLs but
// actually 404. Render a placeholder if the image fails to load so
// the admin can still see the raw string.
const ImagePreview = ({ src, alt }) => {
    const [failed, setFailed] = useState(false);

    if (failed) {
        return (
            <Stack spacing={0.5}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: '#888' }}>
                    <ImageNotSupportedIcon fontSize="small" />
                    <Typography variant="caption">Image failed to load</Typography>
                </Box>
                <Typography
                    variant="caption"
                    sx={{ color: '#cdd6f4', wordBreak: 'break-all', fontFamily: 'monospace' }}
                >
                    {src}
                </Typography>
            </Stack>
        );
    }
    return (
        <Box
            component="img"
            src={src}
            alt={alt}
            onError={() => setFailed(true)}
            sx={{
                maxWidth: '100%',
                maxHeight: 200,
                objectFit: 'contain',
                bgcolor: '#fff',
                borderRadius: 0.5,
                p: 0.5,
            }}
        />
    );
};

const ChangesDiffView = ({ changes }) => {
    if (!changes || Object.keys(changes).length === 0) {
        return (
            <Box>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                    Proposed Changes
                </Typography>
                <Typography color="text.secondary" variant="body2">
                    No change details available.
                </Typography>
            </Box>
        );
    }

    return (
        <Box>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
                Proposed Changes
            </Typography>
            <Stack spacing={2}>
                {Object.entries(changes).map(([key, value]) => {
                    // Normalise into ``{ old, new }`` so the side-by-side
                    // layout works no matter which shape the backend
                    // returned. Three common shapes:
                    //   { field: { old: X, new: Y } } — full diff
                    //   { field: Y }                 — new value only
                    //   { field: { ...nested } }     — arbitrary blob
                    //                                  (e.g. address)
                    // For the blob case we treat the whole thing as
                    // the "Requested" value with no "Previous" — better
                    // than splatting two identical JSON dumps.
                    const hasDiff = value && typeof value === 'object'
                        && !Array.isArray(value)
                        && ('old' in value || 'new' in value);
                    const oldVal = hasDiff ? value.old : undefined;
                    const newVal = hasDiff ? value.new : value;

                    return (
                        <Paper
                            key={key}
                            sx={{
                                p: 2,
                                borderRadius: 2,
                                bgcolor: '#1e1e2e',
                            }}
                            elevation={2}
                        >
                            <Typography
                                variant="subtitle2"
                                sx={{
                                    color: '#89b4fa',
                                    fontFamily: 'monospace',
                                    mb: 1.5,
                                    wordBreak: 'break-word',
                                }}
                            >
                                {key}
                            </Typography>
                            <Stack
                                direction={{ xs: 'column', sm: 'row' }}
                                spacing={1.5}
                                divider={
                                    <Divider
                                        orientation="vertical"
                                        flexItem
                                        sx={{ borderColor: 'rgba(255,255,255,0.12)' }}
                                    />
                                }
                            >
                                <ValueCell value={oldVal} fieldKey={key} tone="old" />
                                <ValueCell value={newVal} fieldKey={key} tone="new" />
                            </Stack>
                        </Paper>
                    );
                })}
            </Stack>
        </Box>
    );
};

export default ChangesDiffView;
