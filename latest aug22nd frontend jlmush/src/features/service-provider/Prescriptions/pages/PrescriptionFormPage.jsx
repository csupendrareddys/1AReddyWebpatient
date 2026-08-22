/**
 * PrescriptionFormPage — Create or edit a prescription.
 *
 * Medicine row redesign:
 *   - Medicine Type: Solid → fraction pickers (1, 3/4, 1/2, 1/4)
 *                    Liquid → ml input for each M/A/E/N slot
 *   - Each M/A/E/N slot has its own food timing (before/after/with food)
 *   - No separate Dosage / Frequency text fields (replaced by M/A/E/N schedule)
 *   - Duration kept as text
 *
 * Routes:
 *   /dashboard/doctor/prescriptions/new?appointmentId=xxx  (create)
 *   /dashboard/doctor/prescriptions/:id/edit               (edit)
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
    Box, Typography, Paper, TextField, Button, IconButton,
    Stack, Divider, Snackbar, Alert, CircularProgress, Autocomplete,
    ToggleButton, ToggleButtonGroup, Tooltip, Chip, MenuItem, Select,
    FormControl, InputLabel,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import PreviewIcon from '@mui/icons-material/Preview';

import WarningIcon from '@mui/icons-material/Warning';
import EventIcon from '@mui/icons-material/Event';
import FollowUpDialog from '../components/FollowUpDialog';

import {
    useSavePrescriptionMutation,
    useUpdatePrescriptionMutation,
    useRevisePrescriptionMutation,
    useGetDoctorPrescriptionQuery,
    useSearchMedicinesQuery,
    useCheckBannedQuery,
    useGetAppointmentPatientContextQuery,
    useGetAppointmentByIdQuery,
} from '../../api/scopedDoctorApi';
// Not scoped, and correctly so: the prescription TEMPLATE is an admin-owned
// tenant setting on /api/admin/prescription-config, which an admin may read
// as themselves.
import { useGetMyPrescriptionTemplateQuery } from '../../api/doctorEndpoints';
import { useDoctorScope } from '../../ProfileSetting/context/DoctorScopeContext';

// ── Constants ──
const FRACTIONS = [
    { value: '1', label: '1' },
    { value: '3/4', label: '\u00BE' },
    { value: '1/2', label: '\u00BD' },
    { value: '1/4', label: '\u00BC' },
];

const FOOD_TIMING_OPTIONS = [
    { value: 'after food', label: 'After Food' },
    { value: 'before food', label: 'Before Food' },
    { value: 'with food', label: 'With Food' },
    { value: 'empty stomach', label: 'Empty Stomach' },
    { value: '', label: 'N/A' },
];

const SLOT_LABELS = [
    { key: 'morning', label: 'Morning', short: 'M', timingKey: 'morning_timing' },
    { key: 'afternoon', label: 'Afternoon', short: 'A', timingKey: 'afternoon_timing' },
    { key: 'evening', label: 'Evening', short: 'E', timingKey: 'evening_timing' },
    { key: 'night', label: 'Night', short: 'N', timingKey: 'night_timing' },
];

// ── Fraction Picker (Solid) ──
const FractionPicker = ({ value, onChange }) => (
    <ToggleButtonGroup
        orientation="vertical" exclusive size="small"
        value={value || ''} onChange={(_, v) => onChange(v)}
    >
        {FRACTIONS.map((f) => (
            <ToggleButton key={f.value} value={f.value} sx={{ py: 0.3, px: 1, fontSize: '0.8rem', minWidth: 40 }}>
                {f.label}
            </ToggleButton>
        ))}
    </ToggleButtonGroup>
);

// ── Single Dose Slot (M / A / E / N) with timing ──
const DoseSlot = ({ label, short, type, doseValue, timingValue, onDoseChange, onTimingChange, instructionValue, onInstructionChange }) => (
    <Box sx={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        border: '1px solid', borderColor: 'divider', borderRadius: 2,
        p: 1, minWidth: 90, bgcolor: doseValue ? 'action.selected' : 'transparent',
    }}>
        <Typography variant="caption" fontWeight="bold" mb={0.5}>{short}</Typography>

        {type === 'liquid' ? (
            <TextField
                size="small" type="number" placeholder="ml"
                value={doseValue || ''}
                onChange={(e) => onDoseChange(e.target.value || null)}
                sx={{ width: 60, '& input': { textAlign: 'center', p: 0.5, fontSize: '0.8rem' } }}
                inputProps={{ min: 0, step: 0.5 }}
            />
        ) : type === 'powder' ? (
            <TextField
                size="small" type="number" placeholder="g"
                value={doseValue || ''}
                onChange={(e) => onDoseChange(e.target.value || null)}
                sx={{ width: 60, '& input': { textAlign: 'center', p: 0.5, fontSize: '0.8rem' } }}
                inputProps={{ min: 0, step: 0.5 }}
            />
        ) : type === 'other' ? (
            <TextField
                size="small" type="number" placeholder="value"
                value={doseValue || ''}
                onChange={(e) => onDoseChange(e.target.value || null)}
                sx={{ width: 60, '& input': { textAlign: 'center', p: 0.5, fontSize: '0.8rem' } }}
                inputProps={{ min: 0, step: 1 }}
            />
        ) : (
            <FractionPicker value={doseValue} onChange={onDoseChange} />
        )}

        {/* Food timing per slot */}
        <Select
            size="small" variant="standard"
            value={timingValue || 'after food'}
            onChange={(e) => onTimingChange(e.target.value)}
            sx={{ mt: 0.5, fontSize: '0.65rem', minWidth: 70, '& .MuiSelect-select': { py: 0.2 } }}
        >
            {FOOD_TIMING_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: '0.75rem' }}>
                    {opt.label}
                </MenuItem>
            ))}
        </Select>

        {/* Per-slot instructions */}
        <TextField
            size="small" placeholder="Instructions"
            value={instructionValue || ''}
            onChange={(e) => onInstructionChange(e.target.value)}
            sx={{ mt: 0.5, width: '100%', '& input': { fontSize: '0.65rem', p: 0.5 } }}
        />
    </Box>
);

// ── Empty medicine template ──
const emptyMedicine = () => ({
    key: Date.now() + Math.random(),
    medicine_id: null,
    custom_generic_name: '',
    custom_brand_name: '',
    quantity: '',
    quantity_unit: 'Nos',
    medicine_type: 'solid',       // solid | liquid | powder | other
    duration: '',
    morning: null,
    afternoon: null,
    evening: null,
    night: null,
    morning_timing: 'after food',
    afternoon_timing: 'after food',
    evening_timing: 'after food',
    night_timing: 'after food',
    instructions: '',
    custom_dose_unit: '',  // for "other" type: drops, puffs, patches, units, etc.
    morning_instructions: '',
    afternoon_instructions: '',
    evening_instructions: '',
    night_instructions: '',
    _search: '',
    _selected: null,
});

// ── Inline banned check hook per medicine row ──
const useBannedCheck = (genericName) => {
    const trimmed = (genericName || '').trim();
    const { data, isFetching } = useCheckBannedQuery(trimmed, {
        skip: trimmed.length < 2,
    });
    return { isBanned: data?.is_banned || false, bannedName: data?.banned_name, reason: data?.reason, checking: isFetching };
};

// Small component to show banned warning inline
const BannedWarning = ({ genericName }) => {
    const { isBanned, bannedName, reason, checking } = useBannedCheck(genericName);
    if (!isBanned || checking) return null;
    return (
        <Alert severity="error" icon={<WarningIcon />} sx={{ mt: 1, py: 0.5 }}>
            <b>BANNED:</b> "{genericName}" matches banned substance "<b>{bannedName}</b>".
            {reason && <> Reason: {reason}</>}
        </Alert>
    );
};

const PrescriptionFormPage = () => {
    const { id: prescriptionId } = useParams();
    const [searchParams] = useSearchParams();
    const appointmentId = searchParams.get('appointmentId');
    const isRevise = searchParams.get('revise') === 'true';
    const navigate = useNavigate();
    // Operations mounts this page under its own /records tab, so every
    // link back into the hub is built from the scope, not hard-coded.
    const { recordsPath } = useDoctorScope();
    const isEdit = !!prescriptionId && !isRevise;

    // ── Form state ──
    const [notes, setNotes] = useState('');
    const [allergies, setAllergies] = useState('');
    const [diagnosis, setDiagnosis] = useState('');
    const [diagnosticTests, setDiagnosticTests] = useState('');
    const [instructions, setInstructions] = useState('');
    const [previousMedicalHistory, setPreviousMedicalHistory] = useState('');
    const [doctorsAdvice, setDoctorsAdvice] = useState('');
    const [followUp, setFollowUp] = useState('');
    const [followUpDialogOpen, setFollowUpDialogOpen] = useState(false);
    const [followUpData, setFollowUpData] = useState(null); // Structured follow-up scheduling data
    const [medicines, setMedicines] = useState([emptyMedicine()]);
    const [snack, setSnack] = useState({ open: false, msg: '', sev: 'success' });

    // ── Medicine search ──
    const [searchTerm, setSearchTerm] = useState('');
    const { data: searchResults = [] } = useSearchMedicinesQuery(searchTerm, {
        skip: searchTerm.length < 2,
    });

    // ── API ──
    // For NEW prescriptions: fetch appointment to check if consultation has ended
    const { data: appointment, isLoading: loadingAppointment } = useGetAppointmentByIdQuery(
        appointmentId, { skip: !appointmentId || !!prescriptionId }
    );
    // Patient context — used to pre-populate allergy, history fields for new prescriptions
    const { data: patientContext } = useGetAppointmentPatientContextQuery(
        appointmentId, { skip: !appointmentId || !!prescriptionId }
    );
    const { data: existingPrescription, isLoading: loadingExisting } = useGetDoctorPrescriptionQuery(
        prescriptionId, { skip: !prescriptionId }
    );
    const { data: tpl = {} } = useGetMyPrescriptionTemplateQuery();
    const [savePrescription, { isLoading: saving }] = useSavePrescriptionMutation();
    const [updatePrescription, { isLoading: updating }] = useUpdatePrescriptionMutation();
    const [revisePrescription, { isLoading: revising }] = useRevisePrescriptionMutation();

    // ── Load existing prescription for edit or revise ──
    useEffect(() => {
        if (existingPrescription && (isEdit || isRevise)) {
            const p = existingPrescription;
            setNotes(p.notes || '');
            setAllergies(p.allergies || '');
            setDiagnosis(p.diagnosis || '');
            setDiagnosticTests(p.diagnostic_tests || '');
            setInstructions(p.instructions || '');
            setPreviousMedicalHistory(p.previous_medical_history || '');
            setDoctorsAdvice(p.doctors_advice || '');
            setFollowUp(p.follow_up || '');
            // Restore structured follow-up data
            if (p.follow_up_type) {
                setFollowUpData({
                    follow_up_type: p.follow_up_type,
                    follow_up_consultation_type: p.follow_up_consultation_type,
                    follow_up_date: p.follow_up_date,
                    follow_up_time_slot_id: p.follow_up_time_slot_id,
                    _display: {
                        type_label: p.follow_up_type === 'free_doctor' ? 'Free Follow-Up' : 'Paid Follow-Up',
                        mode_label: p.follow_up_type === 'paid_patient_picks' ? 'Patient picks slot'
                            : p.follow_up_type === 'paid_doctor_picks' ? 'Doctor picked slot' : null,
                        consultation_type: p.follow_up_consultation_type || '',
                        date: p.follow_up_date,
                        slot_time: p.follow_up_slot_details
                            ? `${p.follow_up_slot_details.start || ''} - ${p.follow_up_slot_details.end || ''}`
                            : null,
                    },
                });
            }
            if (p.medicines?.length) {
                setMedicines(p.medicines.map((m) => ({
                    key: m.id || Date.now() + Math.random(),
                    medicine_id: m.medicine_id || null,
                    custom_generic_name: m.generic_name || '',
                    custom_brand_name: m.brand_name || '',
                    quantity: m.quantity || '',
                    quantity_unit: m.quantity_unit || 'Nos',
                    medicine_type: m.medicine_type || 'solid',
                    duration: m.duration || '',
                    morning: m.morning || null,
                    afternoon: m.afternoon || null,
                    evening: m.evening || null,
                    night: m.night || null,
                    morning_timing: m.morning_timing || m.timing || 'after food',
                    afternoon_timing: m.afternoon_timing || m.timing || 'after food',
                    evening_timing: m.evening_timing || m.timing || 'after food',
                    night_timing: m.night_timing || m.timing || 'after food',
                    instructions: m.instructions || '',
                    custom_dose_unit: m.custom_dose_unit || '',
                    morning_instructions: m.morning_instructions || ((!m.morning_instructions && !m.afternoon_instructions && !m.evening_instructions && !m.night_instructions && m.instructions) ? m.instructions : ''),
                    afternoon_instructions: m.afternoon_instructions || '',
                    evening_instructions: m.evening_instructions || '',
                    night_instructions: m.night_instructions || '',
                    _search: m.generic_name || '',
                    _selected: m.medicine_id ? { id: m.medicine_id, generic_name: m.generic_name, name: m.brand_name } : null,
                })));
            }
        }
    }, [existingPrescription, isEdit, isRevise]);

    // ── Pre-populate from patient context (NEW prescriptions only) ──
    useEffect(() => {
        if (!patientContext || prescriptionId) return;
        const ctx = patientContext.context;
        if (!ctx) return;

        // ── Allergies: collect from health records with record_type containing "allerg" ──
        const allergyRecords = (ctx.shared_health_records || []).filter(
            (r) => (r.record_type || '').toLowerCase().includes('allerg')
        );
        if (allergyRecords.length > 0) {
            const allergyLines = allergyRecords.map((r) => {
                const parts = [];
                const title = r.title || r.record_type || 'Allergy';
                parts.push(title);
                if (r.details?.allergy_name || r.details?.name) {
                    parts.push(r.details.allergy_name || r.details.name);
                }
                if (r.notes) parts.push(r.notes);
                if (r.details?.reaction) parts.push(`Reaction: ${r.details.reaction}`);
                if (r.details?.severity) parts.push(`Severity: ${r.details.severity}`);
                return parts.join(' — ');
            });
            setAllergies((prev) => prev || allergyLines.join('\n'));
        }

        // ── Previous Medical History: collect non-allergy health records ──
        const historyRecords = (ctx.shared_health_records || []).filter(
            (r) => !(r.record_type || '').toLowerCase().includes('allerg')
        );
        if (historyRecords.length > 0) {
            const histLines = historyRecords.map((r) => {
                const parts = [r.title || (r.record_type || '').replace(/_/g, ' ')];
                if (r.record_date) parts.push(`(${r.record_date})`);
                if (r.notes) parts.push(r.notes);
                return parts.join(' ');
            });
            setPreviousMedicalHistory((prev) => prev || histLines.join('\n'));
        }

        // ── Chief Complaint: build from symptoms ──
        const symptoms = ctx.symptoms || [];
        const customSymptoms = ctx.custom_symptoms || [];
        if (symptoms.length > 0 || customSymptoms.length > 0) {
            const symLines = [
                ...symptoms.map((s) => {
                    let line = s.name;
                    if (s.severity) line += ` (${s.severity})`;
                    if (s.notes) line += ` — ${s.notes}`;
                    return line;
                }),
                ...customSymptoms.map((s) => (typeof s === 'string' ? s : s.name || s.symptom || '')),
            ].filter(Boolean);
            setNotes((prev) => prev || symLines.join('\n'));
        }
    }, [patientContext, prescriptionId]);

    // ── Medicine row management ──
    const addMedicineRow = () => setMedicines((prev) => [...prev, emptyMedicine()]);

    const removeMedicineRow = (index) => {
        setMedicines((prev) => prev.length > 1 ? prev.filter((_, i) => i !== index) : prev);
    };

    const updateMedicine = (index, field, value) => {
        setMedicines((prev) => prev.map((m, i) => i === index ? { ...m, [field]: value } : m));
    };

    const handleMedicineSelect = (index, med) => {
        if (!med) {
            updateMedicine(index, '_selected', null);
            updateMedicine(index, 'medicine_id', null);
            return;
        }
        const brandName = (med.name && med.name.toLowerCase() !== (med.generic_name || '').toLowerCase())
            ? med.name : '';
        setMedicines((prev) => prev.map((m, i) => i === index ? {
            ...m,
            _selected: med,
            medicine_id: med.id,
            custom_generic_name: med.generic_name || '',
            custom_brand_name: brandName,
            _search: med.generic_name || '',
        } : m));
    };

    // ── Build payload ──
    const buildPayload = (status) => ({
        status,
        notes, allergies, diagnosis,
        diagnostic_tests: diagnosticTests,
        instructions,
        previous_medical_history: previousMedicalHistory,
        doctors_advice: doctorsAdvice,
        follow_up: followUp,
        // Structured follow-up scheduling
        follow_up_type: followUpData?.follow_up_type || null,
        follow_up_consultation_type: followUpData?.follow_up_consultation_type || null,
        follow_up_date: followUpData?.follow_up_date || null,
        follow_up_time_slot_id: followUpData?.follow_up_time_slot_id || null,
        medicines: medicines.map((m, i) => ({
            medicine_id: m.medicine_id || null,
            custom_generic_name: m.custom_generic_name || null,
            custom_brand_name: m.custom_brand_name || null,
            quantity: m.quantity ? parseInt(m.quantity) : null,
            quantity_unit: m.quantity_unit || null,
            medicine_type: m.medicine_type || 'solid',
            duration: m.duration || null,
            morning: m.morning || null,
            afternoon: m.afternoon || null,
            evening: m.evening || null,
            night: m.night || null,
            morning_timing: m.morning_timing || null,
            afternoon_timing: m.afternoon_timing || null,
            evening_timing: m.evening_timing || null,
            night_timing: m.night_timing || null,
            timing: m.morning_timing || 'after food',   // legacy fallback
            custom_dose_unit: m.custom_dose_unit || null,
            morning_instructions: m.morning_instructions || null,
            afternoon_instructions: m.afternoon_instructions || null,
            evening_instructions: m.evening_instructions || null,
            night_instructions: m.night_instructions || null,
            instructions: [m.morning_instructions, m.afternoon_instructions, m.evening_instructions, m.night_instructions].filter(Boolean).join('; ') || null,
            serial_no: i + 1,
        })),
    });

    const handleSave = async (status = 'draft', { redirectToPreview = false } = {}) => {
        const payload = buildPayload(status);
        try {
            let result;
            if (isRevise) {
                result = await revisePrescription({ prescriptionId, ...payload }).unwrap();
                setSnack({ open: true, msg: 'Prescription revised successfully!', sev: 'success' });
            } else if (isEdit) {
                result = await updatePrescription({ prescriptionId, ...payload }).unwrap();
                setSnack({ open: true, msg: status === 'active' ? 'Prescription finalized!' : 'Saved as draft', sev: 'success' });
            } else {
                if (!appointmentId) {
                    setSnack({ open: true, msg: 'Missing appointment ID', sev: 'error' });
                    return;
                }
                try {
                    result = await savePrescription({ appointmentId, ...payload }).unwrap();
                    setSnack({ open: true, msg: 'Saved as draft', sev: 'success' });
                } catch (createErr) {
                    // 409 = prescription already exists → switch to update mode
                    const existingId = createErr?.data?.existing_prescription_id;
                    if (createErr?.status === 409 && existingId) {
                        result = await updatePrescription({ prescriptionId: existingId, ...payload }).unwrap();
                        setSnack({ open: true, msg: 'Prescription updated', sev: 'success' });
                    } else {
                        throw createErr;
                    }
                }
            }
            const newId = result?.data?.id || result?.id || prescriptionId;
            if (redirectToPreview && newId) {
                // Replace current history entry with the edit URL so pressing
                // browser-back from preview loads the saved prescription data
                // instead of remounting the empty "new" form.
                navigate(`${recordsPath}/prescriptions/${newId}/edit`, { replace: true });
                setTimeout(() => navigate(`${recordsPath}/prescriptions/${newId}/preview`), 100);
            } else {
                setTimeout(() => navigate(`${recordsPath}/prescriptions`), 1200);
            }
        } catch (err) {
            setSnack({ open: true, msg: err?.data?.message || 'Failed to save', sev: 'error' });
        }
    };

    // Resolve section label from admin template config
    const sectionLabel = (key, fallback) => {
        const sections = tpl?.sections_config || [];
        const found = sections.find(s => s.key === key);
        return found?.label || fallback;
    };

    if ((isEdit || isRevise) && loadingExisting) {
        return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
    }

    return (
        <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto' }}>
            {/* Header */}
            <Box display="flex" alignItems="center" gap={1} mb={3}>
                <IconButton onClick={() => navigate(`${recordsPath}/prescriptions`)}>
                    <ArrowBackIcon />
                </IconButton>
                <Typography variant="h5" fontWeight="bold">
                    {isRevise ? 'Revise Prescription' : isEdit ? 'Edit Prescription' : 'New Prescription'}
                </Typography>
            </Box>

            <Stack spacing={3}>
                {/* ══ Chief Complaint ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>
                        {sectionLabel('notes', 'Chief Complaint')}
                    </Typography>
                    <TextField
                        fullWidth multiline rows={2} value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Patient's chief complaint..."
                    />
                </Paper>

                {/* ══ Previous Medical History ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>
                        {sectionLabel('previous_medical_history', 'Previous Medical History')}
                    </Typography>
                    <TextField
                        fullWidth multiline rows={3} value={previousMedicalHistory}
                        onChange={(e) => setPreviousMedicalHistory(e.target.value)}
                        placeholder="Previous medical conditions, surgeries, treatments..."
                    />
                </Paper>

                {/* ══ Allergies ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>
                        {sectionLabel('allergies', 'Allergies')}
                    </Typography>
                    <TextField
                        fullWidth multiline rows={2} value={allergies}
                        onChange={(e) => setAllergies(e.target.value)}
                        placeholder="Drug allergies or other text..."
                    />
                </Paper>

                {/* ══ Provisional Diagnosis ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>
                        {sectionLabel('diagnosis', 'Provisional Diagnosis')}
                    </Typography>
                    <TextField
                        fullWidth multiline rows={2} value={diagnosis}
                        onChange={(e) => setDiagnosis(e.target.value)}
                        placeholder="Provisional diagnosis..."
                    />
                </Paper>

                {/* ══ Diagnostic / Lab Tests ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold">
                        {sectionLabel('diagnostic_tests', 'Diagnostic Tests')}
                    </Typography>
                    <TextField
                        fullWidth multiline rows={3} value={diagnosticTests}
                        onChange={(e) => setDiagnosticTests(e.target.value)}
                        placeholder={"1. Complete Blood Count\n2. CRP Test\n3. X-ray"}
                        sx={{ mt: 1 }}
                    />
                </Paper>

                {/* ══ Instructions ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold">
                        {sectionLabel('instructions', 'Instructions')}
                    </Typography>
                    <TextField
                        fullWidth multiline rows={2} value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        placeholder="General instructions for the patient..."
                        sx={{ mt: 1 }}
                    />
                </Paper>

                {/* ══════════════ Medicines ══════════════ */}
                <Paper sx={{ p: 3 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="h6" fontWeight="bold">Medicines</Typography>
                        <Button startIcon={<AddIcon />} variant="outlined" size="small" onClick={addMedicineRow}>
                            Add Medicine
                        </Button>
                    </Box>

                    {medicines.map((med, idx) => (
                        <Paper key={med.key} variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'grey.50' }}>
                            {/* Title + Delete */}
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1.5}>
                                <Typography variant="subtitle1" fontWeight="bold">#{idx + 1}</Typography>
                                {medicines.length > 1 && (
                                    <IconButton size="small" color="error" onClick={() => removeMedicineRow(idx)}>
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                )}
                            </Box>

                            <Stack spacing={2}>
                                {/* ── Row 1: Generic Name + Brand + Quantity + Unit ── */}
                                <Box display="flex" gap={2} flexWrap="wrap">
                                    <Autocomplete
                                        sx={{ flex: 2, minWidth: 250 }}
                                        freeSolo
                                        options={searchResults}
                                        getOptionLabel={(opt) =>
                                            typeof opt === 'string' ? opt : (opt.generic_name || opt.name || '')
                                        }
                                        inputValue={med._search || ''}
                                        onInputChange={(_, val, reason) => {
                                            updateMedicine(idx, '_search', val);
                                            if (reason === 'input') {
                                                setSearchTerm(val);
                                                updateMedicine(idx, 'custom_generic_name', val);
                                                updateMedicine(idx, 'medicine_id', null);
                                                updateMedicine(idx, '_selected', null);
                                            }
                                        }}
                                        onChange={(_, val) => {
                                            if (!val) {
                                                handleMedicineSelect(idx, null);
                                                return;
                                            }
                                            if (typeof val === 'string') {
                                                // freeSolo typed entry
                                                updateMedicine(idx, 'custom_generic_name', val);
                                                updateMedicine(idx, '_search', val);
                                            } else {
                                                // Selected from dropdown
                                                handleMedicineSelect(idx, val);
                                                updateMedicine(idx, '_search', val.generic_name || '');
                                                // Only fill brand if different from generic
                                                if (val.name && val.name.toLowerCase() !== (val.generic_name || '').toLowerCase()) {
                                                    updateMedicine(idx, 'custom_brand_name', val.name);
                                                }
                                            }
                                        }}
                                        renderInput={(params) => (
                                            <TextField {...params} label="Generic Name *" size="small"
                                                placeholder="Type to search medicines..." />
                                        )}
                                        renderOption={(props, option) => (
                                            <li {...props} key={option.id}>
                                                <Box>
                                                    <Typography variant="body2" fontWeight="bold">{option.generic_name}</Typography>
                                                    {option.name && option.name !== option.generic_name && (
                                                        <Typography variant="caption" color="text.secondary">{option.name}</Typography>
                                                    )}
                                                </Box>
                                            </li>
                                        )}
                                        isOptionEqualToValue={(opt, val) => opt.id === val?.id}
                                    />
                                    <TextField
                                        sx={{ flex: 1, minWidth: 150 }}
                                        label="Brand Name" size="small"
                                        value={med.custom_brand_name}
                                        onChange={(e) => updateMedicine(idx, 'custom_brand_name', e.target.value)}
                                    />
                                    <TextField
                                        sx={{ width: 90 }}
                                        label="Qty" size="small" type="number"
                                        value={med.quantity}
                                        onChange={(e) => updateMedicine(idx, 'quantity', e.target.value)}
                                    />
                                    <TextField
                                        sx={{ width: 100 }}
                                        label="Unit" size="small"
                                        value={med.quantity_unit}
                                        onChange={(e) => updateMedicine(idx, 'quantity_unit', e.target.value)}
                                        select
                                        SelectProps={{ native: true }}
                                    >
                                        <option value="Nos">Nos</option>
                                        <option value="ml">ml</option>
                                        <option value="Strips">Strips</option>
                                        <option value="Bottles">Bottles</option>
                                        <option value="Tubes">Tubes</option>
                                    </TextField>
                                </Box>

                                {/* ── Banned substance warning ── */}
                                <BannedWarning genericName={med.custom_generic_name} />

                                {/* ── Row 2: Medicine Type + Duration ── */}
                                <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
                                    <Box>
                                        <Typography variant="caption" fontWeight="bold" color="text.secondary" mb={0.5} display="block">
                                            Type
                                        </Typography>
                                        <ToggleButtonGroup
                                            exclusive size="small"
                                            value={med.medicine_type}
                                            onChange={(_, v) => {
                                                if (v) {
                                                    updateMedicine(idx, 'medicine_type', v);
                                                    // Reset M/A/E/N when switching type
                                                    updateMedicine(idx, 'morning', null);
                                                    updateMedicine(idx, 'afternoon', null);
                                                    updateMedicine(idx, 'evening', null);
                                                    updateMedicine(idx, 'night', null);
                                                }
                                            }}
                                        >
                                            <ToggleButton value="solid" sx={{ px: 2 }}>
                                                Solid (Tablet/Capsule)
                                            </ToggleButton>
                                            <ToggleButton value="liquid" sx={{ px: 2 }}>
                                                Liquid (Syrup/Drops)
                                            </ToggleButton>
                                            <ToggleButton value="powder" sx={{ px: 2 }}>
                                                Powder
                                            </ToggleButton>
                                            <ToggleButton value="other" sx={{ px: 2 }}>
                                                Other
                                            </ToggleButton>
                                        </ToggleButtonGroup>
                                    </Box>
                                    <TextField
                                        sx={{ width: 200 }}
                                        label="Duration" size="small"
                                        value={med.duration}
                                        onChange={(e) => updateMedicine(idx, 'duration', e.target.value)}
                                        placeholder="e.g. 5 days, 1 week"
                                    />
                                </Box>

                                {/* ── Row 3: M / A / E / N Dosage Schedule ── */}
                                <Box>
                                    <Typography variant="caption" fontWeight="bold" color="text.secondary" mb={1} display="block">
                                        Dosage Schedule — {med.medicine_type === 'liquid' ? 'Enter ml per dose' : med.medicine_type === 'solid' ? 'Select tablet fraction per dose' : med.medicine_type === 'powder' ? 'Enter grams per dose' : 'Enter value per dose'}
                                    </Typography>
                                    <Box display="flex" gap={1.5} flexWrap="wrap" alignItems="flex-start">
                                        {SLOT_LABELS.map((slot) => (
                                            <DoseSlot
                                                key={slot.key}
                                                label={slot.label}
                                                short={slot.short}
                                                type={med.medicine_type}
                                                doseValue={med[slot.key]}
                                                timingValue={med[slot.timingKey]}
                                                onDoseChange={(v) => updateMedicine(idx, slot.key, v)}
                                                onTimingChange={(v) => updateMedicine(idx, slot.timingKey, v)}
                                                instructionValue={med[`${slot.key}_instructions`]}
                                                onInstructionChange={(v) => updateMedicine(idx, `${slot.key}_instructions`, v)}
                                            />
                                        ))}
                                    </Box>

                                    {/* Dose Unit field for "other" type */}
                                    {med.medicine_type === 'other' && (
                                        <TextField
                                            size="small" label="Dose Unit"
                                            value={med.custom_dose_unit}
                                            onChange={(e) => updateMedicine(idx, 'custom_dose_unit', e.target.value)}
                                            placeholder="e.g. drops, puffs, patches, units"
                                            sx={{ mt: 1, width: 250 }}
                                        />
                                    )}
                                </Box>

                                {/* ── Summary chips ── */}
                                {(med.morning || med.afternoon || med.evening || med.night) && (
                                    <Box display="flex" gap={0.5} flexWrap="wrap" alignItems="center">
                                        <Typography variant="caption" color="text.secondary" fontWeight="bold">Schedule:</Typography>
                                        {med.morning && (
                                            <Chip size="small" color="info" variant="outlined"
                                                label={`M: ${med.morning}${med.medicine_type === 'liquid' ? ' ml' : med.medicine_type === 'powder' ? ' g' : med.medicine_type === 'other' ? ` ${med.custom_dose_unit || ''}` : ''} — ${med.morning_timing || 'after food'}${med.morning_instructions ? ` (${med.morning_instructions})` : ''}`}
                                            />
                                        )}
                                        {med.afternoon && (
                                            <Chip size="small" color="info" variant="outlined"
                                                label={`A: ${med.afternoon}${med.medicine_type === 'liquid' ? ' ml' : med.medicine_type === 'powder' ? ' g' : med.medicine_type === 'other' ? ` ${med.custom_dose_unit || ''}` : ''} — ${med.afternoon_timing || 'after food'}${med.afternoon_instructions ? ` (${med.afternoon_instructions})` : ''}`}
                                            />
                                        )}
                                        {med.evening && (
                                            <Chip size="small" color="info" variant="outlined"
                                                label={`E: ${med.evening}${med.medicine_type === 'liquid' ? ' ml' : med.medicine_type === 'powder' ? ' g' : med.medicine_type === 'other' ? ` ${med.custom_dose_unit || ''}` : ''} — ${med.evening_timing || 'after food'}${med.evening_instructions ? ` (${med.evening_instructions})` : ''}`}
                                            />
                                        )}
                                        {med.night && (
                                            <Chip size="small" color="info" variant="outlined"
                                                label={`N: ${med.night}${med.medicine_type === 'liquid' ? ' ml' : med.medicine_type === 'powder' ? ' g' : med.medicine_type === 'other' ? ` ${med.custom_dose_unit || ''}` : ''} — ${med.night_timing || 'after food'}${med.night_instructions ? ` (${med.night_instructions})` : ''}`}
                                            />
                                        )}
                                        {med.duration && <Chip size="small" variant="outlined" label={`Duration: ${med.duration}`} />}
                                    </Box>
                                )}
                            </Stack>
                        </Paper>
                    ))}
                </Paper>

                {/* ══ Doctor's Advice ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold">
                        {sectionLabel('doctors_advice', "Doctor's Advice")}
                    </Typography>
                    <TextField
                        fullWidth multiline rows={2} value={doctorsAdvice}
                        onChange={(e) => setDoctorsAdvice(e.target.value)}
                        placeholder="Advice for the patient..."
                        sx={{ mt: 1 }}
                    />
                </Paper>

                {/* ══ Follow-up ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold">Follow-up / Next Appointment</Typography>
                    <TextField
                        fullWidth multiline rows={2} value={followUp}
                        onChange={(e) => setFollowUp(e.target.value)}
                        placeholder="Follow-up instructions or date..."
                        sx={{ mt: 1 }}
                    />

                    {/* Follow-Up Scheduling Summary Box */}
                    {followUpData && (
                        <Alert severity="success" variant="outlined" sx={{ mt: 2 }}
                            action={
                                <Button size="small" color="inherit" onClick={() => setFollowUpDialogOpen(true)}>
                                    Edit
                                </Button>
                            }
                        >
                            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                                {followUpData._display?.type_label || 'Follow-Up Scheduled'}
                            </Typography>
                            <Typography variant="body2">
                                {followUpData._display?.consultation_type && (
                                    <>Consultation: <strong>{followUpData._display.consultation_type}</strong><br /></>
                                )}
                                {followUpData._display?.date && (
                                    <>Date: <strong>{new Date(followUpData._display.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</strong><br /></>
                                )}
                                {followUpData._display?.slot_time && (
                                    <>Time: <strong>{followUpData._display.slot_time}</strong><br /></>
                                )}
                                {followUpData._display?.mode_label && (
                                    <Chip label={followUpData._display.mode_label} size="small" variant="outlined" sx={{ mt: 0.5 }} />
                                )}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                This will be included in the prescription and activated after admin approval.
                            </Typography>
                        </Alert>
                    )}

                    <Button
                        variant="outlined" color="warning" startIcon={<EventIcon />}
                        onClick={() => setFollowUpDialogOpen(true)}
                        sx={{ mt: 2 }}
                    >
                        {followUpData ? 'Change Follow-Up' : 'Schedule Follow-Up Appointment'}
                    </Button>
                </Paper>

                {/* Follow-Up Scheduling Dialog */}
                <FollowUpDialog
                    open={followUpDialogOpen}
                    onClose={() => setFollowUpDialogOpen(false)}
                    onConfirm={(data) => setFollowUpData(data)}
                    initialData={followUpData}
                />

                {/* ══ Action Buttons ══ */}
                <Box display="flex" gap={2} justifyContent="flex-end" pb={4}>
                    <Button variant="outlined" onClick={() => navigate(`${recordsPath}/prescriptions`)}>
                        Cancel
                    </Button>
                    <Button
                        variant="contained" color="inherit" startIcon={<SaveIcon />}
                        onClick={() => handleSave('draft')}
                        disabled={saving || updating || revising}
                    >
                        {saving || updating || revising ? 'Saving...' : 'Save as Draft'}
                    </Button>
                    <Button
                        variant="contained" color="info" startIcon={<PreviewIcon />}
                        onClick={() => handleSave('draft', { redirectToPreview: true })}
                        disabled={saving || updating || revising}
                    >
                        {saving || updating || revising ? 'Saving...' : 'Preview & Submit'}
                    </Button>
                </Box>
            </Stack>

            <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({ ...snack, open: false })}>
                <Alert severity={snack.sev} onClose={() => setSnack({ ...snack, open: false })}>{snack.msg}</Alert>
            </Snackbar>
        </Box>
    );
};

export default PrescriptionFormPage;
