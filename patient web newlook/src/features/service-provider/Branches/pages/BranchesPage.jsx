/**
 * BranchesPage — a clinic manages its login-less BRANCH clinics.
 *
 * A branch is another location of this clinic: it has no login of its own, and
 * the main clinic operates it by "opening" it (a scoped replica — v1 lets you
 * edit the branch's Entity Profile). Branches are verified independently, so a
 * fresh one shows "Pending verification" until an admin approves it.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog,
    DialogActions, DialogContent, DialogTitle, Grid, IconButton, List, ListItem,
    ListItemText, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import ApartmentIcon from '@mui/icons-material/Apartment';
import AddBusinessIcon from '@mui/icons-material/AddBusiness';
import LoginIcon from '@mui/icons-material/Login';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import {
    useGetClinicBranchesQuery, useCreateClinicBranchMutation,
    useUpdateClinicBranchMutation, useDeleteClinicBranchMutation,
} from '../api/clinicBranchEndpoints';

const VERIF = {
    verified: { label: 'Verified', color: 'success' },
    pending: { label: 'Pending verification', color: 'warning' },
    rejected: { label: 'Rejected', color: 'error' },
    suspended: { label: 'Suspended', color: 'default' },
};
const EMPTY = { name: '', registration_number: '', phone: '', email: '', address: '', city: '', state: '', pincode: '' };
const REQUIRED = ['name', 'address', 'city', 'state', 'pincode'];
const errOf = (e) => e?.data?.message || e?.data?.error || 'Something went wrong.';

function BranchDialog({ initial, onClose }) {
    const editing = !!initial?.id;
    const [create, { isLoading: creating }] = useCreateClinicBranchMutation();
    const [update, { isLoading: updating }] = useUpdateClinicBranchMutation();
    const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
    const [error, setError] = useState(null);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
    const valid = REQUIRED.every((k) => (form[k] || '').trim());

    const save = async () => {
        setError(null);
        const body = {
            name: form.name.trim(), registration_number: form.registration_number.trim() || undefined,
            phone: form.phone.trim() || undefined, email: form.email.trim() || undefined,
            address: form.address.trim(), city: form.city.trim(),
            state: form.state.trim(), pincode: form.pincode.trim(),
        };
        try {
            if (editing) await update({ branchId: initial.id, ...body }).unwrap();
            else await create(body).unwrap();
            onClose();
        } catch (e) { setError(errOf(e)); }
    };

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>{editing ? 'Edit branch' : 'Add a branch'}</DialogTitle>
            <DialogContent dividers>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                <Grid container spacing={2}>
                    <Grid item xs={12}><TextField fullWidth autoFocus label="Branch name" value={form.name} onChange={set('name')} /></Grid>
                    <Grid item xs={12} sm={6}><TextField fullWidth label="Registration number" value={form.registration_number} onChange={set('registration_number')} /></Grid>
                    <Grid item xs={12} sm={6}><TextField fullWidth label="Phone" value={form.phone} onChange={set('phone')} /></Grid>
                    <Grid item xs={12}><TextField fullWidth label="Email" value={form.email} onChange={set('email')} /></Grid>
                    <Grid item xs={12}><TextField fullWidth label="Address" value={form.address} onChange={set('address')} /></Grid>
                    <Grid item xs={12} sm={5}><TextField fullWidth label="City" value={form.city} onChange={set('city')} /></Grid>
                    <Grid item xs={12} sm={4}><TextField fullWidth label="State" value={form.state} onChange={set('state')} /></Grid>
                    <Grid item xs={12} sm={3}><TextField fullWidth label="Pincode" value={form.pincode} onChange={set('pincode')} /></Grid>
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={save} disabled={!valid || creating || updating}>
                    {(creating || updating) ? 'Saving…' : (editing ? 'Save' : 'Add branch')}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export default function BranchesPage() {
    const navigate = useNavigate();
    const { data: branches = [], isLoading } = useGetClinicBranchesQuery();
    const [remove] = useDeleteClinicBranchMutation();
    const [dialog, setDialog] = useState(null); // {} for new, branch for edit

    const onRemove = (b) => () => {
        if (window.confirm(`Remove branch "${b.name}"? Its data stays but it can no longer be opened.`)) remove(b.id);
    };

    return (
        <Box sx={{ p: 3, maxWidth: 960, mx: 'auto' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <ApartmentIcon color="primary" />
                <Typography variant="h4">Branches</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Other locations of your clinic — managed from here, with no separate login.
                Open one to manage it; each branch is verified independently.
            </Typography>

            <Card>
                <CardContent>
                    <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
                        <Typography variant="subtitle1" fontWeight={600} sx={{ flexGrow: 1 }}>
                            Your branches ({branches.length})
                        </Typography>
                        <Button variant="contained" startIcon={<AddBusinessIcon />} onClick={() => setDialog({})}>
                            Add branch
                        </Button>
                    </Stack>
                    {isLoading ? <CircularProgress size={22} />
                        : branches.length === 0 ? (
                            <Typography color="text.secondary">No branches yet.</Typography>
                        ) : (
                            <List disablePadding>
                                {branches.map((b) => {
                                    const v = VERIF[b.verification_status] || VERIF.pending;
                                    return (
                                        <ListItem key={b.id} divider sx={{ pr: { sm: 26 }, flexWrap: 'wrap' }}
                                            secondaryAction={
                                                <Stack direction="row" spacing={0.5} alignItems="center">
                                                    <Button size="small" variant="outlined" startIcon={<LoginIcon />}
                                                        onClick={() => navigate(b.id)}>Open</Button>
                                                    <Tooltip title="Edit"><IconButton size="small" onClick={() => setDialog(b)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                                                    <Tooltip title="Remove"><IconButton size="small" color="error" onClick={onRemove(b)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                                                </Stack>
                                            }>
                                            <ListItemText
                                                primary={
                                                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                                        <span>{b.name}</span>
                                                        <Chip size="small" label={v.label} color={v.color} variant="outlined" />
                                                    </Stack>
                                                }
                                                secondary={b.city} />
                                        </ListItem>
                                    );
                                })}
                            </List>
                        )}
                </CardContent>
            </Card>

            {dialog && <BranchDialog initial={dialog.id ? dialog : null} onClose={() => setDialog(null)} />}
        </Box>
    );
}
