/**
 * AdminProducts — Admin catalog management for marketplace products/services.
 * Supports list, create, edit, and soft-delete.
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box, Typography, Button, Paper, Table, TableContainer, TableHead, TableRow, TableCell,
    TableBody, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Snackbar, Alert, Chip, CircularProgress, Stack, Autocomplete,
    Tabs, Tab, Divider, FormControlLabel, Switch,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';

import {
    useGetAdminProductsQuery,
    useCreateAdminProductMutation,
    useUpdateAdminProductMutation,
    useDeleteAdminProductMutation,
    useGetWorkQualificationsQuery,
    useCreateWorkQualificationMutation,
} from '../../../api/marketplaceEndpoints';
import {
    useGetMasterSpecializationsByLevelQuery,
    useGetMasterDegreesByLevelQuery,
} from '../../../api/doctorSignupConfigEndpoints';
import {
    useGetServiceCommunicationConfigQuery,
    useUpsertServiceCommunicationConfigMutation,
} from '../../../api/serviceCommunicationEndpoints';
import AppointmentTypesPanel from './AppointmentTypesPanel';
import WorkQualificationsDialog from './WorkQualificationsDialog';
import ExperienceRuleBuilder, { describeRule } from './ExperienceRuleBuilder';
import CommunicationSection, {
    EMPTY_COMMUNICATION, communicationFromApi, communicationToApi,
} from './CommunicationSection';

const specId = (s) => String(s.id || s.category_id);

const EMPTY_FORM = {
    name: '', description: '', min_price: '', max_price: '',
    allowed_specialization_ids: [], is_group_service: false,
    required_degree_ids: [], required_work_qualification_ids: [],
    experience_rule: [], logo_asset_id: null,
    // Service terms the ADMIN imposes — the doctor only picks a selling price.
    min_consultations: 1, max_consultations: 1,
    // Per-mode consultation counts + slot length (minutes). min calls = 0 means
    // the mode isn't included.
    audio_min_consultations: 0, audio_max_consultations: 1,
    voice_min_duration: 5, voice_max_duration: 30,
    video_min_consultations: 0, video_max_consultations: 1,
    video_min_duration: 5, video_max_duration: 30,
    // Admin-set payout schedule (empty = the doctor is paid in one settlement).
    payout_installments: [],
    tax_mode: 'none', cgst_rate: 9, sgst_rate: 9, igst_rate: 18,
    // When the service's consultations may be scheduled (per weekday).
    working_hours: {},
};

const WH_DAYS = [
    ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'],
    ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun'],
];

// Group offerings are authored in their own builder, not here.
const GROUP_TAB = 2;
const GROUP_OFFERINGS_ROUTE = '/dashboard/admin/group-offerings';

const AdminProducts = () => {
    const navigate = useNavigate();
    const { data: products = [], isLoading } = useGetAdminProductsQuery();
    const { data: specializations = [] } = useGetMasterSpecializationsByLevelQuery({});
    const { data: degrees = [] } = useGetMasterDegreesByLevelQuery({});
    const { data: workQualifications = [] } = useGetWorkQualificationsQuery();
    const [createProduct] = useCreateAdminProductMutation();
    const [updateProduct] = useUpdateAdminProductMutation();
    const [deleteProduct] = useDeleteAdminProductMutation();
    const [createWorkQualification] = useCreateWorkQualificationMutation();
    const [upsertCommunication] = useUpsertServiceCommunicationConfigMutation();

    const [wqDialogOpen, setWqDialogOpen] = useState(false);
    const [wqManagerOpen, setWqManagerOpen] = useState(false);
    const [wqName, setWqName] = useState('');

    const [tab, setTab] = useState(0); // 0 = Appointments, 1 = Services, 2 = Group Offerings
    const isAppointmentsTab = tab === 0;
    const isGroupTab = tab === GROUP_TAB;

    // The Group Offerings tab is a shortcut to the builder route, so it must
    // never become the selected tab — this page has no panel to show for it.
    const handleTabChange = (_, value) => {
        if (value === GROUP_TAB) {
            navigate(GROUP_OFFERINGS_ROUTE);
            return;
        }
        setTab(value);
    };
    const visibleProducts = products.filter((p) => !!p.is_group_service === isGroupTab);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editId, setEditId] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [communication, setCommunication] = useState(EMPTY_COMMUNICATION);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

    // Communication config is a separate resource keyed on the product id, so
    // it can only be fetched once we're editing an existing product. Skipped
    // on create (no id yet) — the form starts from EMPTY_COMMUNICATION.
    // ``is_group_service`` products are collaboration templates, not sold to a
    // patient, so they don't get a communication channel.
    const showCommunication = !form.is_group_service;
    const { data: existingComm } = useGetServiceCommunicationConfigQuery(editId, {
        skip: !editId || !dialogOpen || !showCommunication,
    });
    useEffect(() => {
        if (dialogOpen && editId) {
            setCommunication(communicationFromApi(existingComm));
        }
    }, [dialogOpen, editId, existingComm]);

    const openCreate = () => {
        setEditId(null);
        setForm({ ...EMPTY_FORM, is_group_service: isGroupTab });
        setCommunication(EMPTY_COMMUNICATION);
        setDialogOpen(true);
    };
    const openEdit = (p) => {
        setEditId(p.id);
        setForm({
            name: p.name, description: p.description || '',
            min_price: p.min_price, max_price: p.max_price,
            allowed_specialization_ids: (p.allowed_specialization_ids || []).map(String),
            is_group_service: !!p.is_group_service,
            required_degree_ids: (p.required_degree_ids || []).map(String),
            required_work_qualification_ids: (p.required_work_qualification_ids || []).map(String),
            experience_rule: p.experience_rule || [],
            logo_asset_id: p.logo_asset_id || null,
            min_consultations: p.min_consultations ?? 1,
            max_consultations: p.max_consultations ?? 1,
            audio_min_consultations: p.audio_min_consultations ?? 0,
            audio_max_consultations: p.audio_max_consultations ?? 1,
            voice_min_duration: p.voice_min_duration ?? 5,
            voice_max_duration: p.voice_max_duration ?? 30,
            video_min_consultations: p.video_min_consultations ?? 0,
            video_max_consultations: p.video_max_consultations ?? 1,
            video_min_duration: p.video_min_duration ?? 5,
            video_max_duration: p.video_max_duration ?? 30,
            payout_installments: (p.payout_installments || []).map((i) => ({
                payment_type: i.payment_type || 'fixed',
                amount: i.amount ?? '',
                percentage: i.percentage ?? '',
                due_after_days: i.due_after_days ?? 0,
                period_label: i.period_label || '',
            })),
            working_hours: p.working_hours || {},
            tax_mode: p.tax_mode || 'none',
            cgst_rate: p.cgst_rate ?? 9,
            sgst_rate: p.sgst_rate ?? 9,
            igst_rate: p.igst_rate ?? 18,
        });
        setDialogOpen(true);
    };

    const handleAddWorkQualification = async () => {
        const name = wqName.trim();
        if (!name) return;
        try {
            const res = await createWorkQualification({ name }).unwrap();
            const created = res?.data;
            // Select what was just added — that is why the admin added it.
            if (created?.id) {
                setForm((f) => ({
                    ...f,
                    required_work_qualification_ids: [
                        ...f.required_work_qualification_ids, String(created.id),
                    ],
                }));
            }
            setWqName('');
            setWqDialogOpen(false);
            setSnackbar({ open: true, message: 'Work qualification added', severity: 'success' });
        } catch (err) {
            setSnackbar({
                open: true,
                message: err?.data?.error || err?.data?.message || 'Could not add work qualification',
                severity: 'error',
            });
        }
    };

    // Admin payout-installment editor helpers.
    const addInstallment = () => setForm((f) => ({
        ...f,
        payout_installments: [
            ...(f.payout_installments || []),
            { payment_type: 'percentage', amount: '', percentage: '', due_after_days: 0, period_label: '' },
        ],
    }));
    const updateInstallment = (idx, patch) => setForm((f) => ({
        ...f,
        payout_installments: (f.payout_installments || []).map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
    const removeInstallment = (idx) => setForm((f) => ({
        ...f,
        payout_installments: (f.payout_installments || []).filter((_, i) => i !== idx),
    }));

    const handleSave = async () => {
        if (!form.name.trim()) {
            setSnackbar({ open: true, message: 'Name is required', severity: 'warning' });
            return;
        }
        try {
            // A years field left blank mid-edit would post `years: ''` and be
            // rejected; treat it as 0 rather than failing the whole save.
            const experienceRule = (form.experience_rule || [])
                .map((group) => group.map((c) => ({ level: c.level, years: parseInt(c.years, 10) || 0 })))
                .filter((group) => group.length > 0);

            const payload = {
                name: form.name.trim(),
                description: form.description.trim(),
                min_price: parseFloat(form.min_price) || 0,
                max_price: parseFloat(form.max_price) || 0,
                allowed_specialization_ids: form.allowed_specialization_ids,
                is_group_service: form.is_group_service,
                required_degree_ids: form.required_degree_ids,
                required_work_qualification_ids: form.required_work_qualification_ids,
                experience_rule: experienceRule,
                logo_asset_id: form.logo_asset_id,
            };
            // Service terms — only meaningful for a sold service, not a
            // group-offering template (which carries its own tax on the plan).
            if (!form.is_group_service) {
                const _int0 = (v) => Math.max(0, parseInt(v, 10) || 0);
                const _min = (v) => Math.max(1, parseInt(v, 10) || 1);
                payload.min_consultations = parseInt(form.min_consultations, 10) || 1;
                payload.max_consultations = parseInt(form.max_consultations, 10) || 1;
                payload.audio_min_consultations = _int0(form.audio_min_consultations);
                payload.audio_max_consultations = _int0(form.audio_max_consultations);
                payload.video_min_consultations = _int0(form.video_min_consultations);
                payload.video_max_consultations = _int0(form.video_max_consultations);
                payload.voice_min_duration = _min(form.voice_min_duration);
                payload.voice_max_duration = _min(form.voice_max_duration);
                payload.video_min_duration = _min(form.video_min_duration);
                payload.video_max_duration = _min(form.video_max_duration);
                payload.payout_installments = (form.payout_installments || []).map((i, idx) => {
                    const pct = i.payment_type === 'percentage';
                    const days = Math.max(0, parseInt(i.due_after_days, 10) || 0);
                    return {
                        installment_no: idx + 1,
                        payment_type: pct ? 'percentage' : 'fixed',
                        amount: pct ? null : (parseFloat(i.amount) || 0),
                        percentage: pct ? (parseFloat(i.percentage) || 0) : null,
                        due_after_days: days,
                        // Derived from the numeric days — no free text.
                        period_label: days > 0 ? `After ${days} days` : 'On completion',
                    };
                });
                payload.working_hours = form.working_hours || {};
                payload.tax_mode = form.tax_mode;
                payload.cgst_rate = form.tax_mode === 'intra_state' ? parseFloat(form.cgst_rate) || 0 : null;
                payload.sgst_rate = form.tax_mode === 'intra_state' ? parseFloat(form.sgst_rate) || 0 : null;
                payload.igst_rate = form.tax_mode === 'inter_state' ? parseFloat(form.igst_rate) || 0 : null;
            }
            // The product save has to land first: communication settings are a
            // separate resource keyed on the product id, which doesn't exist
            // until creation returns.
            let productId = editId;
            if (editId) {
                await updateProduct({ productId: editId, ...payload }).unwrap();
            } else {
                const created = await createProduct(payload).unwrap();
                productId = created?.data?.id || created?.id;
            }

            // Only send when there is something to say — a product that never
            // had communication and still doesn't shouldn't get an empty
            // config row written for it.
            if (showCommunication && productId
                && (communication.is_enabled || existingComm)) {
                await upsertCommunication({
                    productId, ...communicationToApi(communication),
                }).unwrap();
            }

            setSnackbar({
                open: true,
                message: editId ? 'Product updated' : 'Product created',
                severity: 'success',
            });
            setDialogOpen(false);
        } catch (err) {
            // Rule/criteria validation comes back under `error`; keep the
            // specific reason rather than collapsing it to "Operation failed".
            setSnackbar({
                open: true,
                message: err?.data?.error || err?.data?.message || 'Operation failed',
                severity: 'error',
            });
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this product?')) return;
        try {
            await deleteProduct(id).unwrap();
            setSnackbar({ open: true, message: 'Product deleted', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Delete failed', severity: 'error' });
        }
    };

    return (
        <Box sx={{ p: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h5" fontWeight="bold">Product Catalog</Typography>
                <Stack direction="row" spacing={1}>
                    {/* Catalog-level reference data every doctor picks from, so it
                        sits with the catalog rather than inside one product. */}
                    <Button
                        variant="outlined" startIcon={<WorkspacePremiumIcon />}
                        onClick={() => setWqManagerOpen(true)}
                    >
                        Work Qualifications
                    </Button>
                    {!isAppointmentsTab && (
                        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
                            {isGroupTab ? 'Add Group Offering' : 'Add Product'}
                        </Button>
                    )}
                </Stack>
            </Stack>

            <Tabs value={tab} onChange={handleTabChange} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Tab label="Appointments" />
                <Tab label="Services" />
                <Tab label="Group Offerings" />
            </Tabs>

            {isAppointmentsTab && <AppointmentTypesPanel />}

            {isGroupTab && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    A <strong>group offering</strong> (e.g. Longevity) is served by a group of doctors
                    covering the required specializations. Doctors form groups against it — one initiates,
                    the co-doctors accept, and you approve. Set the required specializations below.
                </Alert>
            )}

            {!isAppointmentsTab && isLoading && (
                <Box display="flex" justifyContent="center" mt={6}><CircularProgress /></Box>
            )}

            {!isAppointmentsTab && !isLoading && (
            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell><b>Name</b></TableCell>
                            <TableCell><b>Description</b></TableCell>
                            {isGroupTab && <TableCell><b>Required specializations</b></TableCell>}
                            <TableCell align="right"><b>Min Price (₹)</b></TableCell>
                            <TableCell align="right"><b>Max Price (₹)</b></TableCell>
                            <TableCell><b>Status</b></TableCell>
                            <TableCell align="center"><b>Actions</b></TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {visibleProducts.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={isGroupTab ? 7 : 6} align="center">
                                    {isGroupTab ? 'No group offerings yet.' : 'No products yet.'}
                                </TableCell>
                            </TableRow>
                        )}
                        {visibleProducts.map((p) => (
                            <TableRow key={p.id}>
                                <TableCell>{p.name}</TableCell>
                                <TableCell>{p.description || '—'}</TableCell>
                                {isGroupTab && (
                                    <TableCell>
                                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                            {(p.allowed_specialization_ids || []).length === 0 ? '— (any)' :
                                                (p.allowed_specialization_ids || []).map((sid) => {
                                                    const s = specializations.find((x) => specId(x) === String(sid));
                                                    return <Chip key={sid} size="small" label={s ? s.name : sid} />;
                                                })}
                                        </Stack>
                                    </TableCell>
                                )}
                                <TableCell align="right">{p.min_price}</TableCell>
                                <TableCell align="right">{p.max_price}</TableCell>
                                <TableCell>
                                    <Chip
                                        label={p.is_active ? 'Active' : 'Inactive'}
                                        color={p.is_active ? 'success' : 'default'}
                                        size="small"
                                    />
                                </TableCell>
                                <TableCell align="center">
                                    <IconButton size="small" onClick={() => openEdit(p)}><EditIcon fontSize="small" /></IconButton>
                                    <IconButton size="small" color="error" onClick={() => handleDelete(p.id)}><DeleteIcon fontSize="small" /></IconButton>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
            )}

            {/* Create / Edit Dialog */}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="lg" fullWidth
                scroll="paper" PaperProps={{ sx: { minHeight: '85vh' } }}>
                <DialogTitle>
                    {editId
                        ? (form.is_group_service ? 'Edit Group Offering' : 'Edit Product')
                        : (form.is_group_service ? 'New Group Offering' : 'New Product')}
                </DialogTitle>
                <DialogContent>
                    <Stack spacing={2} mt={1}>
                        <TextField label="Name" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} fullWidth required />
                        <TextField label="Description" value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} fullWidth multiline rows={2} />
                        <Stack direction="row" spacing={2}>
                            <TextField label="Min Price (₹)" type="number" value={form.min_price} onChange={(e) => setForm(f => ({ ...f, min_price: e.target.value }))} fullWidth />
                            <TextField label="Max Price (₹)" type="number" value={form.max_price} onChange={(e) => setForm(f => ({ ...f, max_price: e.target.value }))} fullWidth />
                        </Stack>

                        {/* Service terms the admin fixes for every doctor who lists
                            this service. The doctor only chooses a selling price
                            inside the min/max band above. Not shown for group
                            offerings — those carry their own tax on the plan. */}
                        {!form.is_group_service && (
                            <>
                                <Divider textAlign="left">
                                    <Typography variant="caption" color="text.secondary">
                                        Service terms — fixed by admin
                                    </Typography>
                                </Divider>

                                {/* Per-mode consultation counts + slot length. Set
                                    min calls to 0 to leave a mode out. */}
                                <Typography variant="caption" color="text.secondary">Audio consultations</Typography>
                                <Stack direction="row" spacing={2}>
                                    <TextField
                                        label="Min calls" type="number" fullWidth
                                        value={form.audio_min_consultations}
                                        onChange={(e) => setForm(f => ({ ...f, audio_min_consultations: e.target.value }))}
                                    />
                                    <TextField
                                        label="Max calls" type="number" fullWidth
                                        value={form.audio_max_consultations}
                                        onChange={(e) => setForm(f => ({ ...f, audio_max_consultations: e.target.value }))}
                                    />
                                    <TextField
                                        label="Min mins/slot" type="number" fullWidth
                                        value={form.voice_min_duration}
                                        onChange={(e) => setForm(f => ({ ...f, voice_min_duration: e.target.value }))}
                                    />
                                    <TextField
                                        label="Max mins/slot" type="number" fullWidth
                                        value={form.voice_max_duration}
                                        onChange={(e) => setForm(f => ({ ...f, voice_max_duration: e.target.value }))}
                                    />
                                </Stack>
                                <Typography variant="caption" color="text.secondary">Video consultations</Typography>
                                <Stack direction="row" spacing={2}>
                                    <TextField
                                        label="Min calls" type="number" fullWidth
                                        value={form.video_min_consultations}
                                        onChange={(e) => setForm(f => ({ ...f, video_min_consultations: e.target.value }))}
                                    />
                                    <TextField
                                        label="Max calls" type="number" fullWidth
                                        value={form.video_max_consultations}
                                        onChange={(e) => setForm(f => ({ ...f, video_max_consultations: e.target.value }))}
                                    />
                                    <TextField
                                        label="Min mins/slot" type="number" fullWidth
                                        value={form.video_min_duration}
                                        onChange={(e) => setForm(f => ({ ...f, video_min_duration: e.target.value }))}
                                    />
                                    <TextField
                                        label="Max mins/slot" type="number" fullWidth
                                        value={form.video_max_duration}
                                        onChange={(e) => setForm(f => ({ ...f, video_max_duration: e.target.value }))}
                                    />
                                </Stack>

                                {/* Admin-set payout schedule — the doctor's fee is
                                    released in these installments. */}
                                <Divider textAlign="left">
                                    <Typography variant="caption" color="text.secondary">
                                        Payout to doctor — installments
                                    </Typography>
                                </Divider>
                                <Typography variant="caption" color="text.secondary">
                                    How the doctor's fee is paid out. Each installment is a
                                    fixed ₹ amount or a % of the fee, released after the given
                                    number of days. Leave empty to pay in one settlement.
                                </Typography>
                                {(form.payout_installments || []).map((inst, idx) => (
                                    <Stack key={idx} direction="row" spacing={1} alignItems="center">
                                        <TextField
                                            select SelectProps={{ native: true }} label="Type"
                                            sx={{ minWidth: 120 }}
                                            value={inst.payment_type}
                                            onChange={(e) => updateInstallment(idx, { payment_type: e.target.value })}
                                        >
                                            <option value="percentage">% of fee</option>
                                            <option value="fixed">Fixed ₹</option>
                                        </TextField>
                                        {inst.payment_type === 'percentage' ? (
                                            <TextField
                                                label="Percent" type="number" sx={{ width: 110 }}
                                                value={inst.percentage}
                                                onChange={(e) => updateInstallment(idx, { percentage: e.target.value })}
                                            />
                                        ) : (
                                            <TextField
                                                label="Amount ₹" type="number" sx={{ width: 110 }}
                                                value={inst.amount}
                                                onChange={(e) => updateInstallment(idx, { amount: e.target.value })}
                                            />
                                        )}
                                        <TextField
                                            label="Pay after (days)" type="number" sx={{ width: 160 }}
                                            value={inst.due_after_days}
                                            onChange={(e) => updateInstallment(idx, { due_after_days: e.target.value })}
                                            helperText="0 = on completion"
                                        />
                                        <IconButton size="small" color="error" onClick={() => removeInstallment(idx)}>
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Stack>
                                ))}
                                <Button size="small" startIcon={<AddIcon />} onClick={addInstallment} sx={{ alignSelf: 'flex-start' }}>
                                    Add installment
                                </Button>

                                <Divider textAlign="left" sx={{ mt: 1 }}>
                                    <Typography variant="caption" color="text.secondary">Working hours — when consultations can be scheduled</Typography>
                                </Divider>
                                {WH_DAYS.map(([key, label]) => {
                                    const wh = form.working_hours || {};
                                    const d = wh[key] || {};
                                    const setDay = (patch) => setForm((f) => ({
                                        ...f, working_hours: { ...(f.working_hours || {}), [key]: { ...d, ...patch } },
                                    }));
                                    return (
                                        <Stack key={key} direction="row" spacing={1} alignItems="center">
                                            <Typography sx={{ width: 44 }} variant="body2">{label}</Typography>
                                            <FormControlLabel
                                                control={<Switch size="small" checked={!d.closed}
                                                    onChange={(e) => setDay({ closed: !e.target.checked })} />}
                                                label={d.closed ? 'Closed' : 'Open'} sx={{ width: 110, m: 0 }}
                                            />
                                            <TextField size="small" type="time" label="From" disabled={d.closed}
                                                value={d.open || '09:00'} onChange={(e) => setDay({ open: e.target.value })}
                                                InputLabelProps={{ shrink: true }} sx={{ width: 130 }} />
                                            <TextField size="small" type="time" label="To" disabled={d.closed}
                                                value={d.close || '18:00'} onChange={(e) => setDay({ close: e.target.value })}
                                                InputLabelProps={{ shrink: true }} sx={{ width: 130 }} />
                                        </Stack>
                                    );
                                })}

                                <TextField
                                    select fullWidth label="Tax on service fee"
                                    SelectProps={{ native: true }}
                                    value={form.tax_mode}
                                    onChange={(e) => setForm(f => ({ ...f, tax_mode: e.target.value }))}
                                >
                                    <option value="none">No tax</option>
                                    <option value="intra_state">Intra-state (CGST + SGST)</option>
                                    <option value="inter_state">Inter-state (IGST)</option>
                                </TextField>
                                {form.tax_mode === 'intra_state' && (
                                    <Stack direction="row" spacing={2}>
                                        <TextField
                                            label="CGST %" type="number" fullWidth value={form.cgst_rate}
                                            onChange={(e) => setForm(f => ({ ...f, cgst_rate: e.target.value }))}
                                        />
                                        <TextField
                                            label="SGST %" type="number" fullWidth value={form.sgst_rate}
                                            onChange={(e) => setForm(f => ({ ...f, sgst_rate: e.target.value }))}
                                        />
                                    </Stack>
                                )}
                                {form.tax_mode === 'inter_state' && (
                                    <TextField
                                        label="IGST %" type="number" fullWidth value={form.igst_rate}
                                        onChange={(e) => setForm(f => ({ ...f, igst_rate: e.target.value }))}
                                    />
                                )}
                            </>
                        )}
                        <Autocomplete
                            multiple
                            options={specializations}
                            getOptionLabel={(o) => o.name || ''}
                            value={specializations.filter((s) => form.allowed_specialization_ids.includes(specId(s)))}
                            onChange={(_, vals) => setForm(f => ({ ...f, allowed_specialization_ids: vals.map(specId) }))}
                            renderInput={(params) => (
                                <TextField {...params} label={form.is_group_service
                                    ? 'Required specializations (the group must cover these)'
                                    : 'Allowed specializations (leave empty = any doctor)'} />
                            )}
                        />

                        <Divider textAlign="left">
                            <Typography variant="caption" color="text.secondary">
                                Eligibility — who may offer this
                            </Typography>
                        </Divider>

                        <Autocomplete
                            multiple
                            options={degrees}
                            getOptionLabel={(o) => o.name || ''}
                            value={degrees.filter((d) => form.required_degree_ids.includes(specId(d)))}
                            onChange={(_, vals) => setForm(f => ({ ...f, required_degree_ids: vals.map(specId) }))}
                            renderInput={(params) => (
                                <TextField {...params}
                                    label="Required education (leave empty = any)"
                                    helperText="Doctor must hold any one of these" />
                            )}
                        />

                        <Stack direction="row" spacing={1} alignItems="flex-start">
                            <Autocomplete
                                multiple
                                sx={{ flex: 1 }}
                                options={workQualifications}
                                getOptionLabel={(o) => o.name || ''}
                                value={workQualifications.filter((w) => form.required_work_qualification_ids.includes(specId(w)))}
                                onChange={(_, vals) => setForm(f => ({ ...f, required_work_qualification_ids: vals.map(specId) }))}
                                renderInput={(params) => (
                                    <TextField {...params}
                                        label="Required work qualification (leave empty = any)"
                                        helperText="Doctor must hold any one of these" />
                                )}
                            />
                            <Button
                                size="small" startIcon={<AddIcon />} sx={{ mt: 1, whiteSpace: 'nowrap' }}
                                onClick={() => setWqDialogOpen(true)}
                            >
                                New
                            </Button>
                        </Stack>

                        <ExperienceRuleBuilder
                            value={form.experience_rule}
                            onChange={(rule) => setForm(f => ({ ...f, experience_rule: rule }))}
                        />

                        {/* Communication terms for the purchased service. Hidden
                            for group offerings — those are multi-doctor
                            collaboration templates, not something a patient buys
                            and gets a channel for. */}
                        {showCommunication && (
                            <CommunicationSection
                                value={communication}
                                onChange={setCommunication}
                                isEditing={!!editId}
                            />
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleSave}>{editId ? 'Update' : 'Create'}</Button>
                </DialogActions>
            </Dialog>

            <WorkQualificationsDialog
                open={wqManagerOpen}
                onClose={() => setWqManagerOpen(false)}
                onNotify={(message, severity) => setSnackbar({ open: true, message, severity })}
            />

            {/* New work qualification — adds to the master list doctors pick from */}
            <Dialog open={wqDialogOpen} onClose={() => setWqDialogOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>New Work Qualification</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus fullWidth sx={{ mt: 1 }}
                        label="Name" value={wqName}
                        onChange={(e) => setWqName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddWorkQualification(); }}
                        helperText="Added to the list doctors choose from on their profile"
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setWqDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleAddWorkQualification} disabled={!wqName.trim()}>
                        Add
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar(s => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
            </Snackbar>
        </Box>
    );
};

export default AdminProducts;
