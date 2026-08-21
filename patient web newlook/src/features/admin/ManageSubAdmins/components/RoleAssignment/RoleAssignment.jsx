/**
 * RoleAssignment — Assign/unassign roles for a sub-admin
 * Pure UI component
 */
import {
    Box, Typography, Chip, IconButton, Tooltip,
    Button, CircularProgress,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';

const RoleAssignment = ({
    roles,
    isLoading,
    hasFullAccess,
    onAssign,
    onUnassign,
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
                    Assigned Roles
                </Typography>
                {hasFullAccess && (
                    <Button
                        size="small"
                        startIcon={<AddCircleOutlineIcon />}
                        onClick={onAssign}
                        sx={{ textTransform: 'none' }}
                    >
                        Assign Role
                    </Button>
                )}
            </Box>

            {roles.length === 0 ? (
                <Typography color="text.secondary" variant="body2">
                    No roles assigned. Click "Assign Role" to add one.
                </Typography>
            ) : (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {roles.map((role) => (
                        <Chip
                            key={role.id || role.role_id}
                            label={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {role.role_name || role.name}
                                    {(role.role_level != null || role.level != null) && (
                                        <Typography
                                            component="span"
                                            variant="caption"
                                            sx={{ opacity: 0.7 }}
                                        >
                                            (L{role.role_level ?? role.level})
                                        </Typography>
                                    )}
                                </Box>
                            }
                            onDelete={hasFullAccess ? () => onUnassign(role.role_id) : undefined}
                            deleteIcon={
                                <Tooltip title="Unassign Role">
                                    <DeleteIcon fontSize="small" />
                                </Tooltip>
                            }
                            sx={{
                                bgcolor: '#ede9fe',
                                color: '#7c3aed',
                                fontWeight: 500,
                                '& .MuiChip-deleteIcon': { color: '#a78bfa' },
                            }}
                        />
                    ))}
                </Box>
            )}
        </Box>
    );
};

export default RoleAssignment;
