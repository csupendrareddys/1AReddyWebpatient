/**
 * DocumentApprovalsPage — Admin reviews doctor-issued documents.
 *
 * The missing other half of the document flow: doctors could already push a
 * document to PENDING_APPROVAL from their preview screen, and the backend
 * approve/reject routes existed, but no admin screen ever consumed them —
 * so submitted documents sat in the queue with no way to clear them.
 *
 * Mirrors PrescriptionApprovalsPage (same Pending / Approved / Rejected /
 * All buckets) because it is the same workflow on a sibling entity.
 *
 * Review happens against the document's own content, NOT its PDF: the PDF is
 * only rendered when the doctor pushes to the patient, which is *after*
 * approval, so at review time ``pdf_link`` is always null. The Review dialog
 * is therefore the only way an admin can see what they are approving — the
 * description, the doctor's named fields, and every attached file.
 */
import { useState } from 'react';
import {
    Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, TablePagination, Button, Chip, CircularProgress,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField, Snackbar, Alert,
    IconButton, Tooltip, Tabs, Tab, Divider, Stack,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import VisibilityIcon from '@mui/icons-material/Visibility';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DescriptionIcon from '@mui/icons-material/Description';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { apiFileUrl } from '../../../../api/fileUrl';
import {
    useGetDocumentApprovalsQuery,
    useApproveDocumentMutation,
    useRejectDocumentMutation,
} from '../../api/documentConfigEndpoints';

// Tab index → backend status filter. Keep in sync with the ``status`` query
// param accepted by /admin/document-config/pending-approvals
// (pending|approved|rejected|all).
const TABS = [
    { key: 'pending',  label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'all',      label: 'All' },
];

const STATUS_CHIP = {
    pending_approval: { label: 'Pending', color: 'warning' },
    approved:         { label: 'Approved', color: 'success' },
    active:           { label: 'Active', color: 'success' },
    rejected:         { label: 'Rejected', color: 'error' },
    revised:          { label: 'Revised', color: 'info' },
    expired:          { label: 'Expired', color: 'default' },
    cancelled:        { label: 'Cancelled', color: 'default' },
    draft:            { label: 'Draft', color: 'default' },
};

const truncate = (s, n = 45) =>
    !s ? '-' : (s.length > n ? `${s.slice(0, n)}…` : s);

// Document-wide file plus every per-field file — what the admin needs to be
// able to open before approving.
const countAttachments = (d) => (
    (d.attachment_url ? 1 : 0)
    + (d.custom_fields || []).reduce((n, f) => n + (f.attachments?.length || 0), 0)
);

const DocumentApprovalsPage = () => {
    const [tabIdx, setTabIdx] = useState(0);
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);
    const [rejectDialog, setRejectDialog] = useState({ open: false, id: null });
    const [rejectReason, setRejectReason] = useState('');
    const [reviewDoc, setReviewDoc] = useState(null);
    const [snack, setSnack] = useState({ open: false, msg: '', sev: 'success' });

    const activeTab = TABS[tabIdx];
    const { data, isLoading } = useGetDocumentApprovalsQuery({
        page: page + 1,
        per_page: rowsPerPage,
        status: activeTab.key,
    });
    const [approveDocument] = useApproveDocumentMutation();
    const [rejectDocument] = useRejectDocumentMutation();

    const documents = data?.documents || [];
    const pagination = data?.pagination || {};

    const handleTabChange = (_, v) => {
        setTabIdx(v);
        setPage(0); // reset paginator when switching buckets
    };

    const handleApprove = async (id) => {
        try {
            await approveDocument(id).unwrap();
            setSnack({ open: true, msg: 'Document approved!', sev: 'success' });
        } catch (err) {
            setSnack({ open: true, msg: err?.data?.message || 'Failed', sev: 'error' });
        }
    };

    const handleReject = async () => {
        try {
            await rejectDocument({ id: rejectDialog.id, reason: rejectReason }).unwrap();
            setSnack({ open: true, msg: 'Document rejected', sev: 'info' });
            setRejectDialog({ open: false, id: null });
            setRejectReason('');
        } catch (err) {
            setSnack({ open: true, msg: err?.data?.message || 'Failed', sev: 'error' });
        }
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" gap={1} mb={2}>
                <DescriptionIcon fontSize="large" color="primary" />
                <Typography variant="h4" fontWeight="bold">Document Approvals</Typography>
                {pagination.total > 0 && (
                    <Chip
                        label={`${pagination.total} ${activeTab.label.toLowerCase()}`}
                        color={activeTab.key === 'pending' ? 'warning' : 'default'}
                        size="small"
                        sx={{ ml: 1 }}
                    />
                )}
            </Box>

            {/* Status tabs — actioned items don't disappear from the admin's
                view, they just move to a different bucket. */}
            <Tabs
                value={tabIdx}
                onChange={handleTabChange}
                sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
            >
                {TABS.map((t) => (
                    <Tab key={t.key} label={t.label} />
                ))}
            </Tabs>

            <TableContainer component={Paper}>
                {isLoading ? (
                    <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>
                ) : (
                    <>
                        <Table size="small">
                            <TableHead>
                                <TableRow sx={{ bgcolor: '#fff3e0' }}>
                                    <TableCell><b>Doctor</b></TableCell>
                                    <TableCell><b>Patient</b></TableCell>
                                    <TableCell><b>Document</b></TableCell>
                                    <TableCell><b>Description</b></TableCell>
                                    <TableCell><b>Rev</b></TableCell>
                                    <TableCell><b>Status</b></TableCell>
                                    <TableCell><b>Issued</b></TableCell>
                                    <TableCell align="right"><b>Actions</b></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {documents.map((d) => {
                                    const chip = STATUS_CHIP[d.status] || { label: d.status || '—', color: 'default' };
                                    // Approve / Reject only make sense while the row
                                    // is still PENDING_APPROVAL — the backend 400s
                                    // otherwise. Actioned rows stay viewable.
                                    const isPending = d.status === 'pending_approval';
                                    return (
                                        <TableRow key={d.id} hover>
                                            <TableCell>{d.doctor?.full_name || '-'}</TableCell>
                                            <TableCell>{d.patient?.full_name || '-'}</TableCell>
                                            <TableCell>{d.product_name || '-'}</TableCell>
                                            <TableCell>{truncate(d.description)}</TableCell>
                                            <TableCell>v{d.revision_number || 1}</TableCell>
                                            <TableCell>
                                                <Chip size="small" label={chip.label} color={chip.color} variant="outlined" />
                                                {d.rejection_reason && (
                                                    <Tooltip title={d.rejection_reason}>
                                                        <Typography
                                                            variant="caption"
                                                            color="error"
                                                            display="block"
                                                            sx={{ maxWidth: 180 }}
                                                            noWrap
                                                        >
                                                            {d.rejection_reason}
                                                        </Typography>
                                                    </Tooltip>
                                                )}
                                            </TableCell>
                                            <TableCell>{d.issue_date || d.created_at?.split('T')[0] || '-'}</TableCell>
                                            <TableCell align="right">
                                                {/* The content review — the PDF does not exist until the
                                                    doctor pushes, which is after approval, so this is the
                                                    only way to see what is being approved. */}
                                                <Tooltip title="Review content">
                                                    <IconButton
                                                        size="small" color="primary"
                                                        onClick={() => setReviewDoc(d)}
                                                    >
                                                        <VisibilityIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                                {/* Passive indicator, not a second button — Review is the
                                                    only way in, and two icons doing the same thing reads
                                                    like they do different things. */}
                                                {countAttachments(d) > 0 && (
                                                    <Chip
                                                        size="small" variant="outlined"
                                                        icon={<AttachFileIcon />}
                                                        label={countAttachments(d)}
                                                        sx={{ mx: 0.5, verticalAlign: 'middle' }}
                                                    />
                                                )}
                                                {d.pdf_link && (
                                                    <Tooltip title="View generated PDF">
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => window.open(apiFileUrl(d.pdf_link), '_blank', 'noopener')}
                                                        >
                                                            <DescriptionIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                )}
                                                {isPending && (
                                                    <>
                                                        <Tooltip title="Approve">
                                                            <IconButton size="small" color="success" onClick={() => handleApprove(d.id)}>
                                                                <CheckCircleIcon fontSize="small" />
                                                            </IconButton>
                                                        </Tooltip>
                                                        <Tooltip title="Reject">
                                                            <IconButton size="small" color="error"
                                                                onClick={() => setRejectDialog({ open: true, id: d.id })}>
                                                                <CancelIcon fontSize="small" />
                                                            </IconButton>
                                                        </Tooltip>
                                                    </>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                                {!documents.length && (
                                    <TableRow>
                                        <TableCell colSpan={8} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                                            No documents in this bucket.
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

            {/* Reject Dialog — the reason is appended to the document's notes
                so the doctor can see why when they revise it. */}
            {/* Content review — description, the doctor's named fields, and
                every attached file as a working download link. */}
            <Dialog open={!!reviewDoc} onClose={() => setReviewDoc(null)} maxWidth="md" fullWidth>
                <DialogTitle sx={{ pb: 1 }}>
                    <Typography variant="h6" component="div" fontWeight="bold">
                        {reviewDoc?.product_name || 'Document'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {reviewDoc?.doctor?.full_name ? `Dr. ${reviewDoc.doctor.full_name}` : '-'}
                        {' → '}{reviewDoc?.patient?.full_name || '-'}
                        {' · v'}{reviewDoc?.revision_number || 1}
                    </Typography>
                </DialogTitle>
                <DialogContent dividers>
                    {reviewDoc?.description && (
                        <Box sx={{ mb: 2.5 }}>
                            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>Description</Typography>
                            <Typography variant="body2" whiteSpace="pre-line">{reviewDoc.description}</Typography>
                        </Box>
                    )}

                    {(reviewDoc?.custom_fields || []).map((f, i) => (
                        <Box key={f.id || `${f.label}-${i}`} sx={{ mb: 2.5 }}>
                            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>{f.label}</Typography>
                            {f.value && (
                                <Typography variant="body2" whiteSpace="pre-line">{f.value}</Typography>
                            )}
                            {(f.attachments || []).length > 0 && (
                                <Stack spacing={0.5} sx={{ mt: 1 }}>
                                    {f.attachments.map((a) => (
                                        <Box key={a.id} display="flex" alignItems="center" gap={1}>
                                            <InsertDriveFileIcon fontSize="small" color="action" />
                                            <Typography variant="body2">
                                                <a href={apiFileUrl(a.url)} target="_blank" rel="noopener noreferrer">
                                                    {a.name || 'Attachment'}
                                                </a>
                                            </Typography>
                                        </Box>
                                    ))}
                                </Stack>
                            )}
                        </Box>
                    ))}

                    {reviewDoc?.attachment_url && (
                        <>
                            <Divider sx={{ my: 2 }} />
                            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>Attachment</Typography>
                            <Box display="flex" alignItems="center" gap={1}>
                                <InsertDriveFileIcon fontSize="small" color="action" />
                                <Typography variant="body2">
                                    <a href={apiFileUrl(reviewDoc.attachment_url)} target="_blank" rel="noopener noreferrer">
                                        {reviewDoc.attachment_name || 'Attachment'}
                                    </a>
                                </Typography>
                            </Box>
                        </>
                    )}

                    {!reviewDoc?.description
                        && !(reviewDoc?.custom_fields || []).length
                        && !reviewDoc?.attachment_url && (
                        <Typography variant="body2" color="text.secondary" fontStyle="italic">
                            {reviewDoc?.pdf_link
                                ? 'Uploaded as a PDF — open it from the row.'
                                : 'This document has no content.'}
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setReviewDoc(null)}>Close</Button>
                    {reviewDoc?.status === 'pending_approval' && (
                        <>
                            <Button
                                color="error"
                                onClick={() => {
                                    setRejectDialog({ open: true, id: reviewDoc.id });
                                    setReviewDoc(null);
                                }}
                            >
                                Reject
                            </Button>
                            <Button
                                variant="contained" color="success"
                                onClick={() => { handleApprove(reviewDoc.id); setReviewDoc(null); }}
                            >
                                Approve
                            </Button>
                        </>
                    )}
                </DialogActions>
            </Dialog>

            <Dialog open={rejectDialog.open} onClose={() => setRejectDialog({ open: false, id: null })} maxWidth="sm" fullWidth>
                <DialogTitle>Reject Document</DialogTitle>
                <DialogContent>
                    <TextField autoFocus fullWidth multiline rows={3} sx={{ mt: 1 }}
                        label="Reason for rejection"
                        value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Please provide a reason..." />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRejectDialog({ open: false, id: null })}>Cancel</Button>
                    <Button variant="contained" color="error" onClick={handleReject}>Reject</Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({ ...snack, open: false })}>
                <Alert severity={snack.sev}>{snack.msg}</Alert>
            </Snackbar>
        </Box>
    );
};

export default DocumentApprovalsPage;
