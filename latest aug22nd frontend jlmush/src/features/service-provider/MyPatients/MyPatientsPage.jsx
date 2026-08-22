/**
 * MyPatientsPage — doctor's patient roster.
 *
 * Lists every patient the doctor is linked to: those they INVITED plus
 * those they've had a COMPLETED appointment with. Supports search, a
 * source filter (invited / consulted), a consultation-type filter, sort,
 * and pagination. Backend: GET /api/doctor/patients (tenant-scoped; a
 * doctor never sees another doctor's patients).
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress,
    MenuItem, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
    TablePagination, TableRow, TextField, Typography,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';

import InviteUserDialog from '../../admin/components/InviteUserDialog/InviteUserDialog';
import {
    useDoctorInvitePatientMutation,
    useListDoctorInvitedPatientsQuery,
} from '../Affiliation/api/affiliationEndpoints';

const CONSULTATION_TYPES = [
    { value: '', label: 'All types' },
    { value: 'video', label: 'Video' },
    { value: 'audio', label: 'Audio' },
    { value: 'chat', label: 'Chat' },
    { value: 'complete', label: 'Complete' },
    { value: 'home_visit', label: 'Home visit' },
];

function ActivationChip({ patient }) {
    if (!patient.pending_activation) {
        return <Chip label="Active" color="success" size="small" />;
    }
    let label = 'Pending activation';
    if (patient.must_set_password) label = 'Awaiting password';
    else if (!patient.email_verified && !patient.phone_verified) label = 'Awaiting OTPs';
    else if (!patient.email_verified) label = 'Awaiting email OTP';
    else if (!patient.phone_verified) label = 'Awaiting phone OTP';
    return <Chip label={label} color="warning" size="small" />;
}

function SourceChip({ source }) {
    if (source === 'both') return <Chip label="Added · Appointment" color="secondary" size="small" variant="outlined" />;
    if (source === 'invited') return <Chip label="Added" color="primary" size="small" variant="outlined" />;
    return <Chip label="Appointment" color="info" size="small" variant="outlined" />;
}

export default function MyPatientsPage() {
    const [open, setOpen] = useState(false);
    const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });

    // Filters / sort / pagination.
    const [search, setSearch] = useState('');
    const [source, setSource] = useState('all');
    const [consultationType, setConsultationType] = useState('');
    const [sort, setSort] = useState('recent');
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);

    const { data, isLoading, isFetching, error, refetch } =
        useListDoctorInvitedPatientsQuery({
            search: search.trim() || undefined,
            source,
            consultation_type: consultationType || undefined,
            sort,
            page: page + 1,
            per_page: rowsPerPage,
        });

    const patients = data?.patients || [];
    const total = data?.pagination?.total || 0;

    const resetToFirstPage = () => setPage(0);

    const handleInviteResult = (severity, msg) => {
        setSnack({ open: true, msg, severity });
        if (severity === 'success') refetch();
    };

    return (
        <Box sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h5" fontWeight={600}>My Patients</Typography>
                <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setOpen(true)}>
                    Add Patient
                </Button>
            </Box>

            {/* ── Filter / sort bar ── */}
            <Card sx={{ mb: 2 }}>
                <CardContent sx={{ py: 2 }}>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
                        <TextField
                            size="small" label="Search name / email / phone"
                            value={search}
                            onChange={(e) => { setSearch(e.target.value); resetToFirstPage(); }}
                            sx={{ minWidth: 240, flexGrow: 1 }}
                        />
                        <TextField
                            select size="small" label="Source" value={source}
                            onChange={(e) => { setSource(e.target.value); resetToFirstPage(); }}
                            sx={{ minWidth: 150 }}
                        >
                            <MenuItem value="all">All patients</MenuItem>
                            <MenuItem value="consulted">By appointment</MenuItem>
                            <MenuItem value="invited">Added by me</MenuItem>
                        </TextField>
                        <TextField
                            select size="small" label="Consultation type" value={consultationType}
                            onChange={(e) => { setConsultationType(e.target.value); resetToFirstPage(); }}
                            sx={{ minWidth: 160 }}
                        >
                            {CONSULTATION_TYPES.map((c) => (
                                <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            select size="small" label="Sort by" value={sort}
                            onChange={(e) => { setSort(e.target.value); resetToFirstPage(); }}
                            sx={{ minWidth: 150 }}
                        >
                            <MenuItem value="recent">Recent visit</MenuItem>
                            <MenuItem value="name">Name (A–Z)</MenuItem>
                            <MenuItem value="oldest">Oldest added</MenuItem>
                        </TextField>
                    </Stack>
                </CardContent>
            </Card>

            <Card>
                <CardContent>
                    {(isLoading || isFetching) && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress />
                        </Box>
                    )}

                    {error && !isFetching && (
                        <Alert severity="error" sx={{ mb: 2 }}>Couldn't load your patient list.</Alert>
                    )}

                    {!isLoading && !isFetching && !error && patients.length === 0 && (
                        <Alert severity="info">
                            No patients match. Patients appear here once you complete an
                            appointment with them or <strong>Add Patient</strong> to invite one.
                        </Alert>
                    )}

                    {!isFetching && !error && patients.length > 0 && (
                        <>
                            <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Patient</TableCell>
                                        <TableCell>Contact</TableCell>
                                        <TableCell>Source</TableCell>
                                        <TableCell>Last visit</TableCell>
                                        <TableCell>Activation</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {patients.map((p) => (
                                        <TableRow key={p.patient_id} hover>
                                            <TableCell>
                                                <Typography variant="body2" fontWeight={600}>{p.full_name}</Typography>
                                            </TableCell>
                                            <TableCell>
                                                <Stack spacing={0.25}>
                                                    <Typography variant="caption">{p.email || '—'}</Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {p.phone_number || '—'}
                                                    </Typography>
                                                </Stack>
                                            </TableCell>
                                            <TableCell><SourceChip source={p.source} /></TableCell>
                                            <TableCell>
                                                {p.last_appointment_date
                                                    ? new Date(p.last_appointment_date).toLocaleDateString()
                                                    : '—'}
                                            </TableCell>
                                            <TableCell><ActivationChip patient={p} /></TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                            </TableContainer>
                            <TablePagination
                                component="div"
                                count={total}
                                page={page}
                                onPageChange={(_, p) => setPage(p)}
                                rowsPerPage={rowsPerPage}
                                onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                                rowsPerPageOptions={[10, 25, 50, 100]}
                            />
                        </>
                    )}
                </CardContent>
            </Card>

            <InviteUserDialog
                open={open}
                onClose={() => setOpen(false)}
                onResult={handleInviteResult}
                mode="patient"
                mutationHook={useDoctorInvitePatientMutation}
            />
            <Snackbar
                open={snack.open}
                autoHideDuration={6000}
                onClose={() => setSnack((s) => ({ ...s, open: false }))}
            >
                <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))}>
                    {snack.msg}
                </Alert>
            </Snackbar>
        </Box>
    );
}
