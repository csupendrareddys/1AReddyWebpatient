/**
 * GroupOfferingsBuilder — admin-authored multidisciplinary healthcare plan.
 *
 * Phase 1: Section 1 (basics), Section 2 (qualification/doctor slots with live
 * budget validation), Section 4 (summary). Save Draft anytime; Publish is gated
 * on every slot being allocated, budget valid, and ≥1 slot. Payment schedule /
 * taxes / payouts land in later phases.
 */
import React, { useState, useMemo } from 'react';
import {
    Box, Typography, Button, Paper, Table, TableHead, TableRow, TableCell,
    TableBody, TableContainer, IconButton, TextField, Snackbar, Alert, Chip,
    CircularProgress, Stack, Divider, MenuItem, Select, FormControl, InputLabel,
    Radio, RadioGroup, FormControlLabel, Autocomplete, Tabs, Tab, Grid, Tooltip,
    Checkbox, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import GroupsIcon from '@mui/icons-material/Groups';
import CategoryIcon from '@mui/icons-material/Category';
import PlanTeamsDialog from '../../components/PlanTeamsDialog';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArchiveIcon from '@mui/icons-material/Archive';
import PublishIcon from '@mui/icons-material/Publish';

import {
    useGetGroupOfferingsQuery,
    useCreateGroupOfferingMutation,
    useUpdateGroupOfferingMutation,
    usePublishGroupOfferingMutation,
    useArchiveGroupOfferingMutation,
    useDeleteGroupOfferingMutation,
    useGetGroupOfferingCategoriesQuery,
    useCreateGroupOfferingCategoryMutation,
    useDeleteGroupOfferingCategoryMutation,
} from '../../../api/groupOfferingEndpoints';
import { useGetWorkQualificationsQuery } from '../../../api/marketplaceEndpoints';
import { useGetMasterSpecializationsByLevelQuery } from '../../../api/doctorSignupConfigEndpoints';
import ExperienceRuleBuilder from '../../../AdminProducts/pages/AdminProducts/ExperienceRuleBuilder';

const CATEGORY_OPTIONS = ['Healthcare Plan', 'Longevity Program', 'Chronic Care', 'Wellness Plan'];
const DURATION_PRESETS = [
    { key: '15_days', label: '15 Days' },
    { key: '1_month', label: '1 Month' },
    { key: '3_months', label: '3 Months' },
    { key: '6_months', label: '6 Months' },
    { key: '12_months', label: '12 Months' },
    { key: 'custom', label: 'Custom' },
];
const STATUS_TABS = ['all', 'draft', 'published', 'archived'];
const STATUS_COLOR = { draft: 'warning', published: 'success', archived: 'default' };

// Remaining-payment timing presets (Section 3). ``days`` seeds due_after_days;
// null means it isn't a fixed day offset (Mid/End resolve from plan duration).
const DUE_OPTIONS = [
    { label: 'Due Immediately', days: 0 },
    { label: 'Before First Consultation', days: 0 },
    { label: 'After 5 Days', days: 5 },
    { label: 'After 10 Days', days: 10 },
    { label: 'Mid Plan', days: null },
    { label: 'End of Plan', days: null },
    { label: 'Custom', days: null },
];

const WEEKDAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'],
    ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];

const defaultWorkingHours = () => {
    const wh = {};
    WEEKDAYS.forEach(([k]) => { wh[k] = { open: '09:00', close: '20:00', closed: false }; });
    return wh;
};

const emptyRow = () => ({
    _key: Math.random().toString(36).slice(2),
    // Doctor-eligibility for the slot — same model as a service:
    // any-of specializations + any-of work-quals (ANDed) + DNF experience rule.
    specialization_ids: [], work_qualification_ids: [], experience_rule: [],
    min_consultations: 1, max_consultations: 1,
    voice_enabled: true, video_enabled: true,
    voice_min_duration: 5, voice_max_duration: 30,
    video_min_duration: 5, video_max_duration: 30,
    chat_enabled: true, allocated_budget: 0,
});

const blankDraft = () => ({
    id: null, name: '', category: 'Healthcare Plan',
    duration_type: '1_month', duration_value: 30,
    patient_price: '', description: '',
    members: [emptyRow()],
    working_hours: defaultWorkingHours(),
    tax_mode: 'none', cgst_rate: '9', sgst_rate: '9', igst_rate: '18',
});

const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);

const GroupOfferingsBuilder = () => {
    const [statusTab, setStatusTab] = useState(0);
    const status = STATUS_TABS[statusTab];
    const { data: offerings = [], isLoading } = useGetGroupOfferingsQuery(status);
    const { data: specializations = [] } = useGetMasterSpecializationsByLevelQuery({});
    const { data: workQualifications = [] } = useGetWorkQualificationsQuery();
    const { data: savedCategories = [] } = useGetGroupOfferingCategoriesQuery();
    const [createCategory] = useCreateGroupOfferingCategoryMutation();
    const [deleteCategory] = useDeleteGroupOfferingCategoryMutation();
    const [catDialogOpen, setCatDialogOpen] = useState(false);
    const [newCategory, setNewCategory] = useState('');

    const [createOffering] = useCreateGroupOfferingMutation();
    const [updateOffering] = useUpdateGroupOfferingMutation();
    const [publishOffering] = usePublishGroupOfferingMutation();
    const [archiveOffering] = useArchiveGroupOfferingMutation();
    const [deleteOffering] = useDeleteGroupOfferingMutation();
    const [mode, setMode] = useState('list'); // 'list' | 'edit'
    const [draft, setDraft] = useState(blankDraft());
    const [teamsFor, setTeamsFor] = useState(null); // plan whose teams are open
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

    const notify = (message, severity = 'info') => setSnackbar({ open: true, message, severity });

    const specOptions = useMemo(
        () => (specializations || []).map((s) => ({ id: s.id || s.category_id, name: s.name })),
        [specializations],
    );
    // Work-qualification slot options come from the product-catalog master
    // (the same list admins manage under Product Catalog → Work Qualifications).
    const workQualOptions = useMemo(
        () => (workQualifications || []).map((w) => ({ id: w.id || w.category_id, name: w.name })),
        [workQualifications],
    );

    // Category dropdown is admin-managed (persisted). Fall back to the built-in
    // seeds only until the admin adds their own via "Manage Categories".
    const categoryOptions = useMemo(() => {
        const names = (savedCategories || []).map((c) => c.name);
        const set = new Set(names.length ? names : CATEGORY_OPTIONS);
        (offerings || []).forEach((o) => { if (o.category) set.add(o.category); });
        return [...set];
    }, [savedCategories, offerings]);

    const addCategory = async () => {
        const name = newCategory.trim();
        if (!name) return;
        try {
            await createCategory(name).unwrap();
            setNewCategory('');
            notify('Category added', 'success');
        } catch (e) {
            notify(e?.data?.error || e?.data?.message || 'Could not add category', 'error');
        }
    };
    const removeCategory = async (id) => {
        try { await deleteCategory(id).unwrap(); notify('Category removed', 'info'); }
        catch (e) { notify(e?.data?.message || 'Could not remove', 'error'); }
    };

    // ── Derived summary (fees = the doctor budget; tax carved from it) ─────
    const allocatedTotal = draft.members.reduce((s, r) => s + num(r.allocated_budget), 0);
    const patientPrice = num(draft.patient_price);
    const platformRevenue = patientPrice - allocatedTotal;
    const budgetOverPatient = allocatedTotal > patientPrice + 1e-6;
    const totalConsults = draft.members.reduce((s, r) => s + num(r.max_consultations), 0);

    // Tax is INCLUDED in the doctors' fees — computed on the total fees, carved
    // out of the doctors' share, never added to what the patient pays.
    const cgst = draft.tax_mode === 'intra_state' ? allocatedTotal * num(draft.cgst_rate) / 100 : 0;
    const sgst = draft.tax_mode === 'intra_state' ? allocatedTotal * num(draft.sgst_rate) / 100 : 0;
    const igst = draft.tax_mode === 'inter_state' ? allocatedTotal * num(draft.igst_rate) / 100 : 0;
    const taxAmount = cgst + sgst + igst;
    const feesExTax = allocatedTotal - taxAmount;
    const taxRatesOk = (draft.tax_mode !== 'intra_state' || (num(draft.cgst_rate) > 0 || num(draft.sgst_rate) > 0))
        && (draft.tax_mode !== 'inter_state' || num(draft.igst_rate) > 0);

    const canPublish = !!draft.name.trim() && patientPrice > 0 && draft.members.length > 0
        && !budgetOverPatient && taxRatesOk;

    // ── Row edits ─────────────────────────────────────────────────────────
    const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
    const setRow = (key, patch) => setDraft((d) => ({
        ...d, members: d.members.map((r) => (r._key === key ? { ...r, ...patch } : r)),
    }));
    const addRow = () => setDraft((d) => ({ ...d, members: [...d.members, emptyRow()] }));
    const removeRow = (key) => setDraft((d) => ({ ...d, members: d.members.filter((r) => r._key !== key) }));

    const setDay = (dayKey, patch) => setDraft((d) => ({
        ...d, working_hours: { ...d.working_hours, [dayKey]: { ...d.working_hours[dayKey], ...patch } },
    }));

    const openCreate = () => { setDraft(blankDraft()); setMode('edit'); };
    const openEdit = (o) => {
        setDraft({
            id: o.id, name: o.name, category: o.category,
            duration_type: o.duration_type, duration_value: o.duration_value,
            patient_price: o.patient_price,
            description: o.description || '',
            members: (o.members || []).map((m) => ({
                _key: m.id,
                specialization_ids: m.eligibility?.specialization_ids || [],
                work_qualification_ids: m.eligibility?.work_qualification_ids || [],
                experience_rule: m.eligibility?.experience_rule || [],
                min_consultations: m.min_consultations ?? 1, max_consultations: m.max_consultations ?? 1,
                voice_enabled: m.voice_enabled ?? true, video_enabled: m.video_enabled ?? true,
                voice_min_duration: m.voice_min_duration ?? 5, voice_max_duration: m.voice_max_duration ?? 30,
                video_min_duration: m.video_min_duration ?? 5, video_max_duration: m.video_max_duration ?? 30,
                chat_enabled: m.chat_enabled ?? true, allocated_budget: m.allocated_budget,
            })),
            working_hours: (o.working_hours && Object.keys(o.working_hours).length)
                ? { ...defaultWorkingHours(), ...o.working_hours } : defaultWorkingHours(),
            tax_mode: o.tax_mode || 'none',
            cgst_rate: o.cgst_rate ?? '9', sgst_rate: o.sgst_rate ?? '9', igst_rate: o.igst_rate ?? '18',
        });
        setMode('edit');
    };

    const payload = () => ({
        name: draft.name, category: draft.category,
        duration_type: draft.duration_type, duration_value: num(draft.duration_value),
        patient_price: num(draft.patient_price),
        doctor_budget: allocatedTotal,   // fees are the doctor budget
        description: draft.description,
        working_hours: draft.working_hours,
        members: draft.members.map((r) => ({
            eligibility: {
                specialization_ids: r.specialization_ids || [],
                work_qualification_ids: r.work_qualification_ids || [],
                experience_rule: (r.experience_rule || [])
                    .map((g) => g.map((c) => ({ level: c.level, years: parseInt(c.years, 10) || 0 })))
                    .filter((g) => g.length > 0),
            },
            min_consultations: num(r.min_consultations), max_consultations: num(r.max_consultations),
            voice_enabled: !!r.voice_enabled, video_enabled: !!r.video_enabled,
            voice_min_duration: num(r.voice_min_duration), voice_max_duration: num(r.voice_max_duration),
            video_min_duration: num(r.video_min_duration), video_max_duration: num(r.video_max_duration),
            chat_enabled: !!r.chat_enabled,
            allocated_budget: num(r.allocated_budget),
        })),
        tax_mode: draft.tax_mode,
        cgst_rate: draft.tax_mode === 'intra_state' ? num(draft.cgst_rate) : null,
        sgst_rate: draft.tax_mode === 'intra_state' ? num(draft.sgst_rate) : null,
        igst_rate: draft.tax_mode === 'inter_state' ? num(draft.igst_rate) : null,
    });

    const saveDraft = async () => {
        if (!draft.name.trim()) { notify('Plan name is required', 'warning'); return; }
        try {
            if (draft.id) {
                await updateOffering({ id: draft.id, ...payload() }).unwrap();
                notify('Draft saved', 'success');
            } else {
                const res = await createOffering(payload()).unwrap();
                setDraft((d) => ({ ...d, id: res.data?.id || res.id }));
                notify('Saved as draft', 'success');
            }
        } catch (e) { notify(e?.data?.message || e?.data?.error || 'Save failed', 'error'); }
    };

    const doPublish = async () => {
        try {
            // Ensure it exists first so publish can carry the latest edits.
            let id = draft.id;
            if (!id) {
                const res = await createOffering(payload()).unwrap();
                id = res.data?.id || res.id;
                setDraft((d) => ({ ...d, id }));
            }
            await publishOffering({ id, ...payload() }).unwrap();
            notify('Group offering published', 'success');
            setMode('list');
        } catch (e) { notify(e?.data?.message || e?.data?.error || 'Publish failed', 'error'); }
    };

    const handleArchive = async (o) => {
        if (!window.confirm('Archive this group offering?')) return;
        try { await archiveOffering(o.id).unwrap(); notify('Archived', 'success'); }
        catch (e) { notify(e?.data?.message || 'Archive failed', 'error'); }
    };
    const handleDelete = async (o) => {
        if (!window.confirm('Delete this group offering?')) return;
        try { await deleteOffering(o.id).unwrap(); notify('Deleted', 'success'); }
        catch (e) { notify(e?.data?.message || 'Delete failed', 'error'); }
    };

    // Shared across list + builder views — manages the persisted Category list.
    const categoryDialog = (
        <Dialog open={catDialogOpen} onClose={() => setCatDialogOpen(false)} maxWidth="xs" fullWidth>
            <DialogTitle>Group Offering Categories</DialogTitle>
            <DialogContent>
                <Stack direction="row" spacing={1} sx={{ mt: 1, mb: 2 }}>
                    <TextField autoFocus fullWidth size="small" label="New category" value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') addCategory(); }} />
                    <Button variant="contained" onClick={addCategory} disabled={!newCategory.trim()}>Add</Button>
                </Stack>
                {savedCategories.length === 0 ? (
                    <Alert severity="info">No categories yet. Add one — it becomes selectable in the plan builder.</Alert>
                ) : (
                    <Stack spacing={0.5}>
                        {savedCategories.map((c) => (
                            <Stack key={c.id} direction="row" alignItems="center" justifyContent="space-between">
                                <Typography>{c.name}</Typography>
                                <IconButton size="small" color="error" onClick={() => removeCategory(c.id)}>
                                    <DeleteIcon fontSize="small" />
                                </IconButton>
                            </Stack>
                        ))}
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setCatDialogOpen(false)}>Close</Button>
            </DialogActions>
        </Dialog>
    );

    // ── List view ─────────────────────────────────────────────────────────
    if (mode === 'list') {
        return (
            <Box sx={{ p: 3 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                    <Box>
                        <Typography variant="h5" fontWeight="bold">Group Offerings</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Admin-authored multidisciplinary healthcare plans.
                        </Typography>
                    </Box>
                    <Stack direction="row" spacing={1}>
                        <Button variant="outlined" startIcon={<CategoryIcon />} onClick={() => setCatDialogOpen(true)}>
                            Manage Categories
                        </Button>
                        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
                            Create Group Offering
                        </Button>
                    </Stack>
                </Stack>

                <Tabs value={statusTab} onChange={(_, v) => setStatusTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
                    {STATUS_TABS.map((t) => <Tab key={t} label={t.charAt(0).toUpperCase() + t.slice(1)} />)}
                </Tabs>

                {isLoading ? (
                    <Box display="flex" justifyContent="center" mt={6}><CircularProgress /></Box>
                ) : offerings.length === 0 ? (
                    <Alert severity="info">No group offerings in this view.</Alert>
                ) : (
                    <TableContainer component={Paper}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell><b>Plan</b></TableCell>
                                    <TableCell><b>Category</b></TableCell>
                                    <TableCell align="right"><b>Patient ₹</b></TableCell>
                                    <TableCell align="center"><b>Doctors</b></TableCell>
                                    <TableCell align="center"><b>Consults</b></TableCell>
                                    <TableCell><b>Status</b></TableCell>
                                    <TableCell align="center"><b>Actions</b></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {offerings.map((o) => (
                                    <TableRow key={o.id}>
                                        <TableCell><Typography variant="subtitle2">{o.name}</Typography></TableCell>
                                        <TableCell>{o.category}</TableCell>
                                        <TableCell align="right">₹{o.patient_price}</TableCell>
                                        <TableCell align="center">{o.doctors_included}</TableCell>
                                        <TableCell align="center">{o.total_consultations}</TableCell>
                                        <TableCell>
                                            <Chip label={(o.status || 'draft').toUpperCase()} size="small"
                                                color={STATUS_COLOR[o.status] || 'default'} />
                                        </TableCell>
                                        <TableCell align="center">
                                            <Tooltip title="Manage teams"><IconButton size="small" onClick={() => setTeamsFor(o)}><GroupsIcon fontSize="small" /></IconButton></Tooltip>
                                            <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(o)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                                            {o.status !== 'archived' && (
                                                <Tooltip title="Archive"><IconButton size="small" onClick={() => handleArchive(o)}><ArchiveIcon fontSize="small" /></IconButton></Tooltip>
                                            )}
                                            <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => handleDelete(o)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}

                <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                    anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                    <Alert severity={snackbar.severity} variant="filled">{snackbar.message}</Alert>
                </Snackbar>

                <PlanTeamsDialog offering={teamsFor} open={!!teamsFor} onClose={() => setTeamsFor(null)} />
                {categoryDialog}
            </Box>
        );
    }

    // ── Builder view ──────────────────────────────────────────────────────
    return (
        <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto' }}>
            <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                <IconButton onClick={() => setMode('list')}><ArrowBackIcon /></IconButton>
                <Typography variant="h5" fontWeight="bold">
                    {draft.id ? 'Edit Group Offering' : 'Create Group Offering'}
                </Typography>
            </Stack>

            {/* Section 1 — Basic details */}
            <Paper sx={{ p: 3, mb: 3, borderRadius: 2 }}>
                <Typography variant="h6" fontWeight={600} gutterBottom>Group Offering Details</Typography>
                <Divider sx={{ mb: 2 }} />
                <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                        <TextField label="Plan Name *" fullWidth value={draft.name}
                            onChange={(e) => setField('name', e.target.value)} />
                    </Grid>
                    <Grid item xs={12} md={6}>
                        <Stack direction="row" spacing={1} alignItems="flex-start">
                            <Autocomplete
                                freeSolo
                                sx={{ flex: 1 }}
                                options={categoryOptions}
                                value={draft.category}
                                onChange={(_, v) => setField('category', v || '')}
                                onInputChange={(_, v) => setField('category', v)}
                                renderInput={(p) => (
                                    <TextField {...p} label="Category *" fullWidth
                                        helperText="Pick a category, or add one with the + button" />
                                )}
                            />
                            <Tooltip title="Add / manage categories">
                                <Button variant="outlined" sx={{ mt: 0.5, minWidth: 44, px: 0 }}
                                    onClick={() => setCatDialogOpen(true)}>
                                    <AddIcon />
                                </Button>
                            </Tooltip>
                        </Stack>
                    </Grid>
                    <Grid item xs={12}>
                        <Typography variant="body2" fontWeight={600} gutterBottom>Duration *</Typography>
                        <RadioGroup row value={draft.duration_type} onChange={(e) => setField('duration_type', e.target.value)}>
                            {DURATION_PRESETS.map((d) => (
                                <FormControlLabel key={d.key} value={d.key} control={<Radio />} label={d.label} />
                            ))}
                        </RadioGroup>
                        {draft.duration_type === 'custom' && (
                            <TextField label="Custom Duration (Days)" type="number" size="small" sx={{ mt: 1, width: 220 }}
                                value={draft.duration_value}
                                onChange={(e) => setField('duration_value', e.target.value)} />
                        )}
                    </Grid>
                    <Grid item xs={12} md={4}>
                        <TextField label="Price to Patient (₹)" type="number" fullWidth value={draft.patient_price}
                            onChange={(e) => setField('patient_price', e.target.value)} />
                    </Grid>
                    <Grid item xs={12} md={8}>
                        <TextField label="Description" fullWidth multiline rows={2} value={draft.description}
                            onChange={(e) => setField('description', e.target.value)} />
                    </Grid>
                </Grid>

                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>Working Hours</Typography>
                <Typography variant="caption" color="text.secondary">
                    Calls and chat are available only within these hours (tenant-local).
                </Typography>
                <Stack spacing={0.5} sx={{ mt: 1 }}>
                    {WEEKDAYS.map(([key, label]) => {
                        const day = draft.working_hours[key] || {};
                        return (
                            <Stack key={key} direction="row" spacing={2} alignItems="center">
                                <Typography sx={{ width: 44 }}>{label}</Typography>
                                <FormControlLabel control={
                                    <Radio size="small" checked={!day.closed}
                                        onClick={() => setDay(key, { closed: false })} />
                                } label="Open" />
                                <FormControlLabel control={
                                    <Radio size="small" checked={!!day.closed}
                                        onClick={() => setDay(key, { closed: true })} />
                                } label="Closed" />
                                {!day.closed && (
                                    <>
                                        <TextField size="small" type="time" sx={{ width: 130 }} value={day.open || '09:00'}
                                            onChange={(e) => setDay(key, { open: e.target.value })} />
                                        <Typography>–</Typography>
                                        <TextField size="small" type="time" sx={{ width: 130 }} value={day.close || '20:00'}
                                            onChange={(e) => setDay(key, { close: e.target.value })} />
                                    </>
                                )}
                            </Stack>
                        );
                    })}
                </Stack>
            </Paper>

            {/* Section 2 — Qualification slots (no doctors — teams fill these) */}
            <Paper sx={{ p: 3, mb: 3, borderRadius: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="h6" fontWeight={600}>Qualification Slots</Typography>
                    <Button startIcon={<AddIcon />} onClick={addRow}>Add Slot</Button>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                    Define the roles + fees. Doctors are assigned per team later.
                </Typography>
                <Divider sx={{ my: 2 }} />
                <Stack spacing={2}>
                    {draft.members.map((r) => (
                        <Paper key={r._key} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
                                <Autocomplete multiple size="small" options={specOptions} sx={{ minWidth: 240 }}
                                    getOptionLabel={(o) => o.name || ''}
                                    isOptionEqualToValue={(o, v) => o.id === v.id}
                                    value={specOptions.filter((s) => (r.specialization_ids || []).includes(s.id))}
                                    onChange={(_, vals) => setRow(r._key, { specialization_ids: vals.map((v) => v.id) })}
                                    renderInput={(p) => <TextField {...p} label="Education qualifications" placeholder="Any of…" />} />
                                <Autocomplete multiple size="small" options={workQualOptions} sx={{ minWidth: 240 }}
                                    getOptionLabel={(o) => o.name || ''}
                                    isOptionEqualToValue={(o, v) => o.id === v.id}
                                    value={workQualOptions.filter((s) => (r.work_qualification_ids || []).includes(s.id))}
                                    onChange={(_, vals) => setRow(r._key, { work_qualification_ids: vals.map((v) => v.id) })}
                                    renderInput={(p) => <TextField {...p} label="Work qualifications" placeholder="Any of…" />} />
                                <TextField size="small" type="number" label="Fee (₹)" sx={{ width: 120 }}
                                    value={r.allocated_budget} onChange={(e) => setRow(r._key, { allocated_budget: e.target.value })} />
                                <FormControlLabel control={
                                    <Checkbox size="small" checked={!!r.chat_enabled}
                                        onChange={(e) => setRow(r._key, { chat_enabled: e.target.checked })} />
                                } label="Chat" />
                                <FormControlLabel control={
                                    <Checkbox size="small" checked={!!r.voice_enabled}
                                        onChange={(e) => setRow(r._key, { voice_enabled: e.target.checked })} />
                                } label="Voice" />
                                <FormControlLabel control={
                                    <Checkbox size="small" checked={!!r.video_enabled}
                                        onChange={(e) => setRow(r._key, { video_enabled: e.target.checked })} />
                                } label="Video" />
                                <IconButton size="small" color="error" onClick={() => removeRow(r._key)}><DeleteIcon fontSize="small" /></IconButton>
                            </Stack>
                            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                                <Typography variant="caption" sx={{ width: 90 }}>Consultations</Typography>
                                <TextField size="small" type="number" label="Min" sx={{ width: 80 }} value={r.min_consultations}
                                    onChange={(e) => setRow(r._key, { min_consultations: e.target.value })} />
                                <TextField size="small" type="number" label="Max" sx={{ width: 80 }} value={r.max_consultations}
                                    onChange={(e) => setRow(r._key, { max_consultations: e.target.value })} />
                                {r.voice_enabled && (<>
                                    <Typography variant="caption" sx={{ width: 90 }}>Voice (min)</Typography>
                                    <TextField size="small" type="number" label="Min" sx={{ width: 80 }} value={r.voice_min_duration}
                                        onChange={(e) => setRow(r._key, { voice_min_duration: e.target.value })} />
                                    <TextField size="small" type="number" label="Max" sx={{ width: 80 }} value={r.voice_max_duration}
                                        onChange={(e) => setRow(r._key, { voice_max_duration: e.target.value })} />
                                </>)}
                                {r.video_enabled && (<>
                                    <Typography variant="caption" sx={{ width: 90 }}>Video (min)</Typography>
                                    <TextField size="small" type="number" label="Min" sx={{ width: 80 }} value={r.video_min_duration}
                                        onChange={(e) => setRow(r._key, { video_min_duration: e.target.value })} />
                                    <TextField size="small" type="number" label="Max" sx={{ width: 80 }} value={r.video_max_duration}
                                        onChange={(e) => setRow(r._key, { video_max_duration: e.target.value })} />
                                </>)}
                                {!r.voice_enabled && !r.video_enabled && (
                                    <Typography variant="caption" color="text.secondary">
                                        Chat-only slot — no calls
                                    </Typography>
                                )}
                            </Stack>
                            <Divider sx={{ my: 1.5 }} />
                            <ExperienceRuleBuilder
                                value={r.experience_rule || []}
                                onChange={(rule) => setRow(r._key, { experience_rule: rule })}
                            />
                        </Paper>
                    ))}
                </Stack>
                {budgetOverPatient && (
                    <Alert severity="error" sx={{ mt: 2 }}>
                        Total slot fees (₹{allocatedTotal.toLocaleString()}) exceed the patient price.
                    </Alert>
                )}
            </Paper>

            {/* Section 3 — Tax (patient pays the plan price once; no schedule) */}
            <Paper sx={{ p: 3, mb: 3, borderRadius: 2 }}>
                <Typography variant="h6" fontWeight={600} gutterBottom>Tax</Typography>
                <Typography variant="body2" color="text.secondary" mb={1}>
                    Included in the doctors' fees (like consultation fees) — the patient pays the plan price.
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <RadioGroup row value={draft.tax_mode} onChange={(e) => setField('tax_mode', e.target.value)}>
                    <FormControlLabel value="none" control={<Radio />} label="No Tax (exempt)" />
                    <FormControlLabel value="intra_state" control={<Radio />} label="Intra-state (CGST + SGST)" />
                    <FormControlLabel value="inter_state" control={<Radio />} label="Inter-state (IGST)" />
                </RadioGroup>
                {draft.tax_mode === 'intra_state' && (
                    <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                        <TextField label="CGST %" type="number" size="small" sx={{ width: 120 }} value={draft.cgst_rate}
                            onChange={(e) => setField('cgst_rate', e.target.value)} />
                        <TextField label="SGST %" type="number" size="small" sx={{ width: 120 }} value={draft.sgst_rate}
                            onChange={(e) => setField('sgst_rate', e.target.value)} />
                    </Stack>
                )}
                {draft.tax_mode === 'inter_state' && (
                    <TextField label="IGST %" type="number" size="small" sx={{ mt: 1, width: 120 }} value={draft.igst_rate}
                        onChange={(e) => setField('igst_rate', e.target.value)} />
                )}
            </Paper>

            {/* Section 4 — Summary */}
            <Paper sx={{ p: 3, mb: 3, borderRadius: 2, bgcolor: '#f8f9fa' }}>
                <Typography variant="h6" fontWeight={600} gutterBottom>Summary</Typography>
                <Divider sx={{ mb: 2 }} />
                <Grid container spacing={2}>
                    {[
                        ['Patient Pays (tax incl.)', `₹${patientPrice.toLocaleString()}`, 'primary.main'],
                        ['Total Doctor Fees', `₹${allocatedTotal.toLocaleString()}`, budgetOverPatient ? 'error.main' : 'text.primary'],
                        ['Platform Revenue', `₹${platformRevenue.toLocaleString()}`, platformRevenue < 0 ? 'error.main' : 'success.main'],
                        ...(draft.tax_mode === 'intra_state'
                            ? [['CGST (in fees)', `₹${cgst.toLocaleString()}`], ['SGST (in fees)', `₹${sgst.toLocaleString()}`]] : []),
                        ...(draft.tax_mode === 'inter_state' ? [['IGST (in fees)', `₹${igst.toLocaleString()}`]] : []),
                        ...(taxAmount > 0 ? [['Fees Net (ex-tax)', `₹${feesExTax.toLocaleString()}`]] : []),
                        ['Slots', draft.members.length],
                        ['Total Consultations', totalConsults],
                    ].map(([label, value, color]) => (
                        <Grid item xs={6} md={4} key={label}>
                            <Typography variant="caption" color="text.secondary">{label}</Typography>
                            <Typography variant="h6" fontWeight={700} color={color || 'text.primary'}>{value}</Typography>
                        </Grid>
                    ))}
                </Grid>
            </Paper>

            <Stack direction="row" spacing={2} justifyContent="flex-end">
                <Button onClick={() => setMode('list')}>Cancel</Button>
                <Button variant="outlined" onClick={saveDraft}>Save Draft</Button>
                <Tooltip title={canPublish ? '' : 'Add a name, patient price, ≥1 slot, keep fees within price, and set tax rates to publish'}>
                    <span>
                        <Button variant="contained" startIcon={<PublishIcon />} disabled={!canPublish} onClick={doPublish}>
                            Publish
                        </Button>
                    </span>
                </Tooltip>
            </Stack>

            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snackbar.severity} variant="filled">{snackbar.message}</Alert>
            </Snackbar>
            {categoryDialog}
        </Box>
    );
};

export default GroupOfferingsBuilder;
