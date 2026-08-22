import React, { useRef, useState } from 'react';
import { Box, Button, Typography, Tooltip } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import VisibilityIcon from '@mui/icons-material/Visibility';
import EditIcon from '@mui/icons-material/Edit';
import ReplayIcon from '@mui/icons-material/Replay';
import axiosInstance from '../../../../api/axiosConfig';

/**
 * AboutAttachField – preview / edit / re-upload for About Me file attachments.
 * Props:
 *   fieldName     – backend presign field, e.g. 'briefAboutAttachment'
 *   attachment    – File object (freshly picked) or null
 *   attachmentUrl – stored server URL / key (existing upload)
 *   preview       – blob preview URL for a freshly-picked file
 *   attachmentName– file name to display
 *   onChange      – (File) => void
 *   onClear       – () => void
 */
const AboutAttachField = React.memo(({ fieldName, attachment, attachmentUrl, preview, attachmentName, onChange, onClear }) => {
    const inputRef = useRef(null);
    const [previewing, setPreviewing] = useState(false);

    const hasFile = Boolean(attachment || attachmentUrl);
    const displayName = attachmentName || (hasFile ? 'Attached file' : '');
    const openPicker = () => inputRef.current?.click();

    const handleChange = (e) => {
        const file = e.target.files?.[0];
        if (file) onChange(file);
        e.target.value = '';
    };

    const handlePreview = async () => {
        // Freshly-picked blob → open directly
        if (preview) {
            window.open(preview, '_blank', 'noopener,noreferrer');
            return;
        }
        // Stored file → ask backend for presigned URL
        if (!fieldName) return;
        setPreviewing(true);
        try {
            const { data } = await axiosInstance.get(
                `/api/v1/doctor/profile/about/presign?field=${encodeURIComponent(fieldName)}`
            );
            if (data?.data?.url) window.open(data.data.url, '_blank', 'noopener,noreferrer');
            else alert(data?.message || 'Could not load preview.');
        } catch (err) {
            alert(err?.response?.data?.message || 'Failed to fetch preview.');
        } finally {
            setPreviewing(false);
        }
    };

    return (
        <Box>
            <input ref={inputRef} type="file" hidden accept="image/*,.pdf,.doc,.docx" onChange={handleChange} />
            {!hasFile ? (
                <Button variant="outlined" startIcon={<AttachFileIcon />} size="medium"
                    sx={{ whiteSpace: 'nowrap' }} onClick={openPicker}>
                    Attach File
                </Button>
            ) : (
                <Box display="flex" flexDirection="column" gap={0.5}>
                    <Typography variant="caption" color="success.main" fontWeight={600}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        ✓ {displayName}
                    </Typography>
                    <Box display="flex" gap={1} flexWrap="wrap">
                        <Tooltip title="Preview the attached file">
                            <Button variant="outlined" size="small" startIcon={<VisibilityIcon />}
                                onClick={handlePreview} disabled={previewing}
                                color="info" sx={{ textTransform: 'none', fontSize: '0.78rem' }}>
                                {previewing ? 'Loading…' : 'Preview'}
                            </Button>
                        </Tooltip>
                        <Tooltip title="Choose a different file">
                            <Button variant="outlined" size="small" startIcon={<EditIcon />}
                                onClick={openPicker}
                                color="warning" sx={{ textTransform: 'none', fontSize: '0.78rem' }}>
                                Edit
                            </Button>
                        </Tooltip>
                        <Tooltip title="Remove attachment">
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

AboutAttachField.displayName = 'AboutAttachField';

export default AboutAttachField;
