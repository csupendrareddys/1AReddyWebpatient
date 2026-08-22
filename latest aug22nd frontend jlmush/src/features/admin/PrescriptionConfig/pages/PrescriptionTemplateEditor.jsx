/**
 * PrescriptionTemplateEditor — Admin page to configure the prescription PDF layout.
 */
import { useState, useEffect, useRef } from 'react';
import {
    Box, Typography, Paper, TextField, Button, Switch, FormControlLabel,
    Snackbar, Alert, CircularProgress, Stack, IconButton, Chip,
    ToggleButton, ToggleButtonGroup, Tooltip, Divider,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import DescriptionIcon from '@mui/icons-material/Description';
import UploadIcon from '@mui/icons-material/Upload';
import DeleteIcon from '@mui/icons-material/Delete';
import ImageIcon from '@mui/icons-material/Image';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import {
    useGetPrescriptionTemplateQuery,
    useUpdatePrescriptionTemplateMutation,
    useUploadRxSymbolMutation,
} from '../../api/prescriptionConfigEndpoints';

const PrescriptionTemplateEditor = () => {
    const { data: tpl, isLoading } = useGetPrescriptionTemplateQuery();
    const [updateTemplate, { isLoading: saving }] = useUpdatePrescriptionTemplateMutation();
    const [uploadRxSymbol, { isLoading: uploadingRx }] = useUploadRxSymbolMutation();

    const [form, setForm] = useState({});
    const [snack, setSnack] = useState({ open: false, msg: '', sev: 'success' });

    // Rx symbol mode: 'image' or 'text'
    const [rxMode, setRxMode] = useState('image');
    const rxFileRef = useRef();

    useEffect(() => {
        if (tpl) {
            setForm({ ...tpl });
            // Determine initial mode based on saved data
            if (tpl.rx_symbol_text && !tpl.rx_symbol_url) {
                setRxMode('text');
            } else {
                setRxMode('image');
            }
        }
    }, [tpl]);

    const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

    // Sections config helpers
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

    const getSections = () => {
        const saved = form.sections_config || [];
        const savedKeys = saved.map(s => s.key);
        const missing = DEFAULT_SECTIONS.filter(d => !savedKeys.includes(d.key));
        return [...saved, ...missing].sort((a, b) => a.order - b.order);
    };

    const updateSection = (key, field, value) => {
        const sections = getSections().map(s =>
            s.key === key ? { ...s, [field]: value } : s
        );
        set('sections_config', sections);
    };

    // ── Rx Symbol upload handler ──────────────────────────────────
    const handleRxFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const res = await uploadRxSymbol(file).unwrap();
            set('rx_symbol_url', res.data?.rx_symbol_url || res.rx_symbol_url);
            set('rx_symbol_text', null);
            setSnack({ open: true, msg: 'Rx symbol uploaded!', sev: 'success' });
        } catch (err) {
            setSnack({ open: true, msg: err?.data?.message || 'Upload failed', sev: 'error' });
        }
        // reset file input so same file can be re-selected
        e.target.value = '';
    };

    const handleRxModeChange = (_, newMode) => {
        if (!newMode) return;
        setRxMode(newMode);
        if (newMode === 'image') {
            set('rx_symbol_text', null);
        } else {
            set('rx_symbol_url', null);
        }
    };

    const handleSave = async () => {
        try {
            await updateTemplate(form).unwrap();
            setSnack({ open: true, msg: 'Template saved!', sev: 'success' });
        } catch (err) {
            setSnack({ open: true, msg: err?.data?.message || 'Failed to save', sev: 'error' });
        }
    };

    if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;

    return (
        <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
            <Box display="flex" alignItems="center" gap={1} mb={3}>
                <DescriptionIcon fontSize="large" color="primary" />
                <Box>
                    <Typography variant="h4" fontWeight="bold">Prescription / Document PDF Editor</Typography>
                    <Typography variant="body2" color="text.secondary">
                        One letterhead for both. Everything here applies to prescription
                        PDFs and to doctor document PDFs; only the disclaimer differs
                        between them (see Footer &amp; Disclaimer).
                    </Typography>
                </Box>
            </Box>

            <Stack spacing={3}>
                {/* ══ Header Settings ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>Header Settings</Typography>
                    <Stack spacing={2}>
                        <TextField label="Clinic Name" fullWidth size="small"
                            value={form.clinic_name || ''} onChange={(e) => set('clinic_name', e.target.value)} />
                        <TextField label="Clinic Logo URL" fullWidth size="small"
                            value={form.clinic_logo_url || ''} onChange={(e) => set('clinic_logo_url', e.target.value)}
                            helperText="Enter logo URL or upload via template upload" />
                        <TextField label="Header Subtitle (under logo)" fullWidth size="small" multiline rows={2}
                            value={form.header_subtitle || ''} onChange={(e) => set('header_subtitle', e.target.value)} />
                        <FormControlLabel control={<Switch checked={form.show_doctor_name !== false} onChange={(e) => set('show_doctor_name', e.target.checked)} />}
                            label="Show Doctor Name" />
                        <FormControlLabel control={<Switch checked={form.show_doctor_qualification !== false} onChange={(e) => set('show_doctor_qualification', e.target.checked)} />}
                            label="Show Doctor Qualification" />
                        <FormControlLabel control={<Switch checked={form.show_doctor_specialization !== false} onChange={(e) => set('show_doctor_specialization', e.target.checked)} />}
                            label="Show Doctor Specialization" />
                        <FormControlLabel control={<Switch checked={form.show_registration_number !== false} onChange={(e) => set('show_registration_number', e.target.checked)} />}
                            label="Show Registration Number" />
                    </Stack>
                </Paper>

                {/* ══ Patient Info Settings ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>Patient Info Section</Typography>
                    <Stack spacing={1}>
                        <FormControlLabel control={<Switch checked={form.show_patient_name !== false} onChange={(e) => set('show_patient_name', e.target.checked)} />}
                            label="Show Patient Name" />
                        <FormControlLabel control={<Switch checked={form.show_patient_age_gender !== false} onChange={(e) => set('show_patient_age_gender', e.target.checked)} />}
                            label="Show Age & Gender" />
                        <FormControlLabel control={<Switch checked={form.show_patient_id !== false} onChange={(e) => set('show_patient_id', e.target.checked)} />}
                            label="Show Patient ID" />
                        <FormControlLabel control={<Switch checked={form.show_prescription_id !== false} onChange={(e) => set('show_prescription_id', e.target.checked)} />}
                            label="Show Prescription ID" />
                        <FormControlLabel control={<Switch checked={form.show_prescription_date !== false} onChange={(e) => set('show_prescription_date', e.target.checked)} />}
                            label="Show Prescription Date" />
                    </Stack>
                </Paper>

                {/* ══ Body Sections — Label & Visibility Control ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>
                        Prescription Sections
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Edit the heading label shown to doctors and patients for each section. Toggle visibility to show/hide a section.
                    </Typography>
                    <Stack spacing={2}>
                        {getSections().map((sec) => (
                            <Box key={sec.key} sx={{
                                display: 'flex', alignItems: 'center', gap: 2,
                                p: 1.5, bgcolor: sec.visible ? '#f1f8e9' : '#fafafa',
                                borderRadius: 1, border: '1px solid #e0e0e0',
                            }}>
                                <Switch
                                    checked={sec.visible !== false}
                                    onChange={(e) => updateSection(sec.key, 'visible', e.target.checked)}
                                    color="success"
                                    size="small"
                                />
                                <TextField
                                    size="small"
                                    label="Section Heading"
                                    value={sec.label}
                                    onChange={(e) => updateSection(sec.key, 'label', e.target.value)}
                                    sx={{ flex: 1 }}
                                    disabled={sec.visible === false}
                                />
                                <Chip
                                    label={sec.key}
                                    size="small"
                                    variant="outlined"
                                    color="default"
                                    sx={{ fontSize: '0.65rem', opacity: 0.6, minWidth: 120 }}
                                />
                            </Box>
                        ))}
                    </Stack>
                </Paper>

                {/* ══ Rx Symbol ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>Rx Symbol</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Shown before the medicines table. Upload a logo image (stored in S3) or enter custom text.
                        If neither is set, the default <strong>"Rx"</strong> text is used.
                    </Typography>

                    {/* Mode toggle */}
                    <ToggleButtonGroup
                        value={rxMode}
                        exclusive
                        onChange={handleRxModeChange}
                        size="small"
                        sx={{ mb: 2 }}
                    >
                        <ToggleButton value="image" sx={{ gap: 0.5 }}>
                            <ImageIcon fontSize="small" /> Image
                        </ToggleButton>
                        <ToggleButton value="text" sx={{ gap: 0.5 }}>
                            <TextFieldsIcon fontSize="small" /> Text
                        </ToggleButton>
                    </ToggleButtonGroup>

                    {rxMode === 'image' ? (
                        <Stack spacing={1.5}>
                            {/* Upload button */}
                            <input
                                ref={rxFileRef}
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={handleRxFileChange}
                            />
                            <Box display="flex" alignItems="center" gap={2}>
                                <Button
                                    variant="outlined"
                                    startIcon={<UploadIcon />}
                                    onClick={() => rxFileRef.current?.click()}
                                    disabled={uploadingRx}
                                    size="small"
                                >
                                    {uploadingRx ? 'Uploading…' : 'Upload Rx Symbol Image'}
                                </Button>
                                {form.rx_symbol_url && (
                                    <Tooltip title="Remove image">
                                        <IconButton size="small" color="error"
                                            onClick={() => set('rx_symbol_url', null)}>
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )}
                            </Box>

                            {/* Preview */}
                            {form.rx_symbol_url ? (
                                <Box display="flex" alignItems="center" gap={2}
                                    sx={{ p: 1.5, bgcolor: '#f5f5f5', borderRadius: 1, border: '1px solid #e0e0e0' }}>
                                    <Typography variant="body2" color="text.secondary">Current:</Typography>
                                    <Box component="img" src={form.rx_symbol_url} alt="Rx Symbol"
                                        sx={{ height: 44, maxWidth: 90, objectFit: 'contain' }} />
                                </Box>
                            ) : (
                                <Typography variant="body2" color="text.disabled" fontStyle="italic">
                                    No image uploaded yet — default "Rx" text will be shown.
                                </Typography>
                            )}
                        </Stack>
                    ) : (
                        <Stack spacing={1}>
                            <TextField
                                label="Custom Rx Text"
                                size="small"
                                value={form.rx_symbol_text || ''}
                                onChange={(e) => set('rx_symbol_text', e.target.value)}
                                placeholder='e.g. ℞ or Rx'
                                helperText='Unicode tip: "℞" is the official prescription symbol'
                                inputProps={{ maxLength: 20 }}
                                sx={{ maxWidth: 240 }}
                            />
                            {form.rx_symbol_text && (
                                <Box display="flex" alignItems="baseline" gap={1}>
                                    <Typography variant="body2" color="text.secondary">Preview:</Typography>
                                    <Typography variant="h5" fontWeight="bold" sx={{ fontFamily: 'serif' }}>
                                        {form.rx_symbol_text}
                                    </Typography>
                                </Box>
                            )}
                        </Stack>
                    )}
                </Paper>

                {/* ══ Footer / Disclaimer ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>Footer & Disclaimer</Typography>
                    <Stack spacing={2}>
                        <FormControlLabel control={<Switch checked={form.show_doctor_signature !== false} onChange={(e) => set('show_doctor_signature', e.target.checked)} />}
                            label="Show Doctor Signature Area" />
                        <TextField label="Signature Label" fullWidth size="small"
                            value={form.signature_label || ''} onChange={(e) => set('signature_label', e.target.value)} />
                        <TextField label="Disclaimer Title" fullWidth size="small"
                            value={form.disclaimer_title || ''} onChange={(e) => set('disclaimer_title', e.target.value)} />
                        <TextField label="Disclaimer Text" fullWidth size="small" multiline rows={6}
                            value={form.disclaimer_text || ''} onChange={(e) => set('disclaimer_text', e.target.value)} />

                        <Divider sx={{ my: 1 }} />
                        <Typography variant="subtitle2" fontWeight="bold">
                            Document Disclaimer
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            Used for doctor Documents (deliverables of a purchased service),
                            which share this letterhead but must not carry the prescription's
                            teleconsultation / medico-legal wording. Leave blank to use the
                            built-in default.
                        </Typography>
                        <TextField label="Document Disclaimer Title" fullWidth size="small"
                            value={form.document_disclaimer_title || ''} onChange={(e) => set('document_disclaimer_title', e.target.value)} />
                        <TextField label="Document Disclaimer Text" fullWidth size="small" multiline rows={6}
                            value={form.document_disclaimer_text || ''} onChange={(e) => set('document_disclaimer_text', e.target.value)} />
                    </Stack>
                </Paper>

                {/* ══ Action Buttons Config ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>Action Buttons</Typography>
                    <Stack spacing={1}>
                        <FormControlLabel control={<Switch checked={form.show_share_button !== false} onChange={(e) => set('show_share_button', e.target.checked)} />}
                            label="Show Share Button" />
                        <FormControlLabel control={<Switch checked={form.show_print_button !== false} onChange={(e) => set('show_print_button', e.target.checked)} />}
                            label="Show Print Button" />
                        <FormControlLabel control={<Switch checked={form.show_follow_up_button !== false} onChange={(e) => set('show_follow_up_button', e.target.checked)} />}
                            label="Show Follow Up Button" />
                    </Stack>
                </Paper>

                {/* ══ Save ══ */}
                <Box display="flex" justifyContent="flex-end" pb={4}>
                    <Button variant="contained" color="primary" size="large" startIcon={<SaveIcon />}
                        onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving...' : 'Save Template'}
                    </Button>
                </Box>
            </Stack>

            <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({ ...snack, open: false })}>
                <Alert severity={snack.sev}>{snack.msg}</Alert>
            </Snackbar>
        </Box>
    );
};

export default PrescriptionTemplateEditor;
