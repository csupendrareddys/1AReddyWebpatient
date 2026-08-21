/**
 * PrescriptionPreviewPage -- PDF-style preview of a prescription.
 * Uses admin-configured template for header, footer, sections, disclaimer.
 * Matches the redesigned PDF layout:
 *   - Doctor qualification + clinic address in header
 *   - Expanded patient info (contact, ID)
 *   - Chief Complaint (was Notes), Previous Medical History, Allergies
 *   - Rx symbol before medicines
 *   - Stamp-style signature block
 *   - E-prescription validity line
 */
import { useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box, Typography, Paper, Divider, Button, CircularProgress,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Chip, IconButton, Stack,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PrintIcon from '@mui/icons-material/Print';
import ShareIcon from '@mui/icons-material/Share';
import SendIcon from '@mui/icons-material/Send';
import CardGiftcardIcon from '@mui/icons-material/CardGiftcard';
import PaymentIcon from '@mui/icons-material/Payment';
import {
    useGetDoctorPrescriptionQuery,
    useUpdatePrescriptionMutation,
} from '../../api/scopedDoctorApi';
import {
    useGetPrescriptionTemplateQuery,
} from '../../api/doctorEndpoints';
import { useDoctorScope } from '../../ProfileSetting/context/DoctorScopeContext';

const PrescriptionPreviewPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    // Operations mounts this page under its own /records tab, so every
    // link back into the hub is built from the scope, not hard-coded.
    const { recordsPath } = useDoctorScope();
    const printRef = useRef(null);
    const { data: p, isLoading } = useGetDoctorPrescriptionQuery(id);
    const { data: tpl = {} } = useGetPrescriptionTemplateQuery();
    const [updatePrescription, { isLoading: submitting }] = useUpdatePrescriptionMutation();

    if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
    if (!p) return <Box p={4}><Typography color="error">Prescription not found.</Typography></Box>;

    const handlePrint = () => {
        const content = printRef.current;
        if (!content) return;

        // Inject a temporary print-only stylesheet that hides everything except
        // the prescription Paper, preserving all existing MUI / inline styles.
        const styleId = '__prescription-print-style';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                @media print {
                    /* Hide everything on the page */
                    body > * { visibility: hidden !important; position: absolute !important; }
                    /* Show only the printable area and all its children */
                    [data-print-area],
                    [data-print-area] * { visibility: visible !important; position: static !important; }
                    [data-print-area] {
                        position: absolute !important; left: 0; top: 0;
                        width: 100% !important; max-width: 100% !important;
                        margin: 0 !important; padding: 12px !important;
                        box-shadow: none !important; border: none !important;
                    }
                    /* Let fonts scale to fit the print page */
                    @page { size: A4; margin: 10mm; }
                    /* Ensure tables don't overflow */
                    table { font-size: 11pt !important; }
                    th, td { padding: 4px 8px !important; }
                    /* Signature block — scale text relative to its container */
                    .sig-line { font-size: 7pt !important; }
                    /* Avoid page breaks inside sections */
                    [data-print-area] > div { page-break-inside: avoid; }
                }
            `;
            document.head.appendChild(style);
        }

        // Mark the prescription Paper as the print area
        content.setAttribute('data-print-area', '');
        window.print();
        // Clean up after print dialog closes
        content.removeAttribute('data-print-area');
    };

    const handleSubmitForApproval = async () => {
        try {
            await updatePrescription({ prescriptionId: id, status: 'pending_approval' }).unwrap();
            navigate(`${recordsPath}/prescriptions`);
        } catch (err) {
            alert(err?.data?.message || 'Failed to submit');
        }
    };

    const handlePushToPatient = async () => {
        try {
            await updatePrescription({ prescriptionId: id, status: 'active' }).unwrap();
            navigate(`${recordsPath}/prescriptions`);
        } catch (err) {
            alert(err?.data?.message || 'Failed to push to patient');
        }
    };

    // Helper to calculate age from DOB
    const calcAge = (dob) => {
        if (!dob) return '';
        const diff = Date.now() - new Date(dob).getTime();
        return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
    };

    const patientAge = p.patient?.dob ? `${calcAge(p.patient.dob)} Yrs` : '';
    const patientGender = p.patient?.gender || '';

    // Section renderer -- ordered by template config
    // Updated: "Notes" -> "Chief Complaint", added "Previous Medical History"
    const DEFAULT_SECTIONS = [
        { key: 'notes', label: 'Chief Complaint', visible: true, order: 1 },
        { key: 'previous_medical_history', label: 'Previous Medical History', visible: true, order: 2 },
        { key: 'allergies', label: 'Allergies', visible: true, order: 3 },
        { key: 'diagnosis', label: 'Provisional Diagnosis', visible: true, order: 4 },
        { key: 'diagnostic_tests', label: 'Diagnostic Tests', visible: true, order: 5 },
        { key: 'instructions', label: 'Instructions', visible: true, order: 6 },
        { key: 'medicines', label: 'Medicines', visible: true, order: 7 },
        { key: 'doctors_advice', label: "Doctor's Advice", visible: true, order: 8 },
        { key: 'follow_up', label: 'Follow-up', visible: true, order: 9 },
    ];

    // Merge template sections with defaults (handles new keys not yet in saved template)
    const mergeWithDefaults = (saved) => {
        const savedKeys = saved.map(s => s.key);
        const missing = DEFAULT_SECTIONS.filter(d => !savedKeys.includes(d.key));
        return [...saved, ...missing].sort((a, b) => a.order - b.order);
    };

    const sections = mergeWithDefaults(tpl.sections_config || DEFAULT_SECTIONS);

    // Build follow-up display text (text instructions + structured details)
    const buildFollowUpDisplay = () => {
        const parts = [];
        if (p.follow_up) parts.push(p.follow_up);
        if (p.follow_up_type) {
            const typeLabels = {
                free_doctor: 'Free follow-up consultation scheduled',
                paid_patient_picks: 'Paid follow-up consultation recommended',
                paid_doctor_picks: 'Paid follow-up consultation reserved',
            };
            parts.push(typeLabels[p.follow_up_type] || '');
            if (p.follow_up_consultation_type) {
                parts.push(`Type: ${p.follow_up_consultation_type.replace('_', ' ')}`);
            }
            if (p.follow_up_slot_details) {
                const s = p.follow_up_slot_details;
                if (s.date) parts.push(`Date: ${new Date(s.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`);
                if (s.start && s.end) parts.push(`Time: ${s.start} - ${s.end}`);
            } else if (p.follow_up_date) {
                parts.push(`Suggested Date: ${new Date(p.follow_up_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`);
            }
        }
        return parts.length > 0 ? parts.join('\n') : null;
    };

    const sectionContentMap = {
        notes: p.notes,
        previous_medical_history: p.previous_medical_history,
        allergies: p.allergies,
        diagnosis: p.diagnosis,
        diagnostic_tests: p.diagnostic_tests,
        instructions: p.instructions,
        doctors_advice: p.doctors_advice,
        follow_up: buildFollowUpDisplay(),
    };

    // Generate a prescription ID display
    const prescriptionDisplayId = p.id ? p.id.substring(0, 8).toUpperCase() : '';

    // Mask aadhar for display
    const maskAadhar = (val) => {
        if (!val) return null;
        return val.length >= 4 ? `XXXX-XXXX-${val.slice(-4)}` : val;
    };

    // Format current timestamp for signature
    const signDateTime = p.issue_date
        ? new Date(p.issue_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const signTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    return (
        <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
            {/* Back button */}
            <Box display="flex" alignItems="center" gap={1} mb={2}>
                <IconButton onClick={() => navigate(-1)}><ArrowBackIcon /></IconButton>
                <Typography variant="h5" fontWeight="bold">Prescription Preview</Typography>
                {p.status === 'draft' && (
                    <Chip label="Draft -- Not submitted" color="warning" size="small" sx={{ ml: 1 }} />
                )}
                {p.status === 'pending_approval' && (
                    <Chip label="Pending Admin Approval" color="info" size="small" sx={{ ml: 1 }} />
                )}
                {p.status === 'approved' && (
                    <Chip label="Admin Approved -- Ready to push" color="success" size="small" sx={{ ml: 1 }} />
                )}
                {p.status === 'active' && (
                    <Chip label="Pushed to Patient" color="success" size="small" sx={{ ml: 1 }} />
                )}
            </Box>

            {/* Printable Content */}
            <Paper ref={printRef} sx={{ p: 0, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>

                {/* ── Header ── */}
                <Box sx={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    p: 2, bgcolor: '#e8f5e9', borderBottom: '2px solid #a5d6a7',
                }}>
                    <Box display="flex" alignItems="center" gap={2}>
                        {tpl.clinic_logo_url && (
                            <Box
                                component="img" src={tpl.clinic_logo_url} alt="Clinic Logo"
                                sx={{ width: 64, height: 64, objectFit: 'contain', borderRadius: 1 }}
                            />
                        )}
                        <Box>
                            {tpl.clinic_name && (
                                <Typography variant="h6" fontWeight="bold" color="success.dark">
                                    {tpl.clinic_name}
                                </Typography>
                            )}
                            {p.doctor?.clinic_address && (
                                <Typography variant="caption" color="text.secondary" display="block" sx={{ maxWidth: 300 }}>
                                    {p.doctor.clinic_address}
                                </Typography>
                            )}
                        </Box>
                    </Box>
                    <Box textAlign="right">
                        {(tpl.show_doctor_name !== false) && p.doctor && (
                            <Typography fontWeight="bold">Dr. {p.doctor.full_name}</Typography>
                        )}
                        {(tpl.show_doctor_qualification !== false) && p.doctor?.qualification && (
                            <Typography variant="body2" color="text.secondary">
                                {p.doctor.qualification}
                            </Typography>
                        )}
                        {(tpl.show_doctor_specialization !== false) && p.doctor?.specialization && (
                            <Typography variant="body2" color="text.secondary">
                                {p.doctor.specialization}
                            </Typography>
                        )}
                        {(tpl.show_registration_number !== false) && p.doctor?.registration_number && (
                            <Typography variant="body2" color="text.secondary">
                                Reg No: {p.doctor.registration_number}
                            </Typography>
                        )}
                    </Box>
                </Box>

                {/* ── Patient Info (expanded) ── */}
                <Box sx={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    p: 2, mx: 2, mt: 2, bgcolor: '#f1f8e9', borderRadius: 2,
                    border: '1px solid #c5e1a5',
                }}>
                    <Box>
                        {(tpl.show_patient_name !== false) && (
                            <Typography fontWeight="bold">
                                Patient: {p.patient?.full_name || 'Patient'}
                            </Typography>
                        )}
                        {(tpl.show_patient_age_gender !== false) && (
                            <Typography variant="body2" color="text.secondary">
                                {[patientAge && `Age: ${patientAge}`, patientGender].filter(Boolean).join('  |  ')}
                            </Typography>
                        )}
                        {/* Height, Weight */}
                        {(p.patient?.height || p.patient?.weight) && (
                            <Typography variant="body2" color="text.secondary">
                                {[
                                    p.patient?.height && `Height: ${p.patient.height} cm`,
                                    p.patient?.weight && `Weight: ${p.patient.weight} kg`,
                                ].filter(Boolean).join('  |  ')}
                            </Typography>
                        )}
                        {/* Contact & Patient ID */}
                        <Typography variant="body2" color="text.secondary">
                            {[
                                p.patient?.phone_number && `Contact: ${p.patient.phone_number}`,
                                p.patient?.aadhar_number && `ID: ${maskAadhar(p.patient.aadhar_number)}`,
                            ].filter(Boolean).join('  |  ')}
                        </Typography>
                    </Box>
                    <Box textAlign="right">
                        {(tpl.show_prescription_date !== false) && (
                            <Typography variant="body2">
                                {p.issue_date ? new Date(p.issue_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
                            </Typography>
                        )}
                        {(tpl.show_prescription_id !== false) && (
                            <Typography variant="body2" color="text.secondary">
                                Prescription ID: {prescriptionDisplayId}
                            </Typography>
                        )}
                    </Box>
                </Box>

                {/* ── Body Sections ── */}
                <Box sx={{ p: 2 }}>
                    {sections.map((sec) => {
                        if (!sec.visible) return null;

                        // Medicines section with Rx symbol
                        if (sec.key === 'medicines') {
                            // Filter content-empty rows. The doctor's form
                            // pre-creates a blank "Add Medicine" row;
                            // submitting without filling anything was
                            // persisting an all-NULL row that rendered as
                            // a row of dashes here. Suppress those at
                            // render time too (defence for any historical
                            // prescriptions saved before the backend
                            // save-time skip went in).
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
                                    <Box display="flex" alignItems="center" gap={1} sx={{ mb: 1 }}>
                                        {/* Rx: admin image > admin text > default "Rx" */}
                                        {tpl.rx_symbol_url ? (
                                            <Box component="img" src={tpl.rx_symbol_url} alt="Rx"
                                                sx={{ height: 28, maxWidth: 44, objectFit: 'contain' }} />
                                        ) : (
                                            <Typography variant="h5" fontWeight="bold" color="text.primary"
                                                sx={{ fontFamily: 'serif', lineHeight: 1 }}>
                                                {tpl.rx_symbol_text || 'Rx'}
                                            </Typography>
                                        )}
                                        <Typography variant="subtitle1" fontWeight="bold">
                                            {sec.label}
                                        </Typography>
                                    </Box>
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
                                                                    <Typography variant="caption" color="text.secondary">
                                                                        ({m.brand_name})
                                                                    </Typography>
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
                                                            <TableCell sx={{ whiteSpace: 'pre-line', fontSize: '0.8em' }}>
                                                                {fmtSlot(m.morning, m.morning_timing, m.morning_instructions)}
                                                            </TableCell>
                                                            <TableCell sx={{ whiteSpace: 'pre-line', fontSize: '0.8em' }}>
                                                                {fmtSlot(m.afternoon, m.afternoon_timing, m.afternoon_instructions)}
                                                            </TableCell>
                                                            <TableCell sx={{ whiteSpace: 'pre-line', fontSize: '0.8em' }}>
                                                                {fmtSlot(m.evening, m.evening_timing, m.evening_instructions)}
                                                            </TableCell>
                                                            <TableCell sx={{ whiteSpace: 'pre-line', fontSize: '0.8em' }}>
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

                        // Text sections
                        const content = sectionContentMap[sec.key];
                        if (!content) return null;

                        // Follow-up section with structured data gets special styling
                        if (sec.key === 'follow_up' && p.follow_up_type) {
                            const typeIcon = p.follow_up_type === 'free_doctor'
                                ? <CardGiftcardIcon fontSize="small" color="success" />
                                : <PaymentIcon fontSize="small" color="warning" />;
                            return (
                                <Box key={sec.key} sx={{ mb: 2 }}>
                                    <Typography variant="subtitle1" fontWeight="bold">{sec.label}</Typography>
                                    {p.follow_up && (
                                        <Box sx={{ bgcolor: '#f5f5f5', p: 1.5, borderRadius: 1, mt: 0.5, mb: 1 }}>
                                            <Typography variant="body2" whiteSpace="pre-line">{p.follow_up}</Typography>
                                        </Box>
                                    )}
                                    <Box sx={{
                                        bgcolor: p.follow_up_type === 'free_doctor' ? '#e8f5e9' : '#fff3e0',
                                        p: 1.5, borderRadius: 1, mt: 0.5,
                                        border: '1px solid',
                                        borderColor: p.follow_up_type === 'free_doctor' ? '#a5d6a7' : '#ffcc80',
                                    }}>
                                        <Box display="flex" alignItems="center" gap={0.5} mb={0.5}>
                                            {typeIcon}
                                            <Typography variant="subtitle2" fontWeight="bold">
                                                {p.follow_up_type === 'free_doctor' ? 'Free Follow-Up Scheduled'
                                                    : p.follow_up_type === 'paid_patient_picks' ? 'Paid Follow-Up -- Patient Picks Slot'
                                                    : 'Paid Follow-Up -- Slot Reserved'}
                                            </Typography>
                                        </Box>
                                        {p.follow_up_consultation_type && (
                                            <Typography variant="body2">
                                                Consultation: <strong>{p.follow_up_consultation_type.replace('_', ' ')}</strong>
                                            </Typography>
                                        )}
                                        {p.follow_up_slot_details?.date && (
                                            <Typography variant="body2">
                                                Date: <strong>{new Date(p.follow_up_slot_details.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
                                            </Typography>
                                        )}
                                        {p.follow_up_slot_details?.start && (
                                            <Typography variant="body2">
                                                Time: <strong>{p.follow_up_slot_details.start} - {p.follow_up_slot_details.end}</strong>
                                            </Typography>
                                        )}
                                        {!p.follow_up_slot_details && p.follow_up_date && (
                                            <Typography variant="body2">
                                                Suggested Date: <strong>{new Date(p.follow_up_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
                                            </Typography>
                                        )}
                                    </Box>
                                </Box>
                            );
                        }

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

                {/* ── Signature ── */}
                {(tpl.show_doctor_signature !== false) && (
                    <Box sx={{ p: 2, pt: 0 }}>
                        <Divider sx={{ mb: 2 }} />

                        {/* Outer container — right-aligned, width adapts to content */}
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Box sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', minWidth: 200 }}>

                                {/* Top row — signature image + digitally-signed text side by side */}
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 72 }}>

                                    {/* Signature image */}
                                    {p.doctor?.signature_url && (
                                        <Box sx={{ flexShrink: 0 }}>
                                            <Box component="img"
                                                src={p.doctor.signature_url}
                                                alt="Doctor Signature"
                                                sx={{ maxWidth: 160, maxHeight: 52, objectFit: 'contain' }}
                                            />
                                        </Box>
                                    )}

                                    {/* Digitally signed text — no overflow, font scales with container */}
                                    {p.doctor && (
                                        <Box sx={{ flexShrink: 0 }}>
                                            {['Digitally signed by', `Dr. ${p.doctor.full_name}`, `Date: ${signDateTime}`, `Time: ${signTime}`].map((line, i) => (
                                                <Typography key={i} className="sig-line" sx={{
                                                    fontSize: '0.55rem', color: 'text.secondary',
                                                    fontStyle: 'italic', lineHeight: 1.7, whiteSpace: 'nowrap',
                                                }}>
                                                    {line}
                                                </Typography>
                                            ))}
                                        </Box>
                                    )}
                                </Box>

                                {/* Bottom — doctor name, qualification, reg no */}
                                {p.doctor && (
                                    <Box sx={{ py: 1, px: 2, textAlign: 'center' }}>
                                        <Typography variant="body2" fontWeight="bold">
                                            Dr. {p.doctor.full_name}
                                        </Typography>
                                        {p.doctor.qualification && (
                                            <Typography variant="caption" color="text.secondary" display="block">
                                                {p.doctor.qualification}
                                            </Typography>
                                        )}
                                        {p.doctor.registration_number && (
                                            <Typography variant="caption" color="text.secondary" display="block">
                                                Reg No: {p.doctor.registration_number}
                                            </Typography>
                                        )}
                                    </Box>
                                )}
                            </Box>
                        </Box>
                    </Box>
                )}

                {/* ── E-Prescription Validity Line ── */}
                <Box sx={{ px: 2, pb: 1 }}>
                    <Typography variant="caption" color="text.secondary" fontStyle="italic" display="block" textAlign="center">
                        {p.valid_until
                            ? `This e-prescription is valid until ${new Date(p.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.`
                            : 'This e-prescription is valid for 30 days from the date of issue.'}
                    </Typography>
                </Box>

                {/* ── Disclaimer ── */}
                {tpl.disclaimer_text && (
                    <Box sx={{ p: 2, bgcolor: '#fafafa', borderTop: '1px solid #eee' }}>
                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                            {tpl.disclaimer_title || 'DISCLAIMER'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" whiteSpace="pre-line" component="div">
                            {tpl.disclaimer_text}
                        </Typography>
                    </Box>
                )}
            </Paper>

            {/* ── Action Buttons ── */}
            <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 3, mb: 4 }}>
                {/* Draft / Rejected -> "Send for Approval" */}
                {(p.status === 'draft' || p.status === 'rejected') && (
                    <Button variant="contained" color="success" startIcon={<SendIcon />}
                        onClick={handleSubmitForApproval} disabled={submitting}
                        sx={{ borderRadius: 3, px: 4, py: 1.5, fontWeight: 'bold' }}>
                        {submitting ? 'Submitting...' : 'Send for Approval'}
                    </Button>
                )}

                {/* Pending Approval -> info only */}
                {p.status === 'pending_approval' && (
                    <Typography variant="body1" color="info.main" fontWeight="bold" sx={{ py: 2 }}>
                        Submitted -- waiting for admin approval
                    </Typography>
                )}

                {/* Approved by admin -> "Push to Patient" */}
                {p.status === 'approved' && (
                    <Button variant="contained" color="success" size="large" startIcon={<SendIcon />}
                        onClick={handlePushToPatient} disabled={submitting}
                        sx={{ borderRadius: 3, px: 5, py: 1.5, fontWeight: 'bold', fontSize: '1rem' }}>
                        {submitting ? 'Pushing...' : 'Push to Patient'}
                    </Button>
                )}

                {/* Active (pushed to patient) -> Share, Print */}
                {p.status === 'active' && (
                    <>
                        {(tpl.show_share_button !== false) && (
                            <Button variant="contained" color="warning" startIcon={<ShareIcon />}
                                sx={{ borderRadius: 3, px: 4, py: 1.5, fontWeight: 'bold' }}>
                                Share
                            </Button>
                        )}
                        {(tpl.show_print_button !== false) && (
                            <Button variant="contained" color="warning" startIcon={<PrintIcon />}
                                onClick={handlePrint}
                                sx={{ borderRadius: 3, px: 4, py: 1.5, fontWeight: 'bold' }}>
                                Print
                            </Button>
                        )}
                    </>
                )}
            </Stack>
        </Box>
    );
};

export default PrescriptionPreviewPage;
