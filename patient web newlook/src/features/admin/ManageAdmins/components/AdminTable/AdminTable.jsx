/**
 * AdminTable — Displays admin list in a table with actions
 */
import {
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TablePagination,
    Paper,
    Box,
    Typography,
    Chip,
    Avatar,
    IconButton,
    Tooltip,
    CircularProgress,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import PersonIcon from '@mui/icons-material/Person';

const AdminTable = ({
    admins,
    loading,
    pagination,
    page,
    rowsPerPage,
    userId,
    onEdit,
    onDelete,
    onToggleStatus,
    onPageChange,
    onRowsPerPageChange,
}) => {
    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <TableContainer component={Paper} elevation={3}>
            <Table>
                <TableHead>
                    <TableRow sx={{ bgcolor: 'grey.100' }}>
                        <TableCell>Admin</TableCell>
                        <TableCell>Role</TableCell>
                        <TableCell>Permissions</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell align="right">Actions</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {admins.map((admin) => (
                        <TableRow key={admin.id} hover>
                            <TableCell>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Avatar sx={{ bgcolor: admin.role === 'super_admin' ? 'warning.main' : 'primary.main' }}>
                                        {admin.role === 'super_admin' ? <AdminPanelSettingsIcon /> : <PersonIcon />}
                                    </Avatar>
                                    <Box>
                                        <Typography variant="body1" fontWeight="medium">
                                            {admin.full_name}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            {admin.user_details?.email || admin.user_details?.phone_number}
                                        </Typography>
                                    </Box>
                                </Box>
                            </TableCell>
                            <TableCell>
                                <Chip
                                    label={admin.role === 'super_admin' ? 'Super Admin' : 'Sub Admin'}
                                    color={admin.role === 'super_admin' ? 'warning' : 'primary'}
                                    size="small"
                                />
                            </TableCell>
                            <TableCell>
                                {admin.role === 'super_admin' ? (
                                    <Chip label="All Permissions" color="success" size="small" />
                                ) : (
                                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                        {(admin.permissions || []).slice(0, 2).map((perm) => (
                                            <Chip key={perm} label={perm.replace('_', ' ')} size="small" variant="outlined" />
                                        ))}
                                        {(admin.permissions || []).length > 2 && (
                                            <Chip label={`+${admin.permissions.length - 2} more`} size="small" variant="outlined" />
                                        )}
                                        {(!admin.permissions || admin.permissions.length === 0) && (
                                            <Typography variant="body2" color="text.secondary">No permissions</Typography>
                                        )}
                                    </Box>
                                )}
                            </TableCell>
                            <TableCell>
                                <Chip
                                    label={admin.status || 'Active'}
                                    color={admin.status === 'blocked' ? 'error' : 'success'}
                                    size="small"
                                />
                            </TableCell>
                            <TableCell align="right">
                                {admin.user_id !== userId && (
                                    <>
                                        <Tooltip title="Edit">
                                            <IconButton size="small" onClick={() => onEdit(admin)}>
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title={admin.status === 'blocked' ? 'Activate' : 'Block'}>
                                            <IconButton
                                                size="small"
                                                onClick={() => onToggleStatus(admin)}
                                                color={admin.status === 'blocked' ? 'success' : 'warning'}
                                            >
                                                {admin.status === 'blocked' ? <CheckCircleIcon fontSize="small" /> : <BlockIcon fontSize="small" />}
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete">
                                            <IconButton size="small" onClick={() => onDelete(admin)} color="error">
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                    {admins.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                                <Typography color="text.secondary">No admins found</Typography>
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
            <TablePagination
                component="div"
                count={pagination.total}
                page={page}
                onPageChange={onPageChange}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={onRowsPerPageChange}
                rowsPerPageOptions={[5, 10, 25]}
            />
        </TableContainer>
    );
};

export default AdminTable;
