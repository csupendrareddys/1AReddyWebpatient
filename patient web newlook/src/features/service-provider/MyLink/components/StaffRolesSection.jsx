/**
 * StaffRolesSection — the roles a practice can hand to its own staff.
 *
 * Support Staff answers "who works here"; this answers "and what is each of
 * them meant to be able to do". It used to be the tenant admin's answer alone:
 * a curated list per vertical that a provider could only pick from. That works
 * until a clinic wants a role nobody else wants — a receptionist who may take
 * payments but not touch prescriptions — and the only way to get one was to
 * ask an administrator.
 *
 * **Two tiers, and the screen has to make the difference obvious**, because
 * they look identical in a dropdown and behave nothing alike:
 *
 *   shared (``is_shared``)  the administrator's, offered to every practice in
 *                           the vertical. Readable and assignable here, but
 *                           editing one would silently re-scope every other
 *                           practice's staff — so the server refuses and this
 *                           screen shows the matrix read-only rather than
 *                           letting ticks land and fail at Save.
 *   own                     authored by this practice, nobody else can see it,
 *                           fully theirs to rename, deactivate or delete.
 *
 * The matrix itself is the admin screen's, component for component — same
 * table, same state hook, same rules about where a grant lives. Two matrices
 * over one set of module keys is exactly the drift this reuse avoids.
 */
import { useEffect, useMemo, useState } from 'react';
import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogContentText, DialogTitle, Divider, FormControlLabel,
    IconButton, List, ListItem, ListItemButton, ListItemText, ListSubheader,
    Paper, Snackbar, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import GroupsIcon from '@mui/icons-material/Groups';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SaveIcon from '@mui/icons-material/Save';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';

import PermissionTreeTable from
    '../../../admin/Operations/permissions/components/PermissionTreeTable/PermissionTreeTable';
import usePermissionTree from
    '../../../admin/Operations/permissions/hooks/usePermissionTree';
import {
    useGetMyStaffRolesQuery,
    useCreateMyStaffRoleMutation,
    useUpdateMyStaffRoleMutation,
    useDeleteMyStaffRoleMutation,
    useGetMyStaffModulesQuery,
    useGetMyStaffRolePermissionsQuery,
    useSaveMyStaffRolePermissionsMutation,
} from '../api/providerStaffEndpoints';

const NOOP = () => {};

/**
 * How a shared role's matrix is made read-only WITHOUT forking the table.
 *
 * The handlers passed in are no-ops, so nothing can change; this kills the
 * affordances that would otherwise invite a click the app then ignores — the
 * checkboxes, the data-range selects, and the column headings that toggle a
 * whole column. Expanders are deliberately left alive: reading what a shared
 * role grants means opening its branches. An Alert above the table says why,
 * so a deadened control is explained rather than merely unresponsive.
 */
const READ_ONLY_MATRIX_SX = {
    '& thead .MuiTableCell-root, & .MuiCheckbox-root, & .MuiOutlinedInput-root': {
        pointerEvents: 'none',
    },
    '& .MuiCheckbox-root, & .MuiOutlinedInput-root': { opacity: 0.7 },
};

const EMPTY_ROLE_FORM = { id: null, name: '', description: '', is_active: true };

export default function StaffRolesSection({ providerLabel = 'practice', canEdit = true }) {
    const {
        data: roles = [], isLoading: loadingRoles, error: rolesError,
    } = useGetMyStaffRolesQuery({ includeInactive: true });
    const { data: catalog, isLoading: loadingCatalog } = useGetMyStaffModulesQuery();

    const [roleId, setRoleId] = useState('');

    // Settle on a role as soon as there is one, and re-settle if the selected
    // one disappears (deleted here, or withdrawn by the administrator).
    useEffect(() => {
        setRoleId((current) => (
            roles.some((r) => r.id === current) ? current : (roles[0]?.id || '')
        ));
    }, [roles]);

    // ``currentData``, NOT ``data`` — same trap as the admin matrix: RTK Query
    // serves the previous role's grants while the next role is in flight, and a
    // draft is only seeded once, so the matrix would keep one role's ticks
    // under another role's name and save them there.
    const { currentData: savedPermissions, isFetching: loadingPerms } =
        useGetMyStaffRolePermissionsQuery(roleId, { skip: !roleId });
    const [savePermissions, { isLoading: saving }] = useSaveMyStaffRolePermissionsMutation();

    const [createRole, { isLoading: creatingRole }] = useCreateMyStaffRoleMutation();
    const [updateRole, { isLoading: updatingRole }] = useUpdateMyStaffRoleMutation();
    const [deleteRole] = useDeleteMyStaffRoleMutation();

    const [roleForm, setRoleForm] = useState(null);   // null = dialog closed
    const [roleFormError, setRoleFormError] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [snack, setSnack] = useState(null);

    const tree = useMemo(() => catalog?.modules || [], [catalog]);
    const matrix = usePermissionTree({ tree, roleKey: roleId, savedPermissions });

    const role = roles.find((r) => r.id === roleId);
    // ``canEdit`` is false when a staff member is looking at their employer's
    // roles. Every role is read-only to them, shared or not: editing a role is
    // how you would grant yourself the role you are missing, so the backend
    // refuses it and the buttons should not pretend otherwise.
    const readOnly = !canEdit || !!role?.is_shared;
    const shared = roles.filter((r) => r.is_shared);
    const own = roles.filter((r) => !r.is_shared);

    // The endpoints are gated to doctor / clinic / hospital, so a 403 here is a
    // routing mistake rather than a server problem — say so instead of drawing
    // an empty role list.
    if (rolesError?.status === 403) {
        return (
            <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>Staff Roles</Typography>
                <Alert severity="info">
                    Only doctors, clinics and hospitals can define staff roles.
                </Alert>
            </Paper>
        );
    }

    const openCreate = () => { setRoleForm({ ...EMPTY_ROLE_FORM }); setRoleFormError(''); };
    const openEdit = (target) => {
        setRoleForm({
            id: target.id,
            name: target.name || '',
            description: target.description || '',
            is_active: target.is_active !== false,
        });
        setRoleFormError('');
    };

    const submitRole = async () => {
        if (!roleForm.name.trim()) {
            setRoleFormError('Give the role a name');
            return;
        }
        try {
            if (roleForm.id) {
                await updateRole({
                    roleId: roleForm.id,
                    name: roleForm.name,
                    description: roleForm.description,
                    is_active: roleForm.is_active,
                }).unwrap();
                setSnack({ severity: 'success', message: 'Role updated' });
            } else {
                const res = await createRole({
                    name: roleForm.name, description: roleForm.description,
                }).unwrap();
                // Land on the new role so the obvious next step — granting it
                // something — needs no second click. The id is read defensively
                // because a create that doesn't echo the row back is still a
                // successful create; the list refetch will show it either way.
                const newId = res?.data?.role?.id || res?.data?.id;
                if (newId) setRoleId(newId);
                setSnack({ severity: 'success', message: 'Role created' });
            }
            setRoleForm(null);
        } catch (err) {
            setRoleFormError(
                err?.data?.message || err?.data?.error || 'Could not save this role',
            );
        }
    };

    const removeRole = async () => {
        try {
            await deleteRole(confirmDelete.id).unwrap();
            setSnack({ severity: 'success', message: `${confirmDelete.name} deleted` });
            setConfirmDelete(null);
        } catch (err) {
            setSnack({
                severity: 'error',
                message: err?.data?.message || err?.data?.error || 'Could not delete this role',
            });
        }
    };

    const handleSave = async () => {
        try {
            const res = await savePermissions({
                roleId, permissions: matrix.buildPayload(),
            }).unwrap();
            setSnack({ severity: 'success', message: res?.message || 'Permissions saved' });
        } catch (err) {
            setSnack({
                severity: 'error',
                message: err?.data?.message || err?.data?.error || 'Failed to save permissions',
            });
        }
    };

    const roleItem = (r) => (
        <ListItem
            key={r.id}
            disablePadding
            secondaryAction={(r.is_shared || !canEdit) ? null : (
                <Stack direction="row">
                    <Tooltip title="Rename or deactivate">
                        <IconButton size="small" edge="end" onClick={() => openEdit(r)}>
                            <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                        <IconButton size="small" edge="end" color="error"
                            onClick={() => setConfirmDelete(r)}>
                            <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Stack>
            )}
        >
            <ListItemButton selected={r.id === roleId} onClick={() => setRoleId(r.id)}>
                <ListItemText
                    primary={(
                        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap"
                            useFlexGap>
                            <Typography variant="body2" fontWeight={600}>{r.name}</Typography>
                            {r.is_shared && (
                                <Chip size="small" variant="outlined" icon={<LockOutlinedIcon />}
                                    label="Shared" />
                            )}
                            {r.is_active === false && (
                                <Chip size="small" color="warning" label="Inactive" />
                            )}
                        </Stack>
                    )}
                    secondary={(
                        <Typography variant="caption" color="text.secondary">
                            {r.granted_module_count ?? 0} module
                            {r.granted_module_count === 1 ? '' : 's'}
                            {' · '}
                            {r.staff_count ?? 0} staff
                        </Typography>
                    )}
                />
            </ListItemButton>
        </ListItem>
    );

    return (
        <Box>
            <Alert severity="info" sx={{ mb: 2 }}>
                A role is a named set of things a staff member may do. <b>Shared</b> roles come from
                your platform administrator — you can see what they grant and assign them, but only
                the administrator can change one. Roles you create belong to your {providerLabel}{' '}
                alone and are yours to edit.
                {canEdit ? (
                    <>
                        {' '}Grants are enforced on the screens a staff member can open from their
                        own sign-in; modules with no screen behind them yet are recorded as intent
                        and shown to them as such.
                    </>
                ) : (
                    <>
                        {' '}You can see what each role grants, but changing one is the practice&apos;s
                        to do — that is how someone would grant themselves the access they were not
                        given.
                    </>
                )}
            </Alert>

            {loadingRoles ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <Box sx={{
                    display: 'flex', gap: 2, alignItems: 'flex-start',
                    flexDirection: { xs: 'column', md: 'row' },
                }}>
                    <Paper sx={{ width: { xs: '100%', md: 300 }, flexShrink: 0 }}>
                        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="subtitle1" fontWeight={600} sx={{ flexGrow: 1 }}>
                                Roles
                            </Typography>
                            {canEdit && (
                                <Button size="small" variant="contained" startIcon={<AddIcon />}
                                    onClick={openCreate}>
                                    New
                                </Button>
                            )}
                        </Box>
                        <Divider />
                        {!roles.length ? (
                            <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
                                <Typography variant="body2">
                                    {canEdit
                                        ? 'No roles yet. Create one to describe what a receptionist '
                                          + 'or a practice manager here is allowed to do.'
                                        : 'No roles have been defined here yet.'}
                                </Typography>
                            </Box>
                        ) : (
                            <List dense disablePadding sx={{ maxHeight: '68vh', overflowY: 'auto' }}>
                                {!!shared.length && (
                                    <ListSubheader disableSticky>
                                        Shared by your administrator
                                    </ListSubheader>
                                )}
                                {shared.map(roleItem)}
                                {!!own.length && (
                                    <ListSubheader disableSticky>
                                        Your {providerLabel}&apos;s roles
                                    </ListSubheader>
                                )}
                                {own.map(roleItem)}
                            </List>
                        )}
                    </Paper>

                    <Box sx={{ flexGrow: 1, minWidth: 0, width: '100%' }}>
                        {!role ? (
                            <Paper sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                                <Typography variant="body2">
                                    {roles.length
                                        ? 'Pick a role to see and edit what it grants.'
                                        : 'Once you create a role, its permissions appear here.'}
                                </Typography>
                            </Paper>
                        ) : (
                            <>
                                <Paper sx={{ p: 2, mb: 2 }}>
                                    <Box sx={{
                                        display: 'flex', alignItems: 'center', gap: 1.5,
                                        flexWrap: 'wrap',
                                    }}>
                                        <Typography variant="subtitle1" fontWeight={600}>
                                            {role.name}
                                        </Typography>
                                        <Chip size="small" variant="outlined"
                                            label={`${matrix.grantedLeafCount} / ${matrix.totalLeafCount} modules granted`} />
                                        {role.staff_count > 0 && (
                                            <Chip size="small" variant="outlined" icon={<GroupsIcon />}
                                                label={`${role.staff_count} staff hold this role`} />
                                        )}
                                        {matrix.isDirty && (
                                            <Chip size="small" color="warning" label="Unsaved changes" />
                                        )}

                                        <Box sx={{ flexGrow: 1 }} />

                                        <Button size="small" startIcon={<UnfoldMoreIcon />}
                                            onClick={matrix.expandAll}>
                                            Expand all
                                        </Button>
                                        <Button size="small" startIcon={<UnfoldLessIcon />}
                                            onClick={matrix.collapseAll}>
                                            Collapse all
                                        </Button>
                                        <Tooltip title="Discard your edits and go back to what is stored">
                                            <span>
                                                <Button size="small" color="inherit"
                                                    startIcon={<RestartAltIcon />}
                                                    onClick={matrix.revert}
                                                    disabled={readOnly || !matrix.isDirty}>
                                                    Revert
                                                </Button>
                                            </span>
                                        </Tooltip>
                                        <Button
                                            variant="contained"
                                            startIcon={saving
                                                ? <CircularProgress size={16} color="inherit" />
                                                : <SaveIcon />}
                                            onClick={handleSave}
                                            disabled={readOnly || saving || !matrix.isDirty}
                                            sx={{
                                                bgcolor: '#16a34a', '&:hover': { bgcolor: '#15803d' },
                                                textTransform: 'none', fontWeight: 600,
                                            }}
                                        >
                                            Save Permissions
                                        </Button>
                                    </Box>
                                    {!!role.description && (
                                        <>
                                            <Divider sx={{ my: 1.5 }} />
                                            <Typography variant="caption" color="text.secondary">
                                                {role.description}
                                            </Typography>
                                        </>
                                    )}
                                </Paper>

                                {readOnly && (
                                    <Alert severity="warning" icon={<LockOutlinedIcon />} sx={{ mb: 2 }}>
                                        <b>{role.name}</b> is managed by your platform administrator
                                        and shared with every {providerLabel} on this platform. You
                                        can see exactly what it grants and assign it to your staff,
                                        but the ticks below can&apos;t be changed here — ask your
                                        administrator, or create your own role to grant something
                                        different.
                                    </Alert>
                                )}

                                {loadingCatalog || loadingPerms ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                                        <CircularProgress />
                                    </Box>
                                ) : (
                                    <Box sx={readOnly ? READ_ONLY_MATRIX_SX : undefined}>
                                        <PermissionTreeTable
                                            rows={matrix.rows}
                                            expanded={matrix.expanded}
                                            onToggleExpand={matrix.toggleExpand}
                                            grantFor={matrix.grantFor}
                                            columnState={matrix.columnState}
                                            onToggle={readOnly ? NOOP : matrix.toggle}
                                            onToggleColumnAll={readOnly ? NOOP : matrix.toggleColumnAll}
                                            dataRangeOf={matrix.dataRangeOf}
                                            onDataRangeChange={readOnly ? NOOP : matrix.setDataRange}
                                            dataRanges={catalog?.data_ranges}
                                        />
                                    </Box>
                                )}

                                {!readOnly && (
                                    <Typography variant="caption" color="text.secondary"
                                        sx={{ display: 'block', mt: 1.5 }}>
                                        Grants live on the deepest row. A parent row rolls its
                                        children up — it shows a dash when they disagree, and
                                        ticking it fills every child in. Click a column heading to
                                        toggle it for the whole tree.
                                    </Typography>
                                )}
                            </>
                        )}
                    </Box>
                </Box>
            )}

            <Dialog open={!!roleForm} onClose={() => setRoleForm(null)} maxWidth="sm" fullWidth>
                <DialogTitle>{roleForm?.id ? 'Edit role' : 'New role'}</DialogTitle>
                <DialogContent>
                    {roleFormError && (
                        <Alert severity="error" sx={{ mb: 2 }}>{roleFormError}</Alert>
                    )}
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <TextField
                            label="Role name" required fullWidth size="small" autoFocus
                            placeholder="Front Desk"
                            value={roleForm?.name || ''}
                            onChange={(e) => setRoleForm((f) => ({ ...f, name: e.target.value }))}
                        />
                        <TextField
                            label="Description" fullWidth size="small" multiline rows={2}
                            placeholder="Books appointments and takes payments, no clinical records."
                            value={roleForm?.description || ''}
                            onChange={(e) => setRoleForm((f) => ({
                                ...f, description: e.target.value,
                            }))}
                        />
                        {roleForm?.id && (
                            <FormControlLabel
                                control={(
                                    <Switch
                                        checked={!!roleForm?.is_active}
                                        onChange={(e) => setRoleForm((f) => ({
                                            ...f, is_active: e.target.checked,
                                        }))}
                                    />
                                )}
                                label={(
                                    <Typography variant="body2">
                                        Active — deactivate to retire a role without deleting it or
                                        losing what it grants.
                                    </Typography>
                                )}
                            />
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRoleForm(null)}>Cancel</Button>
                    <Button variant="contained" onClick={submitRole}
                        disabled={creatingRole || updatingRole}
                        startIcon={(creatingRole || updatingRole)
                            ? <CircularProgress size={16} color="inherit" /> : null}>
                        {roleForm?.id ? 'Save changes' : 'Create role'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)}>
                <DialogTitle>Delete {confirmDelete?.name}?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {confirmDelete?.staff_count
                            ? `${confirmDelete.staff_count} staff member${confirmDelete.staff_count === 1 ? '' : 's'} hold this role and will lose it.`
                            : 'No staff hold this role.'}
                        {' '}Its permissions go with it.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
                    <Button color="error" variant="contained" onClick={removeRole}>Delete</Button>
                </DialogActions>
            </Dialog>

            <Snackbar
                open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert severity={snack?.severity} onClose={() => setSnack(null)} sx={{ width: '100%' }}>
                    {snack?.message}
                </Alert>
            </Snackbar>
        </Box>
    );
}
