/**
 * useViewAppointments — Custom hook for ViewAppointments page
 * Uses RTK Query for data fetching
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGetAppointmentsQuery } from '../../api/appointmentsEndpoints';
import usePermissions from '../../../../common/hooks/usePermissions';

const useViewAppointments = () => {
    const navigate = useNavigate();

    // Use the real RBAC permissions hook
    const { hasFullAccess, can } = usePermissions();
    const hasPermission = hasFullAccess || can('appointment_list', 'view');

    // Pagination & filter
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [statusFilter, setStatusFilter] = useState('');

    // RTK Query
    const {
        data: appointmentsData,
        isLoading: loading,
        error: queryError,
    } = useGetAppointmentsQuery(
        {
            page: page + 1,
            per_page: rowsPerPage,
            status: statusFilter || undefined,
        },
        { skip: !hasPermission }
    );

    const appointments = appointmentsData?.appointments || [];
    const total = appointmentsData?.pagination?.total || 0;
    const error = queryError?.data?.message || queryError?.data?.error || null;

    const getStatusColor = (status) => {
        switch (status) {
            case 'scheduled': return 'primary';
            case 'completed': return 'success';
            case 'cancelled': return 'error';
            case 'pending': return 'warning';
            default: return 'default';
        }
    };

    const handleGoBack = () => navigate('/dashboard/admin');

    return {
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
        handleGoBack,
    };
};

export default useViewAppointments;
