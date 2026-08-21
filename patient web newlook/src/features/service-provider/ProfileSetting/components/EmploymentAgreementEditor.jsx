/**
 * EmploymentAgreementEditor — admin-only. Convert a doctor's billing type and
 * edit the employment/consultancy agreement (min-slot rules, salary, cadence,
 * platform fee). Lives inside the AnalyticsSection admin panel (reusing that
 * per-doctor settings surface).
 */
import { useState, useEffect } from 'react';
import {
    Box, Typography, ToggleButtonGroup, ToggleButton, TextField, Button,
    Stack, Divider, Alert, Snackbar, CircularProgress, Chip,
    Dialog, DialogTitle, DialogContent, DialogActions, MenuItem,
} from '@mui/material';
import {
    useGetDoctorBillingQuery,
    useConvertDoctorTypeMutation,
    useUpdateAgreementMutation,
    useGenerateSalaryPayoutMutation,
    useGetSalaryPayoutsQuery,
    useUpdateSalaryStatusMutation,
    useAdjustSalaryPayoutMutation,
    usePushSalaryPayoutMutation,
} from '../../../admin/api/doctorBillingEndpoints';
import { toLocalDateString } from '../../../../common/utils/date';

const ADJUST_KINDS = [
    { value: 'lwp', label: 'Leave Without Pay' },
    { value: 'penalty', label: 'Penalty' },
    { value: 'bonus', label: 'Bonus' },
    { value: 'correction', label: 'Manual Correction' },
];

const monthRange = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const fmt = (d) => toLocalDateString(d);
    return { period_start: fmt(start), period_end: fmt(end) };
};

const EMPTY = {
    min_hours_per_day: '', min_hours_per_week: '', min_hours_per_month: '',
    day_window_start: '', day_window_end: '',
    chat_min: '', audio_min: '', video_min: '',
    monthly_salary: '', payment_cadence: 'monthly',
    platform_fee_mode: 'zero', platform_fee_value: '',
    base_retainer_amount: '',
};

const fromAgreement = (a) => {
    if (!a) return { ...EMPTY };
    const ptm = a.per_type_minimums || {};
    return {
        min_hours_per_day: a.min_hours_per_day ?? '',
        min_hours_per_week: a.min_hours_per_week ?? '',
        min_hours_per_month: a.min_hours_per_month ?? '',
        day_window_start: a.day_window_start || '',
        day_window_end: a.day_window_end || '',
        chat_min: ptm.chat ?? '', audio_min: ptm.audio ?? '', video_min: ptm.video ?? '',
        monthly_salary: a.monthly_salary ?? '',
        payment_cadence: a.payment_cadence || 'monthly',
        platform_fee_mode: a.platform_fee_mode || 'zero',
        platform_fee_value: a.platform_fee_value ?? '',
        base_retainer_amount: a.base_retainer_amount ?? '',
    };
};

const toPayload = (f) => {
    const per_type_minimums = {};
    if (f.chat_min !== '') per_type_minimums.chat = Number(f.chat_min);
    if (f.audio_min !== '') per_type_minimums.audio = Number(f.audio_min);
    if (f.video_min !== '') per_type_minimums.video = Number(f.video_min);
    return {
        min_hours_per_day: f.min_hours_per_day === '' ? null : Number(f.min_hours_per_day),
        min_hours_per_week: f.min_hours_per_week === '' ? null : Number(f.min_hours_per_week),
        min_hours_per_month: f.min_hours_per_month === '' ? null : Number(f.min_hours_per_month),
        day_window_start: f.day_window_start || null,
        day_window_end: f.day_window_end || null,
        per_type_minimums,
        monthly_salary: f.monthly_salary === '' ? 0 : Number(f.monthly_salary),
        payment_cadence: f.payment_cadence,
        platform_fee_mode: f.platform_fee_mode,
        platform_fee_value: f.platform_fee_value === '' ? null : Number(f.platform_fee_value),
        base_retainer_amount: f.base_retainer_amount === '' ? null : Number(f.base_retainer_amount),
    };
};

const EmploymentAgreementEditor = ({ doctorId }) => {
    const { data, isLoading } = useGetDoctorBillingQuery(doctorId, { skip: !doctorId });
    const [convertType, { isLoading: converting }] = useConvertDoctorTypeMutation();
    const [updateAgreement, { isLoading: savingAgr }] = useUpdateAgreementMutation();
    const [generateSalary, { isLoading: genSalary }] = useGenerateSalaryPayoutMutation();
    const [updateSalary] = useUpdateSalaryStatusMutation();
    const [adjustSalary, { isLoading: adjusting }] = useAdjustSalaryPayoutMutation();
    const [pushSalary, { isLoading: pushing }] = usePushSalaryPayoutMutation();
    const [adjustFor, setAdjustFor] = useState(null);
    const [adjustForm, setAdjustForm] = useState({ amount: '', kind: 'lwp', reason: '' });

    const openAdjust = (row) => {
        setAdjustFor(row);
        setAdjustForm({ amount: '', kind: 'lwp', reason: '' });
    };

    const submitAdjust = async () => {
        const amt = parseFloat(adjustForm.amount);
        if (!amt) { notify('Enter a non-zero amount', 'warning'); return; }
        if (!adjustForm.reason.trim()) { notify('A reason is required', 'warning'); return; }
        // Deductions are entered as a positive number and sent signed, so the
        // admin never has to remember to type a minus.
        const signed = ['lwp', 'penalty'].includes(adjustForm.kind) ? -Math.abs(amt) : Math.abs(amt);
        try {
            await adjustSalary({
                id: adjustFor.id, amount: signed,
                kind: adjustForm.kind, reason: adjustForm.reason.trim(),
            }).unwrap();
            notify('Adjustment recorded', 'success');
            setAdjustFor(null);
        } catch (err) {
            notify(err?.data?.error || err?.data?.message || 'Adjustment failed', 'error');
        }
    };
    const { data: salaryRows = [] } = useGetSalaryPayoutsQuery({ doctor_id: doctorId }, { skip: !doctorId });

    const billingType = data?.profile?.billing_type || 'plan';
    const [type, setType] = useState('plan');
    const [salaryOverride, setSalaryOverride] = useState('');
    const [retainerOverride, setRetainerOverride] = useState('');
    const [secondOpinionOverride, setSecondOpinionOverride] = useState('');
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

    useEffect(() => {
        if (data) {
            setType(data.profile?.billing_type || 'plan');
            setSalaryOverride(data.profile?.salary_override ?? '');
            setRetainerOverride(data.profile?.retainer_override ?? '');
            setSecondOpinionOverride(data.profile?.second_opinion_rate_override ?? '');
        }
    }, [data]);

    const notify = (message, severity = 'info') => setSnackbar({ open: true, message, severity });
    const isEmployed = type === 'employee' || type === 'consultant';

    const handleSave = async () => {
        try {
            const payload = { doctorId, billing_type: type };
            if (isEmployed) {
                payload.salary_override = salaryOverride === '' ? null : Number(salaryOverride);
                payload.retainer_override = retainerOverride === '' ? null : Number(retainerOverride);
            }
            payload.second_opinion_rate_override =
                secondOpinionOverride === '' ? null : Number(secondOpinionOverride);
            await convertType(payload).unwrap();
            notify(type === 'plan' ? 'Doctor set to Plan' : `Set to ${type}`, 'success');
        } catch (err) {
            notify(err?.data?.message || err?.data?.error || 'Save failed', 'error');
        }
    };

    if (isLoading) return <CircularProgress size={22} />;

    return (
        <Box sx={{ mb: 3 }}>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Admin: Employment / Billing Type
                <Chip label={billingType.toUpperCase()} size="small" sx={{ ml: 1 }}
                    color={billingType === 'plan' ? 'default' : 'primary'} />
            </Typography>
            <ToggleButtonGroup value={type} exclusive size="small" sx={{ mb: 2 }}
                onChange={(_, v) => v && setType(v)}>
                <ToggleButton value="plan">Plan</ToggleButton>
                <ToggleButton value="employee">Employee</ToggleButton>
                <ToggleButton value="consultant">Consultant</ToggleButton>
            </ToggleButtonGroup>

            {/* Family-doctor second-opinion credit rate — per-doctor override
                of the plan's rate; applies to any doctor (all billing types). */}
            <Box sx={{ mb: 2 }}>
                <TextField
                    size="small" type="number"
                    label="Second-opinion credit rate — this doctor"
                    value={secondOpinionOverride}
                    onChange={(e) => setSecondOpinionOverride(e.target.value)}
                    helperText="Credits earned per empanelled patient's completed booking. Blank = use the plan rate."
                    sx={{ width: 320 }}
                />
            </Box>

            {isEmployed && (
                <Box sx={{ mb: 1 }}>
                    <Alert severity="info" sx={{ mb: 2 }}>
                        Pay terms — minimum slot hours, day window, default salary/retainer, cadence, and
                        the platform-fee mode — come from the doctor's <strong>plan</strong>. Assign or
                        change it in <strong>Provider Subscriptions</strong> (or the doctor requests one in
                        their portal and you approve it). Set this doctor's actual pay below if it differs
                        from the plan default.
                    </Alert>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        {type !== 'consultant' ? (
                            <TextField fullWidth size="small" type="number" label="Monthly salary — this doctor (₹)"
                                value={salaryOverride} onChange={(e) => setSalaryOverride(e.target.value)}
                                helperText="Blank = use the plan default" />
                        ) : (
                            <TextField fullWidth size="small" type="number" label="Base retainer — this doctor (₹)"
                                value={retainerOverride} onChange={(e) => setRetainerOverride(e.target.value)}
                                helperText="Blank = use the plan default" />
                        )}
                    </Stack>
                    {type === 'consultant' && (
                        <Alert severity="info" sx={{ mt: 1 }}>Consultant = base retainer + per-patient earnings above the minimum slots (per-patient uses the plan T-day hold).</Alert>
                    )}
                </Box>
            )}

            <Button variant="contained" size="small" sx={{ mt: 1 }} disabled={converting} onClick={handleSave}>
                {type === 'plan' ? 'Set to Plan' : `Set to ${type}`}
            </Button>

            {/* Salary payouts (admin) — generate + settle */}
            {billingType !== 'plan' && (
                <Box sx={{ mt: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
                        <Typography variant="subtitle2" fontWeight={600}>Salary / Retainer Payouts</Typography>
                        <Button size="small" variant="outlined" disabled={genSalary}
                            onClick={async () => {
                                try { await generateSalary({ doctorId, ...monthRange(), kind: billingType === 'consultant' ? 'retainer' : 'salary' }).unwrap(); notify('Salary generated for this month', 'success'); }
                                catch (err) { notify(err?.data?.message || 'Generate failed', 'error'); }
                            }}>
                            Generate this month
                        </Button>
                    </Box>
                    {salaryRows.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">No salary payouts yet.</Typography>
                    ) : (
                        salaryRows.map((s) => {
                            const adjusted = Number(s.adjustments_total || 0) !== 0;
                            // Adjusting after the push would move a figure the
                            // doctor has already been shown and can claim.
                            const adjustable = ['pending', 'on_hold'].includes(s.status);
                            return (
                                <Box key={s.id} sx={{ py: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 0.5 }}>
                                        <Typography variant="body2">
                                            {s.period_start} → {s.period_end} · {s.kind} ·{' '}
                                            {adjusted ? (
                                                <>
                                                    <Box component="span" sx={{ textDecoration: 'line-through', color: 'text.disabled', mr: 0.5 }}>
                                                        ₹{s.gross_salary}
                                                    </Box>
                                                    <Box component="span" fontWeight={600}>₹{s.net_amount}</Box>
                                                </>
                                            ) : (
                                                <Box component="span" fontWeight={600}>₹{s.net_amount}</Box>
                                            )}
                                            <Chip label={s.status} size="small" sx={{ ml: 1 }}
                                                color={s.status === 'completed' ? 'success' : 'warning'} variant="outlined" />
                                            {s.compliance_withheld && <Chip label="Withheld" size="small" color="error" sx={{ ml: 0.5 }} />}
                                        </Typography>
                                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                                            {adjustable && (
                                                <Button size="small" onClick={() => openAdjust(s)}>Adjust</Button>
                                            )}
                                            {adjustable && (
                                                <Button size="small" variant="contained" color="secondary"
                                                    disabled={s.compliance_withheld || pushing}
                                                    onClick={async () => {
                                                        try { await pushSalary({ id: s.id }).unwrap(); notify('Pushed — the doctor can now claim it', 'success'); }
                                                        catch (err) { notify(err?.data?.error || err?.data?.message || 'Push failed', 'error'); }
                                                    }}>Push to doctor</Button>
                                            )}
                                            <Button size="small" color={s.compliance_withheld ? 'primary' : 'error'}
                                                onClick={async () => {
                                                    try { await updateSalary({ id: s.id, compliance_withheld: !s.compliance_withheld }).unwrap(); notify(s.compliance_withheld ? 'Released' : 'Withheld', 'success'); }
                                                    catch (err) { notify(err?.data?.message || 'Failed', 'error'); }
                                                }}>{s.compliance_withheld ? 'Release' : 'Withhold'}</Button>
                                        </Box>
                                    </Box>
                                    {/* The audit trail: expected vs approved and why, kept
                                        visible rather than hidden behind a dialog. */}
                                    {(s.adjustments || []).map((a) => (
                                        <Typography key={a.id} variant="caption" color="text.secondary" sx={{ display: 'block', pl: 1 }}>
                                            {Number(a.amount) < 0 ? '−' : '+'}₹{Math.abs(Number(a.amount))} · {a.kind} · {a.reason}
                                            {a.created_by_name ? ` — ${a.created_by_name}` : ''}
                                            {a.created_at ? ` (${new Date(a.created_at).toLocaleDateString()})` : ''}
                                        </Typography>
                                    ))}
                                </Box>
                            );
                        })
                    )}
                </Box>
            )}

            <Dialog open={!!adjustFor} onClose={() => setAdjustFor(null)} maxWidth="xs" fullWidth>
                <DialogTitle>Adjust salary</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <Alert severity="info">
                            The original salary of ₹{adjustFor?.gross_salary} is kept. This is
                            recorded as a separate, permanent entry the doctor can see.
                        </Alert>
                        <TextField select label="Type" size="small" value={adjustForm.kind}
                            onChange={(e) => setAdjustForm((f) => ({ ...f, kind: e.target.value }))}>
                            {ADJUST_KINDS.map((k) => (
                                <MenuItem key={k.value} value={k.value}>{k.label}</MenuItem>
                            ))}
                        </TextField>
                        <TextField label="Amount (₹)" type="number" size="small" value={adjustForm.amount}
                            onChange={(e) => setAdjustForm((f) => ({ ...f, amount: e.target.value }))}
                            helperText={['lwp', 'penalty'].includes(adjustForm.kind)
                                ? 'Entered as a positive number; it will be deducted.'
                                : 'Will be added to the payout.'} />
                        <TextField label="Reason (required)" size="small" multiline rows={2}
                            value={adjustForm.reason} required
                            onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))}
                            placeholder="e.g. Leave Without Pay (2 Days)" />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAdjustFor(null)}>Cancel</Button>
                    <Button variant="contained" onClick={submitAdjust} disabled={adjusting}>
                        {adjusting ? 'Saving…' : 'Record adjustment'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar open={snackbar.open} autoHideDuration={3500} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snackbar.severity} variant="filled">{snackbar.message}</Alert>
            </Snackbar>
        </Box>
    );
};

export default EmploymentAgreementEditor;
