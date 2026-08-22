/**
 * ApprovalTable — Table listing approval requests
 * Pure UI component
 */
import {
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Paper, Chip, IconButton, Tooltip, TablePagination,
    CircularProgress, Box, Typography,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';

const STATUS_COLORS = {
    pending: 'warning',
    under_review: 'info',
    completed: 'success',
    rejected: 'error',
    cancelled: 'default',
    query: 'secondary',
};

const ApprovalTable = ({
    approvals,
    loading,
    pagination,
    page,
    rowsPerPage,
    onView,
    onPageChange,
    onRowsPerPageChange,
}) => {
    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <TableContainer component={Paper} sx={{ borderRadius: 2, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
            <Table>
                <TableHead>
                    <TableRow sx={{ backgroundColor: '#f8f9fa' }}>
                        <TableCell sx={{ fontWeight: 700 }}>Request</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Entity</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Requested By</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Level</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Created</TableCell>
                        <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {approvals.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                                <Typography color="text.secondary">No approval requests found</Typography>
                            </TableCell>
                        </TableRow>
                    ) : (
                        approvals.map((req) => (
                            <TableRow key={req.id} hover sx={{ cursor: 'pointer' }} onClick={() => onView(req)}>
                                <TableCell>
                                    <Typography fontWeight={500} sx={{ color: '#2563eb' }}>
                                        {req.title || req.entity_type?.replace(/_/g, ' ') || 'Request'}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {req.requested_by_name || `#${req.id?.slice(0, 8)}`}
                                    </Typography>
                                </TableCell>
                                <TableCell>
                                    <Chip
                                        label={req.entity_type?.replace(/_/g, ' ') || '—'}
                                        size="small"
                                        sx={{ bgcolor: '#f3e8ff', color: '#9333ea' }}
                                    />
                                </TableCell>
                                <TableCell sx={{ color: '#6b7280' }}>
                                    {req.requested_by_name || req.requested_by_id?.slice(0, 8) || '—'}
                                </TableCell>
                                <TableCell>
                                    <Chip
                                        label={req.status?.replace(/_/g, ' ').toUpperCase() || 'PENDING'}
                                        size="small"
                                        color={STATUS_COLORS[req.status] || 'default'}
                                    />
                                </TableCell>
                                <TableCell>
                                    {req.current_level != null ? `L${req.current_level}` : '—'}
                                    {req.required_level != null && ` / L${req.required_level}`}
                                </TableCell>
                                <TableCell sx={{ color: '#6b7280', fontSize: '0.85rem' }}>
                                    {req.created_at ? new Date(req.created_at).toLocaleDateString() : '—'}
                                </TableCell>
                                <TableCell align="right">
                                    <Tooltip title="View Details">
                                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); onView(req); }}>
                                            <VisibilityIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
            <TablePagination
                component="div"
                count={pagination.total || 0}
                page={page}
                onPageChange={onPageChange}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={onRowsPerPageChange}
                rowsPerPageOptions={[5, 10, 25]}
            />
        </TableContainer>
    );
};

export default ApprovalTable;
