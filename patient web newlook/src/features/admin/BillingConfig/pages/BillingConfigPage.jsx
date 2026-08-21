/**
 * BillingConfigPage — Super admin page to configure platform charges, GST, and TDS rates.
 */
import { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, TextField, Button, Grid,
    CircularProgress, Snackbar, Alert, Divider,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import {
    useGetBillingConfigQuery,
    useUpdateBillingConfigMutation,
} from '../../api/billingConfigEndpoints';

// Mirrors app/models/_enums.py ConsultationType. Any type left blank here falls
// back to the flat CGST/SGST pair above.
const CONSULTATION_TYPES = [
    { value: 'video', label: 'Video' },
    { value: 'audio', label: 'Audio' },
    { value: 'chat', label: 'Chat' },
    { value: 'complete', label: 'Complete' },
    { value: 'home_visit', label: 'Home Visit' },
    { value: 'camp', label: 'Camp' },
];

const BillingConfigPage = () => {
    const { data: config, isLoading } = useGetBillingConfigQuery();
    const [updateConfig, { isLoading: isSaving }] = useUpdateBillingConfigMutation();

    const [form, setForm] = useState({
        cgst_rate: '9.00',
        sgst_rate: '9.00',
        // Blank means "derive as CGST + SGST" — the backend stores NULL and the
        // tax engine sums the pair. Only set it to state a rate explicitly.
        igst_rate: '',
        tds_rate: '10.00',
        default_hold_days: '0',
        // Tenant-wide % off every patient-facing price. 0 = no sale on.
        platform_discount_pct: '0',
        // { video: { cgst: '9', sgst: '9', igst: '18' }, ... } — string-valued
        // while editing; igst optional per type, same derivation rule.
        gst_by_consultation_type: {},
        // Bill template fields
        bill_company_name: 'JL Triangle Private Limited',
        bill_company_tagline: 'A Practo Group Company',
        bill_pan: 'AAFCJ1085J',
        bill_gst_reg: '36AAFCJ1085J1ZF',
        bill_cin: 'U72900TG2021PTC148836',
        bill_sac: '9993',
        bill_support_email: 'support@jlmush.com',
        bill_footer_note: 'Healthcare services exempt from GST',
        bill_logo_url: '',
    });

    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    useEffect(() => {
        if (config) {
            setForm({
                cgst_rate: config.cgst_rate || '9.00',
                sgst_rate: config.sgst_rate || '9.00',
                igst_rate: config.igst_rate != null ? String(config.igst_rate) : '',
                tds_rate: config.tds_rate || '10.00',
                default_hold_days: config.default_hold_days ?? 0,
                platform_discount_pct: config.platform_discount_pct ?? 0,
                gst_by_consultation_type: Object.fromEntries(
                    Object.entries(config.gst_by_consultation_type || {}).map(
                        ([type, rates]) => [type, {
                            cgst: rates?.cgst != null ? String(rates.cgst) : '',
                            sgst: rates?.sgst != null ? String(rates.sgst) : '',
                            igst: rates?.igst != null ? String(rates.igst) : '',
                        }],
                    ),
                ),
                bill_company_name: config.bill_company_name || 'JL Triangle Private Limited',
                bill_company_tagline: config.bill_company_tagline || 'A Practo Group Company',
                bill_pan: config.bill_pan || '',
                bill_gst_reg: config.bill_gst_reg || '',
                bill_cin: config.bill_cin || '',
                bill_sac: config.bill_sac || '',
                bill_support_email: config.bill_support_email || '',
                bill_footer_note: config.bill_footer_note || '',
                bill_logo_url: config.bill_logo_url || '',
            });
        }
    }, [config]);

    const handleChange = (field) => (e) => {
        setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };

    const handleGstTypeChange = (type, key) => (e) => {
        const { value } = e.target;
        setForm((prev) => ({
            ...prev,
            gst_by_consultation_type: {
                ...prev.gst_by_consultation_type,
                [type]: { ...(prev.gst_by_consultation_type[type] || {}), [key]: value },
            },
        }));
    };

    const handleSave = async () => {
        try {
            // Only send rows where BOTH cgst and sgst are filled; a blank row is
            // omitted so that type falls back to the flat default pair. IGST is
            // optional on top — blank leaves the backend to derive cgst + sgst.
            const cleanedGst = {};
            Object.entries(form.gst_by_consultation_type || {}).forEach(([type, rates]) => {
                const cgst = rates?.cgst;
                const sgst = rates?.sgst;
                if (cgst !== '' && cgst != null && sgst !== '' && sgst != null) {
                    const entry = { cgst: Number(cgst), sgst: Number(sgst) };
                    if (rates?.igst !== '' && rates?.igst != null) {
                        entry.igst = Number(rates.igst);
                    }
                    cleanedGst[type] = entry;
                }
            });
            const payload = {
                ...form,
                // '' → null so a cleared field means "derive", not "zero-rate".
                igst_rate: form.igst_rate === '' ? null : Number(form.igst_rate),
                gst_by_consultation_type: cleanedGst,
            };
            await updateConfig(payload).unwrap();
            setSnackbar({ open: true, message: 'Billing configuration saved successfully', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Failed to save', severity: 'error' });
        }
    };

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ maxWidth: 800, mx: 'auto', py: 4, px: 2 }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>
                Billing Configuration
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Configure GST rates and TDS for doctor billing. Platform charges
                are now set per plan under <em>Marketplace Membership Plans</em>.
            </Typography>

            {/* Sits above TDS because it's the only setting on this page that
                changes what a PATIENT sees — everything below it moves money
                between the platform and the provider after the fact. */}
            <Paper sx={{ p: 3, mb: 3 }} elevation={1}>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    Platform-wide discount
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    One percentage off <b>every</b> patient-facing price on this site —
                    consultations and catalog services alike. Cards show the old price
                    struck through beside the new one, and the discounted figure is what
                    gets charged. Set <b>0</b> for no sale.
                </Typography>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Platform Discount (%)"
                            type="number"
                            value={form.platform_discount_pct}
                            onChange={handleChange('platform_discount_pct')}
                            size="small"
                            inputProps={{ min: 0, max: 100, step: '0.01' }}
                            helperText="Applies on top of any per-doctor pricing rules. A member's own tier discount comes off after this, at billing."
                        />
                    </Grid>
                </Grid>
            </Paper>

            <Paper sx={{ p: 3, mb: 3 }} elevation={1}>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    TDS &amp; Payout Hold
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Tenant-wide defaults. Each can be overridden per doctor in their
                    profile settings. (GST is set per consultation type below.)
                </Typography>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="TDS Rate (%)"
                            type="number"
                            value={form.tds_rate}
                            onChange={handleChange('tds_rate')}
                            size="small"
                            inputProps={{ min: 0, step: '0.01' }}
                            helperText="Default for doctors without a per-doctor TDS override."
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Payout Hold (days, T)"
                            type="number"
                            value={form.default_hold_days}
                            onChange={handleChange('default_hold_days')}
                            size="small"
                            inputProps={{ min: 0, step: '1' }}
                            helperText="Days a Plan doctor's earning is held before payable/claimable (per-doctor override in their settings)."
                        />
                    </Grid>
                </Grid>
            </Paper>

            {/* GST by consultation type */}
            <Paper sx={{ p: 3, mb: 3 }} elevation={1}>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    GST by consultation type
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    The <b>Default</b> row applies to every consultation type not given
                    its own rate below. Leave a type&apos;s row blank to use the default.
                    <b> IGST</b> is the inter-state leg — leave it blank and it is derived
                    as CGST + SGST, which is what it must equal; set it only to state the
                    rate explicitly.
                </Typography>

                <Grid container spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                    <Grid item xs={12} sm={3}>
                        <Typography variant="body2" fontWeight={600}>
                            Default (all other types)
                        </Typography>
                    </Grid>
                    <Grid item xs={4} sm={3}>
                        <TextField
                            fullWidth
                            label="CGST (%)"
                            type="number"
                            value={form.cgst_rate}
                            onChange={handleChange('cgst_rate')}
                            size="small"
                            inputProps={{ min: 0, step: '0.01' }}
                        />
                    </Grid>
                    <Grid item xs={4} sm={3}>
                        <TextField
                            fullWidth
                            label="SGST (%)"
                            type="number"
                            value={form.sgst_rate}
                            onChange={handleChange('sgst_rate')}
                            size="small"
                            inputProps={{ min: 0, step: '0.01' }}
                        />
                    </Grid>
                    <Grid item xs={4} sm={3}>
                        <TextField
                            fullWidth
                            label="IGST (%)"
                            type="number"
                            value={form.igst_rate}
                            onChange={handleChange('igst_rate')}
                            size="small"
                            inputProps={{ min: 0, step: '0.01' }}
                            placeholder={String(
                                (Number(form.cgst_rate) || 0) + (Number(form.sgst_rate) || 0),
                            )}
                            helperText="Blank = CGST + SGST"
                        />
                    </Grid>
                </Grid>
                <Divider sx={{ mb: 2 }} />

                {CONSULTATION_TYPES.map(({ value, label }) => {
                    const row = form.gst_by_consultation_type[value] || {};
                    return (
                        <Grid container spacing={1} alignItems="center" key={value} sx={{ mb: 1.5 }}>
                            <Grid item xs={12} sm={3}>
                                <Typography variant="body2">{label}</Typography>
                            </Grid>
                            <Grid item xs={4} sm={3}>
                                <TextField
                                    fullWidth
                                    label="CGST (%)"
                                    type="number"
                                    value={row.cgst ?? ''}
                                    onChange={handleGstTypeChange(value, 'cgst')}
                                    size="small"
                                    inputProps={{ min: 0, step: '0.01' }}
                                    placeholder={String(form.cgst_rate)}
                                />
                            </Grid>
                            <Grid item xs={4} sm={3}>
                                <TextField
                                    fullWidth
                                    label="SGST (%)"
                                    type="number"
                                    value={row.sgst ?? ''}
                                    onChange={handleGstTypeChange(value, 'sgst')}
                                    size="small"
                                    inputProps={{ min: 0, step: '0.01' }}
                                    placeholder={String(form.sgst_rate)}
                                />
                            </Grid>
                            <Grid item xs={4} sm={3}>
                                <TextField
                                    fullWidth
                                    label="IGST (%)"
                                    type="number"
                                    value={row.igst ?? ''}
                                    onChange={handleGstTypeChange(value, 'igst')}
                                    size="small"
                                    inputProps={{ min: 0, step: '0.01' }}
                                    placeholder={String(
                                        (Number(row.cgst || form.cgst_rate) || 0)
                                        + (Number(row.sgst || form.sgst_rate) || 0),
                                    )}
                                />
                            </Grid>
                        </Grid>
                    );
                })}
            </Paper>

            <Divider sx={{ my: 3 }} />

            {/* Bill Template Settings */}
            <Paper sx={{ p: 3, mb: 3 }} elevation={1}>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    Bill / Invoice Template
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Configure the company details shown on doctor payout invoices.
                </Typography>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                        <TextField fullWidth label="Company Name" value={form.bill_company_name} onChange={handleChange('bill_company_name')} size="small" />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField fullWidth label="Company Tagline" value={form.bill_company_tagline} onChange={handleChange('bill_company_tagline')} size="small" />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField fullWidth label="PAN" value={form.bill_pan} onChange={handleChange('bill_pan')} size="small" />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField fullWidth label="GST Registration No." value={form.bill_gst_reg} onChange={handleChange('bill_gst_reg')} size="small" />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField fullWidth label="CIN" value={form.bill_cin} onChange={handleChange('bill_cin')} size="small" />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField fullWidth label="SAC Code" value={form.bill_sac} onChange={handleChange('bill_sac')} size="small" />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField fullWidth label="Support Email" value={form.bill_support_email} onChange={handleChange('bill_support_email')} size="small" />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField fullWidth label="Logo URL" value={form.bill_logo_url} onChange={handleChange('bill_logo_url')} size="small" placeholder="https://..." />
                    </Grid>
                    <Grid item xs={12}>
                        <TextField fullWidth label="Footer Note" value={form.bill_footer_note} onChange={handleChange('bill_footer_note')} size="small" multiline rows={2} />
                    </Grid>
                </Grid>
            </Paper>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                <Button
                    variant="contained"
                    startIcon={<SaveIcon />}
                    onClick={handleSave}
                    disabled={isSaving}
                    size="large"
                >
                    {isSaving ? 'Saving...' : 'Save Configuration'}
                </Button>
            </Box>

            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    severity={snackbar.severity}
                    onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                    variant="filled"
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default BillingConfigPage;
