/**
 * ResellerTenantsPage — "My Tenants" for an apex reseller: the tenants it
 * created, their subscription state, suspend/reactivate/rename, and the
 * create dialog. Deliberately a small fresh table (the vendor TenantsList
 * is 1400+ lines of DNS/entitlement machinery children don't have).
 *
 * A 403 not_apex_tenant (deep link from a non-apex admin) renders the
 * "not included in your plan" empty state instead of a spinner.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Chip, CircularProgress, Container, IconButton,
    Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CampaignIcon from '@mui/icons-material/Campaign';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import EditIcon from '@mui/icons-material/Edit';
import ExtensionIcon from '@mui/icons-material/Extension';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import ChildAddonsDialog from '../components/ChildAddonsDialog';
import ChangeChildPlanDialog from '../components/ChangeChildPlanDialog';
import { useDispatch } from 'react-redux';

import { setSnackbar } from '../../redux/adminSharedUiSlice';
import QuotaCard from '../components/QuotaCard';
import CreateChildTenantDialog from '../components/CreateChildTenantDialog';
import AnnouncementDialog from '../../components/AnnouncementDialog';
import {
    useListResellerTenantsQuery, useUpdateResellerTenantMutation,
    useAnnounceToChildrenMutation,
} from '../api/resellerEndpoints';

const SUB_COLORS = { active: 'success', trial: 'info', past_due: 'warning',
                     suspended: 'error' };

export default function ResellerTenantsPage() {
    const dispatch = useDispatch();
    const notify = (severity, message) =>
        dispatch(setSnackbar({ open: true, severity, message }));

    const { data: tenants = [], isLoading, error } = useListResellerTenantsQuery();
    const [updateTenant] = useUpdateResellerTenantMutation();
    const [createOpen, setCreateOpen] = useState(false);
    const [renaming, setRenaming] = useState(null);
    const [addonsFor, setAddonsFor] = useState(null);
    const [planFor, setPlanFor] = useState(null);
    const [planPick, setPlanPick] = useState(''); // {id, name}
    const [announceOpen, setAnnounceOpen] = useState(false);
    const [announce, announceState] = useAnnounceToChildrenMutation();

    const handleAnnounce = async (payload) => {
        try {
            const res = await announce(payload).unwrap();
            const d = res?.data || res;
            notify('success',
                `Announcement sent to ${d?.admins_notified ?? 0} admin(s) `
                + `across ${d?.tenants_reached ?? 0} tenant(s).`
                + (d?.skipped_ids?.length
                    ? ` ${d.skipped_ids.length} id(s) skipped.` : ''));
            return true;
        } catch (err) {
            notify('error',
                err?.data?.error || 'Failed to send announcement.');
            return false;
        }
    };

    if (error?.status === 403) {
        return (
            <Container maxWidth="md" sx={{ py: 6 }}>
                <Alert severity="info">
                    <Typography variant="subtitle1" fontWeight={600}>
                        Reselling isn&apos;t included in your plan
                    </Typography>
                    <Typography variant="body2">
                        Operating your own tenants requires a reseller plan.
                        Contact your provider to upgrade.
                    </Typography>
                </Alert>
            </Container>
        );
    }

    const setStatus = async (t, status) => {
        try {
            await updateTenant({ id: t.id, data: { status } }).unwrap();
            notify('success', `"${t.slug}" ${status === 'active' ? 'reactivated' : 'suspended'}`);
        } catch (err) {
            notify('error', err?.data?.error || 'Update failed');
        }
    };

    const saveRename = async () => {
        try {
            await updateTenant({
                id: renaming.id, data: { name: renaming.name },
            }).unwrap();
            notify('success', 'Renamed');
            setRenaming(null);
        } catch (err) {
            notify('error', err?.data?.error || 'Rename failed');
        }
    };

    return (
        <Container maxWidth="lg" sx={{ py: 3 }}>
            <Stack direction="row" justifyContent="space-between"
                   alignItems="center" sx={{ mb: 2 }}>
                <Box>
                    <Typography variant="h4">My Tenants</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Organisations running on tenancies you sold them.
                    </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                    <Button variant="outlined" startIcon={<CampaignIcon />}
                            onClick={() => setAnnounceOpen(true)}
                            disabled={tenants.length === 0}>
                        Announce
                    </Button>
                    <Button variant="contained" startIcon={<AddIcon />}
                            onClick={() => setCreateOpen(true)}>
                        New tenant
                    </Button>
                </Stack>
            </Stack>

            <QuotaCard />

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <TableContainer component={Paper}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Name</TableCell>
                                <TableCell>Subdomain</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell>Plan / Billing</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {tenants.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5}>
                                        <Typography variant="body2" color="text.secondary">
                                            No tenants yet — create the first one.
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                            {tenants.map((t) => (
                                <TableRow key={t.id} hover>
                                    <TableCell>
                                        {renaming?.id === t.id ? (
                                            <Stack direction="row" spacing={1}>
                                                <TextField
                                                    size="small" value={renaming.name}
                                                    onChange={(e) => setRenaming(
                                                        { ...renaming, name: e.target.value })}
                                                />
                                                <Button size="small" onClick={saveRename}>Save</Button>
                                                <Button size="small" onClick={() => setRenaming(null)}>✕</Button>
                                            </Stack>
                                        ) : t.name}
                                    </TableCell>
                                    <TableCell><code>{t.slug}</code></TableCell>
                                    <TableCell>
                                        <Chip size="small" label={t.status}
                                              color={t.status === 'active' ? 'success' : 'default'} />
                                    </TableCell>
                                    <TableCell>
                                        {t.subscription ? (
                                            <Stack direction="row" spacing={0.5} alignItems="center">
                                                <Typography variant="body2">
                                                    {t.subscription.plan_name || t.subscription.plan_code}
                                                </Typography>
                                                <Chip
                                                    size="small"
                                                    label={t.subscription.status}
                                                    color={SUB_COLORS[t.subscription.status] || 'default'}
                                                    variant="outlined"
                                                />
                                            </Stack>
                                        ) : '—'}
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title="Change plan">
                                            <IconButton size="small"
                                                        onClick={() => {
                                                            setPlanFor(t);
                                                            setPlanPick(t.subscription?.plan_code || '');
                                                        }}>
                                                <SwapHorizIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Add-ons">
                                            <IconButton size="small"
                                                        onClick={() => setAddonsFor(t)}>
                                                <ExtensionIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Rename">
                                            <IconButton size="small"
                                                        onClick={() => setRenaming({ id: t.id, name: t.name })}>
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        {t.status === 'active' ? (
                                            <Tooltip title="Suspend">
                                                <IconButton size="small" color="error"
                                                            onClick={() => setStatus(t, 'inactive')}>
                                                    <BlockIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        ) : (
                                            <Tooltip title="Reactivate">
                                                <IconButton size="small" color="success"
                                                            onClick={() => setStatus(t, 'active')}>
                                                    <CheckCircleOutlineIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            <AnnouncementDialog
                open={announceOpen}
                onClose={() => setAnnounceOpen(false)}
                tenants={tenants}
                audienceAllLabel="All my tenants"
                onSend={handleAnnounce}
                sending={announceState.isLoading}
            />

            <CreateChildTenantDialog
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                notify={notify}
            />
            {addonsFor && (
                <ChildAddonsDialog child={addonsFor}
                    onClose={() => setAddonsFor(null)} />
            )}
            {planFor && (
                <ChangeChildPlanDialog
                    child={planFor}
                    initial={planPick}
                    onClose={() => setPlanFor(null)}
                />
            )}
        </Container>
    );
}
