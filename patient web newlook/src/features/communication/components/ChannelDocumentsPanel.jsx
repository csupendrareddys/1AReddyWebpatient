/**
 * ChannelDocumentsPanel — upload + list + download files in a channel.
 *
 * Both sides can upload (PDF/image, <= the service's max_attachment_mb).
 * Explicitly NOT prescriptions — those keep their own flow and never appear
 * as uploads here. Uploads are disabled once the service ends; existing files
 * stay downloadable until retention deletes them.
 */
import { useRef, useState } from 'react';
import {
    Alert, Box, Button, Collapse, IconButton, Link, Stack, Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

import {
    useGetChannelDocumentsQuery,
    useGetChannelDocumentUrlMutation,
    useUploadChannelDocumentMutation,
} from '../api/scopedChannelApi';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';

function fmtSize(bytes) {
    if (!bytes) return '';
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
}

export default function ChannelDocumentsPanel({ channel }) {
    const channelId = channel?.id;
    const ps = channel?.purchased_service || {};
    // A holding channel has no purchase — document sharing is always on, both
    // sides can upload.
    const canUpload = channel?.status === 'active'
        && (channel?.is_holding || (ps.status === 'active' && ps.documents_enabled));
    const maxMb = ps.max_attachment_mb || 5;

    const { data: docs = [] } = useGetChannelDocumentsQuery(channelId, { skip: !channelId });
    const [upload, { isLoading: uploading }] = useUploadChannelDocumentMutation();
    const [getUrl] = useGetChannelDocumentUrlMutation();

    const [open, setOpen] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef(null);

    // Documents are only part of some services — hide the panel entirely when
    // this one doesn't include them and nothing was ever uploaded.
    if (!channel?.is_holding && !ps.documents_enabled && docs.length === 0) return null;

    const onPick = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setError('');
        if (file.size > maxMb * 1024 * 1024) {
            setError(`File is too large (max ${maxMb} MB).`);
            return;
        }
        try {
            await upload({ channelId, file }).unwrap();
        } catch (err) {
            setError(err?.data?.error || err?.data?.message || 'Upload failed.');
        }
    };

    const onDownload = async (doc) => {
        setError('');
        try {
            const { url } = await getUrl({ channelId, docId: doc.id }).unwrap();
            if (url) window.open(url, '_blank', 'noopener');
        } catch (err) {
            setError(err?.data?.error || err?.data?.message || 'Could not open the file.');
        }
    };

    return (
        <Box sx={{ borderBottom: '1px solid', borderColor: 'grey.200', bgcolor: '#fff' }}>
            <Stack
                direction="row" alignItems="center" justifyContent="space-between"
                sx={{ px: 2, py: 1, cursor: 'pointer' }}
                onClick={() => setOpen((v) => !v)}
            >
                <Stack direction="row" spacing={1} alignItems="center">
                    <InsertDriveFileOutlinedIcon fontSize="small" color="action" />
                    <Typography variant="subtitle2" fontWeight={700}>
                        Documents{docs.length ? ` (${docs.length})` : ''}
                    </Typography>
                </Stack>
                <IconButton size="small">{open ? <ExpandLessIcon /> : <ExpandMoreIcon />}</IconButton>
            </Stack>

            <Collapse in={open} unmountOnExit>
                <Box sx={{ px: 2, pb: 2 }}>
                    {error && (
                        <Alert severity="warning" onClose={() => setError('')} sx={{ mb: 1 }}>
                            {error}
                        </Alert>
                    )}
                    {docs.length === 0 && (
                        <Typography variant="caption" color="text.secondary">No files yet.</Typography>
                    )}
                    <Stack spacing={0.5}>
                        {docs.map((d) => (
                            <Stack
                                key={d.id} direction="row" alignItems="center" spacing={1}
                                sx={{ p: 0.75, borderRadius: 1, '&:hover': { bgcolor: 'grey.50' } }}
                            >
                                <InsertDriveFileOutlinedIcon fontSize="small" color="action" />
                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                    <Link
                                        component="button" variant="body2" underline="hover"
                                        onClick={() => onDownload(d)} sx={{ textAlign: 'left' }}
                                    >
                                        {d.filename}
                                    </Link>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                        {fmtSize(d.file_size_bytes)}
                                    </Typography>
                                </Box>
                            </Stack>
                        ))}
                    </Stack>

                    {canUpload && (
                        <>
                            <input
                                ref={inputRef} type="file" accept={ACCEPT}
                                style={{ display: 'none' }} onChange={onPick}
                            />
                            <Button
                                size="small" startIcon={<UploadFileIcon />} sx={{ mt: 1 }}
                                disabled={uploading}
                                onClick={() => inputRef.current?.click()}
                            >
                                {uploading ? 'Uploading…' : `Upload (PDF / image, ≤ ${maxMb} MB)`}
                            </Button>
                        </>
                    )}
                </Box>
            </Collapse>
        </Box>
    );
}
