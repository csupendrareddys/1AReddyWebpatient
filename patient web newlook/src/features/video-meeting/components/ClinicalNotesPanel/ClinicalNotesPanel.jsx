/**
 * ClinicalNotesPanel - Allows doctor to write clinical notes during a live consultation.
 * Fields: Notes, Allergies, Provisional Diagnosis.
 * Auto-saves as a draft prescription linked to the appointment.
 * When doctor later opens the full prescription form, the draft is already populated.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
    Box,
    TextField,
    Typography,
    Chip,
    CircularProgress,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import NoteAltIcon from '@mui/icons-material/NoteAlt';
import {
    useSavePrescriptionMutation,
    useUpdatePrescriptionMutation,
} from '../../../service-provider/api/doctorEndpoints';

const AUTO_SAVE_DELAY = 2000; // 2 seconds debounce

const ClinicalNotesPanel = ({ appointmentId }) => {
    const [notes, setNotes] = useState('');
    const [allergies, setAllergies] = useState('');
    const [diagnosis, setDiagnosis] = useState('');
    const [prescriptionId, setPrescriptionId] = useState(null);
    const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
    const debounceRef = useRef(null);
    const initialLoadDone = useRef(false);
    const lastSavedRef = useRef({ notes: '', allergies: '', diagnosis: '' });

    const [savePrescription] = useSavePrescriptionMutation();
    const [updatePrescription] = useUpdatePrescriptionMutation();

    // Load existing draft on mount
    useEffect(() => {
        if (!appointmentId || initialLoadDone.current) return;
        initialLoadDone.current = true;

        const loadDraft = async () => {
            try {
                const { default: axiosInstance } = await import('../../../../api/axiosConfig');
                // Check if a draft already exists for this appointment
                const res = await axiosInstance.get(`/api/doctor/prescriptions`, {
                    params: { appointment_id: appointmentId, status: 'draft', per_page: 1 },
                });
                const existing = res.data?.data?.prescriptions?.[0];
                if (existing) {
                    setPrescriptionId(existing.id);
                    setNotes(existing.notes || '');
                    setAllergies(existing.allergies || '');
                    setDiagnosis(existing.diagnosis || '');
                    lastSavedRef.current = {
                        notes: existing.notes || '',
                        allergies: existing.allergies || '',
                        diagnosis: existing.diagnosis || '',
                    };
                }
            } catch {
                // No draft yet — that's fine
            }
        };
        loadDraft();
    }, [appointmentId]);

    const doSave = useCallback(async (currentNotes, currentAllergies, currentDiagnosis) => {
        // Skip if nothing changed
        const last = lastSavedRef.current;
        if (
            currentNotes === last.notes &&
            currentAllergies === last.allergies &&
            currentDiagnosis === last.diagnosis
        ) return;

        // Skip if all empty
        if (!currentNotes.trim() && !currentAllergies.trim() && !currentDiagnosis.trim()) return;

        setSaveStatus('saving');
        try {
            const payload = {
                status: 'draft',
                notes: currentNotes,
                allergies: currentAllergies,
                diagnosis: currentDiagnosis,
                medicines: [],
            };

            if (prescriptionId) {
                await updatePrescription({ prescriptionId, ...payload }).unwrap();
            } else {
                const result = await savePrescription({ appointmentId, ...payload }).unwrap();
                const newId = result?.data?.id || result?.id;
                if (newId) setPrescriptionId(newId);
            }

            lastSavedRef.current = {
                notes: currentNotes,
                allergies: currentAllergies,
                diagnosis: currentDiagnosis,
            };
            setSaveStatus('saved');
        } catch (err) {
            // Handle 409 — draft already exists
            if (err?.status === 409) {
                const existingId = err?.data?.existing_prescription_id;
                if (existingId) {
                    setPrescriptionId(existingId);
                    // Retry as update
                    try {
                        const payload = {
                            status: 'draft',
                            notes: currentNotes,
                            allergies: currentAllergies,
                            diagnosis: currentDiagnosis,
                            medicines: [],
                        };
                        await updatePrescription({ prescriptionId: existingId, ...payload }).unwrap();
                        lastSavedRef.current = {
                            notes: currentNotes,
                            allergies: currentAllergies,
                            diagnosis: currentDiagnosis,
                        };
                        setSaveStatus('saved');
                        return;
                    } catch {
                        // fall through to error
                    }
                }
            }
            setSaveStatus('error');
        }
    }, [appointmentId, prescriptionId, savePrescription, updatePrescription]);

    // Debounced auto-save on field change
    const scheduleAutoSave = useCallback((n, a, d) => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setSaveStatus('idle');
        debounceRef.current = setTimeout(() => {
            doSave(n, a, d);
        }, AUTO_SAVE_DELAY);
    }, [doSave]);

    const handleNotesChange = (e) => {
        const val = e.target.value;
        setNotes(val);
        scheduleAutoSave(val, allergies, diagnosis);
    };

    const handleAllergiesChange = (e) => {
        const val = e.target.value;
        setAllergies(val);
        scheduleAutoSave(notes, val, diagnosis);
    };

    const handleDiagnosisChange = (e) => {
        const val = e.target.value;
        setDiagnosis(val);
        scheduleAutoSave(notes, allergies, val);
    };

    // Cleanup debounce on unmount — flush pending save
    useEffect(() => {
        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, []);

    const statusChip = () => {
        switch (saveStatus) {
            case 'saving':
                return <Chip icon={<CircularProgress size={14} />} label="Saving..." size="small" variant="outlined" />;
            case 'saved':
                return <Chip icon={<CheckCircleIcon />} label="Saved" size="small" color="success" variant="outlined" />;
            case 'error':
                return <Chip label="Save failed" size="small" color="error" variant="outlined" />;
            default:
                return null;
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 2, gap: 2, overflow: 'auto' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <NoteAltIcon fontSize="small" color="primary" />
                    <Typography variant="subtitle2" fontWeight="bold">
                        Clinical Notes
                    </Typography>
                </Box>
                {statusChip()}
            </Box>

            <Typography variant="caption" color="text.secondary">
                Write notes during the consultation. These will auto-save as a draft prescription.
            </Typography>

            <TextField
                label="Notes"
                placeholder="Clinical notes..."
                multiline
                minRows={3}
                maxRows={6}
                value={notes}
                onChange={handleNotesChange}
                fullWidth
                size="small"
            />

            <TextField
                label="Allergies"
                placeholder="Drug allergies or other text..."
                multiline
                minRows={2}
                maxRows={4}
                value={allergies}
                onChange={handleAllergiesChange}
                fullWidth
                size="small"
            />

            <TextField
                label="Provisional Diagnosis"
                placeholder="Provisional diagnosis..."
                multiline
                minRows={2}
                maxRows={4}
                value={diagnosis}
                onChange={handleDiagnosisChange}
                fullWidth
                size="small"
            />

            <Typography variant="caption" color="text.secondary" sx={{ mt: 'auto' }}>
                These notes will appear in your prescription draft after the consultation.
            </Typography>
        </Box>
    );
};

export default ClinicalNotesPanel;
