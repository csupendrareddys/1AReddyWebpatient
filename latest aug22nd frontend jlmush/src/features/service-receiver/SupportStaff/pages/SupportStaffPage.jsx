/**
 * SupportStaffPage — a patient manages their caregivers ("support staff").
 *
 * A caregiver is a person the patient trusts to act on their behalf — book
 * appointments, view records, manage prescriptions — who gets their OWN login
 * (so every action is attributable to them) and a role that bounds exactly what
 * they may do. This is the patient-side mirror of a practice's support staff.
 *
 * Roles + the permission matrix are authored with the reused ``RoleManager``
 * (the same roles a patient grants a linked family member). Here the patient
 * just provisions the caregiver's login and assigns which role(s) they hold.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress,
    Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton,
    List, ListItem, ListItemText, ListItemButton, MenuItem, Stack, TextField,
    Tooltip, Typography, Switch, FormControlLabel,
} from '@mui/material';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import SecurityIcon from '@mui/icons-material/Security';
import ChildCareIcon from '@mui/icons-material/ChildCare';

import {
    useGetPatientStaffQuery, useCreatePatientStaffMutation,
    useSetPatientStaffRolesMutation, useSetPatientStaffMinorsMutation,
    useSuspendPatientStaffMutation,
    useActivatePatientStaffMutation, useDeletePatientStaffMutation,
} from '../api/supportStaffEndpoints';
import { useGetFamilyRolesQuery, useGetMinorsQuery } from '../../Family/api/familyEndpoints';
import RoleManager from '../../Family/components/RoleManager';
import useResilientQuery from '../../../../common/hooks/useResilientQuery';

const STATUS = {
    active: { label: 'Active', color: 'success' },
    suspended: { label: 'Suspended', color: 'warning' },
};
const EMPTY = { first_name: '', last_name: '', relation: '', email: '', password: '', role_ids: [] };
const errOf = (e) => e?.data?.message || e?.data?.error || 'Something went wrong.';

// ── Add-caregiver dialog ─────────────────────────────────────────────────────
function AddDialog({ roles, onClose, onCreated }) {
    const [create, { isLoading }] = useCreatePatientStaffMutation();
    const [form, setForm] = useState(EMPTY);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    const save = async () => {
        setError(null);
        try {
            await create({
                first_name: form.first_name.trim(),
                last_name: form.last_name.trim() || undefined,
                relation: form.relation.trim() || undefined,
                email: form.email.trim(),
                password: form.password,
                role_ids: form.role_ids,
            }).unwrap();
            onCreated?.();
            onClose();
        } catch (e) {
            setError(errOf(e));
        }
    };

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>Add a caregiver</DialogTitle>
            <DialogContent dividers>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    They sign in with the email + password you set here, and can only do
                    what their role allows.
                </Typography>
                <Stack spacing={2}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <TextField fullWidth autoFocus label="First name" value={form.first_name} onChange={set('first_name')} />
                        <TextField fullWidth label="Last name" value={form.last_name} onChange={set('last_name')} />
                    </Stack>
                    <TextField fullWidth label="Relation (e.g. Nurse, Aide, Son)" value={form.relation} onChange={set('relation')} />
                    <Divider>Login</Divider>
                    <TextField fullWidth label="Login email" type="email" value={form.email} onChange={set('email')} />
                    <TextField fullWidth label="Temporary password" type="password" value={form.password}
                        onChange={set('password')} helperText="At least 8 characters. Share it with the caregiver to sign in." />
                    <TextField select fullWidth label="Role(s)" value={form.role_ids}
                        onChange={(e) => setForm((f) => ({ ...f, role_ids: e.target.value }))}
                        SelectProps={{ multiple: true, renderValue: (ids) =>
                            roles.filter((r) => ids.includes(r.id)).map((r) => r.name).join(', ') || 'No access yet' }}
                        helperText="What this caregiver may do. Create roles in the section below.">
                        {roles.length === 0 && <MenuItem disabled>No roles yet — create one below</MenuItem>}
                        {roles.map((r) => (
                            <MenuItem key={r.id} value={r.id}>
                                <Checkbox checked={form.role_ids.includes(r.id)} />
                                <ListItemText primary={r.name + (r.is_shared ? '  (shared)' : '')} />
                            </MenuItem>
                        ))}
                    </TextField>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={save}
                    disabled={isLoading || !form.first_name.trim() || !form.email.trim() || form.password.length < 8}>
                    {isLoading ? 'Adding…' : 'Add caregiver'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

// ── Assign-roles dialog ──────────────────────────────────────────────────────
function RolesDialog({ member, roles, onClose }) {
    const [setRoles, { isLoading }] = useSetPatientStaffRolesMutation();
    const [selected, setSelected] = useState((member.roles || []).map((r) => r.id));
    const [canPay, setCanPay] = useState(!!member.can_pay_on_behalf);
    const [error, setError] = useState(null);

    const toggle = (id) => () =>
        setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

    const save = async () => {
        setError(null);
        try {
            await setRoles({ staffId: member.id, roleIds: selected, canPayOnBehalf: canPay }).unwrap();
            onClose();
        } catch (e) {
            setError(errOf(e));
        }
    };

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="xs">
            <DialogTitle>Roles — {member.full_name}</DialogTitle>
            <DialogContent dividers>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                {roles.length === 0 ? (
                    <Typography color="text.secondary">No roles yet. Create one in the section below first.</Typography>
                ) : (
                    <List dense disablePadding>
                        {roles.map((r) => (
                            <ListItem key={r.id} disablePadding>
                                <ListItemButton onClick={toggle(r.id)} dense>
                                    <Checkbox edge="start" checked={selected.includes(r.id)} tabIndex={-1} disableRipple />
                                    <ListItemText primary={r.name + (r.is_shared ? '  (shared)' : '')} secondary={r.description || null} />
                                </ListItemButton>
                            </ListItem>
                        ))}
                    </List>
                )}

                {/* Money permission — deliberately separate from roles. */}
                <Divider sx={{ my: 1.5 }} />
                <FormControlLabel
                    control={<Switch checked={canPay} onChange={(e) => setCanPay(e.target.checked)} />}
                    label="Let this caregiver pay for bookings"
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: -0.5 }}>
                    When on, they can choose to pay for a booking they make for you from their
                    OWN payment method (your card is never charged). Otherwise every booking
                    they create waits for you to pay within a 20-minute hold.
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={save} disabled={isLoading}>
                    {isLoading ? 'Saving…' : 'Save'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

// ── Minor-access dialog ──────────────────────────────────────────────────────
// Grant a caregiver a set of the owner's minors, each optionally bounded by a
// role (no role = the whole minor account). Never grants payment — money stays
// with the parent — so there's nothing to warn about beyond the section scope.
function MinorsDialog({ member, minors, roles, onClose }) {
    const [setMinors, { isLoading }] = useSetPatientStaffMinorsMutation();
    // { member_id: role_id|'' } for every GRANTED minor ('' = whole account).
    const [granted, setGranted] = useState(() => {
        const init = {};
        (member.minor_grants || []).forEach((g) => { init[g.member_id] = g.role_id || ''; });
        return init;
    });
    const [error, setError] = useState(null);

    const isGranted = (id) => Object.prototype.hasOwnProperty.call(granted, id);
    const toggle = (id) => () => setGranted((g) => {
        const next = { ...g };
        if (Object.prototype.hasOwnProperty.call(next, id)) delete next[id];
        else next[id] = '';
        return next;
    });
    const setRole = (id) => (e) => setGranted((g) => ({ ...g, [id]: e.target.value }));

    const save = async () => {
        setError(null);
        try {
            const payload = Object.entries(granted).map(([member_id, role_id]) => ({
                member_id, role_id: role_id || undefined,
            }));
            await setMinors({ staffId: member.id, minors: payload }).unwrap();
            onClose();
        } catch (e) {
            setError(errOf(e));
        }
    };

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>Minor access — {member.full_name}</DialogTitle>
            <DialogContent dividers>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Let this caregiver manage a child&apos;s profile. Leave the role empty
                    to grant the whole account, or pick a role to limit them to those
                    sections. For a child&apos;s bookings, payment always stays with you.
                </Typography>
                {minors.length === 0 ? (
                    <Typography color="text.secondary">You have no minor profiles yet.</Typography>
                ) : (
                    <List dense disablePadding>
                        {minors.map((mn) => {
                            const name = [mn.first_name, mn.last_name].filter(Boolean).join(' ') || 'Minor';
                            const on = isGranted(mn.id);
                            return (
                                <ListItem key={mn.id} divider disableGutters
                                    secondaryAction={on ? (
                                        <TextField select size="small" value={granted[mn.id] || ''}
                                            onChange={setRole(mn.id)} sx={{ minWidth: 150 }}
                                            SelectProps={{ displayEmpty: true }}>
                                            <MenuItem value=""><em>Whole account</em></MenuItem>
                                            {roles.map((r) => (
                                                <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>
                                            ))}
                                        </TextField>
                                    ) : null}>
                                    <Checkbox edge="start" checked={on} onChange={toggle(mn.id)} tabIndex={-1} disableRipple />
                                    <ListItemText primary={name} secondary={mn.relation || 'Child'} />
                                </ListItem>
                            );
                        })}
                    </List>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={save} disabled={isLoading || minors.length === 0}>
                    {isLoading ? 'Saving…' : 'Save minor access'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export default function SupportStaffPage() {
    const { data: staff = [], isLoading } = useResilientQuery(useGetPatientStaffQuery);
    const { data: roles = [] } = useResilientQuery(useGetFamilyRolesQuery);
    const { data: minors = [] } = useResilientQuery(useGetMinorsQuery);
    const [suspend] = useSuspendPatientStaffMutation();
    const [activate] = useActivatePatientStaffMutation();
    const [remove] = useDeletePatientStaffMutation();

    const [addOpen, setAddOpen] = useState(false);
    const [rolesFor, setRolesFor] = useState(null);
    const [minorsFor, setMinorsFor] = useState(null);

    const onRemove = (m) => () => {
        if (window.confirm(`Remove ${m.full_name}? Their login will be disabled.`)) remove(m.id);
    };

    return (
        <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <BadgeOutlinedIcon color="primary" />
                <Typography variant="h4">Support Staff</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Give a caregiver their own login to act on your behalf — bounded by the
                permissions you grant. Every action they take is recorded under their name.
            </Typography>

            <Card sx={{ mb: 3 }}>
                <CardContent>
                    <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
                        <Typography variant="subtitle1" fontWeight={600} sx={{ flexGrow: 1 }}>
                            Caregivers ({staff.length})
                        </Typography>
                        <Button variant="contained" startIcon={<PersonAddAlt1Icon />} onClick={() => setAddOpen(true)}>
                            Add caregiver
                        </Button>
                    </Stack>
                    {isLoading ? <CircularProgress size={22} />
                        : staff.length === 0 ? (
                            <Typography color="text.secondary">No caregivers yet.</Typography>
                        ) : (
                            <List disablePadding>
                                {staff.map((m) => {
                                    const st = STATUS[m.status] || STATUS.active;
                                    return (
                                        <ListItem key={m.id} divider sx={{ pr: { sm: 24 }, flexWrap: 'wrap' }}
                                            secondaryAction={
                                                <Stack direction="row" spacing={0.5} alignItems="center">
                                                    <Tooltip title="Roles / permissions">
                                                        <IconButton size="small" onClick={() => setRolesFor(m)}><SecurityIcon fontSize="small" /></IconButton>
                                                    </Tooltip>
                                                    {minors.length > 0 && (
                                                        <Tooltip title="Minor access">
                                                            <IconButton size="small" onClick={() => setMinorsFor(m)}><ChildCareIcon fontSize="small" /></IconButton>
                                                        </Tooltip>
                                                    )}
                                                    {m.status === 'active' ? (
                                                        <Tooltip title="Suspend (disable login)">
                                                            <IconButton size="small" color="warning" onClick={() => suspend(m.id)}><BlockIcon fontSize="small" /></IconButton>
                                                        </Tooltip>
                                                    ) : (
                                                        <Tooltip title="Reactivate">
                                                            <IconButton size="small" color="success" onClick={() => activate(m.id)}><CheckCircleOutlineIcon fontSize="small" /></IconButton>
                                                        </Tooltip>
                                                    )}
                                                    <Tooltip title="Remove">
                                                        <IconButton size="small" color="error" onClick={onRemove(m)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                                                    </Tooltip>
                                                </Stack>
                                            }>
                                            <ListItemText
                                                primary={
                                                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                                        <span>{m.full_name}</span>
                                                        <Chip size="small" label={st.label} color={st.color} variant="outlined" />
                                                        {(m.roles || []).map((r) => (
                                                            <Chip key={r.id} size="small" label={r.name} color="primary" variant="outlined" />
                                                        ))}
                                                        {(m.roles || []).length === 0 && (
                                                            <Chip size="small" label="No access" variant="outlined" />
                                                        )}
                                                        {(m.minor_grants || []).length > 0 && (
                                                            <Chip size="small" icon={<ChildCareIcon />}
                                                                label={`${m.minor_grants.length} minor${m.minor_grants.length > 1 ? 's' : ''}`}
                                                                color="secondary" variant="outlined" />
                                                        )}
                                                    </Stack>
                                                }
                                                secondary={[m.relation, m.email].filter(Boolean).join(' · ')} />
                                        </ListItem>
                                    );
                                })}
                            </List>
                        )}
                </CardContent>
            </Card>

            {/* Author the roles a caregiver can hold (same roles as family). */}
            <RoleManager />

            {addOpen && (
                <AddDialog roles={roles} onClose={() => setAddOpen(false)} onCreated={() => {}} />
            )}
            {rolesFor && (
                <RolesDialog member={rolesFor} roles={roles} onClose={() => setRolesFor(null)} />
            )}
            {minorsFor && (
                <MinorsDialog member={minorsFor} minors={minors} roles={roles} onClose={() => setMinorsFor(null)} />
            )}
        </Box>
    );
}
