/**
 * useViewPatients — Custom hook for ViewPatients page
 * Uses RTK Query for data fetching and mutations
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    useGetPatientsQuery,
    useUpdatePatientStatusMutation,
} from '../../api/patientsEndpoints';
import usePermissions from '../../../../common/hooks/usePermissions';

const useViewPatients = () => {
    const navigate = useNavigate();

    // Use the real RBAC permissions hook
    const { hasFullAccess, can } = usePermissions();
    const hasViewPermission = hasFullAccess || can('patient_list', 'view');
    const hasEditPermission = hasFullAccess || can('patient_list', 'edit');

    // Pagination & search
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [search, setSearch] = useState('');

    // RTK Query
    const {
        data: patientsData,
        isLoading: loading,
        error: queryError,
    } = useGetPatientsQuery(
        {
            page: page + 1,
            per_page: rowsPerPage,
            search: search || undefined,
        },
        { skip: !hasViewPermission }
    );

    const [updatePatientStatus, { isLoading: updating }] = useUpdatePatientStatusMutation();

    const patients = patientsData?.patients || [];
    const total = patientsData?.pagination?.total || 0;
    const error = queryError?.data?.message || queryError?.data?.error || null;

    // Dialog states
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [selectedPatient, setSelectedPatient] = useState(null);
    const [newStatus, setNewStatus] = useState('');
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    // Search handler
    const handleSearch = useCallback((e) => {
        if (e.key === 'Enter') {
            setPage(0);
        }
    }, []);

    // Status edit handlers
    const handleEditClick = (patient) => {
        setSelectedPatient(patient);
        setNewStatus(patient.status || 'active');
        setEditDialogOpen(true);
    };

    const handleStatusUpdate = async () => {
        if (!selectedPatient) return;
        try {
            await updatePatientStatus({ patientId: selectedPatient.id, status: newStatus }).unwrap();
            setSnackbar({ open: true, message: 'Patient status updated successfully', severity: 'success' });
            setEditDialogOpen(false);
        } catch (err) {
            setSnackbar({
                open: true,
                message: err.data?.error || 'Failed to update status',
                severity: 'error',
            });
        }
    };

    const handleGoBack = () => navigate('/dashboard/admin');
    const closeSnackbar = () => setSnackbar((prev) => ({ ...prev, open: false }));

    return {
        // Permissions
        hasViewPermission,
        hasEditPermission,
        // Data
        patients,
        total,
        // Loading / Error
        loading,
        error,
        updating,
        // Pagination & Search
        page,
        setPage,
        rowsPerPage,
        setRowsPerPage,
        search,
        setSearch,
        handleSearch,
        // Dialog
        editDialogOpen,
        setEditDialogOpen,
        selectedPatient,
        newStatus,
        setNewStatus,
        handleEditClick,
        handleStatusUpdate,
        // Snackbar
        snackbar,
        closeSnackbar,
        // Navigation
        handleGoBack,
    };
};

export default useViewPatients;
