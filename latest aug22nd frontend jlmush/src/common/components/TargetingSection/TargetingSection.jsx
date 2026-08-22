/**
 * TargetingSection — the audience-targeting form block, shared by:
 *
 *   * the admin Edit Product dialog (services + group services),
 *   * the admin Group Offerings builder,
 *   * the doctor Slot Visibility tab (one block per consultation type).
 *
 * Controlled + batched by design: every edit only mutates the parent's
 * local state via ``onChange(nextTargeting)``; the PARENT decides when to
 * persist (its own single Save), so many selections travel to the backend
 * in ONE call. Value shape mirrors the backend's ``clean_targeting``:
 *
 *   { age: {priority: [], general: []}, gender: {priority, general},
 *     entity: {priority: [], general}, product_category_ids: [],
 *     payment: {price, mode, installments: [{pct, due_after_days}]},
 *     description, not_suggested_for,
 *     quotas: {messages, video_calls, voice_calls} }
 */
import {
    Box, Button, Checkbox, Chip, Divider, Grid, IconButton, ListItemText,
    MenuItem, OutlinedInput, Select, Stack, TextField, ToggleButton,
    ToggleButtonGroup, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

// Age ranges in multiples of 5, up to 100 ("General"); "Priority" picks
// from the same list (multiple).
export const AGE_RANGES = Array.from({ length: 20 }, (_, i) => {
    const lo = i * 5;
    return `${lo === 0 ? 1 : lo}-${lo + 5}`;
});

const GENDER_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'male', label: 'Male' },
    { value: 'female', label: 'Female' },
];

// Corporate entity types (mirrors EntityCoreFields' vocabulary).
export const ENTITY_OPTIONS = [
    'individual', 'proprietorship', 'partnership', 'private_limited',
    'public_limited', 'section_8', 'trust',
];

// Body organs / systems — no backend master exists, so a static list
// (stored as plain strings, same as the age ranges).
export const BODY_ORGAN_OPTIONS = [
    'Heart', 'Lungs', 'Brain & Nerves', 'Liver', 'Kidneys',
    'Stomach & Digestive', 'Bones & Joints', 'Skin', 'Eyes',
    'Ear, Nose & Throat', 'Reproductive Health', 'Dental',
    'Hormones (Endocrine)', 'Blood', 'Mental Health', 'General',
];

const prettify = (s) => (s || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());


/** Chip-rendering multi-select (same look as the category table pickers). */
function MultiSelect({ label, options, value, onChange, prettifyLabels = false, width }) {
    const vals = value || [];
    return (
        <Box sx={{ minWidth: width || 220, flex: 1 }}>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
            <Select
                multiple size="small" fullWidth displayEmpty
                value={vals}
                onChange={(e) => onChange(e.target.value)}
                input={<OutlinedInput />}
                renderValue={(sel) => sel.length
                    ? (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                            {sel.map((s) => (
                                <Chip key={s} size="small" label={prettifyLabels ? prettify(s) : s} />
                            ))}
                        </Stack>
                    )
                    : <Typography variant="body2" color="text.secondary">Pick…</Typography>}
            >
                {options.map((opt) => {
                    const v = typeof opt === 'object' ? opt.value : opt;
                    const l = typeof opt === 'object' ? opt.label : (prettifyLabels ? prettify(opt) : opt);
                    return (
                        <MenuItem key={v} value={v}>
                            <Checkbox checked={vals.indexOf(v) > -1} size="small" />
                            <ListItemText primary={l} />
                        </MenuItem>
                    );
                })}
            </Select>
        </Box>
    );
}


export default function TargetingSection({
    value, onChange, categories = [],
    // Symptom master options ({id, name}) — admin surfaces pass the admin
    // master list; the doctor surface passes its /symptoms/available list.
    symptomOptions = [],
    // "Recommended for you" config — ADMIN product catalog only.
    showRecommended = false,
    recommendedOptions = { doctors: [], specializations: [], products: [] },
}) {
    const t = value || {};

    // Immutable patch helpers — every edit produces a fresh targeting
    // object handed to the parent; nothing is persisted here.
    const patch = (key, val) => onChange({ ...t, [key]: val });
    const patchIn = (key, sub, val) => patch(key, { ...(t[key] || {}), [sub]: val });

    const pay = t.payment || {};
    const installments = pay.installments || [];
    const quotas = t.quotas || {};

    const setInstallment = (idx, field, val) => {
        const rows = installments.map((r, i) => (i === idx ? { ...r, [field]: val } : r));
        patchIn('payment', 'installments', rows);
    };

    return (
        <Stack spacing={2}>
            {/* ── 1. Age ─────────────────────────────────────────── */}
            <Divider textAlign="left"><Typography variant="overline">Age</Typography></Divider>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <MultiSelect
                    label="Priority age ranges (multiple)"
                    options={AGE_RANGES}
                    value={(t.age || {}).priority}
                    onChange={(v) => patchIn('age', 'priority', v)}
                />
                <MultiSelect
                    label="General age ranges (multiples of 5)"
                    options={AGE_RANGES}
                    value={(t.age || {}).general}
                    onChange={(v) => patchIn('age', 'general', v)}
                />
            </Stack>

            {/* ── 2. Gender ──────────────────────────────────────── */}
            <Divider textAlign="left"><Typography variant="overline">Gender</Typography></Divider>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                    select size="small" label="Priority" sx={{ minWidth: 200, flex: 1 }}
                    value={(t.gender || {}).priority || ''}
                    onChange={(e) => patchIn('gender', 'priority', e.target.value)}
                >
                    <MenuItem value="">—</MenuItem>
                    {GENDER_OPTIONS.map((g) => (
                        <MenuItem key={g.value} value={g.value}>{g.label}</MenuItem>
                    ))}
                </TextField>
                <TextField
                    select size="small" label="General" sx={{ minWidth: 200, flex: 1 }}
                    value={(t.gender || {}).general || ''}
                    onChange={(e) => patchIn('gender', 'general', e.target.value)}
                >
                    <MenuItem value="">—</MenuItem>
                    {GENDER_OPTIONS.map((g) => (
                        <MenuItem key={g.value} value={g.value}>{g.label}</MenuItem>
                    ))}
                </TextField>
            </Stack>

            {/* ── 3. Entity ──────────────────────────────────────── */}
            <Divider textAlign="left"><Typography variant="overline">Entity</Typography></Divider>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-end">
                <MultiSelect
                    label="Priority entities (single or multiple)"
                    options={ENTITY_OPTIONS}
                    prettifyLabels
                    value={(t.entity || {}).priority}
                    onChange={(v) => patchIn('entity', 'priority', v)}
                />
                <TextField
                    size="small" label="General" sx={{ minWidth: 160 }}
                    value={(t.entity || {}).general || 'all'}
                    InputProps={{ readOnly: true }}
                    helperText="All entities"
                />
            </Stack>

            {/* ── 4. Product category ────────────────────────────── */}
            <Divider textAlign="left"><Typography variant="overline">Product category</Typography></Divider>
            <MultiSelect
                label="Categories (from Product Categories)"
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                value={t.product_category_ids}
                onChange={(v) => patch('product_category_ids', v)}
            />

            {/* ── 4b. Recommended for you (ADMIN catalog only) —
                three INDEPENDENT sections; shown to patients in the
                mobile app's Recommended rail with fixed priority
                doctor > product > specialization. ── */}
            {showRecommended && (
                <>
                    <Divider textAlign="left">
                        <Typography variant="overline">Recommended for you</Typography>
                    </Divider>
                    <Typography variant="caption" color="text.secondary">
                        Three independent picks. Display priority on the patient side
                        is fixed: Doctors first, then Products, then Specializations.
                    </Typography>
                    <MultiSelect
                        label="Doctors (shown first)"
                        options={(recommendedOptions.doctors || []).map((d) => ({
                            value: d.id, label: d.name,
                        }))}
                        value={(t.recommended || {}).doctor_ids}
                        onChange={(v) => patchIn('recommended', 'doctor_ids', v)}
                    />
                    <MultiSelect
                        label="Products (shown second)"
                        options={(recommendedOptions.products || []).map((p) => ({
                            value: p.id, label: p.name,
                        }))}
                        value={(t.recommended || {}).product_ids}
                        onChange={(v) => patchIn('recommended', 'product_ids', v)}
                    />
                    <MultiSelect
                        label="Specializations (shown third)"
                        options={(recommendedOptions.specializations || []).map((s) => ({
                            value: s.id, label: s.name,
                        }))}
                        value={(t.recommended || {}).specialization_ids}
                        onChange={(v) => patchIn('recommended', 'specialization_ids', v)}
                    />
                </>
            )}

            {/* ── 4c. Body organs + symptoms ─────────────────────── */}
            <Divider textAlign="left"><Typography variant="overline">Body organs</Typography></Divider>
            <MultiSelect
                label="Organs / systems this applies to"
                options={BODY_ORGAN_OPTIONS}
                value={t.body_organs}
                onChange={(v) => patch('body_organs', v)}
            />
            <Divider textAlign="left"><Typography variant="overline">Symptoms</Typography></Divider>
            <MultiSelect
                label="Symptoms (from the symptoms master)"
                options={(symptomOptions || []).map((s) => ({
                    value: s.id, label: s.name,
                }))}
                value={t.symptoms}
                onChange={(v) => patch('symptoms', v)}
            />

            {/* ── 4d. Call flow + flow type ──────────────────────── */}
            <Divider textAlign="left"><Typography variant="overline">Call flow</Typography></Divider>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                    size="small" type="number" label="Intro calls" sx={{ width: 140 }}
                    inputProps={{ min: 0 }}
                    value={(t.call_flow || {}).intro_calls ?? ''}
                    onChange={(e) => patchIn('call_flow', 'intro_calls', e.target.value === '' ? null : Number(e.target.value))}
                />
                <TextField
                    size="small" type="number" label="Mid calls" sx={{ width: 140 }}
                    inputProps={{ min: 0 }}
                    value={(t.call_flow || {}).mid_calls ?? ''}
                    onChange={(e) => patchIn('call_flow', 'mid_calls', e.target.value === '' ? null : Number(e.target.value))}
                />
                <TextField
                    size="small" type="number" label="End calls" sx={{ width: 140 }}
                    inputProps={{ min: 0 }}
                    value={(t.call_flow || {}).end_calls ?? ''}
                    onChange={(e) => patchIn('call_flow', 'end_calls', e.target.value === '' ? null : Number(e.target.value))}
                />
            </Stack>
            <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    Flow type
                </Typography>
                <ToggleButtonGroup
                    exclusive size="small"
                    value={t.flow_type || ''}
                    onChange={(_e, v) => patch('flow_type', v || null)}
                >
                    <ToggleButton value="consultation_flow">Consultation flow</ToggleButton>
                    <ToggleButton value="plan_flow">Plan flow</ToggleButton>
                </ToggleButtonGroup>
            </Box>

            {/* ── 5. Payment method ──────────────────────────────── */}
            <Divider textAlign="left"><Typography variant="overline">Payment method</Typography></Divider>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
                <TextField
                    size="small" type="number" label="Price (₹)" sx={{ width: 160 }}
                    inputProps={{ min: 0 }}
                    value={pay.price ?? ''}
                    onChange={(e) => patchIn('payment', 'price', e.target.value === '' ? null : Number(e.target.value))}
                />
                <ToggleButtonGroup
                    exclusive size="small"
                    value={pay.mode || 'single'}
                    onChange={(_e, v) => v && patchIn('payment', 'mode', v)}
                >
                    <ToggleButton value="single">Single</ToggleButton>
                    <ToggleButton value="installments">Installments</ToggleButton>
                </ToggleButtonGroup>
            </Stack>
            {pay.mode === 'installments' && (
                <Stack spacing={1}>
                    {installments.map((row, idx) => (
                        <Stack key={idx} direction="row" spacing={1.5} alignItems="center">
                            <TextField
                                size="small" type="number" label="%" sx={{ width: 110 }}
                                inputProps={{ min: 0, max: 100 }}
                                value={row.pct ?? ''}
                                onChange={(e) => setInstallment(idx, 'pct', e.target.value === '' ? '' : Number(e.target.value))}
                            />
                            <TextField
                                size="small" type="number" label="Due after (days)" sx={{ width: 150 }}
                                inputProps={{ min: 0 }}
                                value={row.due_after_days ?? 0}
                                onChange={(e) => setInstallment(idx, 'due_after_days', e.target.value === '' ? 0 : Number(e.target.value))}
                                helperText={idx === 0 && !row.due_after_days ? 'At purchase (after redeem)' : ' '}
                            />
                            <IconButton
                                size="small"
                                onClick={() => patchIn('payment', 'installments',
                                    installments.filter((_r, i) => i !== idx))}
                            >
                                <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                        </Stack>
                    ))}
                    <Button
                        size="small" startIcon={<AddIcon />} sx={{ alignSelf: 'flex-start' }}
                        onClick={() => patchIn('payment', 'installments',
                            [...installments, { pct: '', due_after_days: installments.length ? 5 : 0 }])}
                    >
                        Add installment
                    </Button>
                </Stack>
            )}

            {/* ── 6. View details / Not suggested for ────────────── */}
            <Divider textAlign="left"><Typography variant="overline">Details</Typography></Divider>
            <TextField
                size="small" fullWidth multiline minRows={2}
                label="Description (view details)"
                value={t.description || ''}
                onChange={(e) => patch('description', e.target.value)}
            />
            <TextField
                size="small" fullWidth multiline minRows={2}
                label="Not suggested for (one point per line)"
                value={t.not_suggested_for || ''}
                onChange={(e) => patch('not_suggested_for', e.target.value)}
            />

            {/* ── 7. Quotas ──────────────────────────────────────── */}
            <Divider textAlign="left"><Typography variant="overline">Included quotas</Typography></Divider>
            <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                    <TextField
                        size="small" fullWidth type="number" label="Messages"
                        inputProps={{ min: 0 }}
                        value={quotas.messages ?? ''}
                        onChange={(e) => patchIn('quotas', 'messages', e.target.value === '' ? null : Number(e.target.value))}
                    />
                </Grid>
                <Grid item xs={12} sm={4}>
                    <TextField
                        size="small" fullWidth type="number" label="Video calls"
                        inputProps={{ min: 0 }}
                        value={quotas.video_calls ?? ''}
                        onChange={(e) => patchIn('quotas', 'video_calls', e.target.value === '' ? null : Number(e.target.value))}
                    />
                </Grid>
                <Grid item xs={12} sm={4}>
                    <TextField
                        size="small" fullWidth type="number" label="Voice calls"
                        inputProps={{ min: 0 }}
                        value={quotas.voice_calls ?? ''}
                        onChange={(e) => patchIn('quotas', 'voice_calls', e.target.value === '' ? null : Number(e.target.value))}
                    />
                </Grid>
            </Grid>
        </Stack>
    );
}
