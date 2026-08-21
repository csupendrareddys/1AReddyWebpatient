/**
 * RolesPermissions — the leaf of Operations → Manage Roles & Permissions.
 * Route: /dashboard/admin/operations/roles-permissions/:entity
 *
 * Reached the same way as everything else in Operations — section → user type
 * → entity — and lands on one entity's module tree with a role picker over it.
 * The question the screen answers is "for a <role> at this kind of provider,
 * which of their screens can they do what on".
 *
 * TWO MODES, and the screen says which it's in:
 *
 *  * doctor / clinic / hospital are LIVE. The tree comes from the backend
 *    catalog, roles come from ``provider_roles`` (seeded per tenant on first
 *    read), and Save writes ``provider_role_permissions``. The roles apply to
 *    ``ProviderStaff`` — the people who work for that provider. They still
 *    grant nothing in practice, because staff can't log in yet; that is a
 *    statement about the login, not about the data.
 *
 *  * patient / admin are PREVIEW. Neither has a staff entity to hold a grant,
 *    so there is nothing to save against — see the constants file for why.
 *    Same table, local tree, banner saying nothing persists.
 *
 * Keeping one screen for both is deliberate: the alternative is two matrices
 * that drift, and the preview half is where the next entity gets designed.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    Alert, Box, Breadcrumbs, Button, Chip, CircularProgress, Dialog,
    DialogContent, DialogTitle, Divider, Link, MenuItem, Paper, Snackbar,
    Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import SaveIcon from '@mui/icons-material/Save';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import GroupsIcon from '@mui/icons-material/Groups';
import PersonAddAltIcon from '@mui/icons-material/PersonAddAlt';
import HandshakeIcon from '@mui/icons-material/Handshake';

import BackButton from '../../../../../../common/components/BackButton/BackButton';
import usePermissions from '../../../../../../common/hooks/usePermissions';
import LinkRelationshipPanel from '../../components/LinkRelationshipPanel/LinkRelationshipPanel';
import LinkStaffDialog from '../../components/LinkStaffDialog/LinkStaffDialog';
import PermissionTreeTable from '../../components/PermissionTreeTable/PermissionTreeTable';
import ProviderStaffPanel from '../../components/ProviderStaffPanel/ProviderStaffPanel';
import usePermissionTree from '../../hooks/usePermissionTree';
import {
    ENTITY_LABEL, LIVE_ENTITIES, PREVIEW_ROLES, PREVIEW_TREES, RBAC_ENTITIES,
} from '../../constants/permissionTree';
import {
    useGetProviderModulesQuery,
    useGetProviderRolesQuery,
    useGetProviderRolePermissionsQuery,
    useSaveProviderRolePermissionsMutation,
    useGetProviderStaffQuery,
    useUpdateProviderStaffMutation,
    useSetProviderStaffRolesMutation,
} from '../../api/providerRbacEndpoints';

const OPERATIONS_PATH = '/dashboard/admin/operations';

export default function RolesPermissions() {
    const { entity } = useParams();
    const navigate = useNavigate();
    const { hasFullAccess } = usePermissions();

    const isLive = LIVE_ENTITIES.includes(entity);
    const isKnown = RBAC_ENTITIES.includes(entity);

    // ── Server state (live verticals only) ───────────────────────────────
    // ``skip`` is what keeps the preview entities from calling endpoints that
    // would 404 for them — the backend rejects a non-provider vertical rather
    // than returning an empty list, so asking at all would surface an error.
    const { data: catalog, isLoading: loadingCatalog } = useGetProviderModulesQuery(
        entity, { skip: !isLive || !isKnown },
    );
    const { data: liveRoles, isLoading: loadingRoles } = useGetProviderRolesQuery(
        entity, { skip: !isLive || !isKnown },
    );

    const roles = isLive ? (liveRoles || []) : (PREVIEW_ROLES[entity] || []);
    const [roleId, setRoleId] = useState('');

    // Settle on a role as soon as there is one, and re-settle when the entity
    // changes — a role id from the previous vertical would query nothing.
    useEffect(() => {
        setRoleId((current) => (
            roles.some((r) => r.id === current) ? current : (roles[0]?.id || '')
        ));
    }, [roles]);

    // ``currentData``, NOT ``data``. RTK Query keeps ``data`` from the previous
    // argument while the next one is in flight, so switching roles would hand
    // the matrix the OLD role's grants, seed the new role's draft with them,
    // and — because a draft is only seeded once — never correct itself. Saving
    // would then copy one role's permissions onto another. ``currentData`` is
    // undefined until the response for THIS role arrives, which is exactly the
    // "don't seed yet" signal the hook wants.
    const { currentData: savedPermissions, isFetching: loadingPerms } =
        useGetProviderRolePermissionsQuery(roleId, { skip: !isLive || !roleId });
    const [savePermissions, { isLoading: saving }] = useSaveProviderRolePermissionsMutation();

    // Preview entities have no server, so their "saved" state is permanently
    // empty — which makes revert clear the draft, and every tick dirty.
    const effectiveSaved = isLive ? savedPermissions : [];

    const tree = useMemo(
        () => (isLive ? (catalog?.modules || []) : (PREVIEW_TREES[entity] || [])),
        [isLive, catalog, entity],
    );

    const matrix = usePermissionTree({
        tree, roleKey: roleId, savedPermissions: effectiveSaved,
    });

    const [payload, setPayload] = useState(null);
    const [snack, setSnack] = useState(null);
    const [tab, setTab] = useState(0);

    // The vertical-wide roster: who holds these roles, across every practice.
    // Editing a row is scoped to the row, but adding one needs a practice to
    // add it TO — which is what ``LinkStaffDialog`` asks for, so this tab can
    // now create staff without leaving for the member-detail screen.
    const { data: staffData, isFetching: loadingStaff } = useGetProviderStaffQuery(
        { providerType: entity, per_page: 100 }, { skip: !isLive || tab !== 1 },
    );
    const [updateStaff] = useUpdateProviderStaffMutation();
    const [setStaffRoles, { isLoading: savingStaff }] = useSetProviderStaffRolesMutation();

    // ``null`` closed; ``{ member }`` open — an object rather than a boolean so
    // the dialog remounts per open and drops its previous draft.
    const [linking, setLinking] = useState(null);

    if (!hasFullAccess) {
        return (
            <Paper sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="h6" color="error">Access Denied</Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>
                    Operations is available to super admins only.
                </Typography>
            </Paper>
        );
    }

    // A hand-typed or stale URL shouldn't render an empty grid with a working
    // Save button — say what happened and offer the way back.
    if (!isKnown) {
        return (
            <Paper sx={{ textAlign: 'center', py: 5 }}>
                <Typography variant="h6">Unknown entity</Typography>
                <Typography color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                    There is no permission tree for &quot;{entity}&quot;.
                </Typography>
                <Button variant="outlined" onClick={() => navigate(OPERATIONS_PATH)}>
                    Back to Operations
                </Button>
            </Paper>
        );
    }

    const entityLabel = ENTITY_LABEL[entity] || entity;
    const role = roles.find((r) => r.id === roleId);
    // Includes the per-role permission fetch: until it lands the matrix has no
    // grants to draw, and showing an empty grid would read as "this role has
    // nothing" rather than "still loading".
    const loading = isLive && (loadingCatalog || loadingRoles || loadingPerms);

    const handleSave = async () => {
        if (!isLive) {
            setPayload(matrix.buildPayload());
            return;
        }
        try {
            const res = await savePermissions({
                roleId, providerType: entity, permissions: matrix.buildPayload(),
            }).unwrap();
            setSnack({ severity: 'success', message: res?.message || 'Permissions saved' });
        } catch (err) {
            setSnack({
                severity: 'error',
                message: err?.data?.message || err?.data?.error || 'Failed to save permissions',
            });
        }
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <BackButton to={OPERATIONS_PATH} />
                <Typography variant="h5" fontWeight={600}>Operations</Typography>
            </Box>
            <Paper sx={{ mb: 3, py: 1.5, px: 2 }}>
                <Breadcrumbs>
                    <Link component="button" underline="hover" color="inherit"
                        onClick={() => navigate('/dashboard/admin')}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <HomeIcon fontSize="small" /> Dashboard
                    </Link>
                    <Link component="button" underline="hover" color="inherit"
                        onClick={() => navigate(OPERATIONS_PATH)}>
                        Operations
                    </Link>
                    <Typography color="text.secondary">Manage Roles &amp; Permissions</Typography>
                    <Typography color="primary" fontWeight="bold">{entityLabel}</Typography>
                </Breadcrumbs>
            </Paper>

            {/* Scoped to the two staff tabs. The relationship matrix is not
                about staff at all, and this sentence would be actively wrong
                above it — it says the grants aren't enforced yet, and those
                ones are. That tab carries its own explanation. */}
            {isLive && tab !== 2 ? (
                <Alert severity="info" icon={<GroupsIcon />} sx={{ mb: 2 }}>
                    These roles apply to <b>{entityLabel.toLowerCase()} staff</b> — the people who
                    work for a {entityLabel.toLowerCase()}, not the {entityLabel.toLowerCase()}&apos;s
                    own account. What you save here is stored and is what a staff member will be
                    allowed to do. Staff have no login yet, so nothing is enforced at a sign-in
                    today; the grants are real, the door isn&apos;t open.
                </Alert>
            ) : isLive ? null : (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    <b>Preview only.</b> {entityLabel} has no staff entity to hold a grant, so
                    nothing here is saved or enforced.{' '}
                    {entity === 'admin'
                        ? 'Administrator roles are already managed under Roles & Permissions in the sidebar — this would be a second editor over the same rows.'
                        : 'A patient is one person rather than an organisation; this is the shape family-member delegation would take if it lands.'}
                </Alert>
            )}

            {/* Only the live verticals have staff to show, so the preview
                entities keep a single-screen page rather than a tab strip with
                one permanently empty tab. */}
            {isLive && (
                <Paper sx={{ mb: 2 }}>
                    <Tabs value={tab} onChange={(_, v) => setTab(v)}>
                        <Tab label="Permissions" />
                        <Tab label={`${entityLabel} Staff`} icon={<GroupsIcon />} iconPosition="start" />
                        {/* The other direction of provider permissions: not
                            what a practice grants its own staff, but what a
                            linked clinic or hospital may do to a doctor. One
                            matrix for the tenant, so it appears on all three
                            verticals rather than hiding under one of them and
                            making an operator guess which. */}
                        <Tab label="My Link Relationships" icon={<HandshakeIcon />} iconPosition="start" />
                    </Tabs>
                </Paper>
            )}

            {/* No canEdit prop: the page already refuses anyone without full
                access, so reaching this tab IS the permission. */}
            {isLive && tab === 2 ? (
                <LinkRelationshipPanel />
            ) : isLive && tab === 1 ? (
                <>
                    <Paper sx={{ p: 2, mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box sx={{ minWidth: 0 }}>
                            <Typography variant="subtitle2" fontWeight={600}>
                                Add or move staff
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                A staff member works for one practice. Create someone under a
                                practice, or move an existing member to another one.
                            </Typography>
                        </Box>
                        <Box sx={{ flexGrow: 1 }} />
                        <Button
                            variant="contained" size="small" startIcon={<PersonAddAltIcon />}
                            onClick={() => setLinking({ member: null })}
                            sx={{ flexShrink: 0 }}
                        >
                            Link staff member
                        </Button>
                    </Paper>
                    <ProviderStaffPanel
                        providerType={entity}
                        providerLabel={entityLabel.toLowerCase()}
                        staff={staffData?.staff || []}
                        roles={roles}
                        isLoading={loadingStaff}
                        busy={savingStaff}
                        onUpdate={(member, form) => updateStaff({
                            staffId: member.id, providerType: entity, ...form,
                        }).unwrap()}
                        onSetRoles={(member, roleIds) => setStaffRoles({
                            staffId: member.id, providerType: entity, roleIds,
                        }).unwrap()}
                        onLink={(member) => setLinking({ member })}
                    />
                </>
            ) : (
            <>
            <Paper sx={{ p: 2, mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <TextField
                        select size="small" label="Role"
                        value={roles.some((r) => r.id === roleId) ? roleId : ''}
                        onChange={(e) => setRoleId(e.target.value)}
                        disabled={loading || !roles.length}
                        sx={{ minWidth: 260 }}
                    >
                        {roles.map((r) => (
                            <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>
                        ))}
                    </TextField>

                    <Chip
                        size="small" variant="outlined"
                        label={`${matrix.grantedLeafCount} / ${matrix.totalLeafCount} modules granted`}
                    />
                    {isLive && role?.staff_count > 0 && (
                        <Chip size="small" variant="outlined" icon={<GroupsIcon />}
                            label={`${role.staff_count} staff hold this role`} />
                    )}
                    {matrix.isDirty && (
                        <Chip size="small" color="warning" label="Unsaved changes" />
                    )}

                    <Box sx={{ flexGrow: 1 }} />

                    <Button size="small" startIcon={<UnfoldMoreIcon />} onClick={matrix.expandAll}>
                        Expand all
                    </Button>
                    <Button size="small" startIcon={<UnfoldLessIcon />} onClick={matrix.collapseAll}>
                        Collapse all
                    </Button>
                    <Tooltip title={isLive
                        ? 'Discard your edits and go back to what is stored'
                        : `Clear every tick for ${role?.name || 'this role'}`}>
                        <span>
                            <Button size="small" color="inherit" startIcon={<RestartAltIcon />}
                                onClick={matrix.revert} disabled={!matrix.isDirty}>
                                {isLive ? 'Revert' : 'Reset'}
                            </Button>
                        </span>
                    </Tooltip>
                    <Button
                        variant="contained"
                        startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                        onClick={handleSave}
                        disabled={saving || !roleId || (isLive && !matrix.isDirty)}
                        sx={{
                            bgcolor: '#16a34a', '&:hover': { bgcolor: '#15803d' },
                            textTransform: 'none', fontWeight: 600,
                        }}
                    >
                        Save Permissions
                    </Button>
                </Box>
                <Divider sx={{ my: 1.5 }} />
                <Typography variant="caption" color="text.secondary">
                    Grants live on the deepest row. A parent row rolls its children up — it shows a
                    dash when they disagree, and ticking it fills every child in. Click a column
                    heading to toggle it for the whole tree.
                </Typography>
            </Paper>

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <PermissionTreeTable
                    rows={matrix.rows}
                    expanded={matrix.expanded}
                    onToggleExpand={matrix.toggleExpand}
                    grantFor={matrix.grantFor}
                    columnState={matrix.columnState}
                    onToggle={matrix.toggle}
                    onToggleColumnAll={matrix.toggleColumnAll}
                    dataRangeOf={matrix.dataRangeOf}
                    onDataRangeChange={matrix.setDataRange}
                    dataRanges={catalog?.data_ranges}
                />
            )}
            </>
            )}

            {linking && (
                <LinkStaffDialog
                    open
                    member={linking.member}
                    defaultProviderType={entity}
                    onClose={() => setLinking(null)}
                    onDone={(message) => {
                        setLinking(null);
                        setSnack({ severity: 'success', message });
                    }}
                />
            )}

            {/* Preview entities have nowhere to post, so Save shows the
                operator exactly what WOULD be sent. That keeps the button
                honest and doubles as the spec for the endpoint. */}
            <Dialog open={!!payload} onClose={() => setPayload(null)} maxWidth="md" fullWidth>
                <DialogTitle>
                    Draft permissions — not saved
                    <Typography variant="body2" color="text.secondary">
                        {entityLabel} · {role?.name}
                    </Typography>
                </DialogTitle>
                <DialogContent>
                    <Alert severity="info" sx={{ mb: 2 }}>
                        This is the payload this screen would send if {entityLabel.toLowerCase()}
                        {' '}had a staff entity behind it. Closing this dialog keeps your ticks;
                        leaving the page discards them.
                    </Alert>
                    <Box component="pre" sx={{
                        m: 0, p: 2, bgcolor: '#f8f9fa', borderRadius: 1,
                        fontSize: '0.75rem', overflow: 'auto', maxHeight: '50vh',
                    }}>
                        {JSON.stringify({ entity, role: roleId, permissions: payload }, null, 2)}
                    </Box>
                </DialogContent>
            </Dialog>

            <Snackbar
                open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert severity={snack?.severity} onClose={() => setSnack(null)}
                    sx={{ width: '100%' }}>
                    {snack?.message}
                </Alert>
            </Snackbar>
        </Box>
    );
}
