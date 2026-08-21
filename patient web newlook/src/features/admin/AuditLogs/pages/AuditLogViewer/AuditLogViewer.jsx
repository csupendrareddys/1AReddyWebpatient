/**
 * AuditLogViewer — Displays RBAC audit log events
 * Pure UI composition — all logic in useAuditLogs
 */
import {
    Box, Typography, Alert, TextField, InputAdornment, Button,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Paper, TablePagination, CircularProgress, Chip,
} from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import ClearIcon from '@mui/icons-material/Clear';

import useAuditLogs from '../../hooks/useAuditLogs';

const ACTION_COLORS = {
    create: '#16a34a',
    update: '#2563eb',
    delete: '#dc2626',
    revoke: '#eab308',
    restore: '#8b5cf6',
    assign: '#0891b2',
    unassign: '#f97316',
};

const AuditLogViewer = () => {
    const {
        auditLogs,
        pagination,
        isLoading,
        error,
        page,
        rowsPerPage,
        filters,
        handleChangePage,
        handleChangeRowsPerPage,
        handleFilterChange,
        handleClearFilters,
    } = useAuditLogs();

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h5" fontWeight={600}>
                    Audit Logs
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <TextField
                        size="small"
                        placeholder="Filter by module..."
                        value={filters.module}
                        onChange={(e) => handleFilterChange('module', e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <FilterListIcon sx={{ color: '#9ca3af', fontSize: 18 }} />
                                </InputAdornment>
                            ),
                        }}
                        sx={{ width: 180 }}
                    />
                    <TextField
                        size="small"
                        placeholder="Action type..."
                        value={filters.action_type}
                        onChange={(e) => handleFilterChange('action_type', e.target.value)}
                        sx={{ width: 140 }}
                    />
                    {(filters.module || filters.action_type || filters.admin_id) && (
                        <Button
                            size="small"
                            startIcon={<ClearIcon />}
                            onClick={handleClearFilters}
                            sx={{ textTransform: 'none' }}
                        >
                            Clear
                        </Button>
                    )}
                </Box>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <TableContainer component={Paper} sx={{ borderRadius: 2, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow sx={{ backgroundColor: '#f8f9fa' }}>
                                <TableCell sx={{ fontWeight: 700 }}>Timestamp</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Admin</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Action</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Module</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Details</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {auditLogs.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                                        <Typography color="text.secondary">No audit log entries found</Typography>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                auditLogs.map((log) => (
                                    <TableRow key={log.id} hover>
                                        <TableCell sx={{ fontSize: '0.8rem', color: '#6b7280', whiteSpace: 'nowrap' }}>
                                            {log.created_at
                                                ? new Date(log.created_at).toLocaleString()
                                                : '—'}
                                        </TableCell>
                                        <TableCell sx={{ fontWeight: 500 }}>
                                            {log.admin_name || log.admin_id?.slice(0, 8) || '—'}
                                        </TableCell>
                                        <TableCell>
                                            <Chip
                                                label={log.action_type || log.action || '—'}
                                                size="small"
                                                sx={{
                                                    bgcolor: `${ACTION_COLORS[log.action_type] || '#6b7280'}20`,
                                                    color: ACTION_COLORS[log.action_type] || '#6b7280',
                                                    fontWeight: 600,
                                                    fontSize: '0.75rem',
                                                }}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            {log.module?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || '—'}
                                        </TableCell>
                                        <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', color: '#6b7280', fontSize: '0.8rem' }}>
                                            {log.reason || log.details || JSON.stringify(log.changes)?.slice(0, 80) || '—'}
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
                        onPageChange={handleChangePage}
                        rowsPerPage={rowsPerPage}
                        onRowsPerPageChange={handleChangeRowsPerPage}
                        rowsPerPageOptions={[10, 25, 50, 100]}
                    />
                </TableContainer>
            )}
        </Box>
    );
};

export default AuditLogViewer;
