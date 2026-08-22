/**
 * useAuditLogs — Hook for AuditLogViewer page
 * Encapsulates all state and API calls
 */
import { useState, useCallback } from 'react';
import { useGetAuditLogsQuery } from '../../api/rbacEndpoints';
import usePermissions from '../../../../common/hooks/usePermissions';

const useAuditLogs = () => {
    const { hasFullAccess } = usePermissions();

    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);
    const [filters, setFilters] = useState({
        admin_id: '',
        module: '',
        action_type: '',
    });

    const { data, isLoading, error } = useGetAuditLogsQuery({
        page: page + 1,
        per_page: rowsPerPage,
        ...Object.fromEntries(
            Object.entries(filters).filter(([, v]) => v)
        ),
    });

    const auditLogs = data?.auditLogs || [];
    const pagination = data?.pagination || { total: 0 };

    const handleChangePage = useCallback((_, newPage) => setPage(newPage), []);
    const handleChangeRowsPerPage = useCallback((e) => {
        setRowsPerPage(parseInt(e.target.value, 10));
        setPage(0);
    }, []);

    const handleFilterChange = useCallback((key, value) => {
        setFilters((prev) => ({ ...prev, [key]: value }));
        setPage(0);
    }, []);

    const handleClearFilters = useCallback(() => {
        setFilters({ admin_id: '', module: '', action_type: '' });
        setPage(0);
    }, []);

    return {
        hasFullAccess,
        auditLogs,
        pagination,
        isLoading,
        error: error?.data?.error || null,
        page,
        rowsPerPage,
        filters,
        handleChangePage,
        handleChangeRowsPerPage,
        handleFilterChange,
        handleClearFilters,
    };
};

export default useAuditLogs;
