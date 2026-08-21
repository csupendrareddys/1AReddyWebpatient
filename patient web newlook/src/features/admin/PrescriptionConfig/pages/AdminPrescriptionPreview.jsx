/**
 * AdminPrescriptionPreview — Admin views a prescription before approving/rejecting.
 * Reuses the same green-themed PDF layout as the doctor preview.
 */
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box, Typography, Paper, Divider, CircularProgress,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Chip, IconButton, Stack, Button,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import { useState } from 'react';
import {
    useGetAdminPrescriptionQuery,
    useGetPrescriptionTemplateQuery,
    useApprovePrescriptionMutation,
    useRejectPrescriptionMutation,
} from '../../api/prescriptionConfigEndpoints';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, TextField, Snackbar, Alert,
} from '@mui/material';

const AdminPrescriptionPreview = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { data: p, isLoading } = useGetAdminPrescriptionQuery(id);
    const { data: tpl = {} } = useGetPrescriptionTemplateQuery();
    const [approvePrescription, { isLoading: approving }] = useApprovePrescriptionMutation();
    const [rejectPrescription] = useRejectPrescriptionMutation();
    const [rejectDialog, setRejectDialog] = useState(false);
    const [rejectReason, setRejectReason] = useState('');
    const [snack, setSnack] = useState({ open: false, msg: '', sev: 'success' });

    if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
    if (!p) return <Box p={4}><Typography color="error">Prescription not found.</Typography></Box>;

    const handleApprove = async () => {
        try {
            await approvePrescription(id).unwrap();
            setSnack({ open: true, msg: 'Prescription approved!', sev: 'success' });
            setTimeout(() => navigate('/dashboard/admin/prescription-approvals'), 1000);
        } catch (err) {
            setSnack({ open: true, msg: err?.data?.message || 'Failed', sev: 'error' });
        }
    };

    const handleReject = async () => {
        try {
            await rejectPrescription({ id, reason: rejectReason }).unwrap();
            setSnack({ open: true, msg: 'Prescription rejected', sev: 'info' });
            setRejectDialog(false);
            setRejectReason('');
            setTimeout(() => navigate('/dashboard/admin/prescription-approvals'), 1000);
        } catch (err) {
            setSnack({ open: true, msg: err?.data?.message || 'Failed', sev: 'error' });
        }
    };

    const calcAge = (dob) => {
        if (!dob) return '';
        const diff = Date.now() - new Date(dob).getTime();
        return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
    };

    const patientAge = p.patient?.dob ? `${calcAge(p.patient.dob)} Year` : '';
    const patientGender = p.patient?.gender || '';

    const sections = [...(tpl.sections_config || [
        { key: 'notes', label: 'Notes *', visible: true, order: 1 },
        { key: 'allergies', label: 'Allergies *', visible: true, order: 2 },
        { key: 'diagnosis', label: 'Provisional Diagnosis *', visible: true, order: 3 },
        { key: 'diagnostic_tests', label: 'Diagnostic Tests', visible: true, order: 4 },
        { key: 'instructions', label: 'Instructions', visible: true, order: 5 },
        { key: 'medicines', label: 'Medicines', visible: true, order: 6 },
        { key: 'doctors_advice', label: "Doctor's Advice", visible: true, order: 7 },
        { key: 'follow_up', label: 'Follow-up', visible: true, order: 8 },
    ])].sort((a, b) => a.order - b.order);

    const sectionContentMap = {
        notes: p.notes,
        allergies: p.allergies,
        diagnosis: p.diagnosis,
        diagnostic_tests: p.diagnostic_tests,
        instructions: p.instructions,
        doctors_advice: p.doctors_advice,
        follow_up: p.follow_up,
    };

    const prescriptionDisplayId = p.id ? p.id.substring(0, 8).toUpperCase() : '';

    return (
        <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
            {/* Back + title */}
            <Box display="flex" alignItems="center" gap={1} mb={2}>
                <IconButton onClick={() => navigate('/dashboard/admin/prescription-approvals')}>
                    <ArrowBackIcon />
                </IconButton>
                <Typography variant="h5" fontWeight="bold">Review Prescription</Typography>
                <Chip
                    label={p.status === 'pending_approval' ? 'Pending Approval' : p.status}
                    color={p.status === 'pending_approval' ? 'warning' : 'default'}
                    size="small" sx={{ ml: 1 }}
                />
            </Box>

            {/* PDF Preview */}
            <Paper sx={{ p: 0, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
                {/* Header */}
                <Box sx={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    p: 2, bgcolor: '#e8f5e9', borderBottom: '2px solid #a5d6a7',
                }}>
                    <Box display="flex" alignItems="center" gap={2}>
                        {tpl.clinic_logo_url && (
                            <Box component="img" src={tpl.clinic_logo_url} alt="Logo"
                                sx={{ width: 64, height: 64, objectFit: 'contain', borderRadius: 1 }} />
                        )}
                        {tpl.clinic_name && (
                            <Typography variant="h6" fontWeight="bold" color="success.dark">
                                {tpl.clinic_name}
                            </Typography>
                        )}
                    </Box>
                    <Box textAlign="right">
                        {p.doctor && <Typography fontWeight="bold">Dr. {p.doctor.full_name}</Typography>}
                        {p.doctor?.qualification && (
                            <Typography variant="body2" color="text.secondary">{p.doctor.qualification}</Typography>
                        )}
                        {p.doctor?.specialization && (
                            <Typography variant="body2" color="text.secondary">{p.doctor.specialization}</Typography>
                        )}
                        {p.doctor?.registration_number && (
                            <Typography variant="body2" color="text.secondary">
                                Reg No: {p.doctor.registration_number}
                            </Typography>
                        )}
                    </Box>
                </Box>

                {/* Patient Info */}
                <Box sx={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    p: 2, mx: 2, mt: 2, bgcolor: '#f1f8e9', borderRadius: 2, border: '1px solid #c5e1a5',
                }}>
                    <Box>
                        <Typography fontWeight="bold">{p.patient?.full_name || 'Patient'}</Typography>
                        <Typography variant="body2" color="text.secondary">
                            {[patientAge, patientGender].filter(Boolean).join(', ')}
                        </Typography>
                    </Box>
                    <Box textAlign="right">
                        <Typography variant="body2">
                            {p.issue_date ? new Date(p.issue_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Prescription ID: {prescriptionDisplayId}
                        </Typography>
                    </Box>
                </Box>

                {/* Body Sections */}
                <Box sx={{ p: 2 }}>
                    {sections.map((sec) => {
                        if (!sec.visible) return null;

                        if (sec.key === 'medicines') {
                            // Drop content-empty rows (legacy data from
                            // before the backend save-time skip went in).
                            const realMedicines = (p.medicines || []).filter((m) => (
                                m.medicine_id
                                || (m.custom_generic_name && m.custom_generic_name.trim())
                                || (m.custom_brand_name && m.custom_brand_name.trim())
                                || (m.dosage && String(m.dosage).trim())
                                || (m.frequency && String(m.frequency).trim())
                                || (m.duration && String(m.duration).trim())
                                || (m.morning && String(m.morning).trim())
                                || (m.afternoon && String(m.afternoon).trim())
                                || (m.evening && String(m.evening).trim())
                                || (m.night && String(m.night).trim())
                                || (m.special_instructions && String(m.special_instructions).trim())
                            ));
                            if (!realMedicines.length) return null;
                            return (
                                <Box key="medicines" sx={{ mb: 2 }}>
                                    <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>{sec.label}</Typography>
                                    <TableContainer>
                                        <Table size="small" sx={{ border: '1px solid #ddd' }}>
                                            <TableHead>
                                                <TableRow sx={{ bgcolor: '#e8f5e9' }}>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>S.No</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>Medicine</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>Type</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>M</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>A</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>E</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>N</TableCell>
                                                    <TableCell sx={{ fontWeight: 'bold' }}>Duration</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {realMedicines.map((m, i) => {
                                                    const unit = m.medicine_type === 'liquid' ? ' ml'
                                                        : m.medicine_type === 'powder' ? ' g'
                                                        : m.medicine_type === 'other' ? ` ${m.custom_dose_unit || ''}` : '';
                                                    const fmtSlot = (val, timing, instr) => {
                                                        if (!val) return '-';
                                                        let s = `${val}${unit}`;
                                                        if (timing) s += `\n${timing}`;
                                                        if (instr) s += `\n(${instr})`;
                                                        return s;
                                                    };
                                                    return (
                                                        <TableRow key={m.id || i}>
                                                            <TableCell>{m.serial_no || i + 1}</TableCell>
                                                            <TableCell>
                                                                <Typography variant="body2" fontWeight="bold">
                                                                    {m.generic_name || m.brand_name || '-'}
                                                                </Typography>
                                                                {m.brand_name && m.generic_name && m.brand_name !== m.generic_name && (
                                                                    <Typography variant="caption" color="text.secondary">({m.brand_name})</Typography>
                                                                )}
                                                                {m.quantity && (
                                                                    <Typography variant="caption" display="block" color="text.secondary">
                                                                        Qty: {m.quantity} {m.quantity_unit}
                                                                    </Typography>
                                                                )}
                                                            </TableCell>
                                                            <TableCell>
                                                                <Chip label={m.medicine_type || 'solid'} size="small" variant="outlined" />
                                                            </TableCell>
                                                            <TableCell sx={{ whiteSpace: 'pre-line', fontSize: '0.8rem' }}>
                                                                {fmtSlot(m.morning, m.morning_timing, m.morning_instructions)}
                                                            </TableCell>
                                                            <TableCell sx={{ whiteSpace: 'pre-line', fontSize: '0.8rem' }}>
                                                                {fmtSlot(m.afternoon, m.afternoon_timing, m.afternoon_instructions)}
                                                            </TableCell>
                                                            <TableCell sx={{ whiteSpace: 'pre-line', fontSize: '0.8rem' }}>
                                                                {fmtSlot(m.evening, m.evening_timing, m.evening_instructions)}
                                                            </TableCell>
                                                            <TableCell sx={{ whiteSpace: 'pre-line', fontSize: '0.8rem' }}>
                                                                {fmtSlot(m.night, m.night_timing, m.night_instructions)}
                                                            </TableCell>
                                                            <TableCell>{m.duration || '-'}</TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                </Box>
                            );
                        }

                        const content = sectionContentMap[sec.key];
                        if (!content) return null;
                        return (
                            <Box key={sec.key} sx={{ mb: 2 }}>
                                <Typography variant="subtitle1" fontWeight="bold">{sec.label}</Typography>
                                <Box sx={{ bgcolor: '#f5f5f5', p: 1.5, borderRadius: 1, mt: 0.5 }}>
                                    <Typography variant="body2" whiteSpace="pre-line">{content}</Typography>
                                </Box>
                            </Box>
                        );
                    })}
                </Box>

                {/* Signature */}
                <Box sx={{ textAlign: 'right', p: 2, pt: 0 }}>
                    <Divider sx={{ mb: 2 }} />
                    <Typography variant="body2" fontWeight="bold">{tpl.signature_label || 'Sign'}</Typography>
                    {p.doctor?.signature_url && (
                        <Box component="img" src={p.doctor.signature_url} alt="Doctor Signature"
                            sx={{ maxWidth: 180, maxHeight: 60, objectFit: 'contain', mb: 1 }} />
                    )}
                    {p.doctor && (
                        <>
                            <Typography fontWeight="bold">Dr. {p.doctor.full_name}</Typography>
                            {p.doctor.qualification && <Typography variant="body2" color="text.secondary">{p.doctor.qualification}</Typography>}
                            {p.doctor.registration_number && <Typography variant="body2" color="text.secondary">Reg No: {p.doctor.registration_number}</Typography>}
                        </>
                    )}
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                        {p.issue_date
                            ? new Date(p.issue_date).toLocaleString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : p.created_at
                            ? new Date(p.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : ''}
                    </Typography>
                </Box>

                {/* Disclaimer */}
                {tpl.disclaimer_text && (
                    <Box sx={{ p: 2, bgcolor: '#fafafa', borderTop: '1px solid #eee' }}>
                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                            {tpl.disclaimer_title || 'DISCLAIMER;'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" whiteSpace="pre-line" component="div">
                            {tpl.disclaimer_text}
                        </Typography>
                    </Box>
                )}
            </Paper>

            {/* Admin action buttons */}
            {p.status === 'pending_approval' && (
                <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 3, mb: 4 }}>
                    <Button variant="contained" color="success" size="large"
                        startIcon={<CheckCircleIcon />} onClick={handleApprove}
                        disabled={approving}
                        sx={{ borderRadius: 3, px: 4, py: 1.5, fontWeight: 'bold' }}>
                        {approving ? 'Approving...' : 'Approve Prescription'}
                    </Button>
                    <Button variant="contained" color="error" size="large"
                        startIcon={<CancelIcon />} onClick={() => setRejectDialog(true)}
                        sx={{ borderRadius: 3, px: 4, py: 1.5, fontWeight: 'bold' }}>
                        Reject Prescription
                    </Button>
                </Stack>
            )}

            {/* Reject Dialog */}
            <Dialog open={rejectDialog} onClose={() => setRejectDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Reject Prescription</DialogTitle>
                <DialogContent>
                    <TextField autoFocus fullWidth multiline rows={3} sx={{ mt: 1 }}
                        label="Reason for rejection"
                        value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Please provide a reason..." />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRejectDialog(false)}>Cancel</Button>
                    <Button variant="contained" color="error" onClick={handleReject}>Reject</Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({ ...snack, open: false })}>
                <Alert severity={snack.sev}>{snack.msg}</Alert>
            </Snackbar>
        </Box>
    );
};

export default AdminPrescriptionPreview;
