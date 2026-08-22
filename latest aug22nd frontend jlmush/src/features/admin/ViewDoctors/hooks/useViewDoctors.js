/**
 * useViewDoctors — Custom hook for ViewDoctors page
 * Uses RTK Query for all data fetching and mutations
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    useGetDoctorsQuery,
    useUpdateDoctorStatusMutation,
    useUpdateDoctorVerificationMutation,
    useLazyGetDoctorDocumentsQuery,
} from '../../api/doctorsEndpoints';
import usePermissions from '../../../../common/hooks/usePermissions';

const useViewDoctors = ({ facilityFilter } = {}) => {
    const navigate = useNavigate();

    // Use the real RBAC permissions hook
    const { hasFullAccess, can } = usePermissions();
    const hasViewPermission = hasFullAccess || can('doctor_list', 'view');
    const hasEditStatusPermission = hasFullAccess || can('doctor_list', 'edit');
    const hasVerifyPermission = hasFullAccess || can('doctor_verification', 'view');

    // Pagination & filters
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [search, setSearch] = useState('');
    const [verificationFilter, setVerificationFilter] = useState('');

    // RTK Query
    const {
        data: doctorsData,
        isLoading: loading,
        error: queryError,
    } = useGetDoctorsQuery(
        {
            // Load the whole (server-filtered) set in one shot so per-column
            // sort / filter and pagination can operate over ALL doctors, not
            // just one server page. `page` / `rowsPerPage` below drive
            // client-side pagination in the component.
            page: 1,
            per_page: 1000,
            search: search || undefined,
            approval_status: verificationFilter || undefined,
            // When embedded in "View Vendor" and drilled from a facility,
            // restrict the list to that facility's My-Link doctors.
            hospital_id: facilityFilter?.kind === 'hospital' ? facilityFilter.id : undefined,
            clinic_id: facilityFilter?.kind === 'clinic' ? facilityFilter.id : undefined,
        },
        { skip: !hasViewPermission }
    );

    const [updateDoctorStatus, { isLoading: updatingStatus }] = useUpdateDoctorStatusMutation();
    const [updateDoctorVerification, { isLoading: updatingVerification }] = useUpdateDoctorVerificationMutation();
    const [triggerGetDocuments, { data: documents, isLoading: loadingDocuments }] = useLazyGetDoctorDocumentsQuery();

    const doctors = doctorsData?.doctors || [];
    const total = doctorsData?.pagination?.total || 0;
    const error = queryError?.data?.message || queryError?.data?.error || null;
    const updating = updatingStatus || updatingVerification;

    // Dialog states
    const [statusDialogOpen, setStatusDialogOpen] = useState(false);
    const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
    const [documentsDialogOpen, setDocumentsDialogOpen] = useState(false);
    const [selectedDoctor, setSelectedDoctor] = useState(null);
    const [newStatus, setNewStatus] = useState('');
    const [newVerificationStatus, setNewVerificationStatus] = useState('');
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    // Search handler
    const handleSearch = useCallback((e) => {
        if (e.key === 'Enter') {
            setPage(0);
        }
    }, []);

    // Status handlers
    const handleStatusEditClick = (doctor) => {
        setSelectedDoctor(doctor);
        setNewStatus(doctor.status || 'active');
        setStatusDialogOpen(true);
    };

    const handleStatusUpdate = async () => {
        if (!selectedDoctor) return;
        try {
            await updateDoctorStatus({ doctorId: selectedDoctor.id, status: newStatus }).unwrap();
            setSnackbar({ open: true, message: 'Doctor status updated successfully', severity: 'success' });
            setStatusDialogOpen(false);
        } catch (err) {
            setSnackbar({
                open: true,
                message: err.data?.error || 'Failed to update status',
                severity: 'error',
            });
        }
    };

    // Verification handlers
    const handleVerifyClick = (doctor) => {
        setSelectedDoctor(doctor);
        setNewVerificationStatus(doctor.verification_status || 'pending');
        setVerifyDialogOpen(true);
    };

    const handleVerificationUpdate = async () => {
        if (!selectedDoctor) return;
        try {
            await updateDoctorVerification({
                doctorId: selectedDoctor.id,
                verificationStatus: newVerificationStatus,
            }).unwrap();
            setSnackbar({ open: true, message: 'Verification status updated successfully', severity: 'success' });
            setVerifyDialogOpen(false);
        } catch (err) {
            setSnackbar({
                open: true,
                message: err.data?.error || 'Failed to update verification status',
                severity: 'error',
            });
        }
    };

    // Documents handlers
    const handleViewDocuments = async (doctor) => {
        setSelectedDoctor(doctor);
        setDocumentsDialogOpen(true);
        try {
            await triggerGetDocuments(doctor.id).unwrap();
        } catch (err) {
            setSnackbar({
                open: true,
                message: err.data?.error || 'Failed to fetch documents',
                severity: 'error',
            });
            setDocumentsDialogOpen(false);
        }
    };

    const handleGoBack = () => navigate('/dashboard/admin');
    const closeSnackbar = () => setSnackbar((prev) => ({ ...prev, open: false }));

    return {
        // Permissions
        hasViewPermission,
        hasEditStatusPermission,
        hasVerifyPermission,
        // Data
        doctors,
        total,
        documents,
        // Loading / Error
        loading,
        error,
        updating,
        loadingDocuments,
        // Pagination & Filters
        page,
        setPage,
        rowsPerPage,
        setRowsPerPage,
        search,
        setSearch,
        verificationFilter,
        setVerificationFilter,
        handleSearch,
        // Status dialog
        statusDialogOpen,
        setStatusDialogOpen,
        selectedDoctor,
        newStatus,
        setNewStatus,
        handleStatusEditClick,
        handleStatusUpdate,
        // Verification dialog
        verifyDialogOpen,
        setVerifyDialogOpen,
        newVerificationStatus,
        setNewVerificationStatus,
        handleVerifyClick,
        handleVerificationUpdate,
        // Documents dialog
        documentsDialogOpen,
        setDocumentsDialogOpen,
        handleViewDocuments,
        // Snackbar
        snackbar,
        closeSnackbar,
        // Navigation
        handleGoBack,
    };
};

export default useViewDoctors;
