/**
 * OverrideList — Displays permission overrides for a sub-admin
 * Pure UI component
 */
import {
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Paper, Chip, IconButton, Tooltip, Button, Box, Typography,
    CircularProgress,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import BlockIcon from '@mui/icons-material/Block';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';

const OverrideList = ({
    overrides,
    isLoading,
    hasFullAccess,
    onCreate,
    onEdit,
    onDeactivate,
}) => {
    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                    Permission Overrides
                </Typography>
                {hasFullAccess && (
                    <Button
                        size="small"
                        startIcon={<AddCircleOutlineIcon />}
                        onClick={onCreate}
                        sx={{ textTransform: 'none' }}
                    >
                        Add Override
                    </Button>
                )}
            </Box>

            {overrides.length === 0 ? (
                <Typography color="text.secondary" variant="body2">
                    No overrides configured. Overrides let you grant or revoke specific permissions
                    beyond the role's defaults.
                </Typography>
            ) : (
                <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow sx={{ backgroundColor: '#f8f9fa' }}>
                                <TableCell sx={{ fontWeight: 700 }}>Module</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Permissions</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Reason</TableCell>
                                {hasFullAccess && (
                                    <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
                                )}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {overrides.map((ovr) => (
                                <TableRow key={ovr.id} hover>
                                    <TableCell sx={{ fontWeight: 500 }}>
                                        {ovr.module?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                                        {ovr.resource_id && (
                                            <Chip
                                                label="INSTANCE"
                                                size="small"
                                                color="info"
                                                variant="outlined"
                                                sx={{ ml: 1, height: 18, fontSize: '0.65rem' }}
                                            />
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={ovr.override_type}
                                            size="small"
                                            color={ovr.override_type === 'GRANT' ? 'success' : 'error'}
                                            variant="outlined"
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                            {ovr.can_view && <Chip label="View" size="small" />}
                                            {ovr.can_create && <Chip label="Create" size="small" />}
                                            {ovr.can_edit && <Chip label="Edit" size="small" />}
                                            {ovr.can_delete && <Chip label="Delete" size="small" />}
                                        </Box>
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={ovr.is_active ? 'Active' : 'Inactive'}
                                            size="small"
                                            color={ovr.is_active ? 'success' : 'default'}
                                        />
                                    </TableCell>
                                    <TableCell sx={{ color: '#6b7280', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {ovr.reason || '—'}
                                    </TableCell>
                                    {hasFullAccess && (
                                        <TableCell align="right">
                                            <Tooltip title="Edit Override">
                                                <IconButton size="small" onClick={() => onEdit(ovr)}>
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            {ovr.is_active && (
                                                <Tooltip title="Deactivate">
                                                    <IconButton size="small" color="warning" onClick={() => onDeactivate(ovr.id)}>
                                                        <BlockIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                        </TableCell>
                                    )}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Box>
    );
};

export default OverrideList;
