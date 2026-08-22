/**
 * PatientPrescriptions — Patient views their prescriptions as PDFs.
 * No React component rendering — opens server-generated PDF directly.
 * PDFs are stored in public S3 with permanent (non-expiring) URLs.
 */
import { useState } from 'react';
import {
    Box, Typography, Paper, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, TablePagination, Chip,
    CircularProgress, IconButton, Tooltip, Button, Dialog,
    DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DownloadIcon from '@mui/icons-material/Download';
import CloseIcon from '@mui/icons-material/Close';
// Scoped hook: the caller's own prescriptions, or a MINOR's when a guardian
// has switched into that sub-profile (family scope). Self is unchanged.
import { useGetPatientPrescriptionsQuery } from '../../api/scopedBookingApi';

const PatientPrescriptions = () => {
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);
    const [pdfUrl, setPdfUrl] = useState(null);

    const { data, isLoading } = useGetPatientPrescriptionsQuery({
        status: 'active',
        page: page + 1,
        per_page: rowsPerPage,
    });

    const prescriptions = data?.prescriptions || [];
    const pagination = data?.pagination || {};

    const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric',
    }) : '-';

    const handleViewPdf = (p) => {
        if (p.pdf_link) {
            setPdfUrl(p.pdf_link);
        } else {
            alert('PDF not available yet. Please try again later.');
        }
    };

    const handleDownload = () => {
        if (pdfUrl) {
            const a = document.createElement('a');
            a.href = pdfUrl;
            a.target = '_blank';
            a.download = 'prescription.pdf';
            a.click();
        }
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" gap={1} mb={3}>
                <DescriptionIcon fontSize="large" color="primary" />
                <Typography variant="h4" fontWeight="bold">My Prescriptions</Typography>
            </Box>

            <TableContainer component={Paper}>
                {isLoading ? (
                    <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>
                ) : (
                    <>
                        <Table size="small">
                            <TableHead>
                                <TableRow sx={{ bgcolor: '#e8f5e9' }}>
                                    <TableCell><b>Doctor</b></TableCell>
                                    <TableCell><b>Diagnosis</b></TableCell>
                                    <TableCell><b>Medicines</b></TableCell>
                                    <TableCell><b>Date</b></TableCell>
                                    <TableCell align="right"><b>Action</b></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {prescriptions.map((p) => (
                                    <TableRow key={p.id} hover sx={{ cursor: 'pointer' }}
                                        onClick={() => handleViewPdf(p)}>
                                        <TableCell>
                                            <Typography fontWeight={600}>
                                                {p.doctor?.full_name ? `Dr. ${p.doctor.full_name}` : 'Doctor'}
                                            </Typography>
                                            {p.doctor?.specialization && (
                                                <Typography variant="caption" color="text.secondary">
                                                    {p.doctor.specialization}
                                                </Typography>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {p.diagnosis ? (p.diagnosis.length > 50 ? p.diagnosis.slice(0, 50) + '...' : p.diagnosis) : '-'}
                                        </TableCell>
                                        <TableCell>{p.medicines?.length || 0} items</TableCell>
                                        <TableCell>{formatDate(p.issue_date || p.created_at)}</TableCell>
                                        <TableCell align="right">
                                            {p.pdf_link ? (
                                                <Tooltip title="View PDF">
                                                    <IconButton size="small" color="error"
                                                        onClick={(e) => { e.stopPropagation(); handleViewPdf(p); }}>
                                                        <PictureAsPdfIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            ) : (
                                                <Chip label="Processing" size="small" color="warning" variant="outlined" />
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {!prescriptions.length && (
                                    <TableRow>
                                        <TableCell colSpan={5} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                            No prescriptions yet. Your doctor will send prescriptions here after admin approval.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                        <TablePagination
                            component="div" count={pagination.total || 0}
                            page={page} onPageChange={(_, p) => setPage(p)}
                            rowsPerPage={rowsPerPage}
                            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value)); setPage(0); }}
                        />
                    </>
                )}
            </TableContainer>

            {/* ── PDF Viewer Dialog ── */}
            <Dialog open={!!pdfUrl} onClose={() => setPdfUrl(null)} maxWidth="lg" fullWidth
                PaperProps={{ sx: { height: '90vh' } }}>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1 }}>
                    <Typography variant="h6" component="span" fontWeight="bold">Prescription</Typography>
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
                            title="Prescription PDF"
                            style={{ width: '100%', height: '100%', border: 'none' }}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </Box>
    );
};

export default PatientPrescriptions;
