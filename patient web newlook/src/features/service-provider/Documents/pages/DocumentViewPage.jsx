/**
 * DocumentViewPage — Read-only view of a completed document.
 *
 * Plain-text counterpart to DocumentPreviewPage (which renders the
 * letterhead version). Content is Description + doctor-authored custom
 * fields + the optional attachment; documents have no fixed clinical
 * sections and no medicines.
 */
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box, Typography, Paper, Stack, Chip, IconButton, CircularProgress,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { useGetDoctorDocumentQuery } from '../../api/scopedDoctorApi';
import { apiFileUrl } from '../../../../api/fileUrl';
import { useDoctorScope } from '../../ProfileSetting/context/DoctorScopeContext';

const DocumentViewPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    // Operations mounts this page under its own /records tab, so every
    // link back into the hub is built from the scope, not hard-coded.
    const { recordsPath } = useDoctorScope();
    const { data: p, isLoading, isError } = useGetDoctorDocumentQuery(id);

    if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
    if (isError || !p) return <Box p={4}><Typography color="error">Document not found.</Typography></Box>;

    const Section = ({ title, content }) => content ? (
        <Paper sx={{ p: 3 }}>
            <Typography variant="h6" fontWeight="bold" gutterBottom>{title}</Typography>
            <Typography variant="body1" whiteSpace="pre-line">{content}</Typography>
        </Paper>
    ) : null;

    const customFields = p.custom_fields || [];
    const isEmpty = !p.description && !customFields.length && !p.attachment_url;

    return (
        <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
            <Box display="flex" alignItems="center" gap={1} mb={3}>
                <IconButton onClick={() => navigate(`${recordsPath}/documents`)}>
                    <ArrowBackIcon />
                </IconButton>
                <LocalHospitalIcon color="primary" />
                <Typography variant="h5" fontWeight="bold">Document</Typography>
                <Chip label={p.status === 'active' ? 'Completed' : p.status} color={p.status === 'active' ? 'success' : 'default'} size="small" sx={{ ml: 1 }} />
            </Box>

            {/* Patient info */}
            {p.patient && (
                <Paper sx={{ p: 2, mb: 3, bgcolor: 'primary.50' }}>
                    <Typography variant="subtitle1" fontWeight="bold">{p.patient.full_name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                        {p.patient.gender} | DOB: {p.patient.dob || '-'} | Date: {p.issue_date}
                    </Typography>
                    {(p.patient.height || p.patient.weight) && (
                        <Typography variant="body2" color="text.secondary">
                            {[
                                p.patient.height && `Height: ${p.patient.height} cm`,
                                p.patient.weight && `Weight: ${p.patient.weight} kg`,
                            ].filter(Boolean).join('  |  ')}
                        </Typography>
                    )}
                </Paper>
            )}

            <Stack spacing={2}>
                <Section title="Description" content={p.description} />

                {customFields.map((f, i) => (
                    <Paper key={f.id || `${f.label}-${i}`} sx={{ p: 3 }}>
                        <Typography variant="h6" fontWeight="bold" gutterBottom>{f.label}</Typography>
                        <Typography variant="body1" whiteSpace="pre-line">{f.value || '-'}</Typography>
                        {(f.attachments || []).length > 0 && (
                            <Stack spacing={0.5} sx={{ mt: 1.5 }}>
                                {f.attachments.map((a) => (
                                    <Box key={a.id} display="flex" alignItems="center" gap={1}>
                                        <AttachFileIcon fontSize="small" color="action" />
                                        <a href={apiFileUrl(a.url)} target="_blank" rel="noopener noreferrer">
                                            {a.name || 'Attachment'}
                                        </a>
                                    </Box>
                                ))}
                            </Stack>
                        )}
                    </Paper>
                ))}

                {p.attachment_url && (
                    <Paper sx={{ p: 3 }}>
                        <Typography variant="h6" fontWeight="bold" gutterBottom>Attachment</Typography>
                        <Box display="flex" alignItems="center" gap={1}>
                            <AttachFileIcon fontSize="small" color="action" />
                            <a href={apiFileUrl(p.attachment_url)} target="_blank" rel="noopener noreferrer">
                                {p.attachment_name || 'View attachment'}
                            </a>
                        </Box>
                    </Paper>
                )}

                {isEmpty && (
                    <Typography variant="body2" color="text.secondary" fontStyle="italic">
                        This document has no content.
                    </Typography>
                )}
            </Stack>
        </Box>
    );
};

export default DocumentViewPage;
