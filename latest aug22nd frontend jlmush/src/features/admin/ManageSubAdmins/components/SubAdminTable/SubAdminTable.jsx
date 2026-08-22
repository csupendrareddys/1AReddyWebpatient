/**
 * SubAdminTable — List table of sub-admins
 * Pure UI component
 */
import {
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Paper, Chip, IconButton, Tooltip, TablePagination,
    CircularProgress, Box, Typography, Avatar,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';

const SubAdminTable = ({
    subAdmins,
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
                        <TableCell sx={{ fontWeight: 700, color: '#495057' }}>Admin</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: '#495057' }}>Email</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: '#495057' }}>Roles</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: '#495057' }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: '#495057' }} align="right">Actions</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {subAdmins.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                                <Typography color="text.secondary">No sub-admins found</Typography>
                            </TableCell>
                        </TableRow>
                    ) : (
                        subAdmins.map((admin) => (
                            <TableRow key={admin.id} hover sx={{ cursor: 'pointer' }} onClick={() => onView(admin)}>
                                <TableCell>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                        <Avatar sx={{ width: 32, height: 32, bgcolor: '#E8833A', fontSize: '0.85rem' }}>
                                            {(admin.full_name || admin.email || '?').charAt(0).toUpperCase()}
                                        </Avatar>
                                        <Typography fontWeight={500}>
                                            {admin.full_name || 'N/A'}
                                        </Typography>
                                    </Box>
                                </TableCell>
                                <TableCell sx={{ color: '#6b7280' }}>{admin.email || '—'}</TableCell>
                                <TableCell>
                                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                        {(admin.roles || []).length > 0 ? (
                                            admin.roles.map((r) => (
                                                <Chip
                                                    key={r.id || r.name}
                                                    label={r.name}
                                                    size="medium"
                                                    sx={{ 
                                                        bgcolor: '#ede9fe', 
                                                        color: '#7c3aed', 
                                                        fontWeight: 500,
                                                    }}
                                                />
                                            ))
                                        ) : (
                                            <Typography variant="body2" color="text.secondary">No roles</Typography>
                                        )}
                                    </Box>
                                </TableCell>
                                <TableCell>
                                    <Chip
                                        label={admin.is_active ? 'Active' : 'Inactive'}
                                        size="small"
                                        color={admin.is_active ? 'success' : 'default'}
                                    />
                                </TableCell>
                                <TableCell align="right">
                                    <Tooltip title="View Details">
                                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); onView(admin); }}>
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
                rowsPerPageOptions={[5, 10, 25, 50]}
            />
        </TableContainer>
    );
};

export default SubAdminTable;
