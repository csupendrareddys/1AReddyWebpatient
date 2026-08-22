/**
 * useApprovals — Hook for Approval Queue and Detail pages
 * Encapsulates all state, API calls, and handlers
 */
import { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    useGetApprovalsQuery,
    useGetApprovalQuery,
    useApproveRequestMutation,
    useRejectRequestMutation,
    useCancelRequestMutation,
    useQueryRequestMutation,
    useRespondToQueryMutation,
    useEscalateRequestMutation,
} from '../../api/rbacEndpoints';
import usePermissions from '../../../../common/hooks/usePermissions';

const useApprovals = () => {
    const navigate = useNavigate();
    const { requestId } = useParams();
    const { hasFullAccess, can } = usePermissions();

    // List state
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [statusFilter, setStatusFilter] = useState('');

    // Action dialog state
    const [actionDialog, setActionDialog] = useState({ open: false, type: '', requestId: '' });
    const [actionComments, setActionComments] = useState('');

    // Snackbar
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    // RTK Query: List
    const { data: approvalsData, isLoading: listLoading, error: listError } = useGetApprovalsQuery({
        page: page + 1,
        per_page: rowsPerPage,
        status: statusFilter || 'all',
    });

    // RTK Query: Detail
    const { data: approvalDetail, isLoading: detailLoading } = useGetApprovalQuery(requestId, {
        skip: !requestId,
    });

    // Mutations
    const [approveRequest, { isLoading: approving }] = useApproveRequestMutation();
    const [rejectRequest, { isLoading: rejecting }] = useRejectRequestMutation();
    const [cancelRequest, { isLoading: cancelling }] = useCancelRequestMutation();
    const [queryRequest, { isLoading: querying }] = useQueryRequestMutation();
    const [respondToQuery, { isLoading: responding }] = useRespondToQueryMutation();
    const [escalateRequest, { isLoading: escalating }] = useEscalateRequestMutation();

    const approvals = approvalsData?.approvals || [];
    const pagination = approvalsData?.pagination || { total: 0 };

    // ── Handlers ─────────────────────────────────────────────

    const showSnackbar = useCallback((message, severity = 'success') => {
        setSnackbar({ open: true, message, severity });
    }, []);
    const handleCloseSnackbar = useCallback(() => {
        setSnackbar((prev) => ({ ...prev, open: false }));
    }, []);

    const handleViewDetail = useCallback((approval) => {
        navigate(`/dashboard/admin/approvals/request/${approval.id}`);
    }, [navigate]);

    const handleBackToQueue = useCallback(() => {
        navigate('/dashboard/admin/approvals/queue');
    }, [navigate]);

    const handleChangePage = useCallback((_, newPage) => setPage(newPage), []);
    const handleChangeRowsPerPage = useCallback((e) => {
        setRowsPerPage(parseInt(e.target.value, 10));
        setPage(0);
    }, []);

    const handleOpenAction = useCallback((type, reqId) => {
        setActionDialog({ open: true, type, requestId: reqId || requestId });
        setActionComments('');
    }, [requestId]);

    const handleCloseAction = useCallback(() => {
        setActionDialog({ open: false, type: '', requestId: '' });
        setActionComments('');
    }, []);

    const handleExecuteAction = useCallback(async () => {
        const { type, requestId: reqId } = actionDialog;
        const payload = { requestId: reqId, comments: actionComments };

        try {
            switch (type) {
                case 'approve':
                    await approveRequest(payload).unwrap();
                    showSnackbar('Request approved');
                    break;
                case 'reject':
                    await rejectRequest(payload).unwrap();
                    showSnackbar('Request rejected');
                    break;
                case 'cancel':
                    await cancelRequest(payload).unwrap();
                    showSnackbar('Request cancelled');
                    break;
                case 'query':
                    if (!actionComments.trim()) {
                        showSnackbar('Comments required for raising a query', 'warning');
                        return;
                    }
                    await queryRequest(payload).unwrap();
                    showSnackbar('Query raised');
                    break;
                case 'respond':
                    if (!actionComments.trim()) {
                        showSnackbar('Response is required', 'warning');
                        return;
                    }
                    await respondToQuery(payload).unwrap();
                    showSnackbar('Response submitted');
                    break;
                case 'escalate':
                    await escalateRequest(payload).unwrap();
                    showSnackbar('Request escalated');
                    break;
                default:
                    break;
            }
            handleCloseAction();
        } catch (err) {
            showSnackbar(err?.data?.error || `Failed to ${type}`, 'error');
        }
    }, [
        actionDialog, actionComments,
        approveRequest, rejectRequest, cancelRequest,
        queryRequest, respondToQuery, escalateRequest,
        handleCloseAction, showSnackbar,
    ]);

    const isActionLoading = approving || rejecting || cancelling || querying || responding || escalating;

    return {
        hasFullAccess,
        can,
        // List
        approvals,
        pagination,
        listLoading,
        listError: listError?.data?.error || null,
        page,
        rowsPerPage,
        statusFilter,
        setStatusFilter,
        // Detail
        requestId,
        approvalDetail,
        detailLoading,
        // Action dialog
        actionDialog,
        actionComments,
        setActionComments,
        isActionLoading,
        snackbar,
        // Handlers
        handleViewDetail,
        handleBackToQueue,
        handleChangePage,
        handleChangeRowsPerPage,
        handleOpenAction,
        handleCloseAction,
        handleExecuteAction,
        handleCloseSnackbar,
    };
};

export default useApprovals;
