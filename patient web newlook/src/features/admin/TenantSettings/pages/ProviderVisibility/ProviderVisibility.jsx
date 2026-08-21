/**
 * ProviderVisibility — SUPER_ADMIN page to turn the doctor Discover directory
 * on/off per provider type. Turn on at the start to help doctors grow their
 * network / links, turn off anytime later.
 */
import {
    Box, Typography, Paper, Stack, Switch, FormControlLabel, Divider,
    CircularProgress, Snackbar, Alert, Chip,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import BusinessIcon from '@mui/icons-material/Business';
import { useState } from 'react';

import {
    useGetProviderVisibilityQuery,
    useUpdateProviderVisibilityMutation,
} from '../../../api/tenantSettingsEndpoints';

const ROWS = [
    { key: 'doctors', label: 'Doctors', icon: PersonIcon, desc: 'Doctors can browse and connect with all other doctors in the tenant.' },
    { key: 'hospitals', label: 'Hospitals', icon: LocalHospitalIcon, desc: 'Doctors can browse and connect with all hospitals in the tenant.' },
    { key: 'clinics', label: 'Clinics', icon: BusinessIcon, desc: 'Doctors can browse and connect with all clinics in the tenant.' },
];

const ProviderVisibility = () => {
    const { data: visibility = {}, isLoading } = useGetProviderVisibilityQuery();
    const [updateVisibility, { isLoading: saving }] = useUpdateProviderVisibilityMutation();
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

    const toggle = async (key, value) => {
        try {
            await updateVisibility({ [key]: value }).unwrap();
            setSnackbar({ open: true, message: `${key} directory ${value ? 'enabled' : 'disabled'}`, severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err?.data?.message || 'Update failed', severity: 'error' });
        }
    };

    if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;

    return (
        <Box sx={{ p: 3, maxWidth: 720 }}>
            <Typography variant="h5" fontWeight="bold" gutterBottom>Provider Directory Visibility</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Control whether doctors can browse a "Discover" directory of all providers in your tenant to grow their
                network and links. Turn these on early to bootstrap connections, and off once your network is established.
                (Patient-facing listings are unaffected.)
            </Typography>

            <Paper sx={{ p: 1 }}>
                {ROWS.map((row, i) => {
                    const Icon = row.icon;
                    const on = !!visibility[row.key];
                    return (
                        <Box key={row.key}>
                            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 2 }}>
                                <Stack direction="row" spacing={2} alignItems="center">
                                    <Icon color={on ? 'primary' : 'disabled'} />
                                    <Box>
                                        <Stack direction="row" spacing={1} alignItems="center">
                                            <Typography variant="subtitle1" fontWeight={600}>{row.label}</Typography>
                                            <Chip size="small" label={on ? 'Visible' : 'Hidden'} color={on ? 'success' : 'default'} variant="outlined" />
                                        </Stack>
                                        <Typography variant="body2" color="text.secondary">{row.desc}</Typography>
                                    </Box>
                                </Stack>
                                <FormControlLabel
                                    control={<Switch checked={on} disabled={saving} onChange={(e) => toggle(row.key, e.target.checked)} />}
                                    label=""
                                />
                            </Stack>
                            {i < ROWS.length - 1 && <Divider />}
                        </Box>
                    );
                })}
            </Paper>

            <Snackbar open={snackbar.open} autoHideDuration={3500} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snackbar.severity} variant="filled">{snackbar.message}</Alert>
            </Snackbar>
        </Box>
    );
};

export default ProviderVisibility;
