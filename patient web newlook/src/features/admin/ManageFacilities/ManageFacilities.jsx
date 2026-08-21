/**
 * ManageFacilities — admin view + verify for hospitals and clinics.
 *
 * Single component, parameterised on ``vertical`` ('hospital' | 'clinic')
 * because the two resources mirror each other exactly. Each surface:
 *
 *   * Tab strip — Pending / Verified / Rejected / All — quick filter by
 *     verification status.
 *   * Search box — name or registration number.
 *   * List row — name, registration number, status chip, facility
 *     admin user (the person who registered it), View button.
 *   * View dialog — full row details + facility admin contact +
 *     presigned URLs for admin_aadhaar_attachment + registration_
 *     certificate + Verify / Reject buttons.
 *
 * Mounted at /dashboard/admin/hospitals and /dashboard/admin/clinics —
 * the route layer picks the vertical so this component is reused.
 */
import { useMemo, useState } from 'react';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress,
    Dialog, DialogActions, DialogContent, DialogTitle, Divider,
    InputAdornment, Stack, Tab, Tabs, TextField, Typography,
    List, ListItem, ListItemText, ListItemSecondaryAction, IconButton,
    Tooltip,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import AddBusinessIcon from '@mui/icons-material/AddBusiness';
import Snackbar from '@mui/material/Snackbar';

import {
    useGetHospitalsQuery,
    useGetHospitalDetailQuery,
    useUpdateHospitalVerificationMutation,
    useUpdateHospitalAdminStatusMutation,
    useGetClinicsQuery,
    useGetClinicDetailQuery,
    useUpdateClinicVerificationMutation,
    useUpdateClinicAdminStatusMutation,
} from '../api/facilitiesEndpoints';
import {
    useAdminInviteHospitalMutation,
    useAdminInviteClinicMutation,
} from '../../service-provider/Affiliation/api/affiliationEndpoints';
import InviteUserDialog from '../components/InviteUserDialog/InviteUserDialog';


const TAB_TO_STATUS = ['', 'pending', 'verified', 'rejected'];
const TAB_LABELS = ['All', 'Pending', 'Verified', 'Rejected'];


function StatusChip({ status }) {
    const colorByStatus = {
        pending: 'warning',
        verified: 'success',
        rejected: 'error',
    };
    return (
        <Chip
            size="small"
            label={(status || 'pending').toUpperCase()}
            color={colorByStatus[status] || 'default'}
        />
    );
}


export function FacilityDetailDialog({
    facilityId,
    vertical,
    onClose,
    detailQueryHook,
    verifyMutationHook,
    adminStatusMutationHook,
}) {
    const { data, isLoading, isError, error, refetch } = detailQueryHook(facilityId, {
        skip: !facilityId,
    });
    const [verify, { isLoading: isVerifying }] = verifyMutationHook();
    const [updateAdminStatus, { isLoading: isUpdatingAdminStatus }] = adminStatusMutationHook();
    const [actionError, setActionError] = useState(null);

    const handleVerify = async (newStatus) => {
        setActionError(null);
        try {
            const payload = {
                verificationStatus: newStatus,
                ...(vertical === 'hospital'
                    ? { hospitalId: facilityId }
                    : { clinicId: facilityId }),
            };
            await verify(payload).unwrap();
            onClose(true);
        } catch (e) {
            setActionError(
                e?.data?.message || e?.data?.error || e?.message
                || 'Failed to update verification status.',
            );
        }
    };

    // Independent of the verification flow — flip the admin user's
    // account status. Used to (re-)activate a verified facility whose
    // admin user is still INACTIVE (e.g. row verified before the
    // activate-on-verify code shipped), or to suspend an active admin
    // without rolling back the verification.
    const handleAdminStatus = async (newStatus) => {
        setActionError(null);
        try {
            const payload = {
                status: newStatus,
                ...(vertical === 'hospital'
                    ? { hospitalId: facilityId }
                    : { clinicId: facilityId }),
            };
            await updateAdminStatus(payload).unwrap();
            // Re-read so the chip + button highlighting update without
            // closing the dialog (operator can change verification AND
            // status in one session).
            refetch();
        } catch (e) {
            setActionError(
                e?.data?.message || e?.data?.error || e?.message
                || 'Failed to update admin user status.',
            );
        }
    };

    const adminStatus = data?.admin_user?.status;
    const adminStatusColor = (
        adminStatus === 'active' ? 'success'
        : adminStatus === 'inactive' ? 'warning'
        : adminStatus === 'blocked' ? 'error'
        : 'default'
    );

    return (
        <Dialog open={!!facilityId} onClose={() => onClose(false)} fullWidth maxWidth="md">
            <DialogTitle>
                {vertical === 'hospital' ? 'Hospital' : 'Clinic'} — Verification Details
            </DialogTitle>
            <DialogContent dividers>
                {isLoading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress />
                    </Box>
                )}
                {isError && (
                    <Alert severity="error">
                        Could not load details:{' '}
                        {error?.data?.message || error?.message || 'unknown error'}
                    </Alert>
                )}
                {actionError && (
                    <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>
                )}
                {data && (
                    <Stack spacing={2}>
                        <Box>
                            <Typography variant="h6">{data.name}</Typography>
                            <Stack direction="row" spacing={1} alignItems="center">
                                <StatusChip status={data.verification_status} />
                                {data.created_at && (
                                    <Typography variant="caption" color="text.secondary">
                                        Registered{' '}
                                        {new Date(data.created_at).toLocaleString()}
                                    </Typography>
                                )}
                            </Stack>
                        </Box>

                        <Divider />

                        <Box>
                            <Typography variant="subtitle2" color="text.secondary">
                                Registration
                            </Typography>
                            <Typography>
                                <strong>Number:</strong> {data.registration_number || '—'}
                            </Typography>
                            {data.hospital_type && (
                                <Typography>
                                    <strong>Type:</strong> {data.hospital_type}
                                </Typography>
                            )}
                            <Typography>
                                <strong>Address:</strong>{' '}
                                {[data.address, data.city, data.state, data.pincode]
                                    .filter(Boolean)
                                    .join(', ') || '—'}
                            </Typography>
                        </Box>

                        <Divider />

                        <Box>
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                Admin User (Registrant)
                            </Typography>
                            {data.admin_user ? (
                                <>
                                    <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
                                        <Typography>
                                            {data.admin_user.first_name} {data.admin_user.last_name}
                                        </Typography>
                                        {adminStatus && (
                                            <Chip
                                                size="small"
                                                label={adminStatus.toUpperCase()}
                                                color={adminStatusColor}
                                            />
                                        )}
                                    </Stack>
                                    <Typography variant="body2" color="text.secondary">
                                        {data.admin_user.email}
                                        {' '} · {' '}
                                        {data.admin_user.phone_number}
                                    </Typography>

                                    {/* Admin user status toggle — independent of
                                        the verification flow below. The
                                        currently-applied state is hidden so the
                                        operator's only choices are the OTHER
                                        states. */}
                                    <Stack direction="row" spacing={1} mt={1.5} flexWrap="wrap">
                                        {adminStatus !== 'active' && (
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                color="success"
                                                disabled={isUpdatingAdminStatus}
                                                onClick={() => handleAdminStatus('active')}
                                            >
                                                Activate
                                            </Button>
                                        )}
                                        {adminStatus !== 'inactive' && (
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                color="warning"
                                                disabled={isUpdatingAdminStatus}
                                                onClick={() => handleAdminStatus('inactive')}
                                            >
                                                Deactivate
                                            </Button>
                                        )}
                                        {adminStatus !== 'blocked' && (
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                color="error"
                                                disabled={isUpdatingAdminStatus}
                                                onClick={() => handleAdminStatus('blocked')}
                                            >
                                                Block
                                            </Button>
                                        )}
                                    </Stack>
                                </>
                            ) : (
                                <Typography variant="body2" color="text.disabled">
                                    No admin user on record.
                                </Typography>
                            )}
                        </Box>

                        <Divider />

                        <Box>
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                Documents
                            </Typography>
                            <List dense>
                                {Object.entries(data.documents || {}).map(([key, url]) => (
                                    <ListItem key={key} disablePadding>
                                        <ListItemText
                                            primary={
                                                key
                                                    .replace(/_/g, ' ')
                                                    .replace(/\b\w/g, (c) => c.toUpperCase())
                                            }
                                            secondary={url ? 'Available' : 'Not uploaded'}
                                        />
                                        <ListItemSecondaryAction>
                                            <Tooltip title={url ? 'Open in new tab' : 'No file uploaded'}>
                                                <span>
                                                    <IconButton
                                                        edge="end"
                                                        size="small"
                                                        disabled={!url}
                                                        onClick={() => url && window.open(url, '_blank')}
                                                    >
                                                        <OpenInNewIcon fontSize="small" />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                        </ListItemSecondaryAction>
                                    </ListItem>
                                ))}
                                {Object.keys(data.documents || {}).length === 0 && (
                                    <Typography variant="body2" color="text.disabled">
                                        No documents on record.
                                    </Typography>
                                )}
                            </List>
                        </Box>
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={() => onClose(false)}>Close</Button>
                {data && data.verification_status !== 'verified' && (
                    <Button
                        color="success"
                        variant="contained"
                        startIcon={<CheckCircleIcon />}
                        disabled={isVerifying}
                        onClick={() => handleVerify('verified')}
                    >
                        Approve
                    </Button>
                )}
                {data && data.verification_status !== 'rejected' && (
                    <Button
                        color="error"
                        variant="outlined"
                        startIcon={<CancelIcon />}
                        disabled={isVerifying}
                        onClick={() => handleVerify('rejected')}
                    >
                        Reject
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
}


export default function ManageFacilities({ vertical }) {
    // ``vertical`` is 'hospital' or 'clinic' — drives which RTK hooks we
    // use and which labels we render. Defaults to 'hospital' if the
    // route layer forgot to pass it.
    const v = vertical === 'clinic' ? 'clinic' : 'hospital';
    const isHospital = v === 'hospital';

    const [tab, setTab] = useState(1); // default Pending — that's what needs action
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [page, setPage] = useState(1);
    const [openId, setOpenId] = useState(null);

    // Round-9 invite-facility dialog state.
    const [inviteOpen, setInviteOpen] = useState(false);
    const [inviteSnack, setInviteSnack] = useState({ open: false, msg: '', severity: 'success' });

    // Debounce the search box so we're not firing one request per keystroke.
    useMemo(() => {
        const t = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(t);
    }, [search]);

    const queryParams = {
        page,
        per_page: 20,
        ...(TAB_TO_STATUS[tab] ? { verification_status: TAB_TO_STATUS[tab] } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
    };

    const listQuery = isHospital
        ? useGetHospitalsQuery(queryParams)
        : useGetClinicsQuery(queryParams);

    const rows = useMemo(() => {
        if (!listQuery.data) return [];
        return isHospital ? listQuery.data.hospitals : listQuery.data.clinics;
    }, [listQuery.data, isHospital]);

    return (
        <Box sx={{ p: 3 }}>
            <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 1 }}
            >
                <Typography variant="h4" gutterBottom>
                    {isHospital ? 'Manage Hospitals' : 'Manage Clinics'}
                </Typography>
                {/* Add {Hospital|Clinic} — Round-9 invite flow. Plan- and
                    permission-gated on the backend; if the operator's
                    tenant doesn't have the addon, the API responds 403
                    and the existing feature_disabled snackbar
                    (axiosConfig.js) fires automatically. */}
                <Button
                    variant="contained"
                    startIcon={<AddBusinessIcon />}
                    onClick={() => setInviteOpen(true)}
                >
                    {isHospital ? 'Add Hospital' : 'Add Clinic'}
                </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Review {isHospital ? 'hospital' : 'clinic'} registrations and
                approve / reject them after verifying their documents.
            </Typography>

            <InviteUserDialog
                open={inviteOpen}
                onClose={() => setInviteOpen(false)}
                onResult={(severity, msg) => {
                    setInviteSnack({ open: true, msg, severity });
                    // Refresh the facility list once the invite settles
                    // so the new row shows up in the Pending tab.
                    if (severity === 'success') listQuery.refetch();
                }}
                mode={v}
                mutationHook={isHospital
                    ? useAdminInviteHospitalMutation
                    : useAdminInviteClinicMutation}
            />
            <Snackbar
                open={inviteSnack.open}
                autoHideDuration={6000}
                onClose={() => setInviteSnack((s) => ({ ...s, open: false }))}
            >
                <Alert
                    severity={inviteSnack.severity}
                    onClose={() => setInviteSnack((s) => ({ ...s, open: false }))}
                >
                    {inviteSnack.msg}
                </Alert>
            </Snackbar>

            <Card>
                <CardContent>
                    <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={2}
                        alignItems={{ sm: 'center' }}
                        sx={{ mb: 2 }}
                    >
                        <Tabs
                            value={tab}
                            onChange={(_, v) => { setTab(v); setPage(1); }}
                            sx={{ flex: 1 }}
                        >
                            {TAB_LABELS.map((l, i) => (
                                <Tab key={l} label={l} value={i} />
                            ))}
                        </Tabs>
                        <TextField
                            size="small"
                            placeholder="Search by name or reg. number"
                            value={search}
                            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon fontSize="small" />
                                    </InputAdornment>
                                ),
                            }}
                            sx={{ minWidth: 260 }}
                        />
                    </Stack>

                    {listQuery.isLoading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress />
                        </Box>
                    )}
                    {listQuery.isError && (
                        <Alert severity="error">
                            Could not load{' '}
                            {isHospital ? 'hospitals' : 'clinics'}:{' '}
                            {listQuery.error?.data?.message
                                || listQuery.error?.message
                                || 'unknown error'}
                        </Alert>
                    )}
                    {listQuery.isSuccess && rows.length === 0 && (
                        <Alert severity="info">
                            No {isHospital ? 'hospitals' : 'clinics'} match this filter.
                        </Alert>
                    )}

                    <List>
                        {rows.map((row) => (
                            <ListItem
                                key={row.id}
                                divider
                                sx={{
                                    bgcolor: tab === 1
                                        ? 'rgba(255, 167, 38, 0.04)'
                                        : 'transparent',
                                }}
                            >
                                <ListItemText
                                    primary={
                                        <Stack
                                            direction="row"
                                            spacing={1}
                                            alignItems="center"
                                        >
                                            <Typography fontWeight="bold">
                                                {row.name}
                                            </Typography>
                                            <StatusChip status={row.verification_status} />
                                        </Stack>
                                    }
                                    secondary={
                                        <>
                                            <Typography variant="caption" component="span">
                                                Reg. <strong>{row.registration_number || '—'}</strong>
                                            </Typography>
                                            {row.admin_user && (
                                                <>
                                                    {' · '}
                                                    <Typography variant="caption" component="span">
                                                        Admin: {row.admin_user.first_name}{' '}
                                                        {row.admin_user.last_name}{' '}
                                                        ({row.admin_user.email})
                                                    </Typography>
                                                </>
                                            )}
                                            {row.address && (
                                                <>
                                                    {' · '}
                                                    <Typography variant="caption" component="span">
                                                        {row.address}
                                                        {row.city && `, ${row.city}`}
                                                    </Typography>
                                                </>
                                            )}
                                        </>
                                    }
                                />
                                <ListItemSecondaryAction>
                                    <Button
                                        size="small"
                                        startIcon={<VisibilityIcon />}
                                        variant="outlined"
                                        onClick={() => setOpenId(row.id)}
                                    >
                                        View
                                    </Button>
                                </ListItemSecondaryAction>
                            </ListItem>
                        ))}
                    </List>

                    {listQuery.data?.pagination && listQuery.data.pagination.pages > 1 && (
                        <Stack
                            direction="row"
                            spacing={1}
                            justifyContent="center"
                            alignItems="center"
                            sx={{ mt: 2 }}
                        >
                            <Button
                                disabled={page <= 1}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                            >
                                Prev
                            </Button>
                            <Typography variant="caption">
                                Page {listQuery.data.pagination.page}{' '}
                                of {listQuery.data.pagination.pages}{' '}
                                ({listQuery.data.pagination.total} total)
                            </Typography>
                            <Button
                                disabled={page >= (listQuery.data.pagination.pages || 1)}
                                onClick={() => setPage((p) => p + 1)}
                            >
                                Next
                            </Button>
                        </Stack>
                    )}
                </CardContent>
            </Card>

            {openId && (
                <FacilityDetailDialog
                    facilityId={openId}
                    vertical={v}
                    onClose={(didUpdate) => {
                        setOpenId(null);
                        if (didUpdate) listQuery.refetch();
                    }}
                    detailQueryHook={
                        isHospital ? useGetHospitalDetailQuery : useGetClinicDetailQuery
                    }
                    verifyMutationHook={
                        isHospital
                            ? useUpdateHospitalVerificationMutation
                            : useUpdateClinicVerificationMutation
                    }
                    adminStatusMutationHook={
                        isHospital
                            ? useUpdateHospitalAdminStatusMutation
                            : useUpdateClinicAdminStatusMutation
                    }
                />
            )}
        </Box>
    );
}
