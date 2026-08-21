/**
 * RoleManager — a patient authors their own family roles and edits each role's
 * permission matrix (5 modules × view/manage). Owner-only: these are the roles
 * the patient can later grant to a linked adult so they may act on the patient's
 * behalf, bounded by exactly what's ticked here. Mirrors the provider staff
 * role-matrix screen, leaner (two verbs, flat modules).
 *
 * The backend is the source of truth for the matrix — `manage` implies `view`
 * server-side and all-false rows are dropped — so the UI keeps the same rule
 * live (ticking Manage ticks View; unticking View unticks Manage).
 */
import { Fragment, useEffect, useState } from 'react';
import {
    Alert, Box, Button, Card, CardContent, Checkbox, CircularProgress, Dialog,
    DialogActions, DialogContent, DialogTitle, Divider, IconButton, List, ListItem,
    ListItemText, Stack, Table, TableBody, TableCell, TableHead, TableRow,
    TextField, Tooltip, Typography,
} from '@mui/material';
import BadgeIcon from '@mui/icons-material/Badge';
import EditIcon from '@mui/icons-material/Edit';

import {
    useGetFamilyModulesQuery, useGetFamilyRolesQuery, useGetFamilyRoleQuery,
    useCreateFamilyRoleMutation, useSetFamilyRoleMatrixMutation,
} from '../api/familyEndpoints';

// ── Matrix editor for one role ───────────────────────────────────────────────
function MatrixDialog({ roleId, modules, onClose }) {
    const { data: role, isFetching } = useGetFamilyRoleQuery(roleId, { skip: !roleId });
    const [save, { isLoading: saving }] = useSetFamilyRoleMatrixMutation();
    const [grants, setGrants] = useState({});   // { module_key: {can_view, can_manage} }
    const [error, setError] = useState(null);

    // Seed local state from the role's stored permissions once loaded.
    useEffect(() => {
        if (!role) return;
        const seed = {};
        (role.permissions || []).forEach((p) => {
            seed[p.module] = { can_view: !!p.can_view, can_manage: !!p.can_manage };
        });
        setGrants(seed);
    }, [role]);

    const toggle = (key, verb) => (e) => {
        const on = e.target.checked;
        setGrants((g) => {
            const cur = g[key] || { can_view: false, can_manage: false };
            const next = { ...cur };
            if (verb === 'can_manage') {
                next.can_manage = on;
                if (on) next.can_view = true;          // manage implies view
            } else {
                next.can_view = on;
                if (!on) next.can_manage = false;      // no view ⇒ no manage
            }
            return { ...g, [key]: next };
        });
    };

    const onSave = async () => {
        setError(null);
        const permissions = Object.entries(grants)
            .filter(([, v]) => v.can_view || v.can_manage)
            .map(([module, v]) => ({ module, can_view: v.can_view, can_manage: v.can_manage }));
        try {
            await save({ id: roleId, permissions }).unwrap();
            onClose();
        } catch (e) {
            setError(e?.data?.message || e?.data?.error || 'Could not save permissions.');
        }
    };

    // Group the flat catalog by its `group` for a sectioned matrix — so the same
    // list reads as Profile / Care / Services / Money rather than one wall.
    // Falls back to a single unlabelled group if the backend sends no groups.
    const byGroup = {};
    const groupOrder = [];
    modules.forEach((m) => {
        const grp = m.group || '';
        if (!(grp in byGroup)) { byGroup[grp] = []; groupOrder.push(grp); }
        byGroup[grp].push(m);
    });

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle>
                Permissions{role ? ` — ${role.name}` : ''}
            </DialogTitle>
            <DialogContent dividers>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Choose what a family member or caregiver holding this role may do on your
                    behalf. <b>View</b> lets them see it; <b>Manage</b> lets them act (book, edit,
                    add). Grant each section on its own — e.g. let them edit Contact without
                    touching Personal details, or start Calls without Chat.
                </Typography>
                {isFetching ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>
                ) : (
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Module</TableCell>
                                <TableCell align="center">View</TableCell>
                                <TableCell align="center">Manage</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {groupOrder.map((grp) => (
                                <Fragment key={grp || '_'}>
                                    {grp && (
                                        <TableRow>
                                            <TableCell colSpan={3} sx={{ bgcolor: 'action.hover', py: 0.5, borderBottom: 0 }}>
                                                <Typography variant="caption" fontWeight={700}
                                                    color="text.secondary"
                                                    sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                                    {grp}
                                                </Typography>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                    {byGroup[grp].map((m) => {
                                        const g = grants[m.key] || {};
                                        return (
                                            <TableRow key={m.key}>
                                                <TableCell sx={{ pl: grp ? 3 : 2 }}>{m.label}</TableCell>
                                                <TableCell align="center">
                                                    <Checkbox size="small" checked={!!g.can_view} onChange={toggle(m.key, 'can_view')} />
                                                </TableCell>
                                                <TableCell align="center">
                                                    <Checkbox size="small" checked={!!g.can_manage} onChange={toggle(m.key, 'can_manage')} />
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </Fragment>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={onSave} disabled={saving || isFetching}>
                    {saving ? 'Saving…' : 'Save permissions'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

// ── Create-role dialog ───────────────────────────────────────────────────────
function CreateRoleDialog({ onClose, onCreated }) {
    const [create, { isLoading }] = useCreateFamilyRoleMutation();
    const [form, setForm] = useState({ name: '', description: '' });
    const [error, setError] = useState(null);

    const onSave = async () => {
        setError(null);
        try {
            const res = await create({
                name: form.name.trim(),
                description: form.description.trim() || undefined,
            }).unwrap();
            onCreated?.(res?.data?.id);   // jump straight into its matrix
            onClose();
        } catch (e) {
            setError(e?.data?.message || e?.data?.error || 'Could not create the role.');
        }
    };

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="xs">
            <DialogTitle>New role</DialogTitle>
            <DialogContent dividers>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                <Stack spacing={2} sx={{ mt: 0.5 }}>
                    <TextField autoFocus fullWidth label="Role name" placeholder="e.g. Can book & view records"
                        value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                    <TextField fullWidth label="Description (optional)" multiline minRows={2}
                        value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={onSave} disabled={isLoading || !form.name.trim()}>
                    {isLoading ? 'Creating…' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export default function RoleManager() {
    const { data: modules = [] } = useGetFamilyModulesQuery();
    const { data: roles = [], isLoading } = useGetFamilyRolesQuery();
    const [creating, setCreating] = useState(false);
    const [editId, setEditId] = useState(null);

    return (
        <Card sx={{ mb: 3 }}>
            <CardContent>
                <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
                    <BadgeIcon color="primary" sx={{ mr: 1 }} />
                    <Typography variant="subtitle1" fontWeight={600} sx={{ flexGrow: 1 }}>
                        Roles ({roles.length})
                    </Typography>
                    <Button variant="outlined" onClick={() => setCreating(true)}>New role</Button>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Roles decide what a linked family member can see or do for you. Create one,
                    tick its permissions, then assign it to a member below.
                </Typography>
                <Divider sx={{ mb: 1 }} />
                {isLoading ? <CircularProgress size={22} />
                    : roles.length === 0 ? (
                        <Typography color="text.secondary">No roles yet.</Typography>
                    ) : (
                        <List dense disablePadding>
                            {roles.map((r) => (
                                <ListItem key={r.id} divider
                                    secondaryAction={
                                        r.is_shared ? (
                                            <Tooltip title="Shared role — permissions are managed centrally">
                                                <span><IconButton edge="end" disabled><EditIcon /></IconButton></span>
                                            </Tooltip>
                                        ) : (
                                            <Tooltip title="Edit permissions">
                                                <IconButton edge="end" onClick={() => setEditId(r.id)}><EditIcon /></IconButton>
                                            </Tooltip>
                                        )
                                    }>
                                    <ListItemText
                                        primary={r.name + (r.is_shared ? '  (shared)' : '')}
                                        secondary={r.description || '—'} />
                                </ListItem>
                            ))}
                        </List>
                    )}
            </CardContent>

            {creating && (
                <CreateRoleDialog onClose={() => setCreating(false)} onCreated={(id) => id && setEditId(id)} />
            )}
            {editId && (
                <MatrixDialog roleId={editId} modules={modules} onClose={() => setEditId(null)} />
            )}
        </Card>
    );
}
