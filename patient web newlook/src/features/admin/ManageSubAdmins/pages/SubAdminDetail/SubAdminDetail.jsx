/**
 * SubAdminDetail — Detail page for a single sub-admin
 * Pure UI composition — all logic in useManageSubAdmins
 * Uses tabs: Roles, Overrides, Effective Permissions
 */
import {
    Box, Typography, Button, Tabs, Tab, Alert, Snackbar,
    Dialog, DialogTitle, DialogContent, DialogActions,
    FormControl, InputLabel, Select, MenuItem, IconButton, Chip,
    Avatar, Paper, Tooltip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

import useManageSubAdmins from '../../hooks/useManageSubAdmins';
import RoleAssignment from '../../components/RoleAssignment/RoleAssignment';
import OverrideList from '../../components/OverrideList/OverrideList';
import OverrideDialog from '../../components/OverrideDialog/OverrideDialog';
import EffectivePermsView from '../../components/EffectivePermsView/EffectivePermsView';
import './SubAdminDetail.css';

const SubAdminDetail = () => {
    const {
        hasFullAccess,
        adminId,
        adminInfo,
        adminRoles,
        effectivePerms,
        overrides,
        allRoles,
        enums,
        rolesLoading,
        effectiveLoading,
        overridesLoading,
        activeDetailTab,
        setActiveDetailTab,
        openRoleAssign,
        setOpenRoleAssign,
        selectedRoleToAssign,
        setSelectedRoleToAssign,
        openOverrideDialog,
        overrideMode,
        overrideForm,
        snackbar,
        handleBackToList,
        handleOpenRoleAssign,
        handleAssignRole,
        handleUnassignRole,
        handleOpenCreateOverride,
        handleOpenEditOverride,
        handleCloseOverride,
        handleOverrideFormChange,
        handleSaveOverride,
        handleDeactivateOverride,
        handleCloseSnackbar,
    } = useManageSubAdmins();

    return (
        <Box className="sub-admin-detail">
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <Tooltip title="Back to Sub-Admins">
                    <IconButton onClick={handleBackToList}>
                        <ArrowBackIcon />
                    </IconButton>
                </Tooltip>
                <Avatar sx={{ width: 40, height: 40, bgcolor: '#E8833A', fontWeight: 600 }}>
                    {(adminInfo.full_name || '?').charAt(0).toUpperCase()}
                </Avatar>
                <Box>
                    <Typography variant="h5" fontWeight={600}>
                        {adminInfo.full_name || 'Sub-Admin'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {adminInfo.email || ''} · ID: {adminId?.slice(0, 8)}...
                    </Typography>
                </Box>
                {adminInfo.is_active !== undefined && (
                    <Chip
                        label={adminInfo.is_active ? 'Active' : 'Inactive'}
                        size="small"
                        color={adminInfo.is_active ? 'success' : 'default'}
                        sx={{ ml: 'auto' }}
                    />
                )}
            </Box>

            {/* Tabs */}
            <Paper sx={{ borderRadius: 2, mb: 3 }}>
                <Tabs
                    value={activeDetailTab}
                    onChange={(_, v) => setActiveDetailTab(v)}
                    sx={{ borderBottom: 1, borderColor: 'divider' }}
                >
                    <Tab label="Roles" sx={{ textTransform: 'none', fontWeight: 600 }} />
                    <Tab label="Overrides" sx={{ textTransform: 'none', fontWeight: 600 }} />
                    <Tab label="Effective Permissions" sx={{ textTransform: 'none', fontWeight: 600 }} />
                </Tabs>

                <Box sx={{ p: 3 }}>
                    {activeDetailTab === 0 && (
                        <RoleAssignment
                            roles={adminRoles}
                            isLoading={rolesLoading}
                            hasFullAccess={hasFullAccess}
                            onAssign={handleOpenRoleAssign}
                            onUnassign={handleUnassignRole}
                        />
                    )}
                    {activeDetailTab === 1 && (
                        <OverrideList
                            overrides={overrides}
                            isLoading={overridesLoading}
                            hasFullAccess={hasFullAccess}
                            onCreate={handleOpenCreateOverride}
                            onEdit={handleOpenEditOverride}
                            onDeactivate={handleDeactivateOverride}
                        />
                    )}
                    {activeDetailTab === 2 && (
                        <EffectivePermsView
                            permissions={effectivePerms?.permissions || effectivePerms}
                            isLoading={effectiveLoading}
                        />
                    )}
                </Box>
            </Paper>

            {/* Assign Role Dialog */}
            <Dialog open={openRoleAssign} onClose={() => setOpenRoleAssign(false)} maxWidth="xs" fullWidth>
                <DialogTitle sx={{ fontWeight: 600 }}>Assign Role</DialogTitle>
                <DialogContent>
                    <FormControl fullWidth sx={{ mt: 1 }}>
                        <InputLabel>Select Role</InputLabel>
                        <Select
                            value={selectedRoleToAssign}
                            onChange={(e) => setSelectedRoleToAssign(e.target.value)}
                            label="Select Role"
                        >
                            {allRoles
                                .filter((r) => !adminRoles.some((ar) => (ar.id || ar.role_id) === r.id))
                                .map((r) => (
                                    <MenuItem key={r.id} value={r.id}>
                                        {r.name} {r.level != null && `(Level ${r.level})`}
                                    </MenuItem>
                                ))}
                        </Select>
                    </FormControl>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => setOpenRoleAssign(false)}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleAssignRole}
                        disabled={!selectedRoleToAssign}
                        sx={{
                            bgcolor: '#16a34a',
                            '&:hover': { bgcolor: '#15803d' },
                            textTransform: 'none',
                            fontWeight: 600,
                        }}
                    >
                        Assign
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Override Dialog */}
            <OverrideDialog
                open={openOverrideDialog}
                mode={overrideMode}
                formData={overrideForm}
                modules={enums?.modules || []}
                existingModules={overrides.map(o => o.module)}
                onFormChange={handleOverrideFormChange}
                onSubmit={handleSaveOverride}
                onClose={handleCloseOverride}
            />

            {/* Snackbar */}
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

export default SubAdminDetail;
