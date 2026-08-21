/**
 * Small drop-in logo uploader for landing modules / features.
 *
 * Posts the file to the existing ``/api/page-config/admin/assets`` endpoint
 * (the same one used for hero images), then invokes ``onChange(asset_id)``
 * so the caller can save it on the parent record's ``logo_asset_id`` column.
 *
 * The component shows the current logo (if any) as a thumbnail next to the
 * upload / remove buttons. ``currentUrl`` is rendered directly when present
 * so the admin sees the live image without an extra round-trip.
 *
 * No internal save — the caller is responsible for persisting ``asset_id``
 * via its own patch / mutation. Keeps this component dumb and reusable.
 */
import { useRef, useState } from 'react';
import { Box, Button, Stack, Typography, IconButton, Avatar, CircularProgress, Alert } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import { uploadAsset } from '../../../api/pageConfigEndpoints';

export default function LogoUploader({
    currentUrl,
    onChange,
    disabled = false,
    label = 'Logo',
    assetType = 'logo',
}) {
    const fileInputRef = useRef(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');

    const handlePick = () => {
        if (disabled || uploading) return;
        fileInputRef.current?.click();
    };

    const handleFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';  // allow re-picking the same file
        if (!file) return;
        setError('');
        setUploading(true);
        try {
            const resp = await uploadAsset(file, assetType, file.name);
            // The page-config API returns an envelope ``{data: {...asset...}}``.
            // Defensively support both shapes.
            const asset = resp?.data || resp;
            const assetId = asset?.id || asset?.asset_id;
            if (!assetId) throw new Error('Upload succeeded but no asset id returned.');
            onChange(assetId);
        } catch (err) {
            setError(err?.response?.data?.error || err?.message || 'Upload failed.');
        } finally {
            setUploading(false);
        }
    };

    const handleRemove = () => {
        if (disabled || uploading) return;
        onChange(null);
    };

    return (
        <Box>
            <Stack direction="row" spacing={2} alignItems="center">
                {currentUrl ? (
                    <Avatar
                        src={currentUrl}
                        variant="rounded"
                        sx={{ width: 56, height: 56, bgcolor: 'grey.50', p: 0.5, border: '1px solid', borderColor: 'grey.200' }}
                    />
                ) : (
                    <Box
                        sx={{
                            width: 56, height: 56, borderRadius: 1.5,
                            bgcolor: 'grey.100',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'text.disabled', fontSize: '0.65rem', textAlign: 'center', px: 1,
                        }}
                    >
                        No logo
                    </Box>
                )}

                <Stack spacing={0.5}>
                    <Stack direction="row" spacing={1}>
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={uploading ? <CircularProgress size={14} /> : <CloudUploadIcon />}
                            onClick={handlePick}
                            disabled={disabled || uploading}
                        >
                            {currentUrl ? 'Replace' : 'Upload'}
                        </Button>
                        {currentUrl && (
                            <IconButton
                                size="small" color="error"
                                onClick={handleRemove}
                                disabled={disabled || uploading}
                                aria-label="remove logo"
                            >
                                <DeleteIcon fontSize="small" />
                            </IconButton>
                        )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                        {label} — PNG / JPG / SVG, square works best.
                    </Typography>
                </Stack>
            </Stack>

            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFile}
                style={{ display: 'none' }}
            />

            {error && (
                <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError('')}>
                    {error}
                </Alert>
            )}
        </Box>
    );
}
