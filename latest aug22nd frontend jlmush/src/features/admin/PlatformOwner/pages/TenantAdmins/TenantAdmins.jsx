/**
 * Manage one tenant's admins (super + sub).
 *
 * Mirrors the per-resource management UX used elsewhere (ViewDoctors,
 * ViewPatients) but scoped to a single tenant chosen by the platform
 * owner. Top header shows tenant identity + plan; tabbed table lists
 * super-admins and sub-admins separately. Each row supports
 * block / unblock / delete + (sub-admin) view permissions.
 */
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box, Container, Typography, Paper, Button, Table, TableContainer, TableHead, TableRow,
    TableCell, TableBody, IconButton, Tabs, Tab, Chip, Tooltip, Snackbar,
    Alert, Stack, Breadcrumbs, Link as MLink, Select, MenuItem,
    Divider, FormControl, InputLabel,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
    useGetPlatformTenantQuery,
    useListTenantAdminsQuery,
    useUpdateTenantAdminStatusMutation,
    useDeleteTenantAdminMutation,
} from '../../../api/platformEndpoints';
import {
    useListPlansQuery,
    useGetTenantSubscriptionQuery,
    useAssignTenantSubscriptionMutation,
} from '../../../api/pricingEndpoints';


const StatusChip = ({ status }) => {
    const palette = {
        active:   { color: 'success', icon: <CheckCircleOutlineIcon /> },
        blocked:  { color: 'error',   icon: <BlockIcon /> },
        inactive: { color: 'default', icon: null },
        pending:  { color: 'warning', icon: null },
    };
    const cfg = palette[status] || palette.inactive;
    return (
        <Chip
            label={status}
            color={cfg.color}
            size="small"
            icon={cfg.icon || undefined}
        />
    );
};


const TenantAdmins = () => {
    const { tenantId } = useParams();
    const navigate = useNavigate();

    const tenantQ = useGetPlatformTenantQuery(tenantId);
    const adminsQ = useListTenantAdminsQuery({ tenantId }, { skip: !tenantId });

    const [updateStatus, updateState] = useUpdateTenantAdminStatusMutation();
    const [deleteAdmin] = useDeleteTenantAdminMutation();
    // The REAL plan state: this tenant's subscription plus the vendor
    // catalog. The old dropdown offered a hardcoded free/starter/pro/
    // enterprise list wired to the legacy settings['plan'] string — plans
    // the operator never authored. Assigning goes through the one
    // change-plan path (default add-ons re-attached, over-limit
    // recomputed).
    const subscriptionQ = useGetTenantSubscriptionQuery(tenantId, { skip: !tenantId });
    const plansQ = useListPlansQuery('platform');
    const [assignPlan, planState] = useAssignTenantSubscriptionMutation();
    const planOptions = (plansQ.data || [])
        .filter((pl) => pl.status === 'active' && !pl.plan_type?.is_receiver)
        .map((pl) => ({ value: pl.code, label: pl.name || pl.code }));
    const currentPlanCode = subscriptionQ.data?.plan_code || '';

    const [tab, setTab] = useState(0);
    const [snack, setSnack] = useState({ open: false, severity: 'success', message: '' });

    const tenant = tenantQ.data;
    const admins = adminsQ.data || [];
    const superAdmins = admins.filter((a) => a.role === 'super_admin');
    const subAdmins = admins.filter((a) => a.role === 'sub_admin');
    const visible = tab === 0 ? superAdmins : subAdmins;

    // ── Action handlers ────────────────────────────────────────────
    const handleStatusChange = async (admin, newStatus) => {
        const verb = newStatus === 'blocked' ? 'block'
                   : newStatus === 'active'  ? 'unblock'
                   : `set to ${newStatus}`;
        if (!window.confirm(`${verb} ${admin.full_name || admin.phone_number}?`)) return;
        try {
            await updateStatus({ tenantId, userId: admin.id, status: newStatus }).unwrap();
            setSnack({ open: true, severity: 'success',
                message: `${admin.full_name || admin.phone_number} is now ${newStatus}.` });
        } catch (err) {
            setSnack({ open: true, severity: 'error',
                message: err?.data?.error || 'Failed to update status.' });
        }
    };

    const handleDelete = async (admin) => {
        if (!window.confirm(
            `Delete ${admin.full_name || admin.phone_number}? ` +
            `This soft-deletes the user — they keep their row in the audit log ` +
            `but cannot log in.`
        )) return;
        try {
            await deleteAdmin({ tenantId, userId: admin.id }).unwrap();
            setSnack({ open: true, severity: 'success',
                message: `${admin.full_name || admin.phone_number} deleted.` });
        } catch (err) {
            setSnack({ open: true, severity: 'error',
                message: err?.data?.error || 'Failed to delete admin.' });
        }
    };

    const handlePlanChange = async (newPlanCode) => {
        try {
            await assignPlan({ tenantId, data: { plan_code: newPlanCode } }).unwrap();
            setSnack({ open: true, severity: 'success',
                message: `Plan changed to "${newPlanCode}".` });
        } catch (err) {
            setSnack({ open: true, severity: 'error',
                message: err?.data?.error || 'Failed to change plan.' });
        }
    };

    // ── Render ─────────────────────────────────────────────────────
    return (
        <Container maxWidth="lg" sx={{ py: 3 }}>
            <Breadcrumbs sx={{ mb: 2 }}>
                <MLink
                    component="button" underline="hover"
                    onClick={() => navigate('/dashboard/platform/tenants')}
                >
                    Tenants
                </MLink>
                <Typography color="text.primary">
                    {tenant?.name || tenantId}
                </Typography>
                <Typography color="text.primary">Admins</Typography>
            </Breadcrumbs>

            {/* Header card — tenant identity + plan + DNS info ────── */}
            <Paper sx={{ p: 3, mb: 3 }}>
                <Stack direction="row" alignItems="flex-start" spacing={2}>
                    <Box sx={{ flex: 1 }}>
                        <Typography variant="h5" gutterBottom>
                            {tenant?.name || '…'}
                        </Typography>
                        <Stack direction="row" spacing={2} alignItems="center">
                            <Typography variant="body2" color="text.secondary">
                                slug: <code>{tenant?.slug}</code>
                            </Typography>
                            {tenant?.fqdn && (
                                <Typography variant="body2" color="text.secondary">
                                    fqdn: <code>{tenant.fqdn}</code>
                                </Typography>
                            )}
                            {tenant?.dns_status && (
                                <Chip
                                    label={`dns: ${tenant.dns_status}`}
                                    size="small"
                                    color={tenant.dns_status === 'active' ? 'success'
                                         : tenant.dns_status === 'failed' ? 'error'
                                         : 'default'}
                                />
                            )}
                        </Stack>
                    </Box>
                    <FormControl size="small" sx={{ minWidth: 200 }}>
                        <InputLabel id="plan-label">Plan</InputLabel>
                        <Select
                            labelId="plan-label"
                            label="Plan"
                            // '' renders empty while the subscription (or a
                            // sub-less tenant) resolves — never a made-up
                            // default.
                            value={planOptions.some((p) => p.value === currentPlanCode)
                                ? currentPlanCode : ''}
                            onChange={(e) => handlePlanChange(e.target.value)}
                            disabled={planState.isLoading || !tenant || plansQ.isLoading}
                            displayEmpty
                        >
                            {!currentPlanCode && (
                                <MenuItem value="" disabled>
                                    No subscription
                                </MenuItem>
                            )}
                            {planOptions.map((p) => (
                                <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Stack>
            </Paper>

            {/* Tabs ──────────────────────────────────────────────── */}
            <Paper sx={{ mb: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ pr: 2 }}>
                    <Tabs value={tab} onChange={(_, v) => setTab(v)}>
                        <Tab label={`Super admins (${superAdmins.length})`} />
                        <Tab label={`Sub admins (${subAdmins.length})`} />
                    </Tabs>
                    <Stack direction="row" spacing={1}>
                        <Tooltip title="Refresh">
                            <IconButton onClick={() => adminsQ.refetch()}>
                                <RefreshIcon />
                            </IconButton>
                        </Tooltip>
                        <Button
                            variant="contained" size="small"
                            startIcon={<PersonAddIcon />}
                            onClick={() => navigate(
                                `/dashboard/platform/tenants?createSuperAdmin=${tenantId}`
                            )}
                        >
                            Add super admin
                        </Button>
                    </Stack>
                </Stack>
            </Paper>

            {/* Table ─────────────────────────────────────────────── */}
            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Phone</TableCell>
                            <TableCell>Email</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Created</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {adminsQ.isLoading && (
                            <TableRow><TableCell colSpan={6}>Loading…</TableCell></TableRow>
                        )}
                        {!adminsQ.isLoading && visible.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={6}>
                                    <Alert severity={tab === 0 ? 'warning' : 'info'} sx={{ my: 1 }}>
                                        {tab === 0
                                            ? 'No super-admins yet — this tenant cannot be self-managed. Click "Add super admin" above.'
                                            : 'No sub-admins yet. Sub-admins are created from inside the tenant by their super-admin.'}
                                    </Alert>
                                </TableCell>
                            </TableRow>
                        )}
                        {visible.map((admin) => (
                            <TableRow key={admin.id} hover>
                                <TableCell>
                                    {admin.full_name
                                        || `${admin.first_name || ''} ${admin.last_name || ''}`.trim()
                                        || '—'}
                                </TableCell>
                                <TableCell>{admin.phone_number || '—'}</TableCell>
                                <TableCell>{admin.email || '—'}</TableCell>
                                <TableCell><StatusChip status={admin.status} /></TableCell>
                                <TableCell>
                                    {admin.created_at
                                        ? new Date(admin.created_at).toLocaleDateString()
                                        : '—'}
                                </TableCell>
                                <TableCell align="right">
                                    {admin.role === 'sub_admin' && (
                                        <Tooltip title="View / edit RBAC permissions">
                                            <IconButton
                                                aria-label="permissions"
                                                onClick={() => navigate(
                                                    `/dashboard/admin/sub-admins/${admin.id}` +
                                                    `?tenant_id=${tenantId}`
                                                )}
                                            >
                                                <LockOutlinedIcon />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                    {admin.status === 'active' ? (
                                        <Tooltip title="Block — invalidates active sessions immediately">
                                            <IconButton
                                                aria-label="block"
                                                color="warning"
                                                onClick={() => handleStatusChange(admin, 'blocked')}
                                                disabled={updateState.isLoading}
                                            >
                                                <BlockIcon />
                                            </IconButton>
                                        </Tooltip>
                                    ) : (
                                        <Tooltip title="Unblock">
                                            <IconButton
                                                aria-label="unblock"
                                                color="success"
                                                onClick={() => handleStatusChange(admin, 'active')}
                                                disabled={updateState.isLoading}
                                            >
                                                <CheckCircleOutlineIcon />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                    <Tooltip title="Soft-delete admin">
                                        <IconButton
                                            aria-label="delete"
                                            color="error"
                                            onClick={() => handleDelete(admin)}
                                        >
                                            <DeleteOutlineIcon />
                                        </IconButton>
                                    </Tooltip>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            <Snackbar
                open={snack.open}
                autoHideDuration={4000}
                onClose={() => setSnack((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert severity={snack.severity}>{snack.message}</Alert>
            </Snackbar>
        </Container>
    );
};

export default TenantAdmins;
