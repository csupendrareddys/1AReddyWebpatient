/**
 * AppointmentTypesPanel — the admin "Appointments" tab: a tenant-wide master
 * switch per consultation type (+ marketplace). When a type is off, no doctor
 * can offer it and patients can't book it in this tenant.
 */
import { useState, useEffect, useRef } from 'react';
import {
    Box, Paper, Typography, Switch, FormControlLabel, Button, Alert,
    Snackbar, CircularProgress, Stack,
} from '@mui/material';
import {
    useGetTenantAppointmentTypesQuery,
    useUpdateTenantAppointmentTypesMutation,
} from '../../../api/tenantSettingsEndpoints';

const LABELS = {
    audio: 'Voice Consultation',
    video: 'Video Consultation',
    chat: 'Chat Consultation',
    complete: 'In-Person Consultation',
    home_visit: 'Home Visit Consultancy',
    camp: 'Camp Consultancy',
    marketplace: 'Marketplace',
};
const ORDER = ['audio', 'video', 'chat', 'complete', 'home_visit', 'camp', 'marketplace'];
const allEnabled = () => ORDER.reduce((a, k) => ({ ...a, [k]: true }), {});

const AppointmentTypesPanel = () => {
    const { data, isLoading, isError } = useGetTenantAppointmentTypesQuery();
    const [update, { isLoading: saving }] = useUpdateTenantAppointmentTypesMutation();

    // Local editing copy. Defaults to all-enabled (the backend default for an
    // unset tenant) so the switches are correct and toggleable even before the
    // server value arrives or if the request fails.
    const [state, setState] = useState(allEnabled);
    const [snack, setSnack] = useState(null);

    // Seed from the server value exactly once, when it first resolves. Doing it
    // once (guarded by a ref) — rather than on every `data` change — prevents a
    // background refetch, or an undefined/defaulted `data`, from re-running and
    // wiping out in-progress toggles. Missing keys default to enabled.
    const seededRef = useRef(false);
    useEffect(() => {
        if (!seededRef.current && data && typeof data === 'object') {
            seededRef.current = true;
            setState(ORDER.reduce((a, k) => ({ ...a, [k]: data[k] !== false }), {}));
        }
    }, [data]);

    const toggle = (k) => setState((s) => ({ ...s, [k]: !s[k] }));
    const setAll = (v) => setState(ORDER.reduce((a, k) => ({ ...a, [k]: v }), {}));
    const save = async () => {
        try {
            await update(state).unwrap();
            setSnack({ sev: 'success', msg: 'Appointment types saved' });
        } catch (e) {
            setSnack({ sev: 'error', msg: e?.data?.error || e?.data?.message || 'Save failed' });
        }
    };

    if (isLoading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>;
    }

    return (
        <Paper sx={{ p: 3 }}>
            <Typography variant="h6" fontWeight={600} gutterBottom>Appointments (tenant-wide)</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Turn each appointment type on or off for the whole tenant. When a type is off,
                no doctor can offer it and patients can't book it.
            </Typography>
            {isError && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    Couldn't load the saved settings from the server — showing defaults. You can still
                    edit below, but saving may fail until the backend endpoint is available.
                </Alert>
            )}
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <Button size="small" variant="outlined" onClick={() => setAll(true)}>Enable all</Button>
                <Button size="small" variant="outlined" color="error" onClick={() => setAll(false)}>Disable all</Button>
            </Stack>
            {ORDER.map((k) => (
                <FormControlLabel
                    key={k}
                    sx={{ display: 'block', mb: 0.5 }}
                    control={<Switch name={k} checked={!!state[k]} onChange={() => toggle(k)} />}
                    label={LABELS[k] || k}
                />
            ))}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                <Button variant="contained" onClick={save} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                </Button>
            </Box>
            {snack && (
                <Snackbar open autoHideDuration={3500} onClose={() => setSnack(null)}
                    anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                    <Alert severity={snack.sev} variant="filled">{snack.msg}</Alert>
                </Snackbar>
            )}
        </Paper>
    );
};

export default AppointmentTypesPanel;
