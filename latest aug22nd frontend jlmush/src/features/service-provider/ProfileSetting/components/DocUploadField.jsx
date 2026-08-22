import React, { useRef, useState } from 'react';
import { Box, Button, Typography, Tooltip } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import VisibilityIcon from '@mui/icons-material/Visibility';
import EditIcon from '@mui/icons-material/Edit';
import ReplayIcon from '@mui/icons-material/Replay';
import axiosInstance from '../../../../api/axiosConfig';

/**
 * DocUploadField – shows 3 action buttons once a document is uploaded:
 *   Preview Uploaded → For freshly-picked File objects: opens blob URL directly.
 *                      For server-stored documents: calls the backend presign
 *                      endpoint to get a valid URL, then opens it.
 *   Edit             → pick a replacement file (without clearing current)
 *   Re-upload        → clear, then pick a new file
 *
 * Props:
 *   fieldName  – backend field name, e.g. 'aadhar_attachment' (used for presign)
 *   label      – upload button label
 *   accept     – file input accept string
 *   value      – current value: File | S3-key-string | local-path-string | ''
 *   onChange   – (File) => void
 *   onClear    – () => void
 */
const DocUploadField = React.memo(({ fieldName, label, accept = 'image/*,.pdf', value, onChange, onClear }) => {
    const inputRef = useRef(null);
    const [previewing, setPreviewing] = useState(false);

    const hasFile = Boolean(value);
    const isFile  = value instanceof File;
    const fileName = isFile ? value.name : (hasFile ? 'Uploaded document' : '');

    const openPicker = () => inputRef.current?.click();

    const handleChange = (e) => {
        const file = e.target.files?.[0];
        if (file) onChange(file);
        e.target.value = '';
    };

    const handlePreview = async () => {
        if (!hasFile) return;

        // Freshly-picked file not yet saved → open blob URL directly
        if (isFile) {
            const blobUrl = URL.createObjectURL(value);
            window.open(blobUrl, '_blank', 'noopener,noreferrer');
            return;
        }

        // Stored document → ask backend for a safe presigned URL
        if (!fieldName) return;
        setPreviewing(true);
        try {
            const { data } = await axiosInstance.get(
                `/api/v1/doctor/profile/documents/presign?field=${encodeURIComponent(fieldName)}`
            );
            if (data?.data?.url) {
                window.open(data.data.url, '_blank', 'noopener,noreferrer');
            } else {
                alert(data?.message || 'Could not load document preview.');
            }
        } catch (err) {
            alert(err?.response?.data?.message || 'Failed to fetch document preview.');
        } finally {
            setPreviewing(false);
        }
    };

    return (
        <Box>
            <input ref={inputRef} type="file" hidden accept={accept} onChange={handleChange} />
            {!hasFile ? (
                <Button variant="outlined" startIcon={<AttachFileIcon />} size="medium"
                    sx={{ whiteSpace: 'nowrap' }} onClick={openPicker}>
                    {label}
                </Button>
            ) : (
                <Box display="flex" flexDirection="column" gap={0.5}>
                    <Typography variant="caption" color="success.main" fontWeight={600}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        ✓ {fileName}
                    </Typography>
                    <Box display="flex" gap={1} flexWrap="wrap">
                        <Tooltip title="Preview the currently uploaded document">
                            <Button variant="outlined" size="small" startIcon={<VisibilityIcon />}
                                onClick={handlePreview}
                                disabled={previewing}
                                color="info" sx={{ textTransform: 'none', fontSize: '0.78rem' }}>
                                {previewing ? 'Loading…' : 'Preview Uploaded'}
                            </Button>
                        </Tooltip>
                        <Tooltip title="Choose a different file (keeps current until saved)">
                            <Button variant="outlined" size="small" startIcon={<EditIcon />}
                                onClick={openPicker}
                                color="warning" sx={{ textTransform: 'none', fontSize: '0.78rem' }}>
                                Edit
                            </Button>
                        </Tooltip>
                        <Tooltip title="Clear and upload a completely new document">
                            <Button variant="outlined" size="small" startIcon={<ReplayIcon />}
                                onClick={() => { onClear?.(); setTimeout(openPicker, 50); }}
                                color="error" sx={{ textTransform: 'none', fontSize: '0.78rem' }}>
                                Re-upload
                            </Button>
                        </Tooltip>
                    </Box>
                </Box>
            )}
        </Box>
    );
});

DocUploadField.displayName = 'DocUploadField';

export default DocUploadField;
