/**
 * MemberList — pick a member (patient | doctor | admin) to operate on.
 * Route: /dashboard/admin/operations/:memberType/:opType
 * Generic over memberType; row → detail (edit or, for patients, book).
 */
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box, Typography, Paper, Breadcrumbs, Link, TextField, Table, TableContainer, TableHead,
    TableBody, TableRow, TableCell, TablePagination, Chip, CircularProgress,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';

import BackButton from '../../../../../common/components/BackButton/BackButton';
import { useGetOpsMembersQuery } from '../../api/operationsEndpoints';

const MEMBER_LABEL = {
    patient: 'Patient', doctor: 'Doctor', admin: 'Admin',
    clinic: 'Clinic', hospital: 'Hospital',
};
// Facilities have no second name line — the list carries the facility's own
// name in ``first_name`` and leaves ``last_name`` empty, so the search box
// should say what it actually matches.
const SEARCH_HINT = {
    clinic: 'Search clinic name / owner / phone',
    hospital: 'Search hospital name / owner / phone',
};
const OP_LABEL = {
    profile: 'Profile', booking: 'Booking', appointments: 'Appointments',
    manage: 'Manage Appointments / Services', records: 'Prescriptions / Documents',
    chats: 'Service Chats',
};

// Where a row lands, for op-types that mean a tab other than Profile. Without
// this, picking "Patient Booking" or "Doctor Appointments" from the hub still
// opened the Profile tab and left the operator to find the right one — the
// button named the destination but didn't go there.
const OP_LANDING = {
    booking: 'bookings/book-by-type', appointments: 'appointments',
    manage: 'manage', records: 'records', chats: 'service-chats',
};

export default function PatientMemberList() {
    const { memberType, opType } = useParams();
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);

    const { data, isFetching } = useGetOpsMembersQuery({
        memberType,
        search: search.trim() || undefined,
        page: page + 1,
        per_page: rowsPerPage,
    });
    const members = data?.members || [];
    const total = data?.pagination?.total || 0;
    const noun = MEMBER_LABEL[memberType] || 'Member';
    const label = `${noun} ${OP_LABEL[opType] || 'Operations'}`;

    // The name rides along in router state. Facilities have no ``/profile``
    // summary endpoint for the detail screen to fetch a name from — everything
    // about them is on their EntityProfile — so without this the breadcrumb
    // there can only say "Clinic", which is useless when the tenant has
    // several. A direct link still falls back to the type label.
    const open = (id, memberName) => navigate(
        `/dashboard/admin/operations/${memberType}/${opType}/${id}`
        + (OP_LANDING[opType] ? `/${OP_LANDING[opType]}` : ''),
        { state: { memberName } },
    );

    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <BackButton to="/dashboard/admin/operations" />
                <Typography variant="h5" fontWeight={600}>Operations</Typography>
            </Box>
            <Paper sx={{ mb: 3, py: 1.5, px: 2 }}>
                <Breadcrumbs>
                    <Link component="button" underline="hover" color="inherit"
                        onClick={() => navigate('/dashboard/admin/operations')}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <HomeIcon fontSize="small" /> Dashboard
                    </Link>
                    <Link component="button" underline="hover" color="inherit"
                        onClick={() => navigate('/dashboard/admin/operations')}>
                        Operations
                    </Link>
                    <Typography color="primary" fontWeight="bold">{label}</Typography>
                </Breadcrumbs>
            </Paper>

            <Paper sx={{ p: 2, mb: 2 }}>
                <TextField
                    size="small" fullWidth
                    label={SEARCH_HINT[memberType] || `Search ${noun.toLowerCase()} name / phone`}
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                />
            </Paper>

            <Paper>
                {isFetching ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress />
                    </Box>
                ) : (
                    <>
                        <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>{noun}</TableCell>
                                    <TableCell>Contact</TableCell>
                                    {memberType === 'admin' && <TableCell>Role</TableCell>}
                                    <TableCell>Status</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {members.map((m) => (
                                    <TableRow key={m.id} hover sx={{ cursor: 'pointer' }} onClick={() => open(
                                        m.id,
                                        `${m.first_name || ''} ${m.last_name || ''}`.trim() || null,
                                    )}>
                                        <TableCell>
                                            <Typography variant="body2" fontWeight={600}>
                                                {`${m.first_name || ''} ${m.last_name || ''}`.trim() || '(no name)'}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="caption" display="block">{m.email || '—'}</Typography>
                                            <Typography variant="caption" color="text.secondary">{m.phone_number || '—'}</Typography>
                                        </TableCell>
                                        {memberType === 'admin' && (
                                            <TableCell>
                                                <Chip size="small" variant="outlined"
                                                    label={(m.role || '').replace(/_/g, ' ') || '—'} />
                                            </TableCell>
                                        )}
                                        <TableCell>
                                            <Chip size="small"
                                                label={m.status || 'unknown'}
                                                color={m.status === 'active' ? 'success' : 'default'} />
                                            {/* A facility's verification state is the
                                                first thing support asks about it, and
                                                only facilities carry one. */}
                                            {m.verification_status && (
                                                <Chip size="small" variant="outlined" sx={{ ml: 0.5 }}
                                                    label={m.verification_status}
                                                    color={m.verification_status === 'verified'
                                                        ? 'success'
                                                        : m.verification_status === 'rejected'
                                                            ? 'error' : 'warning'} />
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {!members.length && (
                                    <TableRow>
                                        <TableCell colSpan={memberType === 'admin' ? 4 : 3} align="center"
                                            sx={{ py: 5, color: 'text.secondary' }}>
                                            No {noun.toLowerCase()}s found.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                        </TableContainer>
                        <TablePagination
                            component="div" count={total} page={page}
                            onPageChange={(_, p) => setPage(p)}
                            rowsPerPage={rowsPerPage}
                            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                            rowsPerPageOptions={[10, 25, 50]}
                        />
                    </>
                )}
            </Paper>
        </Box>
    );
}
