/**
 * ViewPatients Page — Pure UI composition
 * All logic lives in useViewPatients hook
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
    TextField,
    InputAdornment,
    Chip,
    CircularProgress,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Snackbar,
    IconButton,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import EditIcon from '@mui/icons-material/Edit';
import PersonAddIcon from '@mui/icons-material/PersonAdd';

import { useState } from 'react';
import useViewPatients from '../../hooks/useViewPatients';
import InviteUserDialog from '../../../components/InviteUserDialog/InviteUserDialog';
import { useAdminInvitePatientMutation } from '../../../../service-provider/Affiliation/api/affiliationEndpoints';
import './ViewPatients.css';

const getStatusColor = (status) => {
    switch (status) {
        case 'active': return 'success';
        case 'blocked': return 'error';
        case 'inactive': return 'warning';
        default: return 'default';
    }
};

const ViewPatients = () => {
    const {
        hasViewPermission,
        hasEditPermission,
        patients,
        total,
        loading,
        error,
        updating,
        page,
        setPage,
        rowsPerPage,
        setRowsPerPage,
        search,
        setSearch,
        handleSearch,
        editDialogOpen,
        setEditDialogOpen,
        selectedPatient,
        newStatus,
        setNewStatus,
        handleEditClick,
        handleStatusUpdate,
        snackbar,
        closeSnackbar,
    } = useViewPatients();

    if (!hasViewPermission) {
        return (
            <Alert severity="error">
                Access Denied. You don't have permission to view patients.
            </Alert>
        );
    }

    const [inviteOpen, setInviteOpen] = useState(false);
    // Local snackbar state for invite success — the hook's snackbar
    // is for status-update flows. Sharing the channel risks ordering
    // issues if the operator triggers both back-to-back.
    const [inviteSnack, setInviteSnack] = useState({ open: false, msg: '', severity: 'success' });

    return (
        <Box>
            {/* Page Title + Add Patient */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h5" fontWeight={600}>
                    View Patients
                </Typography>
                {/* Permission gate: only operators who can edit patient
                    state can invite new ones — mirrors the existing
                    EDIT_PATIENT permission for status updates. */}
                {hasEditPermission && (
                    <Button
                        variant="contained"
                        startIcon={<PersonAddIcon />}
                        onClick={() => setInviteOpen(true)}
                    >
                        Add Patient
                    </Button>
                )}
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <InviteUserDialog
                open={inviteOpen}
                onClose={() => setInviteOpen(false)}
                onResult={(severity, msg) => setInviteSnack({ open: true, msg, severity })}
                mode="patient"
                mutationHook={useAdminInvitePatientMutation}
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

            {/* Search */}
            <Paper className="admin-page-card" sx={{ mb: 2 }}>
                <TextField
                    fullWidth
                    placeholder="Search by name or phone..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyPress={handleSearch}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start"><SearchIcon /></InputAdornment>
                        ),
                    }}
                />
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
                                    <TableCell>Name</TableCell>
                                    <TableCell>Email</TableCell>
                                    <TableCell>Phone</TableCell>
                                    <TableCell>Status</TableCell>
                                    <TableCell>Created At</TableCell>
                                    {hasEditPermission && <TableCell align="center">Actions</TableCell>}
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {patients.map((patient) => (
                                    <TableRow key={patient.id} hover>
                                        <TableCell>{patient.first_name} {patient.last_name}</TableCell>
                                        <TableCell>{patient.email || '-'}</TableCell>
                                        <TableCell>{patient.phone_number || '-'}</TableCell>
                                        <TableCell>
                                            <Chip label={patient.status || 'active'} color={getStatusColor(patient.status)} size="small" />
                                        </TableCell>
                                        <TableCell>{patient.created_at ? new Date(patient.created_at).toLocaleDateString() : '-'}</TableCell>
                                        {hasEditPermission && (
                                            <TableCell align="center">
                                                <IconButton size="small" color="primary" onClick={() => handleEditClick(patient)}>
                                                    <EditIcon />
                                                </IconButton>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))}
                                {patients.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={hasEditPermission ? 6 : 5} align="center" sx={{ py: 4 }}>
                                            <Typography color="text.secondary">No patients found</Typography>
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

            {/* Edit Status Dialog */}
            <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Change Patient Status</DialogTitle>
                <DialogContent>
                    {selectedPatient && (
                        <Box sx={{ pt: 2 }}>
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                Patient: {selectedPatient.first_name} {selectedPatient.last_name}
                            </Typography>
                            <FormControl fullWidth sx={{ mt: 2 }}>
                                <InputLabel>Status</InputLabel>
                                <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} label="Status">
                                    <MenuItem value="active">Active</MenuItem>
                                    <MenuItem value="blocked">Blocked</MenuItem>
                                    <MenuItem value="inactive">Inactive</MenuItem>
                                </Select>
                            </FormControl>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setEditDialogOpen(false)} disabled={updating}>Cancel</Button>
                    <Button onClick={handleStatusUpdate} variant="contained" disabled={updating}>
                        {updating ? <CircularProgress size={20} /> : 'Update'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Snackbar */}
            <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={closeSnackbar} message={snackbar.message} />
        </Box>
    );
};

export default ViewPatients;
