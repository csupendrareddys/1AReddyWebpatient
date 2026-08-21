/**
 * ApprovalQueue — Main approval listing page
 * Pure UI composition — all logic in useApprovals
 */
import {
    Box, Typography, Alert, Snackbar,
    FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';

import useApprovals from '../../hooks/useApprovals';
import ApprovalTable from '../../components/ApprovalTable/ApprovalTable';

const STATUS_OPTIONS = [
    { value: '', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'under_review', label: 'Under Review' },
    { value: 'query', label: 'Query' },
    { value: 'completed', label: 'Completed' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'cancelled', label: 'Cancelled' },
];

const ApprovalQueue = () => {
    const {
        approvals,
        pagination,
        listLoading,
        listError,
        page,
        rowsPerPage,
        statusFilter,
        setStatusFilter,
        snackbar,
        handleViewDetail,
        handleChangePage,
        handleChangeRowsPerPage,
        handleCloseSnackbar,
    } = useApprovals();

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h5" fontWeight={600}>
                    Approval Queue
                </Typography>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>Status</InputLabel>
                    <Select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        label="Status"
                    >
                        {STATUS_OPTIONS.map((opt) => (
                            <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Box>

            {listError && <Alert severity="error" sx={{ mb: 2 }}>{listError}</Alert>}

            <ApprovalTable
                approvals={approvals}
                loading={listLoading}
                pagination={pagination}
                page={page}
                rowsPerPage={rowsPerPage}
                onView={handleViewDetail}
                onPageChange={handleChangePage}
                onRowsPerPageChange={handleChangeRowsPerPage}
            />

            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={handleCloseSnackbar}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} variant="filled">
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default ApprovalQueue;
