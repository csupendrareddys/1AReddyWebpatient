/**
 * TenantProviderPlansAdmin — tenant super-admin's catalog editor for
 * the plans they offer their own in-tenant providers (doctors / clinics
 * / hospitals registering inside the tenant's subdomain).
 *
 * Each vertical is gated independently:
 *   * ``tenant.can_create_doctor_plans``   → "Doctor" tab enabled.
 *   * ``tenant.can_create_clinic_plans``   → "Clinic" tab enabled.
 *   * ``tenant.can_create_hospital_plans`` → "Hospital" tab enabled.
 *
 * Tabs without the add-on render an inline upsell prompt; their CRUD
 * controls are hidden. The backend re-checks on every write (403
 * ``feature_not_entitled``) so the visual gate is UX only.
 *
 * Distinct from:
 *   * ``PlansAdmin``           — platform owner authoring SaaS plans.
 *   * ``MembershipPlansAdmin`` — platform owner authoring apex
 *                                 marketplace tiers.
 */
import {
    Alert, Box, Button, Checkbox, Chip, CircularProgress, Container, Dialog,
    DialogActions, DialogContent, DialogTitle, Divider, FormControl, FormControlLabel,
    FormGroup, IconButton, InputLabel, MenuItem, Paper, Select, Stack, Tab, Table,
    TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip,
    Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import LockIcon from '@mui/icons-material/Lock';
import DeleteIcon from '@mui/icons-material/Delete';
import { useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';

import usePermissions from '../../../../common/hooks/usePermissions';
import FeatureTreeEditor from '../../Pricing/components/FeatureTreeEditor';
import {
    useArchiveTenantProviderPlanMutation,
    useCreateTenantProviderPlanMutation,
    useGetTenantFeaturePathsQuery,
    useListTenantProviderPlansQuery,
    useUpdateTenantProviderPlanMutation,
} from '../../api/tenantProviderPlanEndpoints';
import { setSnackbar } from '../../redux/adminSharedUiSlice';


const VERTICALS = [
    {
        key: 'doctor',
        label: 'Doctors',
        feature: 'tenant.can_create_doctor_plans',
        helpUpsell:
            'Doctor-plan authoring is not included in your current plan. '
            + 'Ask the platform owner to add the doctor-plan capability '
            + 'add-on to enable plans for doctors registering inside your tenant.',
    },
    {
        key: 'clinic',
        label: 'Clinics',
        feature: 'tenant.can_create_clinic_plans',
        helpUpsell:
            'Clinic-plan authoring is not included in your current plan. '
            + 'Contact the platform owner to add the clinic-plan capability.',
    },
    {
        key: 'hospital',
        label: 'Hospitals',
        feature: 'tenant.can_create_hospital_plans',
        helpUpsell:
            'Hospital-plan authoring is not included in your current plan. '
            + 'Contact the platform owner to add the hospital-plan capability.',
    },
];


const STATUS_COLOR = {
    active: 'success',
    draft: 'default',
    archived: 'error',
};


const EMPTY_FORM = {
    code: '',
    name: '',
    description: '',
    // No monthly/annual price — these plans PAY the provider, they don't
    // charge them (that's the marketplace membership plan's job).
    trial_days: 0,
    sort_order: 0,
    status: 'draft',
    features: {},
};


const TenantProviderPlansAdmin = () => {
    const dispatch = useDispatch();
    const { hasFeature } = usePermissions();
    const [tab, setTab] = useState(0);

    const activeVertical = VERTICALS[tab];
    const entitled = hasFeature(activeVertical.feature);

    const { data: plans = [], isLoading, error } =
        useListTenantProviderPlansQuery(activeVertical.key, {
            // Only query when we know the tab is entitled — keeps the
            // server from logging a useless 403 for upsell tabs.
            skip: !entitled,
        });

    const [createPlan, createState] = useCreateTenantProviderPlanMutation();
    const [updatePlan, updateState] = useUpdateTenantProviderPlanMutation();
    const [archivePlan] = useArchiveTenantProviderPlanMutation();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);

    const notify = (severity, message) =>
        dispatch(setSnackbar({ open: true, severity, message }));

    const openCreate = () => {
        setEditingId(null);
        setForm({ ...EMPTY_FORM });
        setDialogOpen(true);
    };

    const openEdit = (plan) => {
        setEditingId(plan.id);
        setForm({
            code: plan.code,
            name: plan.name,
            description: plan.description || '',
            trial_days: plan.trial_days ?? 0,
            sort_order: plan.sort_order ?? 0,
            status: plan.status || 'draft',
            features: plan.features || {},
        });
        setDialogOpen(true);
    };

    const closeDialog = () => {
        setDialogOpen(false);
        setEditingId(null);
    };

    const handleSave = async () => {
        try {
            if (editingId) {
                await updatePlan({ id: editingId, data: form }).unwrap();
                notify('success', `Plan "${form.code}" updated`);
            } else {
                await createPlan({
                    ...form,
                    vertical: activeVertical.key,
                }).unwrap();
                notify('success', `Plan "${form.code}" created`);
            }
            closeDialog();
        } catch (err) {
            const msg =
                err?.data?.error
                || err?.data?.message
                || 'Save failed.';
            notify('error', msg);
        }
    };

    const handleArchive = async (plan) => {
        try {
            await archivePlan(plan.id).unwrap();
            notify('success', `Plan "${plan.code}" archived`);
        } catch (err) {
            notify('error', err?.data?.error || 'Archive failed.');
        }
    };

    return (
        <Container maxWidth="lg" sx={{ mt: 4, mb: 8 }}>
            <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 2 }}
            >
                <Box>
                    <Typography variant="h5">Employee / Consultant Plans</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Plans by which you employ or contract doctors, clinics, and
                        hospitals registering inside <strong>your tenant</strong> —
                        you pay them. Independent from the marketplace on larazen.in.
                    </Typography>
                </Box>
                {entitled && (
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={openCreate}
                    >
                        New plan
                    </Button>
                )}
            </Stack>

            <Tabs
                value={tab}
                onChange={(_, v) => setTab(v)}
                sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
            >
                {VERTICALS.map((v, idx) => (
                    <Tab
                        key={v.key}
                        label={
                            <Stack direction="row" spacing={0.5} alignItems="center">
                                <span>{v.label}</span>
                                {!hasFeature(v.feature) && (
                                    <LockIcon fontSize="small" color="disabled" />
                                )}
                            </Stack>
                        }
                        value={idx}
                    />
                ))}
            </Tabs>

            {!entitled && (
                <Alert
                    severity="info"
                    icon={<LockIcon />}
                    sx={{ mb: 2 }}
                >
                    <Typography variant="body2" fontWeight={600}>
                        Plan authoring for {activeVertical.label.toLowerCase()}
                        {' '}is not enabled
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {activeVertical.helpUpsell}
                    </Typography>
                </Alert>
            )}

            {entitled && error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    Failed to load plans. Please refresh.
                </Alert>
            )}

            {entitled && (
                <Paper>
                    {isLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                            <CircularProgress />
                        </Box>
                    ) : (
                        <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Code</TableCell>
                                    <TableCell>Name</TableCell>
                                    <TableCell>Status</TableCell>
                                    <TableCell align="right">Trial</TableCell>
                                    <TableCell align="right">Sort</TableCell>
                                    <TableCell>Authored by</TableCell>
                                    <TableCell align="right">Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {plans.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={7} align="center">
                                            <Typography
                                                variant="body2"
                                                color="text.secondary"
                                                sx={{ py: 3 }}
                                            >
                                                No plans yet. Create one to offer it to
                                                {' '}{activeVertical.label.toLowerCase()} signing up
                                                inside your tenant.
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                                {plans.map((p) => (
                                    <TableRow key={p.id} hover>
                                        <TableCell><code>{p.code}</code></TableCell>
                                        <TableCell>{p.name}</TableCell>
                                        <TableCell>
                                            <Chip
                                                size="small"
                                                label={p.status}
                                                color={STATUS_COLOR[p.status] || 'default'}
                                            />
                                        </TableCell>
                                        <TableCell align="right">
                                            {p.trial_days}
                                        </TableCell>
                                        <TableCell align="right">{p.sort_order}</TableCell>
                                        <TableCell>
                                            <Chip
                                                size="small"
                                                label={p.authored_by}
                                                variant="outlined"
                                                color={
                                                    p.authored_by === 'platform'
                                                        ? 'warning'
                                                        : 'default'
                                                }
                                            />
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="Edit">
                                                <IconButton
                                                    size="small"
                                                    onClick={() => openEdit(p)}
                                                >
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            {p.status !== 'archived' && (
                                                <Tooltip title="Archive">
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => handleArchive(p)}
                                                    >
                                                        <ArchiveIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </TableContainer>
                    )}
                </Paper>
            )}

            <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="md" fullWidth>
                <DialogTitle>
                    {editingId
                        ? `Edit ${activeVertical.label.slice(0, -1).toLowerCase()} plan`
                        : `New ${activeVertical.label.slice(0, -1).toLowerCase()} plan`}
                </DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <Stack direction="row" spacing={1}>
                            <TextField
                                label="Code"
                                value={form.code}
                                onChange={(e) =>
                                    setForm({ ...form, code: e.target.value })
                                }
                                size="small"
                                sx={{ flex: 1 }}
                                disabled={!!editingId}
                                helperText={editingId ? 'Code is immutable.' : ''}
                            />
                            <TextField
                                label="Name"
                                value={form.name}
                                onChange={(e) =>
                                    setForm({ ...form, name: e.target.value })
                                }
                                size="small"
                                sx={{ flex: 2 }}
                            />
                        </Stack>
                        <TextField
                            label="Description"
                            value={form.description}
                            onChange={(e) =>
                                setForm({ ...form, description: e.target.value })
                            }
                            size="small"
                            fullWidth
                            multiline
                            minRows={2}
                        />
                        <Stack direction="row" spacing={1}>
                            <TextField
                                label="Trial days"
                                type="number"
                                size="small"
                                inputProps={{ min: 0 }}
                                value={form.trial_days ?? 0}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        trial_days: Number(e.target.value),
                                    })
                                }
                                sx={{ flex: 1 }}
                            />
                            <TextField
                                label="Sort"
                                type="number"
                                size="small"
                                inputProps={{ min: 0 }}
                                value={form.sort_order ?? 0}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        sort_order: Number(e.target.value),
                                    })
                                }
                                sx={{ flex: 1 }}
                            />
                        </Stack>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                            <FormControl size="small" sx={{ minWidth: 180 }}>
                                <InputLabel>Status</InputLabel>
                                <Select
                                    label="Status"
                                    value={form.status || 'draft'}
                                    onChange={(e) =>
                                        setForm({ ...form, status: e.target.value })
                                    }
                                >
                                    <MenuItem value="draft">
                                        Draft (hidden from signup)
                                    </MenuItem>
                                    <MenuItem value="active">
                                        Active (shown on signup)
                                    </MenuItem>
                                    <MenuItem value="archived">
                                        Archived (hidden, existing subs intact)
                                    </MenuItem>
                                </Select>
                            </FormControl>
                            {/* A plan is EITHER an employee plan OR a consultant plan
                                (like a membership tier) — never both. Drives which
                                terms section shows below. */}
                            <FormControl size="small" sx={{ minWidth: 200 }}>
                                <InputLabel>Plan type</InputLabel>
                                <Select
                                    label="Plan type"
                                    value={form.features?.plan_type || 'employee'}
                                    onChange={(e) => setForm({
                                        ...form,
                                        features: { ...form.features, plan_type: e.target.value },
                                    })}
                                >
                                    <MenuItem value="employee">Employee</MenuItem>
                                    <MenuItem value="consultant">Consultant</MenuItem>
                                </Select>
                            </FormControl>
                        </Stack>
                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                                Billing terms (payout economics)
                            </Typography>
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block', mb: 1.5 }}
                            >
                                Drives the T-day payout hold, the per-patient
                                platform fee (Plan &amp; Consultant per-patient
                                earnings), and the salary/retainer deduction when
                                a doctor's agreement fee mode is "Plan-based"
                                (Employee &amp; Consultant). Leave a fee as "None"
                                to fall back to the tenant billing config.
                            </Typography>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                                <TextField
                                    label="Payout hold (days)"
                                    type="number"
                                    size="small"
                                    inputProps={{ min: 0 }}
                                    value={form.features?.payout_hold_days ?? ''}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            features: {
                                                ...form.features,
                                                payout_hold_days:
                                                    e.target.value === ''
                                                        ? undefined
                                                        : Number(e.target.value),
                                            },
                                        })
                                    }
                                    sx={{ flex: 1 }}
                                />
                            </Stack>
                            {[
                                { key: 'per_patient_fee', label: 'Per-patient platform fee' },
                                { key: 'salary_deduction', label: 'Salary / retainer deduction' },
                            ].map(({ key, label }) => {
                                const cur = form.features?.[key] || {};
                                const setFee = (patch) =>
                                    setForm({
                                        ...form,
                                        features: {
                                            ...form.features,
                                            [key]: { ...cur, ...patch },
                                        },
                                    });
                                return (
                                    <Stack
                                        key={key}
                                        direction={{ xs: 'column', sm: 'row' }}
                                        spacing={2}
                                        sx={{ mt: 2 }}
                                    >
                                        <TextField
                                            select
                                            label={label}
                                            size="small"
                                            value={cur.mode || 'none'}
                                            onChange={(e) => setFee({ mode: e.target.value })}
                                            sx={{ flex: 1 }}
                                        >
                                            <MenuItem value="none">None</MenuItem>
                                            <MenuItem value="percentage">Percentage (%)</MenuItem>
                                            <MenuItem value="flat">Flat (₹)</MenuItem>
                                        </TextField>
                                        {(cur.mode === 'percentage' || cur.mode === 'flat') && (
                                            <TextField
                                                label={cur.mode === 'percentage' ? 'Value %' : 'Value ₹'}
                                                type="number"
                                                size="small"
                                                inputProps={{ min: 0 }}
                                                value={cur.value ?? ''}
                                                onChange={(e) =>
                                                    setFee({
                                                        value:
                                                            e.target.value === ''
                                                                ? ''
                                                                : Number(e.target.value),
                                                    })
                                                }
                                                sx={{ flex: 1 }}
                                            />
                                        )}
                                    </Stack>
                                );
                            })}
                        </Box>
                        {/* Platform charges — three charges (each inclusive of its
                            per-charge tax) deducted from this provider's payouts,
                            mirroring the membership plan. Stored in features.charges. */}
                        <Box>
                            <Divider sx={{ mb: 1 }} />
                            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                                Platform charges
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                                Deducted from each payout to this provider, inclusive of the
                                per-charge tax. Percentage of the payment (charge) / of the
                                charge (tax), or a fixed ₹ amount.
                            </Typography>
                            {(() => {
                                const charges = Array.isArray(form.features?.charges) ? form.features.charges : [];
                                const getC = (i) => charges[i] || {};
                                const setC = (i, patch) => {
                                    const next = [0, 1, 2].map((idx) => ({ ...getC(idx), ...(idx === i ? patch : {}) }));
                                    setForm({ ...form, features: { ...form.features, charges: next } });
                                };
                                return [0, 1, 2].map((i) => {
                                    const c = getC(i);
                                    return (
                                        <Box key={i} sx={{ mb: 1.5 }}>
                                            <Stack direction="row" spacing={1} sx={{ mb: 0.5 }}>
                                                <TextField label={`Charge ${i + 1} name`} size="small"
                                                    value={c.name ?? ''} onChange={(e) => setC(i, { name: e.target.value })} sx={{ flex: 2 }} />
                                                <TextField select label="Type" size="small"
                                                    value={c.type ?? 'percentage'} onChange={(e) => setC(i, { type: e.target.value })} sx={{ flex: 1 }}>
                                                    <MenuItem value="percentage">Percentage (%)</MenuItem>
                                                    <MenuItem value="fixed">Fixed (₹)</MenuItem>
                                                </TextField>
                                                <TextField label="Value" type="number" size="small" inputProps={{ min: 0, step: '0.01' }}
                                                    value={c.value ?? ''} onChange={(e) => setC(i, { value: e.target.value === '' ? undefined : Number(e.target.value) })} sx={{ flex: 1 }} />
                                            </Stack>
                                            <Stack direction="row" spacing={1} sx={{ pl: 2 }}>
                                                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', flex: 2 }}>
                                                    Tax on charge {i + 1}
                                                </Typography>
                                                <TextField select label="Tax type" size="small"
                                                    value={c.tax_type ?? 'percentage'} onChange={(e) => setC(i, { tax_type: e.target.value })} sx={{ flex: 1 }}>
                                                    <MenuItem value="percentage">Percentage (%)</MenuItem>
                                                    <MenuItem value="fixed">Fixed (₹)</MenuItem>
                                                </TextField>
                                                <TextField label="Tax value" type="number" size="small" inputProps={{ min: 0, step: '0.01' }}
                                                    value={c.tax_value ?? ''} onChange={(e) => setC(i, { tax_value: e.target.value === '' ? undefined : Number(e.target.value) })} sx={{ flex: 1 }} />
                                            </Stack>
                                        </Box>
                                    );
                                });
                            })()}
                        </Box>
                        {/* Employment / consultancy terms — Employee vs Consultant
                            kept in separate verticals so their fields don't mix. */}
                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                                Employment &amp; consultancy terms
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                                Defaults for Employee &amp; Consultant doctors on this plan (each
                                doctor's actual amount is set when you assign the plan).
                            </Typography>
                            {(() => {
                                const emp = form.features?.employment || {};
                                const planType = form.features?.plan_type || 'employee';
                                const setEmp = (patch) => setForm({
                                    ...form,
                                    features: { ...form.features, employment: { ...emp, ...patch } },
                                });
                                const numField = (key, label) => (
                                    <TextField
                                        label={label} type="number" size="small" inputProps={{ min: 0 }}
                                        value={emp[key] ?? ''}
                                        onChange={(e) => setEmp({ [key]: e.target.value === '' ? undefined : Number(e.target.value) })}
                                        sx={{ flex: 1 }}
                                    />
                                );
                                // Multiple working slots per day. Persist as ``day_windows``
                                // and mirror the first into the legacy day_window_start/end
                                // so existing billing_terms readers keep working.
                                const windows = Array.isArray(emp.day_windows)
                                    ? emp.day_windows
                                    : ((emp.day_window_start || emp.day_window_end)
                                        ? [{ start: emp.day_window_start || '', end: emp.day_window_end || '' }]
                                        : []);
                                const setWindows = (next) => setEmp({
                                    day_windows: next.length ? next : undefined,
                                    day_window_start: next[0]?.start || undefined,
                                    day_window_end: next[0]?.end || undefined,
                                });
                                const patchWindow = (i, patch) => setWindows(
                                    windows.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));
                                return (
                                    <Stack spacing={2}>
                                        {/* ── Employee terms (only for an employee plan) ── */}
                                        {planType === 'employee' && (
                                        <Paper variant="outlined" sx={{ p: 1.5, borderColor: 'primary.light' }}>
                                            <Typography variant="overline" color="primary" fontWeight={700}>
                                                Employee
                                            </Typography>
                                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1 }}>
                                                {numField('default_monthly_salary', 'Default monthly salary (₹)')}
                                                <TextField select label="Salary cadence" size="small" value={emp.payment_cadence || 'monthly'}
                                                    onChange={(e) => setEmp({ payment_cadence: e.target.value })} sx={{ flex: 1 }}>
                                                    <MenuItem value="monthly">Monthly</MenuItem>
                                                    <MenuItem value="fortnightly">Every 15 days</MenuItem>
                                                </TextField>
                                            </Stack>
                                        </Paper>
                                        )}

                                        {/* ── Consultant terms (only for a consultant plan) ── */}
                                        {planType === 'consultant' && (
                                        <Paper variant="outlined" sx={{ p: 1.5, borderColor: 'secondary.light' }}>
                                            <Typography variant="overline" color="secondary" fontWeight={700}>
                                                Consultant
                                            </Typography>
                                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1 }}>
                                                {numField('default_base_retainer', 'Default base retainer (₹)')}
                                                <TextField select label="Retainer cadence" size="small" value={emp.retainer_cadence || 'monthly'}
                                                    onChange={(e) => setEmp({ retainer_cadence: e.target.value })} sx={{ flex: 1 }}>
                                                    <MenuItem value="monthly">Monthly</MenuItem>
                                                    <MenuItem value="fortnightly">Every 15 days</MenuItem>
                                                </TextField>
                                            </Stack>
                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5, mb: 0.5 }}>
                                                Commitment to push slots — the minimum the consultant opens.
                                                Per-patient payouts start once the min hours below are served.
                                            </Typography>
                                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                                                {numField('commitment_hours_per_day', 'Commitment hrs / day')}
                                                {numField('commitment_hours_per_week', 'Commitment hrs / week')}
                                                {numField('commitment_hours_per_month', 'Commitment hrs / month')}
                                            </Stack>
                                        </Paper>
                                        )}

                                        <Divider textAlign="left">
                                            <Typography variant="caption" color="text.secondary">
                                                Shared availability &amp; fees
                                            </Typography>
                                        </Divider>

                                        <Typography variant="caption" color="text.secondary">
                                            Minimum slot hours — for consultants, per-patient payouts start
                                            after these hours; for employees, tracked &amp; warned.
                                        </Typography>
                                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                                            {numField('min_hours_per_day', 'Min hrs / day')}
                                            {numField('min_hours_per_week', 'Min hrs / week')}
                                            {numField('min_hours_per_month', 'Min hrs / month')}
                                        </Stack>

                                        {/* Multiple working slots in a day */}
                                        <Box>
                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                                Working day slots (add more than one for a split shift)
                                            </Typography>
                                            <Stack spacing={1}>
                                                {windows.map((w, i) => (
                                                    <Stack key={i} direction="row" spacing={1} alignItems="center">
                                                        <TextField label="Start" type="time" size="small" InputLabelProps={{ shrink: true }}
                                                            value={w.start || ''} onChange={(e) => patchWindow(i, { start: e.target.value })} sx={{ flex: 1 }} />
                                                        <TextField label="End" type="time" size="small" InputLabelProps={{ shrink: true }}
                                                            value={w.end || ''} onChange={(e) => patchWindow(i, { end: e.target.value })} sx={{ flex: 1 }} />
                                                        <IconButton size="small" color="error"
                                                            onClick={() => setWindows(windows.filter((_, idx) => idx !== i))}>
                                                            <DeleteIcon fontSize="small" />
                                                        </IconButton>
                                                    </Stack>
                                                ))}
                                            </Stack>
                                            <Button size="small" startIcon={<AddIcon />} sx={{ mt: 1 }}
                                                onClick={() => setWindows([...windows, { start: '', end: '' }])}>
                                                Add slot
                                            </Button>
                                        </Box>

                                        <TextField select label="Salary/retainer fee mode" size="small" value={emp.platform_fee_mode || 'zero'}
                                            onChange={(e) => setEmp({ platform_fee_mode: e.target.value })} sx={{ maxWidth: 360 }}>
                                            <MenuItem value="zero">None (0)</MenuItem>
                                            <MenuItem value="plan">Plan deduction (uses the deduction above)</MenuItem>
                                            <MenuItem value="custom">Custom (per doctor)</MenuItem>
                                        </TextField>
                                    </Stack>
                                );
                            })()}
                        </Box>
                        {/* Offered consultation types ceiling (Item 2E) */}
                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                                Offered consultation types (ceiling)
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                                Which consultation types a doctor on this plan may offer. Leave all unchecked = no restriction.
                            </Typography>
                            <FormGroup row>
                                {['video', 'audio', 'chat', 'complete', 'home_visit', 'camp'].map((t) => {
                                    const sel = form.features?.offered_consultation_types || [];
                                    const toggle = () => {
                                        const next = sel.includes(t) ? sel.filter((x) => x !== t) : [...sel, t];
                                        setForm({
                                            ...form,
                                            features: {
                                                ...form.features,
                                                offered_consultation_types: next.length ? next : undefined,
                                            },
                                        });
                                    };
                                    return (
                                        <FormControlLabel key={t}
                                            control={<Checkbox size="small" checked={sel.includes(t)} onChange={toggle} />}
                                            label={t} />
                                    );
                                })}
                            </FormGroup>
                        </Box>
                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                Features included in this plan
                            </Typography>
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block', mb: 1 }}
                            >
                                Toggle the dotted feature paths this plan
                                unlocks for the {activeVertical.label.toLowerCase()}{' '}
                                who subscribe to it. Only in-tenant
                                capabilities appear here — tenant-level
                                features like subdomain, landing builder,
                                marketplace listings and payment-gateway
                                config belong to your tenant's SaaS
                                subscription with larazen, not to a
                                provider plan inside your tenant.
                            </Typography>
                            <FeatureTreeEditor
                                value={form.features || {}}
                                onChange={(features) => setForm({ ...form, features })}
                                usePathsHook={useGetTenantFeaturePathsQuery}
                                // Scope the whitelist to the active
                                // vertical so tenant-level features
                                // (subdomain, landing builder,
                                // marketplace listings) don't appear
                                // here — they belong to the tenant's
                                // SaaS subscription, not to a
                                // provider plan inside the tenant.
                                // ``activeVertical.key`` (not .value;
                                // the VERTICALS objects use ``key``
                                // for the doctor/clinic/hospital
                                // string).
                                pathsHookArg={activeVertical.key}
                            />
                        </Box>
                        <Alert severity="info">
                            Plans start in <strong>draft</strong>. Flip to{' '}
                            <strong>active</strong> to expose them on the
                            in-tenant signup picker. Existing subscriptions
                            stay intact when you archive a plan later.
                        </Alert>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeDialog}>Cancel</Button>
                    {/* Surface the disabled reason on hover so the user
                        knows what's missing instead of seeing a silent
                        no-op click on the Create button. */}
                    {(() => {
                        const saving = createState.isLoading
                            || updateState.isLoading;
                        const missing = [];
                        if (!form.code) missing.push('code');
                        if (!form.name) missing.push('name');
                        const reason = saving
                            ? 'Saving…'
                            : (missing.length ? `Fill in: ${missing.join(', ')}` : '');
                        return (
                            <Tooltip
                                title={reason || ''}
                                disableHoverListener={!reason}
                            >
                                <span>
                                    <Button
                                        variant="contained"
                                        onClick={handleSave}
                                        disabled={!!reason}
                                    >
                                        {editingId ? 'Save' : 'Create'}
                                    </Button>
                                </span>
                            </Tooltip>
                        );
                    })()}
                </DialogActions>
            </Dialog>
        </Container>
    );
};


export default TenantProviderPlansAdmin;
