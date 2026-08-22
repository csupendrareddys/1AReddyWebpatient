/**
 * AppointmentDocumentsPanel — attach + view documents during a consultation.
 *
 * Sidebar tab for the appointment call. The patient can attach a file (image /
 * PDF) which is uploaded to the appointment (AppointmentDocument); both sides
 * see the list. Mirrors the service side's ChannelDocumentsPanel, but keyed on
 * the appointment instead of a service channel.
 */
import { useRef, useState } from 'react';
import {
    Box, Button, Stack, Typography, Alert, Link, CircularProgress,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';

import {
    useGetAppointmentDocumentsQuery,
    useUploadAppointmentDocumentMutation,
} from '../../../service-receiver/api/patientEndpoints';

const ACCEPT = 'application/pdf,image/*';
const MAX_MB = 10;

export default function AppointmentDocumentsPanel({ appointmentId, canUpload = true }) {
    const { data: docs = [], isLoading } = useGetAppointmentDocumentsQuery(appointmentId, {
        skip: !appointmentId,
    });
    const [upload, { isLoading: uploading }] = useUploadAppointmentDocumentMutation();
    const inputRef = useRef(null);
    const [error, setError] = useState('');

    const onPick = async (e) => {
        const file = e.target.files?.[0];
        if (inputRef.current) inputRef.current.value = '';
        if (!file) return;
        if (file.size > MAX_MB * 1024 * 1024) {
            setError(`File is too large (max ${MAX_MB} MB).`);
            return;
        }
        setError('');
        try {
            await upload({ appointmentId, file }).unwrap();
        } catch (err) {
            setError(err?.data?.error || err?.data?.message || 'Upload failed. Try again.');
        }
    };

    return (
        <Stack sx={{ height: '100%', minHeight: 0 }}>
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" fontWeight={700}>
                    Documents{docs.length ? ` (${docs.length})` : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    Attach reports or files to this consultation
                </Typography>
            </Box>

            <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1.5 }}>
                {error && (
                    <Alert severity="warning" onClose={() => setError('')} sx={{ mb: 1 }}>
                        {error}
                    </Alert>
                )}
                {isLoading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                        <CircularProgress size={22} />
                    </Box>
                )}
                {!isLoading && docs.length === 0 && (
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
                                {d.attachment_link ? (
                                    <Link
                                        href={d.attachment_link} target="_blank" rel="noopener"
                                        variant="body2" underline="hover"
                                    >
                                        {d.document_name}
                                    </Link>
                                ) : (
                                    <Typography variant="body2" noWrap>{d.document_name}</Typography>
                                )}
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    {d.uploaded_by === 'doctor' ? 'From the doctor' : 'You uploaded'}
                                </Typography>
                            </Box>
                        </Stack>
                    ))}
                </Stack>
            </Box>

            {canUpload && (
                <Box sx={{ p: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                    <input
                        ref={inputRef} type="file" accept={ACCEPT}
                        style={{ display: 'none' }} onChange={onPick}
                    />
                    <Button
                        fullWidth size="small" variant="outlined" startIcon={<UploadFileIcon />}
                        disabled={uploading}
                        onClick={() => inputRef.current?.click()}
                    >
                        {uploading ? 'Uploading…' : `Attach a document (PDF / image, ≤ ${MAX_MB} MB)`}
                    </Button>
                </Box>
            )}
        </Stack>
    );
}
