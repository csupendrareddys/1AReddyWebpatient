/**
 * ViewVendor — unified admin surface for the three provider "vendor"
 * types: Doctors, Hospitals and Clinics.
 *
 * Replaces the three separate sidebar entries (View Doctors / View
 * Hospitals / View Clinics) with a single page carrying a three-way
 * selector:
 *
 *   * Doctors  → embeds the existing ``ViewDoctors`` page. When drilled
 *                from a facility it is filtered to that facility's linked
 *                doctors (all at once).
 *   * Hospitals→ facility table where each row shows inline "My Link"
 *                analytics (linked doctor count + Partner/Associate/
 *                Employee breakdown) and expands to the linked-doctor
 *                roster.
 *   * Clinics  → the same, clinic vertical.
 *
 * The doctor<->facility linkage is the "My Link" care-network
 * (``care_network_connections`` with connection_type=hospital/clinic,
 * context='link', relationship_type = Partner/Associate/Employee). The
 * list endpoint carries per-facility ``analytics`` (by relationship); the
 * roster is fetched lazily on row expand; and drilling a facility filters
 * the Doctors tab via ``?hospital_id=`` / ``?clinic_id=``.
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress,
    Collapse, IconButton, InputAdornment, Paper, Stack, Table, TableBody,
    TableCell, TableContainer, TableHead, TableRow, TextField, ToggleButton,
    ToggleButtonGroup, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import VisibilityIcon from '@mui/icons-material/Visibility';
import GroupsIcon from '@mui/icons-material/Groups';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import BusinessIcon from '@mui/icons-material/Business';
import MedicalServicesIcon from '@mui/icons-material/MedicalServices';

import {
    useGetHospitalsQuery,
    useGetHospitalDetailQuery,
    useGetHospitalDoctorsQuery,
    useUpdateHospitalVerificationMutation,
    useUpdateHospitalAdminStatusMutation,
    useGetClinicsQuery,
    useGetClinicDetailQuery,
    useGetClinicDoctorsQuery,
    useUpdateClinicVerificationMutation,
    useUpdateClinicAdminStatusMutation,
} from '../../../api/facilitiesEndpoints';
import { FacilityDetailDialog } from '../../../ManageFacilities/ManageFacilities';

// The doctor surface is a large page; lazy-load it so switching to the
// Doctors tab is what pulls its chunk, not the initial vendor bundle.
const ViewDoctors = lazy(
    () => import('../../../ViewDoctors/pages/ViewDoctors/ViewDoctors'),
);


const FACILITY_STATUS_COLOR = {
    pending: 'warning',
    verified: 'success',
    rejected: 'error',
};

// "My Link" relationship → chip colour (values stored title-case).
const RELATIONSHIP_COLOR = {
    Partner: 'primary',
    Associate: 'info',
    Employee: 'secondary',
};


function StatusChip({ status, colorMap }) {
    return (
        <Chip
            size="small"
            label={(status || 'pending').toUpperCase()}
            color={colorMap[status] || 'default'}
        />
    );
}


/** One analytics tile. */
function StatTile({ label, value, color }) {
    return (
        <Paper
            variant="outlined"
            sx={{
                px: 2, py: 1.5, flex: 1, minWidth: 110,
                textAlign: 'center', borderRadius: 2,
            }}
        >
            <Typography variant="h5" sx={{ fontWeight: 700, color: color || 'text.primary' }}>
                {value}
            </Typography>
            <Typography variant="caption" color="text.secondary">
                {label}
            </Typography>
        </Paper>
    );
}


/** Compact inline analytics for a facility row — relationship breakdown. */
function InlineAnalytics({ analytics }) {
    const total = analytics?.total || 0;
    if (!total) {
        return (
            <Typography variant="caption" color="text.disabled">
                No linked doctors
            </Typography>
        );
    }
    const byRel = analytics.by_relationship || {};
    return (
        <Stack spacing={0.5}>
            <Typography variant="body2" fontWeight={600}>
                {total} linked doctor{total === 1 ? '' : 's'}
            </Typography>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                {Object.entries(byRel).map(([rel, n]) => (
                    <Chip
                        key={rel}
                        size="small"
                        variant="outlined"
                        color={RELATIONSHIP_COLOR[rel] || 'default'}
                        label={`${n} ${rel}`}
                    />
                ))}
            </Stack>
        </Stack>
    );
}


/** Lazy roster panel shown when a facility row is expanded. */
function RosterPanel({ facility, vertical, onViewAll }) {
    const isHospital = vertical === 'hospital';
    const hosp = useGetHospitalDoctorsQuery(facility.id, { skip: !isHospital });
    const clin = useGetClinicDoctorsQuery(facility.id, { skip: isHospital });
    const q = isHospital ? hosp : clin;

    const doctors = q.data?.doctors || [];
    const counts = q.data?.counts || { total: 0, by_relationship: {} };
    const byRel = counts.by_relationship || {};

    return (
        <Box sx={{ py: 2, px: 1 }}>
            {q.isLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                    <CircularProgress size={28} />
                </Box>
            )}
            {q.isError && (
                <Alert severity="error">
                    Could not load linked doctors:{' '}
                    {q.error?.data?.message || q.error?.message || 'unknown error'}
                </Alert>
            )}
            {q.isSuccess && doctors.length === 0 && (
                <Alert severity="info">
                    No doctors have linked to this {vertical} yet.
                </Alert>
            )}

            {doctors.length > 0 && (
                <>
                    <Stack
                        direction="row"
                        spacing={1.5}
                        alignItems="center"
                        sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}
                    >
                        <StatTile label="Linked doctors" value={counts.total} color="primary.main" />
                        {Object.entries(byRel).map(([rel, n]) => (
                            <StatTile key={rel} label={rel} value={n} />
                        ))}
                        <Box sx={{ flexGrow: 1 }} />
                        <Button
                            variant="contained"
                            size="small"
                            startIcon={<GroupsIcon />}
                            onClick={() => onViewAll(facility)}
                        >
                            View all in Doctors tab
                        </Button>
                    </Stack>

                    <TableContainer sx={{ overflowX: 'auto' }}>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Doctor</TableCell>
                                    <TableCell>Relationship</TableCell>
                                    <TableCell>Status</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {doctors.map((d) => (
                                    <TableRow key={d.connection_id} hover>
                                        <TableCell>{d.doctor_name || '—'}</TableCell>
                                        <TableCell>
                                            <Chip
                                                size="small"
                                                variant="outlined"
                                                color={RELATIONSHIP_COLOR[d.relationship_type] || 'default'}
                                                label={d.relationship_type || '—'}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Chip size="small" color="success" label={(d.status || 'active').toUpperCase()} />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </>
            )}
        </Box>
    );
}


/** One facility row + its expandable roster panel. */
function FacilityRow({ row, vertical, onDetails, onViewAll }) {
    const [open, setOpen] = useState(false);
    const linked = row.doctor_count || 0;
    return (
        <>
            <TableRow hover sx={{ '& > *': { borderBottom: 'unset' } }}>
                <TableCell padding="checkbox">
                    <IconButton size="small" onClick={() => setOpen((o) => !o)}>
                        {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                    </IconButton>
                </TableCell>
                <TableCell>
                    <Typography variant="body2" fontWeight={600}>{row.name}</Typography>
                    {row.hospital_type && (
                        <Typography variant="caption" color="text.secondary">
                            {row.hospital_type}
                        </Typography>
                    )}
                </TableCell>
                <TableCell>{row.registration_number || '—'}</TableCell>
                <TableCell>
                    {[row.city, row.state].filter(Boolean).join(', ') || '—'}
                </TableCell>
                <TableCell>
                    {row.admin_user ? (
                        <>
                            <Typography variant="body2">
                                {row.admin_user.first_name} {row.admin_user.last_name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {row.admin_user.email}
                            </Typography>
                        </>
                    ) : '—'}
                </TableCell>
                <TableCell sx={{ minWidth: 190 }}>
                    <InlineAnalytics analytics={row.analytics} />
                </TableCell>
                <TableCell>
                    <StatusChip status={row.verification_status} colorMap={FACILITY_STATUS_COLOR} />
                </TableCell>
                <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<VisibilityIcon />}
                            onClick={() => onDetails(row.id)}
                        >
                            Details
                        </Button>
                        <Button
                            size="small"
                            variant="contained"
                            startIcon={<GroupsIcon />}
                            disabled={!linked}
                            onClick={() => onViewAll(row)}
                        >
                            Doctors ({linked})
                        </Button>
                    </Stack>
                </TableCell>
            </TableRow>
            <TableRow>
                <TableCell sx={{ py: 0 }} colSpan={8}>
                    <Collapse in={open} timeout="auto" unmountOnExit>
                        {open && (
                            <RosterPanel
                                facility={row}
                                vertical={vertical}
                                onViewAll={onViewAll}
                            />
                        )}
                    </Collapse>
                </TableCell>
            </TableRow>
        </>
    );
}


/**
 * Facility table for a single vertical (hospital | clinic). Both RTK
 * list hooks are called unconditionally (one skipped) so the rules of
 * hooks hold when the parent toggles between verticals.
 */
function VendorFacilityTable({ vertical, onViewAll }) {
    const isHospital = vertical === 'hospital';
    const [search, setSearch] = useState('');
    const [debounced, setDebounced] = useState('');
    const [openId, setOpenId] = useState(null);   // facility detail dialog

    useMemo(() => {
        const t = setTimeout(() => setDebounced(search), 300);
        return () => clearTimeout(t);
    }, [search]);

    // per_page 100 so the analytics tiles reflect the whole (small)
    // facility set for this first draft rather than a single page.
    const params = { page: 1, per_page: 100, ...(debounced ? { search: debounced } : {}) };
    const hosp = useGetHospitalsQuery(params, { skip: !isHospital });
    const clin = useGetClinicsQuery(params, { skip: isHospital });
    const q = isHospital ? hosp : clin;

    const rows = useMemo(() => {
        if (!q.data) return [];
        return (isHospital ? q.data.hospitals : q.data.clinics) || [];
    }, [q.data, isHospital]);

    const stats = useMemo(() => {
        const s = { total: 0, verified: 0, pending: 0, rejected: 0, doctors: 0 };
        rows.forEach((r) => {
            s.total += 1;
            const k = r.verification_status || 'pending';
            if (k in s) s[k] += 1;
            s.doctors += r.doctor_count || 0;
        });
        return s;
    }, [rows]);

    const totalAll = q.data?.pagination?.total ?? stats.total;
    const label = isHospital ? 'hospital' : 'clinic';

    return (
        <Box>
            {/* Vertical-level analytics summary */}
            <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
                <StatTile label={`Total ${label}s`} value={totalAll} />
                <StatTile label="Verified" value={stats.verified} color="success.main" />
                <StatTile label="Pending" value={stats.pending} color="warning.main" />
                <StatTile label="Rejected" value={stats.rejected} color="error.main" />
                <StatTile label="Linked doctors" value={stats.doctors} color="primary.main" />
            </Stack>
            {totalAll > rows.length && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    Analytics reflect the first {rows.length} of {totalAll} {label}s
                    loaded. Pagination will be added once verified.
                </Alert>
            )}

            <Card>
                <CardContent>
                    <TextField
                        size="small"
                        placeholder="Search by name or registration number"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon fontSize="small" />
                                </InputAdornment>
                            ),
                        }}
                        sx={{ minWidth: 300, mb: 2 }}
                    />

                    {q.isLoading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress />
                        </Box>
                    )}
                    {q.isError && (
                        <Alert severity="error">
                            Could not load {label}s:{' '}
                            {q.error?.data?.message || q.error?.message || 'unknown error'}
                        </Alert>
                    )}
                    {q.isSuccess && rows.length === 0 && (
                        <Alert severity="info">No {label}s found.</Alert>
                    )}

                    {rows.length > 0 && (
                        <TableContainer sx={{ overflowX: 'auto' }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell padding="checkbox" />
                                        <TableCell>Name</TableCell>
                                        <TableCell>Registration</TableCell>
                                        <TableCell>Location</TableCell>
                                        <TableCell>Admin User</TableCell>
                                        <TableCell>Linked Doctors / Analytics</TableCell>
                                        <TableCell>Status</TableCell>
                                        <TableCell align="right">Actions</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {rows.map((row) => (
                                        <FacilityRow
                                            key={`${vertical}-${row.id}`}
                                            row={row}
                                            vertical={vertical}
                                            onDetails={setOpenId}
                                            onViewAll={onViewAll}
                                        />
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </CardContent>
            </Card>

            {openId && (
                <FacilityDetailDialog
                    facilityId={openId}
                    vertical={vertical}
                    onClose={(didUpdate) => {
                        setOpenId(null);
                        if (didUpdate) q.refetch();
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


const VENDOR_OPTIONS = [
    { value: 'doctor', label: 'Doctors', icon: <LocalHospitalIcon fontSize="small" /> },
    { value: 'hospital', label: 'Hospitals', icon: <BusinessIcon fontSize="small" /> },
    { value: 'clinic', label: 'Clinics', icon: <MedicalServicesIcon fontSize="small" /> },
];


export default function ViewVendor() {
    const [vendorType, setVendorType] = useState('doctor');
    // { kind: 'hospital'|'clinic', id, name } when the Doctors tab is
    // filtered to a facility's linked doctors; null = all doctors.
    const [facilityFilter, setFacilityFilter] = useState(null);

    const handleType = (_e, next) => {
        if (!next) return;
        setVendorType(next);
        if (next !== 'doctor') setFacilityFilter(null);
    };

    // Drill a facility's linked doctors into the Doctors tab — all at once.
    const handleViewAll = (facility) => {
        setFacilityFilter({ kind: vendorType, id: facility.id, name: facility.name });
        setVendorType('doctor');
    };

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h4" gutterBottom>View Vendor</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Doctors, hospitals and clinics in one place. Select a vendor type
                to browse.
            </Typography>

            <ToggleButtonGroup
                value={vendorType}
                exclusive
                onChange={handleType}
                size="small"
                sx={{ mb: 3 }}
            >
                {VENDOR_OPTIONS.map((o) => (
                    <ToggleButton key={o.value} value={o.value} sx={{ px: 2.5, gap: 1 }}>
                        {o.icon}
                        {o.label}
                    </ToggleButton>
                ))}
            </ToggleButtonGroup>

            {vendorType === 'doctor' && (
                <>
                    {facilityFilter && (
                        <Alert
                            severity="info"
                            sx={{ mb: 2 }}
                            action={
                                <Button
                                    color="inherit"
                                    size="small"
                                    onClick={() => setFacilityFilter(null)}
                                >
                                    View all doctors
                                </Button>
                            }
                        >
                            Showing doctors linked to{' '}
                            <strong>{facilityFilter.name}</strong> ({facilityFilter.kind}).
                        </Alert>
                    )}
                    <Suspense
                        fallback={
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                                <CircularProgress />
                            </Box>
                        }
                    >
                        <ViewDoctors facilityFilter={facilityFilter} />
                    </Suspense>
                </>
            )}

            {(vendorType === 'hospital' || vendorType === 'clinic') && (
                <VendorFacilityTable
                    vertical={vendorType}
                    onViewAll={handleViewAll}
                />
            )}
        </Box>
    );
}
