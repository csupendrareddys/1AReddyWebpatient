import React, { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import {
    Box, Grid, TextField, Typography, Chip, Autocomplete, IconButton,
    Paper, Tooltip, Stack, Divider,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import CloseIcon from '@mui/icons-material/Close';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import usePatientProfilePageConfig from '../hooks/usePatientProfilePageConfig';
import {
    useGetVitalsQuery,
    useUpdateVitalsMutation,
    useGetAllergyMasterListQuery,
} from '../api/scopedPatientApi';

const getVitalStatus = (key, value) => {
    const num = parseFloat(value);
    if (isNaN(num)) return null;

    switch (key) {
        case 'blood_pressure_systolic':
            if (num > 140) return { color: 'error', label: 'High' };
            if (num < 90) return { color: 'warning', label: 'Low' };
            return { color: 'success', label: 'Normal' };
        case 'blood_pressure_diastolic':
            if (num > 90) return { color: 'error', label: 'High' };
            if (num < 60) return { color: 'warning', label: 'Low' };
            return { color: 'success', label: 'Normal' };
        case 'heart_rate':
            if (num > 100) return { color: 'error', label: 'High' };
            if (num < 60) return { color: 'warning', label: 'Low' };
            return { color: 'success', label: 'Normal' };
        case 'spo2':
            if (num < 95) return { color: 'error', label: 'Low' };
            return { color: 'success', label: 'Normal' };
        case 'temperature':
            if (num > 99.5) return { color: 'error', label: 'Fever' };
            if (num < 97) return { color: 'warning', label: 'Low' };
            return { color: 'success', label: 'Normal' };
        case 'bmi': {
            if (num >= 30) return { color: 'error', label: 'Obese' };
            if (num >= 25) return { color: 'warning', label: 'Overweight' };
            if (num < 18.5) return { color: 'warning', label: 'Underweight' };
            return { color: 'success', label: 'Normal' };
        }
        default:
            return null;
    }
};

/**
 * Each allergy entry:
 * { name: string, remarks: string, attachments: [ { name, url?, file? } ] }
 *
 * When saved to backend (vitals JSON), attachments are stored as
 * { name: fileName } references. File upload can be added later via
 * a dedicated endpoint; for now we store file names.
 */
const EMPTY_ALLERGY = { name: '', remarks: '', attachments: [] };

/**
 * Controlled allergy search/add input.
 * Uses a single controlled inputValue to prevent double-add on Enter.
 */
const AllergySearchInput = React.memo(({ options, selectedNames, onAdd }) => {
    const [inputValue, setInputValue] = useState('');

    const filtered = useMemo(
        () => options.filter((n) => !selectedNames.has(n.toLowerCase())),
        [options, selectedNames],
    );

    const doAdd = (name) => {
        if (name?.trim()) {
            onAdd(name.trim());
            setInputValue('');
        }
    };

    return (
        <Autocomplete
            freeSolo
            options={filtered}
            inputValue={inputValue}
            onInputChange={(_, val, reason) => {
                if (reason !== 'reset') setInputValue(val);
            }}
            onChange={(_, val, reason) => {
                if (reason === 'selectOption' && val) {
                    doAdd(typeof val === 'string' ? val : val);
                }
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && inputValue.trim()) {
                    e.preventDefault();
                    e.stopPropagation();
                    doAdd(inputValue);
                }
            }}
            renderInput={(params) => (
                <TextField
                    {...params}
                    label="Search or add allergy"
                    placeholder="Type allergy name and press Enter..."
                    size="small"
                    sx={{ mb: 2, maxWidth: 500 }}
                />
            )}
            clearOnBlur={false}
            selectOnFocus
        />
    );
});

const VitalsSection = ({ configOverride }) => {
    const cfg = usePatientProfilePageConfig('en', 'patient', configOverride);
    // Under React-18 StrictMode the RTK-Query subscription can wedge in
    // ``isLoading: true`` with the resolved data never delivered to this
    // component even though the GET 200s — a known subscription race in this
    // codebase (cf. ``useSettledOrTimeout``, ``PatientLayout``). Keep the
    // subscription (so a save's tag invalidation still refetches while the tab
    // is open), but also prime the form from an imperative ``refetch().unwrap()``
    // on mount: its promise resolves with the data directly, bypassing the
    // possibly-stuck subscription selector, so vitals reliably populate on load.
    const { data: subscribedVitals, refetch: refetchVitals } = useGetVitalsQuery();
    const [primedVitals, setPrimedVitals] = useState(null);
    useEffect(() => {
        let alive = true;
        refetchVitals().unwrap().then((res) => { if (alive) setPrimedVitals(res); }).catch(() => {});
        return () => { alive = false; };
    }, [refetchVitals]);
    const vitalsData = subscribedVitals || primedVitals;
    const [updateVitals, { isLoading: isSaving }] = useUpdateVitalsMutation();

    // Fetch admin-managed allergy master list for autocomplete options
    const { data: allergyOptions = [] } = useGetAllergyMasterListQuery();

    const [formData, setFormData] = useState({
        height_cm: '',
        weight_kg: '',
        bmi: '',
        blood_pressure_systolic: '',
        blood_pressure_diastolic: '',
        heart_rate: '',
        spo2: '',
        temperature: '',
        blood_sugar_fasting: '',
        blood_sugar_pp: '',
    });

    // Allergies are kept as a separate array of objects
    const [allergies, setAllergies] = useState([]); // [{ name, remarks, attachments }]

    useEffect(() => {
        if (vitalsData) {
            const vitals = vitalsData?.vitals || vitalsData?.data?.vitals || vitalsData?.data || vitalsData;
            if (vitals && typeof vitals === 'object') {
                setFormData((prev) => ({
                    ...prev,
                    height_cm: vitals.height_cm ?? '',
                    weight_kg: vitals.weight_kg ?? '',
                    bmi: vitals.bmi ?? '',
                    blood_pressure_systolic: vitals.blood_pressure_systolic ?? '',
                    blood_pressure_diastolic: vitals.blood_pressure_diastolic ?? '',
                    heart_rate: vitals.heart_rate ?? '',
                    spo2: vitals.spo2 ?? '',
                    temperature: vitals.temperature ?? '',
                    blood_sugar_fasting: vitals.blood_sugar_fasting ?? '',
                    blood_sugar_pp: vitals.blood_sugar_pp ?? '',
                }));
                // Load allergies — handle both old format (string[]) and new format (object[])
                if (Array.isArray(vitals.allergies)) {
                    setAllergies(
                        vitals.allergies.map((a) =>
                            typeof a === 'string'
                                ? { name: a, remarks: '', attachments: [] }
                                : { name: a.name || '', remarks: a.remarks || '', attachments: a.attachments || [] }
                        ),
                    );
                }
            }
        }
    }, [vitalsData]);

    // Auto-calculate BMI
    useEffect(() => {
        const h = parseFloat(formData.height_cm);
        const w = parseFloat(formData.weight_kg);
        if (h > 0 && w > 0) {
            const bmi = (w / Math.pow(h / 100, 2)).toFixed(1);
            setFormData((prev) => ({ ...prev, bmi }));
        } else {
            setFormData((prev) => ({ ...prev, bmi: '' }));
        }
    }, [formData.height_cm, formData.weight_kg]);

    const handleChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    }, []);

    // ── Allergy handlers ──
    const handleAddAllergy = useCallback((allergyName) => {
        if (!allergyName?.trim()) return;
        // Prevent duplicates
        if (allergies.some((a) => a.name.toLowerCase() === allergyName.trim().toLowerCase())) return;
        setAllergies((prev) => [...prev, { name: allergyName.trim(), remarks: '', attachments: [] }]);
    }, [allergies]);

    const handleRemoveAllergy = useCallback((idx) => {
        setAllergies((prev) => prev.filter((_, i) => i !== idx));
    }, []);

    const handleAllergyRemarks = useCallback((idx, remarks) => {
        setAllergies((prev) => prev.map((a, i) => (i === idx ? { ...a, remarks } : a)));
    }, []);

    const handleAllergyAttachment = useCallback((idx, files) => {
        if (!files?.length) return;
        setAllergies((prev) =>
            prev.map((a, i) =>
                i === idx
                    ? {
                          ...a,
                          attachments: [
                              ...a.attachments,
                              ...Array.from(files).map((f) => ({ name: f.name, file: f })),
                          ],
                      }
                    : a,
            ),
        );
    }, []);

    const handleRemoveAttachment = useCallback((allergyIdx, attIdx) => {
        setAllergies((prev) =>
            prev.map((a, i) =>
                i === allergyIdx
                    ? { ...a, attachments: a.attachments.filter((_, j) => j !== attIdx) }
                    : a,
            ),
        );
    }, []);

    const handleSaveVitals = useCallback(async () => {
        try {
            // Serialize allergies — strip File objects, keep name + remarks
            const serializedAllergies = allergies.map((a) => ({
                name: a.name,
                remarks: a.remarks,
                attachments: a.attachments.map((att) => ({ name: att.name, url: att.url || null })),
            }));
            await updateVitals({ ...formData, allergies: serializedAllergies }).unwrap();
        } catch (err) {
            console.error('Failed to save vitals:', err);
        }
    }, [formData, allergies, updateVitals]);

    // Build allergy option strings from admin list
    const allergyOptionNames = useMemo(
        () => allergyOptions.map((a) => a.name),
        [allergyOptions],
    );

    // Already-selected names for filtering out of autocomplete
    const selectedAllergyNames = useMemo(
        () => new Set(allergies.map((a) => a.name.toLowerCase())),
        [allergies],
    );

    const renderVitalField = (fieldKey, defaultLabel, extraProps = {}) => {
        if (!cfg.isFieldVisible(fieldKey)) return null;

        const status = getVitalStatus(fieldKey, formData[fieldKey]);

        return (
            <Grid item xs={12} sm={6} md={4} key={fieldKey}>
                <Box sx={{ position: 'relative' }}>
                    <TextField
                        fullWidth
                        label={cfg.getFieldLabel(fieldKey, defaultLabel)}
                        name={fieldKey}
                        value={formData[fieldKey]}
                        onChange={handleChange}
                        required={cfg.isFieldRequired(fieldKey)}
                        type="number"
                        size="small"
                        {...extraProps}
                    />
                    {status && formData[fieldKey] && (
                        <Chip
                            label={status.label}
                            color={status.color}
                            size="small"
                            sx={{
                                position: 'absolute',
                                right: 8,
                                top: -10,
                                height: 20,
                                fontSize: '0.7rem',
                            }}
                        />
                    )}
                </Box>
            </Grid>
        );
    };

    if (!cfg.isSectionVisible('vitals')) return null;

    return (
        <Box>
            {/* ── Vitals Fields ── */}
            <Grid container spacing={2}>
                {renderVitalField('height_cm', 'Height (cm)')}
                {renderVitalField('weight_kg', 'Weight (kg)')}
                {renderVitalField('bmi', 'BMI', { InputProps: { readOnly: true } })}
                {renderVitalField('blood_pressure_systolic', 'BP Systolic (mmHg)')}
                {renderVitalField('blood_pressure_diastolic', 'BP Diastolic (mmHg)')}
                {renderVitalField('heart_rate', 'Heart Rate (bpm)')}
                {renderVitalField('spo2', 'SpO2 (%)')}
                {renderVitalField('temperature', 'Temperature (\u00b0F)')}
                {renderVitalField('blood_sugar_fasting', 'Blood Sugar - Fasting (mg/dL)')}
                {renderVitalField('blood_sugar_pp', 'Blood Sugar - PP (mg/dL)')}
            </Grid>

            {/* ── Allergies Section ── */}
            <Divider sx={{ my: 3 }} />
            <Typography variant="h6" fontWeight="bold" mb={2}>Allergies</Typography>

            {/* Add allergy autocomplete */}
            <AllergySearchInput
                options={allergyOptionNames}
                selectedNames={selectedAllergyNames}
                onAdd={handleAddAllergy}
            />

            {/* Allergy list — vertical, one per row */}
            <Stack spacing={1.5}>
                {allergies.map((allergy, idx) => (
                    <AllergyRow
                        key={`${allergy.name}-${idx}`}
                        allergy={allergy}
                        onRemarks={(val) => handleAllergyRemarks(idx, val)}
                        onAttach={(files) => handleAllergyAttachment(idx, files)}
                        onRemoveAttachment={(attIdx) => handleRemoveAttachment(idx, attIdx)}
                        onRemove={() => handleRemoveAllergy(idx)}
                    />
                ))}
                {!allergies.length && (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', ml: 1 }}>
                        No allergies added yet.
                    </Typography>
                )}
            </Stack>

            {/* ── Save Button ── */}
            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                    onClick={handleSaveVitals}
                    disabled={isSaving}
                    style={{
                        padding: '8px 24px',
                        backgroundColor: '#1976d2',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: isSaving ? 'not-allowed' : 'pointer',
                        opacity: isSaving ? 0.7 : 1,
                    }}
                >
                    {isSaving ? 'Saving...' : 'Save Vitals'}
                </button>
            </Box>
        </Box>
    );
};

// ═══════════════════════════════════════════════════════════════════════
//  Individual Allergy Row
// ═══════════════════════════════════════════════════════════════════════
const AllergyRow = React.memo(({ allergy, onRemarks, onAttach, onRemoveAttachment, onRemove }) => {
    const [showRemarks, setShowRemarks] = useState(!!allergy.remarks);
    const fileRef = useRef(null);

    return (
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" gap={1}>
                {/* Allergy name chip */}
                <Chip
                    label={allergy.name}
                    color="warning"
                    variant="outlined"
                    sx={{ fontWeight: 600, fontSize: '0.9rem' }}
                />

                {/* Spacer */}
                <Box flex={1} />

                {/* Add remarks toggle */}
                <Tooltip title={showRemarks ? 'Hide remarks' : 'Add remarks'}>
                    <IconButton size="small" onClick={() => setShowRemarks((v) => !v)} color={showRemarks ? 'primary' : 'default'}>
                        <NoteAddIcon fontSize="small" />
                    </IconButton>
                </Tooltip>

                {/* Attach file */}
                <Tooltip title="Attach file">
                    <IconButton size="small" onClick={() => fileRef.current?.click()}>
                        <AttachFileIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <input
                    ref={fileRef} type="file" hidden multiple
                    accept="image/*,.pdf,.doc,.docx"
                    onChange={(e) => { onAttach(e.target.files); e.target.value = ''; }}
                />

                {/* Remove allergy */}
                <Tooltip title="Remove allergy">
                    <IconButton size="small" color="error" onClick={onRemove}>
                        <DeleteIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Box>

            {/* Remarks field */}
            {showRemarks && (
                <TextField
                    fullWidth size="small" multiline rows={2}
                    label="Remarks"
                    placeholder="Describe severity, reactions, etc."
                    value={allergy.remarks}
                    onChange={(e) => onRemarks(e.target.value)}
                    sx={{ mt: 1 }}
                />
            )}

            {/* Attachments */}
            {allergy.attachments.length > 0 && (
                <Box display="flex" gap={1} flexWrap="wrap" mt={1}>
                    {allergy.attachments.map((att, attIdx) => (
                        <Chip
                            key={attIdx}
                            icon={<InsertDriveFileIcon />}
                            label={att.name}
                            size="small"
                            variant="outlined"
                            onDelete={() => onRemoveAttachment(attIdx)}
                            deleteIcon={<CloseIcon />}
                        />
                    ))}
                </Box>
            )}
        </Paper>
    );
});

export default React.memo(VitalsSection);
