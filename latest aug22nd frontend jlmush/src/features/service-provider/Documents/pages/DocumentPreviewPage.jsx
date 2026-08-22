/**
 * DocumentPreviewPage -- PDF-style preview of a document.
 *
 * The admin template supplies the frame (letterhead, patient block,
 * signature, validity line, document disclaimer); the body is entirely
 * doctor-authored — Description, then the custom fields in their saved
 * order, then the attachment. There is deliberately no fixed section list
 * and no medicines table here: that is the prescription preview's job.
 */
import { useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box, Typography, Paper, Divider, Button, CircularProgress,
    Chip, IconButton, Stack,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PrintIcon from '@mui/icons-material/Print';
import ShareIcon from '@mui/icons-material/Share';
import SendIcon from '@mui/icons-material/Send';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { apiFileUrl } from '../../../../api/fileUrl';
import {
    useGetDoctorDocumentQuery,
    useUpdateDocumentMutation,
} from '../../api/scopedDoctorApi';
import {
    useGetMyPrescriptionTemplateQuery,
} from '../../api/doctorEndpoints';
import { useDoctorScope } from '../../ProfileSetting/context/DoctorScopeContext';

const DocumentPreviewPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    // Operations mounts this page under its own /records tab, so every
    // link back into the hub is built from the scope, not hard-coded.
    const { recordsPath } = useDoctorScope();
    const printRef = useRef(null);
    const { data: p, isLoading } = useGetDoctorDocumentQuery(id);
    const { data: tpl = {} } = useGetMyPrescriptionTemplateQuery();
    const [updateDocument, { isLoading: submitting }] = useUpdateDocumentMutation();

    if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
    if (!p) return <Box p={4}><Typography color="error">Document not found.</Typography></Box>;

    const handlePrint = () => {
        const content = printRef.current;
        if (!content) return;

        // Inject a temporary print-only stylesheet that hides everything except
        // the document Paper, preserving all existing MUI / inline styles.
        const styleId = '__document-print-style';
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

        // Mark the document Paper as the print area
        content.setAttribute('data-print-area', '');
        window.print();
        // Clean up after print dialog closes
        content.removeAttribute('data-print-area');
    };

    const handleSubmitForApproval = async () => {
        try {
            await updateDocument({ documentId: id, status: 'pending_approval' }).unwrap();
            navigate(`${recordsPath}/documents`);
        } catch (err) {
            alert(err?.data?.message || 'Failed to submit');
        }
    };

    const handlePushToPatient = async () => {
        try {
            await updateDocument({ documentId: id, status: 'active' }).unwrap();
            navigate(`${recordsPath}/documents`);
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


    // Generate a document ID display
    const documentDisplayId = p.id ? p.id.substring(0, 8).toUpperCase() : '';

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
                <Typography variant="h5" fontWeight="bold">Document Preview</Typography>
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
                                Document ID: {documentDisplayId}
                            </Typography>
                        )}
                    </Box>
                </Box>

                {/* ── Body Sections ──
                    A document has no fixed clinical schema: it renders its
                    Description, then the doctor-named custom fields in the
                    order they were authored, then the attachment link.
                    The admin template still controls the letterhead,
                    signature block and disclaimer around this. */}
                <Box sx={{ p: 2 }}>
                    {p.description && (
                        <Box sx={{ mb: 2 }}>
                            <Typography variant="subtitle1" fontWeight="bold">Description</Typography>
                            <Box sx={{ bgcolor: '#f5f5f5', p: 1.5, borderRadius: 1, mt: 0.5 }}>
                                <Typography variant="body2" whiteSpace="pre-line">{p.description}</Typography>
                            </Box>
                        </Box>
                    )}

                    {(p.custom_fields || []).map((f, i) => (
                        <Box key={f.id || `${f.label}-${i}`} sx={{ mb: 2 }}>
                            <Typography variant="subtitle1" fontWeight="bold">{f.label}</Typography>
                            <Box sx={{ bgcolor: '#f5f5f5', p: 1.5, borderRadius: 1, mt: 0.5 }}>
                                <Typography variant="body2" whiteSpace="pre-line">{f.value || '-'}</Typography>
                                {(f.attachments || []).length > 0 && (
                                    <Stack spacing={0.25} sx={{ mt: 1 }}>
                                        {f.attachments.map((a) => (
                                            <Box key={a.id} display="flex" alignItems="center" gap={0.5}>
                                                <AttachFileIcon sx={{ fontSize: 14 }} color="action" />
                                                <Typography variant="caption">
                                                    <a href={apiFileUrl(a.url)} target="_blank" rel="noopener noreferrer">
                                                        {a.name || 'Attachment'}
                                                    </a>
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Stack>
                                )}
                            </Box>
                        </Box>
                    ))}

                    {p.attachment_url && (
                        <Box sx={{ mb: 2 }}>
                            <Typography variant="subtitle1" fontWeight="bold">Attachment</Typography>
                            <Box sx={{
                                display: 'flex', alignItems: 'center', gap: 1,
                                bgcolor: '#f5f5f5', p: 1.5, borderRadius: 1, mt: 0.5,
                            }}>
                                <AttachFileIcon fontSize="small" color="action" />
                                <Typography variant="body2">
                                    <a href={apiFileUrl(p.attachment_url)} target="_blank" rel="noopener noreferrer">
                                        {p.attachment_name || 'View attachment'}
                                    </a>
                                </Typography>
                            </Box>
                        </Box>
                    )}

                    {!p.description && !(p.custom_fields || []).length && !p.attachment_url && (
                        <Typography variant="body2" color="text.secondary" fontStyle="italic">
                            This document has no content yet.
                        </Typography>
                    )}
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

                {/* ── E-Document Validity Line ── */}
                <Box sx={{ px: 2, pb: 1 }}>
                    <Typography variant="caption" color="text.secondary" fontStyle="italic" display="block" textAlign="center">
                        {p.valid_until
                            ? `This e-document is valid until ${new Date(p.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.`
                            : 'This e-document is valid for 30 days from the date of issue.'}
                    </Typography>
                </Box>

                {/* ── Disclaimer ──
                    Documents use the template's DOCUMENT disclaimer, never
                    the prescription one — that text is teleconsultation /
                    medico-legal wording that doesn't apply to a purchased
                    service deliverable. The backend already substitutes a
                    sensible default when the admin hasn't set one. */}
                {tpl.document_disclaimer_text && (
                    <Box sx={{ p: 2, bgcolor: '#fafafa', borderTop: '1px solid #eee' }}>
                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                            {tpl.document_disclaimer_title || 'DISCLAIMER'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" whiteSpace="pre-line" component="div">
                            {tpl.document_disclaimer_text}
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

export default DocumentPreviewPage;
