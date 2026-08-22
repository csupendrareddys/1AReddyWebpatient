/**
 * RoleList — DataGrid table showing all roles with actions
 * Pure UI component — all logic comes from hook via props
 */
import {
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Paper, Chip, IconButton, Tooltip, TablePagination, CircularProgress,
    Box, Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';

const RoleList = ({
    roles,
    loading,
    pagination,
    page,
    rowsPerPage,
    hasFullAccess,
    onEdit,
    onDelete,
    onClone,
    onViewPermissions,
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
                        <TableCell sx={{ fontWeight: 700, color: '#495057' }}>Role Name</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: '#495057' }}>Description</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: '#495057' }}>Level</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: '#495057' }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: '#495057' }} align="right">Actions</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {roles.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                                <Typography color="text.secondary">No roles found</Typography>
                            </TableCell>
                        </TableRow>
                    ) : (
                        roles.map((role) => (
                            <TableRow key={role.id} hover sx={{ '&:hover': { backgroundColor: '#f8f9ff' } }}>
                                <TableCell>
                                    <Typography
                                        sx={{
                                            fontWeight: 600,
                                            color: '#2563eb',
                                            cursor: 'pointer',
                                            '&:hover': { textDecoration: 'underline' },
                                        }}
                                        onClick={() => onViewPermissions(role)}
                                    >
                                        {role.name}
                                    </Typography>
                                    {role.is_system && (
                                        <Chip label="System" size="small" color="info" sx={{ ml: 1, height: 20 }} />
                                    )}
                                </TableCell>
                                <TableCell sx={{ color: '#6b7280', maxWidth: 300 }}>
                                    {role.description || '—'}
                                </TableCell>
                                <TableCell>
                                    {role.level != null ? (
                                        <Chip
                                            label={`Level ${role.level}`}
                                            size="small"
                                            sx={{
                                                bgcolor: '#ede9fe',
                                                color: '#7c3aed',
                                                fontWeight: 600,
                                            }}
                                        />
                                    ) : '—'}
                                </TableCell>
                                <TableCell>
                                    <Chip
                                        label={role.is_active ? 'Active' : 'Inactive'}
                                        size="small"
                                        color={role.is_active ? 'success' : 'default'}
                                        variant={role.is_active ? 'filled' : 'outlined'}
                                    />
                                </TableCell>
                                <TableCell align="right">
                                    <Tooltip title="View Permissions">
                                        <IconButton size="small" onClick={() => onViewPermissions(role)}>
                                            <VisibilityIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    {true && !role.is_system && ( // hasFullAccess && !role.is_system && (
                                        <>
                                            <Tooltip title="Edit Role">
                                                <IconButton size="small" onClick={() => onEdit(role)}>
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Clone Role">
                                                <IconButton size="small" onClick={() => onClone(role)}>
                                                    <ContentCopyIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Delete Role">
                                                <IconButton size="small" color="error" onClick={() => onDelete(role)}>
                                                    <DeleteIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </>
                                    )}
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

export default RoleList;
