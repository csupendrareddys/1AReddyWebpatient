/**
 * ViewAppointments Page — Pure UI composition
 * All logic lives in useViewAppointments hook
 */
import {
    Box,
    Typography,
    Paper,
    Alert,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TablePagination,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Chip,
    CircularProgress,
} from '@mui/material';

import useViewAppointments from '../../hooks/useViewAppointments';
import './ViewAppointments.css';

const ViewAppointments = () => {
    const {
        hasPermission,
        appointments,
        total,
        loading,
        error,
        page,
        setPage,
        rowsPerPage,
        setRowsPerPage,
        statusFilter,
        setStatusFilter,
        getStatusColor,
    } = useViewAppointments();

    if (!hasPermission) {
        return (
            <Alert severity="error">
                Access Denied. You don't have permission to view appointments.
            </Alert>
        );
    }

    return (
        <Box>
            {/* Page Title */}
            <Typography variant="h5" fontWeight={600} sx={{ mb: 3 }}>
                View Appointments
            </Typography>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            {/* Status Filter */}
            <Paper className="admin-page-card" sx={{ mb: 2 }}>
                <FormControl sx={{ minWidth: 200 }}>
                    <InputLabel>Status Filter</InputLabel>
                    <Select
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
                        label="Status Filter"
                    >
                        <MenuItem value="">All</MenuItem>
                        <MenuItem value="pending">Pending</MenuItem>
                        <MenuItem value="scheduled">Scheduled</MenuItem>
                        <MenuItem value="completed">Completed</MenuItem>
                        <MenuItem value="cancelled">Cancelled</MenuItem>
                    </Select>
                </FormControl>
            </Paper>

            {/* Table */}
            <TableContainer component={Paper} className="admin-page-card">
                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                ) : (
                    <>
                        <Table>
                            <TableHead>
                                <TableRow sx={{ bgcolor: 'grey.50' }}>
                                    <TableCell>ID</TableCell>
                                    <TableCell>Patient ID</TableCell>
                                    <TableCell>Doctor ID</TableCell>
                                    <TableCell>Status</TableCell>
                                    <TableCell>Date/Time</TableCell>
                                    <TableCell>Created At</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {appointments.map((appt) => (
                                    <TableRow key={appt.id} hover>
                                        <TableCell>{appt.id.slice(0, 8)}...</TableCell>
                                        <TableCell>{appt.patient_id?.slice(0, 8) || '-'}...</TableCell>
                                        <TableCell>{appt.doctor_id?.slice(0, 8) || '-'}...</TableCell>
                                        <TableCell>
                                            <Chip label={appt.status || 'unknown'} color={getStatusColor(appt.status)} size="small" />
                                        </TableCell>
                                        <TableCell>
                                            {appt.appointment_datetime ? new Date(appt.appointment_datetime).toLocaleString() : '-'}
                                        </TableCell>
                                        <TableCell>
                                            {appt.created_at ? new Date(appt.created_at).toLocaleDateString() : '-'}
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {appointments.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                                            <Typography color="text.secondary">No appointments found</Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                        <TablePagination
                            component="div"
                            count={total}
                            page={page}
                            onPageChange={(e, newPage) => setPage(newPage)}
                            rowsPerPage={rowsPerPage}
                            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                            rowsPerPageOptions={[5, 10, 25]}
                        />
                    </>
                )}
            </TableContainer>
        </Box>
    );
};

export default ViewAppointments;
