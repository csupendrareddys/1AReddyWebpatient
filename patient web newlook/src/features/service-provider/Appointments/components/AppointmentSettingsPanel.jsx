/**
 * AppointmentSettingsPanel (Item 3B) — the doctor's master appointments switch
 * plus which consultation types they offer. Sits atop the Appointments section
 * of the Manage page, above the availability schedule.
 */
import { useState, useEffect } from 'react';
import {
    Box, Paper, Typography, Switch, FormControlLabel, FormGroup, Checkbox,
    Button, Alert, Snackbar, CircularProgress, Divider,
} from '@mui/material';
import {
    useGetAppointmentSettingsQuery,
    useUpdateAppointmentSettingsMutation,
} from '../../api/scopedDoctorApi';

const TYPE_LABELS = {
    video: 'Video', audio: 'Audio', chat: 'Chat',
    complete: 'Complete', home_visit: 'Home Visit', camp: 'Camp',
};

const AppointmentSettingsPanel = () => {
    const { data, isLoading } = useGetAppointmentSettingsQuery();
    const [save, { isLoading: saving }] = useUpdateAppointmentSettingsMutation();
    const [enabled, setEnabled] = useState(true);
    const [offered, setOffered] = useState([]);
    const [snack, setSnack] = useState(null);

    useEffect(() => {
        if (data) {
            setEnabled(!!data.appointments_enabled);
            setOffered(data.offered_consultation_types || []);
        }
    }, [data]);

    const all = data?.all_consultation_types || [];
    const toggleType = (t) =>
        setOffered((o) => (o.includes(t) ? o.filter((x) => x !== t) : [...o, t]));

    const handleSave = async () => {
        try {
            await save({ appointments_enabled: enabled, offered_consultation_types: offered }).unwrap();
            setSnack({ sev: 'success', msg: 'Appointment settings saved' });
        } catch (e) {
            setSnack({ sev: 'error', msg: e?.data?.error || e?.data?.message || 'Save failed' });
        }
    };

    if (isLoading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>;
    }

    return (
        <Paper sx={{ p: 3, borderRadius: 2, mb: 3 }}>
            <Typography variant="h6" fontWeight={600} gutterBottom>Appointments</Typography>
            <FormControlLabel
                control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
                label={enabled ? 'Accepting appointments' : 'Not accepting appointments'}
            />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Master switch — when off, you won't take any new appointments.
            </Typography>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                Consultation types you offer
            </Typography>
            <FormGroup row>
                {all.map((t) => (
                    <FormControlLabel
                        key={t}
                        control={
                            <Checkbox
                                checked={offered.includes(t)}
                                onChange={() => toggleType(t)}
                                disabled={!enabled}
                            />
                        }
                        label={TYPE_LABELS[t] || t}
                    />
                ))}
            </FormGroup>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                <Button variant="contained" onClick={handleSave} disabled={saving}>
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

export default AppointmentSettingsPanel;
