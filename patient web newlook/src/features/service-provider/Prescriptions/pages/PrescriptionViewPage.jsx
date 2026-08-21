/**
 * PrescriptionViewPage — Read-only view of a completed prescription
 */
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box, Typography, Paper, Stack, Chip, Divider, IconButton, CircularProgress,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import { useGetDoctorPrescriptionQuery } from '../../api/scopedDoctorApi';
import { useDoctorScope } from '../../ProfileSetting/context/DoctorScopeContext';

const FRAC_MAP = { '1': 'Full', '3/4': '75%', '1/2': 'Half', '1/4': '25%' };

const PrescriptionViewPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    // Operations mounts this page under its own /records tab, so every
    // link back into the hub is built from the scope, not hard-coded.
    const { recordsPath } = useDoctorScope();
    const { data: p, isLoading, isError } = useGetDoctorPrescriptionQuery(id);

    if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
    if (isError || !p) return <Box p={4}><Typography color="error">Prescription not found.</Typography></Box>;

    const Section = ({ title, content }) => content ? (
        <Paper sx={{ p: 3 }}>
            <Typography variant="h6" fontWeight="bold" gutterBottom>{title}</Typography>
            <Typography variant="body1" whiteSpace="pre-line">{content}</Typography>
        </Paper>
    ) : null;

    return (
        <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
            <Box display="flex" alignItems="center" gap={1} mb={3}>
                <IconButton onClick={() => navigate(`${recordsPath}/prescriptions`)}>
                    <ArrowBackIcon />
                </IconButton>
                <LocalHospitalIcon color="primary" />
                <Typography variant="h5" fontWeight="bold">Prescription</Typography>
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
                <Section title="Notes" content={p.notes} />
                <Section title="Allergies" content={p.allergies} />
                <Section title="Provisional Diagnosis" content={p.diagnosis} />
                <Section title="Diagnostic / Lab Tests" content={p.diagnostic_tests} />
                <Section title="Instructions" content={p.instructions} />

                {/* Medicines — drop content-empty rows so a blank
                    "Add Medicine" row doesn't render as a row of
                    dashes (legacy data before backend save-time skip). */}
                {(() => {
                    const realMedicines = (p.medicines || []).filter((m) => (
                        m.medicine_id
                        || (m.generic_name && m.generic_name.trim())
                        || (m.brand_name && m.brand_name.trim())
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
                    <Paper sx={{ p: 3 }}>
                        <Typography variant="h6" fontWeight="bold" gutterBottom>Medicines ({realMedicines.length})</Typography>
                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow sx={{ bgcolor: 'grey.100' }}>
                                        <TableCell><b>S.No</b></TableCell>
                                        <TableCell><b>Generic Name</b></TableCell>
                                        <TableCell><b>Brand</b></TableCell>
                                        <TableCell><b>Qty</b></TableCell>
                                        <TableCell><b>Dosage</b></TableCell>
                                        <TableCell><b>M/A/E/N</b></TableCell>
                                        <TableCell><b>Duration</b></TableCell>
                                        <TableCell><b>Timing</b></TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {realMedicines.map((m, i) => (
                                        <TableRow key={m.id || i}>
                                            <TableCell>{m.serial_no || i + 1}</TableCell>
                                            <TableCell>
                                                <Typography variant="body2" fontWeight="bold">{m.generic_name || '-'}</Typography>
                                                {m.form && <Typography variant="caption" color="text.secondary">{m.form} {m.strength}</Typography>}
                                            </TableCell>
                                            <TableCell>{m.brand_name || '-'}</TableCell>
                                            <TableCell>{m.quantity ? `${m.quantity} ${m.quantity_unit || ''}` : '-'}</TableCell>
                                            <TableCell>{m.dosage || '-'}<br /><Typography variant="caption">{m.frequency}</Typography></TableCell>
                                            <TableCell>
                                                <Box display="flex" gap={0.5}>
                                                    {m.morning && <Chip size="small" label={`M:${m.morning}`} />}
                                                    {m.afternoon && <Chip size="small" label={`A:${m.afternoon}`} />}
                                                    {m.evening && <Chip size="small" label={`E:${m.evening}`} />}
                                                    {m.night && <Chip size="small" label={`N:${m.night}`} />}
                                                    {!m.morning && !m.afternoon && !m.evening && !m.night && '-'}
                                                </Box>
                                            </TableCell>
                                            <TableCell>{m.duration || '-'}</TableCell>
                                            <TableCell>{m.timing || '-'}<br />{m.instructions && <Typography variant="caption" color="text.secondary">{m.instructions}</Typography>}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </Paper>
                    );
                })()}

                <Section title="Doctor's Advice" content={p.doctors_advice} />
                <Section title="Follow-up / Next Appointment" content={p.follow_up} />
            </Stack>
        </Box>
    );
};

export default PrescriptionViewPage;
