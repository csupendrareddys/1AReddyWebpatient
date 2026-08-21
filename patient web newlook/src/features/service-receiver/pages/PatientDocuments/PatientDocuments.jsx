/**
 * PatientDocuments — the patient's view of documents a doctor has sent them.
 *
 * Sibling of "My Prescriptions", but a document is NOT just a PDF: it carries
 * a description, doctor-named fields, and files attached to those fields.
 * Those files are the whole point of some documents (lab reports, scans), and
 * the PDF can only print their names — presigned URLs expire, so a link baked
 * into a stored PDF would be dead by the time the patient clicked it.
 *
 * So the row opens a content dialog with live download links, and the PDF is
 * one option inside it rather than the only way in.
 */
import { useState } from 'react';
import {
    Box, Typography, Paper, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, TablePagination, Chip,
    CircularProgress, IconButton, Tooltip, Button, Dialog,
    DialogTitle, DialogContent, Divider, Stack,
} from '@mui/material';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DownloadIcon from '@mui/icons-material/Download';
import CloseIcon from '@mui/icons-material/Close';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
// Scoped hook: the caller's own documents, or a MINOR's when a guardian has
// switched into that sub-profile (family scope). Self is unchanged.
import { useGetPatientDocumentsQuery } from '../../api/scopedBookingApi';
import { apiFileUrl } from '../../../../api/fileUrl';

// Every downloadable file on a document: the document-wide one plus each
// field's list. Used for the row's paperclip count.
const countAttachments = (doc) => (
    (doc.attachment_url ? 1 : 0)
    + (doc.custom_fields || []).reduce((n, f) => n + (f.attachments?.length || 0), 0)
);

const PatientDocuments = () => {
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);
    const [pdfUrl, setPdfUrl] = useState(null);
    const [openDoc, setOpenDoc] = useState(null);

    const { data, isLoading } = useGetPatientDocumentsQuery({
        status: 'active',
        page: page + 1,
        per_page: rowsPerPage,
    });

    const documents = data?.documents || [];
    const pagination = data?.pagination || {};

    const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric',
    }) : '-');

    const handleViewPdf = (doc) => {
        if (doc.pdf_link) setPdfUrl(apiFileUrl(doc.pdf_link));
        else alert('PDF not available yet. Please try again later.');
    };

    const handleDownload = () => {
        if (!pdfUrl) return;
        const a = document.createElement('a');
        a.href = pdfUrl;
        a.target = '_blank';
        a.download = 'document.pdf';
        a.click();
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" gap={1} mb={3}>
                <ArticleOutlinedIcon fontSize="large" color="primary" />
                <Typography variant="h4" fontWeight="bold">My Documents</Typography>
            </Box>

            <TableContainer component={Paper}>
                {isLoading ? (
                    <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>
                ) : (
                    <>
                        <Table size="small">
                            <TableHead>
                                <TableRow sx={{ bgcolor: '#e3f2fd' }}>
                                    <TableCell><b>Doctor</b></TableCell>
                                    <TableCell><b>Service</b></TableCell>
                                    <TableCell><b>Date</b></TableCell>
                                    <TableCell><b>Files</b></TableCell>
                                    <TableCell align="right"><b>Action</b></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {documents.map((doc) => (
                                    <TableRow key={doc.id} hover sx={{ cursor: 'pointer' }}
                                        onClick={() => setOpenDoc(doc)}>
                                        <TableCell>
                                            <Typography fontWeight={600}>
                                                {doc.doctor?.full_name ? `Dr. ${doc.doctor.full_name}` : 'Doctor'}
                                            </Typography>
                                            {doc.doctor?.specialization && (
                                                <Typography variant="caption" color="text.secondary">
                                                    {doc.doctor.specialization}
                                                </Typography>
                                            )}
                                        </TableCell>
                                        <TableCell>{doc.product_name || '-'}</TableCell>
                                        <TableCell>{formatDate(doc.issue_date || doc.created_at)}</TableCell>
                                        <TableCell>
                                            {countAttachments(doc) > 0 ? (
                                                <Chip
                                                    size="small" variant="outlined"
                                                    icon={<AttachFileIcon />}
                                                    label={countAttachments(doc)}
                                                />
                                            ) : '-'}
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="Open document">
                                                <IconButton size="small" color="primary"
                                                    onClick={(e) => { e.stopPropagation(); setOpenDoc(doc); }}>
                                                    <ArticleOutlinedIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            {doc.pdf_link ? (
                                                <Tooltip title="View PDF">
                                                    <IconButton size="small" color="error"
                                                        onClick={(e) => { e.stopPropagation(); handleViewPdf(doc); }}>
                                                        <PictureAsPdfIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            ) : (
                                                <Chip label="Processing" size="small" color="warning" variant="outlined" />
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {!documents.length && (
                                    <TableRow>
                                        <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                            No documents yet. Documents your doctor shares will appear here.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                        <TablePagination
                            component="div" count={pagination.total || 0}
                            page={page} onPageChange={(_, p) => setPage(p)}
                            rowsPerPage={rowsPerPage}
                            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                        />
                    </>
                )}
            </TableContainer>

            {/* Document content — description, the doctor's own fields, and
                every attached file as a live download. */}
            <Dialog open={!!openDoc} onClose={() => setOpenDoc(null)} maxWidth="md" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1 }}>
                    <Box>
                        <Typography variant="h6" component="span" fontWeight="bold">
                            {openDoc?.product_name || 'Document'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {openDoc?.doctor?.full_name ? `Dr. ${openDoc.doctor.full_name}` : ''}
                            {' · '}{formatDate(openDoc?.issue_date || openDoc?.created_at)}
                        </Typography>
                    </Box>
                    <Box>
                        {openDoc?.pdf_link && (
                            <Button
                                startIcon={<PictureAsPdfIcon />} size="small" variant="outlined"
                                sx={{ mr: 1 }}
                                onClick={() => { const d = openDoc; setOpenDoc(null); handleViewPdf(d); }}
                            >
                                PDF
                            </Button>
                        )}
                        <IconButton onClick={() => setOpenDoc(null)}><CloseIcon /></IconButton>
                    </Box>
                </DialogTitle>
                <DialogContent dividers>
                    {openDoc?.description && (
                        <Box sx={{ mb: 2.5 }}>
                            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                                Description
                            </Typography>
                            <Typography variant="body2" whiteSpace="pre-line">
                                {openDoc.description}
                            </Typography>
                        </Box>
                    )}

                    {(openDoc?.custom_fields || []).map((f, i) => (
                        <Box key={f.id || `${f.label}-${i}`} sx={{ mb: 2.5 }}>
                            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                                {f.label}
                            </Typography>
                            {f.value && (
                                <Typography variant="body2" whiteSpace="pre-line">{f.value}</Typography>
                            )}
                            {(f.attachments || []).length > 0 && (
                                <Stack spacing={0.5} sx={{ mt: 1 }}>
                                    {f.attachments.map((a) => (
                                        <Box key={a.id} display="flex" alignItems="center" gap={1}>
                                            <InsertDriveFileIcon fontSize="small" color="action" />
                                            <Typography variant="body2">
                                                <a href={apiFileUrl(a.url)} target="_blank" rel="noopener noreferrer" download>
                                                    {a.name || 'Attachment'}
                                                </a>
                                            </Typography>
                                        </Box>
                                    ))}
                                </Stack>
                            )}
                        </Box>
                    ))}

                    {openDoc?.attachment_url && (
                        <>
                            <Divider sx={{ my: 2 }} />
                            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                                Attachment
                            </Typography>
                            <Box display="flex" alignItems="center" gap={1}>
                                <InsertDriveFileIcon fontSize="small" color="action" />
                                <Typography variant="body2">
                                    <a href={apiFileUrl(openDoc.attachment_url)} target="_blank" rel="noopener noreferrer" download>
                                        {openDoc.attachment_name || 'Attachment'}
                                    </a>
                                </Typography>
                            </Box>
                        </>
                    )}

                    {!openDoc?.description
                        && !(openDoc?.custom_fields || []).length
                        && !openDoc?.attachment_url && (
                        <Typography variant="body2" color="text.secondary" fontStyle="italic">
                            {openDoc?.pdf_link
                                ? 'This document is provided as a PDF — open it above.'
                                : 'This document has no content yet.'}
                        </Typography>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={!!pdfUrl} onClose={() => setPdfUrl(null)} maxWidth="lg" fullWidth
                PaperProps={{ sx: { height: '90vh' } }}>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1 }}>
                    <Typography variant="h6" component="span" fontWeight="bold">Document</Typography>
                    <Box>
                        <Button startIcon={<DownloadIcon />} onClick={handleDownload}
                            variant="contained" size="small" sx={{ mr: 1 }}>
                            Download
                        </Button>
                        <IconButton onClick={() => setPdfUrl(null)}><CloseIcon /></IconButton>
                    </Box>
                </DialogTitle>
                <DialogContent sx={{ p: 0, overflow: 'hidden' }}>
                    {pdfUrl && (
                        <iframe
                            src={`${pdfUrl}#toolbar=0&navpanes=0`}
                            title="Document PDF"
                            style={{ width: '100%', height: '100%', border: 'none' }}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </Box>
    );
};

export default PatientDocuments;
