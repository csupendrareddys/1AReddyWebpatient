/**
 * PatientStaffLanding — a caregiver's HOME. Shows their own basic profile (with
 * a change-password action) and the patient(s) they support, each opening a
 * role-bounded replica of that patient's dashboard.
 *
 * Mirrors the provider StaffDashboard: the caregiver's account lives here; the
 * work is one click in. Their identity is read-only (the patient provisioned it)
 * — the one thing they own is their password.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Alert, Avatar, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
    DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemIcon,
    ListItemText, Stack, TextField, Typography,
} from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import ChildCareIcon from '@mui/icons-material/ChildCare';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import LockResetIcon from '@mui/icons-material/LockReset';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';

import {
    useGetPatientStaffMeQuery, useUpdatePatientStaffMeMutation,
} from '../api/supportStaffEndpoints';
import ChangePasswordDialog from '../components/ChangePasswordDialog';
import useResilientQuery from '../../../../common/hooks/useResilientQuery';

function EditProfileDialog({ me, onClose }) {
    const [save, { isLoading }] = useUpdatePatientStaffMeMutation();
    const parts = (me.name || '').split(' ').filter(Boolean);
    const [form, setForm] = useState({
        first_name: parts[0] || '',
        last_name: parts.slice(1).join(' '),
        relation: me.relation || '',
    });
    const [error, setError] = useState(null);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const submit = async () => {
        setError(null);
        try {
            await save({
                first_name: form.first_name.trim(),
                last_name: form.last_name.trim(),
                relation: form.relation.trim(),
            }).unwrap();
            onClose();
        } catch (e) {
            setError(e?.data?.message || e?.data?.error || 'Could not save your profile.');
        }
    };

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="xs">
            <DialogTitle>Edit profile</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2} sx={{ mt: 0.5 }}>
                    {error && <Alert severity="error">{error}</Alert>}
                    <TextField label="First name" value={form.first_name} onChange={set('first_name')} autoFocus />
                    <TextField label="Last name" value={form.last_name} onChange={set('last_name')} />
                    <TextField label="Relation (e.g. Nurse, Aide)" value={form.relation} onChange={set('relation')} />
                    <Typography variant="caption" color="text.secondary">
                        Your login email and what you can access are managed by the patient you care for.
                    </Typography>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={submit} disabled={isLoading || !form.first_name.trim()}>
                    {isLoading ? 'Saving…' : 'Save'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export default function PatientStaffLanding() {
    const navigate = useNavigate();
    const { data = {}, isLoading } = useResilientQuery(useGetPatientStaffMeQuery);
    const me = data.me || {};
    const patients = data.patients || [];
    const [pwOpen, setPwOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);

    if (isLoading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;
    }

    const initials = (me.name || 'C').split(' ').filter(Boolean)
        .map((s) => s[0]).slice(0, 2).join('').toUpperCase();

    return (
        <Box sx={{ p: 3, maxWidth: 720, mx: 'auto' }}>
            <Typography variant="h5" sx={{ mb: 2 }}>My account</Typography>

            {/* Basic profile — read-only identity + change password. */}
            <Card sx={{ mb: 3 }}>
                <CardContent>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                        <Avatar sx={{ bgcolor: 'primary.main', width: 52, height: 52 }}>{initials}</Avatar>
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                            <Typography variant="h6" noWrap>{me.name || 'Caregiver'}</Typography>
                            <Typography variant="body2" color="text.secondary" noWrap>
                                {[me.relation, me.email].filter(Boolean).join(' · ') || 'Support staff'}
                            </Typography>
                            <Chip size="small" label="Support staff" color="primary" variant="outlined" sx={{ mt: 0.5 }} />
                        </Box>
                        <Stack direction={{ xs: 'row', sm: 'column' }} spacing={1}>
                            <Button variant="outlined" size="small" startIcon={<EditOutlinedIcon />} onClick={() => setEditOpen(true)}>
                                Edit profile
                            </Button>
                            <Button variant="outlined" size="small" startIcon={<LockResetIcon />} onClick={() => setPwOpen(true)}>
                                Change password
                            </Button>
                        </Stack>
                    </Stack>
                </CardContent>
            </Card>

            {/* The patient(s) they support. */}
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <BadgeOutlinedIcon color="primary" fontSize="small" />
                <Typography variant="subtitle1" fontWeight={600}>Patients you support</Typography>
            </Stack>
            <Card>
                <CardContent>
                    {patients.length === 0 ? (
                        <Typography color="text.secondary">
                            No patient has added you as a caregiver yet, or your access was
                            suspended. Please check with the person you care for.
                        </Typography>
                    ) : (
                        <List disablePadding>
                            {patients.map((p) => (
                                <Box key={p.patient_id}>
                                    <ListItem divider secondaryAction={
                                        <Button variant="contained" startIcon={<LoginIcon />}
                                            onClick={() => navigate(`${p.patient_id}/bookings`)}>
                                            Open
                                        </Button>
                                    }>
                                        <ListItemText primary={p.patient_name}
                                            secondary={(p.modules || []).map((m) => m.replace(/_/g, ' ')).join(', ') || 'No access granted'} />
                                    </ListItem>
                                    {/* Minors of this patient the caregiver was granted. */}
                                    {(p.minors || []).map((mn) => (
                                        <ListItem key={mn.member_id} divider sx={{ pl: 4 }} secondaryAction={
                                            <Button size="small" variant="outlined" startIcon={<LoginIcon />}
                                                onClick={() => navigate(`minor/${mn.member_id}/bookings`)}>
                                                Open
                                            </Button>
                                        }>
                                            <ListItemIcon sx={{ minWidth: 34 }}>
                                                <ChildCareIcon fontSize="small" color="secondary" />
                                            </ListItemIcon>
                                            <ListItemText primary={mn.name || 'Child'}
                                                secondary={mn.whole ? 'Whole account' : 'Limited access'} />
                                        </ListItem>
                                    ))}
                                </Box>
                            ))}
                        </List>
                    )}
                </CardContent>
            </Card>

            {editOpen && <EditProfileDialog me={me} onClose={() => setEditOpen(false)} />}
            <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
        </Box>
    );
}
