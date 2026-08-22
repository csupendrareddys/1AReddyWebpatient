/**
 * FamilyPage — the guardian manages minor sub-profiles. Add a minor (a
 * login-less patient), see the list, and "Open" one to switch into a full
 * replica of the patient dashboard scoped to that minor.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
    DialogActions, DialogContent, DialogTitle, Grid, List, ListItem,
    ListItemText, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import ChildCareIcon from '@mui/icons-material/ChildCare';
import LoginIcon from '@mui/icons-material/Login';

import { useGetMinorsQuery, useCreateMinorMutation } from '../api/familyEndpoints';
import LinkedFamilySection from '../components/LinkedFamilySection';
import RoleManager from '../components/RoleManager';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');
const EMPTY = { first_name: '', last_name: '', relation: 'Child', dob: '', gender: '' };

export default function FamilyPage() {
    const navigate = useNavigate();
    const { data: minors = [], isLoading } = useGetMinorsQuery();
    const [createMinor, { isLoading: saving }] = useCreateMinorMutation();

    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(EMPTY);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const onSave = async () => {
        setError(null);
        try {
            await createMinor({ ...form, last_name: form.last_name || undefined }).unwrap();
            setOpen(false); setForm(EMPTY);
        } catch (e) {
            setError(e?.data?.message || e?.data?.error || 'Could not create the profile.');
        }
    };

    return (
        <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <ChildCareIcon color="primary" />
                <Typography variant="h4">Family</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Add a child or dependent as a separate profile — no separate login. Open
                one to book and track their appointments and health records under your account.
            </Typography>

            <Card sx={{ mb: 3 }}>
                <CardContent>
                    <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
                        <Typography variant="subtitle1" fontWeight={600} sx={{ flexGrow: 1 }}>
                            Minor profiles ({minors.length})
                        </Typography>
                        <Button variant="contained" onClick={() => { setForm(EMPTY); setError(null); setOpen(true); }}>
                            Add minor
                        </Button>
                    </Stack>
                    {isLoading ? <CircularProgress size={22} />
                        : minors.length === 0 ? (
                            <Typography color="text.secondary">No minor profiles yet.</Typography>
                        ) : (
                            <List dense>
                                {minors.map((m) => (
                                    <ListItem key={m.id} divider sx={{ pr: 18 }}
                                        secondaryAction={
                                            <Stack direction="row" alignItems="center" spacing={1}>
                                                <Chip size="small" label="No login" />
                                                <Button size="small" variant="outlined" startIcon={<LoginIcon />}
                                                    onClick={() => navigate(`/dashboard/patient/family/${m.id}`)}>
                                                    Open
                                                </Button>
                                            </Stack>
                                        }>
                                        <ListItemText
                                            primary={m.full_name}
                                            secondary={`${m.relation}${m.dob ? ` · b. ${fmtDate(m.dob)}` : ''}`} />
                                    </ListItem>
                                ))}
                            </List>
                        )}
                </CardContent>
            </Card>

            {/* Reciprocal adult links: assign roles to family who act for me,
                and open accounts others have shared with me. */}
            <LinkedFamilySection />

            {/* Author the roles that gate what a linked adult may do on my behalf. */}
            <RoleManager />

            <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
                <DialogTitle>Add a minor</DialogTitle>
                <DialogContent dividers>
                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                    <Grid container spacing={2}>
                        <Grid item xs={12} sm={6}>
                            <TextField autoFocus fullWidth label="First name" value={form.first_name} onChange={set('first_name')} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Last name" value={form.last_name} onChange={set('last_name')} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField select fullWidth label="Relation" value={form.relation} onChange={set('relation')}>
                                {['Son', 'Daughter', 'Child', 'Dependent'].map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                            </TextField>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField select fullWidth label="Gender" value={form.gender} onChange={set('gender')}>
                                {['MALE', 'FEMALE', 'OTHER'].map((g) => <MenuItem key={g} value={g}>{g[0] + g.slice(1).toLowerCase()}</MenuItem>)}
                            </TextField>
                        </Grid>
                        <Grid item xs={12}>
                            <TextField fullWidth type="date" label="Date of birth"
                                InputLabelProps={{ shrink: true }} value={form.dob} onChange={set('dob')} />
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={onSave} disabled={saving || !form.first_name.trim()}>
                        {saving ? 'Adding…' : 'Add'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
