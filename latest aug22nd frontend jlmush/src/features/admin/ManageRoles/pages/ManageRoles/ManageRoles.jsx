/**
 * ManageRoles Page — Pure UI composition
 * All logic lives in useManageRoles hook
 * Two views: Roles list (tab 0) and Permission Matrix (tab 1)
 */
import {
    Box, Typography, Button, TextField, Alert, Snackbar,
    InputAdornment, Dialog, DialogTitle, DialogContent,
    DialogActions, CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';

import useManageRoles from '../../hooks/useManageRoles';
import RoleList from '../../components/RoleList/RoleList';
import RoleEditorDialog from '../../components/RoleEditorDialog/RoleEditorDialog';
import PermissionMatrix from '../../components/PermissionMatrix/PermissionMatrix';
import DeleteConfirmDialog from '../../components/DeleteConfirmDialog/DeleteConfirmDialog';
import './ManageRoles.css';

const ManageRoles = () => {
    const {
        hasFullAccess,
        roles,
        pagination,
        groupedPermissions,
        enums,
        selectedRole,
        rolesLoading,
        permissionsLoading,
        createLoading,
        updateLoading,
        savingPermissions,
        rolesError,
        activeTab,
        page,
        rowsPerPage,
        search,
        openEditor,
        editorMode,
        openDelete,
        openClone,
        cloneName,
        setCloneName,
        roleForm,
        snackbar,
        handleOpenCreate,
        handleOpenEdit,
        handleOpenDelete,
        handleOpenClone,
        handleClose,
        handleRoleFormChange,
        handleCreateRole,
        handleUpdateRole,
        handleDeleteRole,
        handleCloneRole,
        handleViewPermissions,
        handleSavePermissions,
        handleBackToRoles,
        handleChangePage,
        handleChangeRowsPerPage,
        handleSearchChange,
        handleCloseSnackbar,
    } = useManageRoles();

    return (
        <Box className="manage-roles">
            {/* ── Roles List View ──────────────────────────────── */}
            {activeTab === 0 && (
                <>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                        <Typography variant="h5" fontWeight={600}>
                            Roles & Permissions
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                            <TextField
                                size="small"
                                placeholder="Search roles..."
                                value={search}
                                onChange={handleSearchChange}
                                InputProps={{
                                    startAdornment: (
                                        <InputAdornment position="start">
                                            <SearchIcon sx={{ color: '#9ca3af' }} />
                                        </InputAdornment>
                                    ),
                                }}
                                sx={{ width: 240 }}
                            />
                            {hasFullAccess && ( // hasFullAccess && (
                                <Button
                                    variant="contained"
                                    startIcon={<AddIcon />}
                                    onClick={handleOpenCreate}
                                    sx={{
                                        bgcolor: '#16a34a',
                                        '&:hover': { bgcolor: '#15803d' },
                                        borderRadius: 2,
                                        textTransform: 'none',
                                        fontWeight: 600,
                                    }}
                                >
                                    Add New Role
                                </Button>
                            )}
                        </Box>
                    </Box>

                    {rolesError && <Alert severity="error" sx={{ mb: 2 }}>{rolesError}</Alert>}

                    <RoleList
                        roles={roles}
                        loading={rolesLoading}
                        pagination={pagination}
                        page={page}
                        rowsPerPage={rowsPerPage}
                        hasFullAccess={hasFullAccess}
                        onEdit={handleOpenEdit}
                        onDelete={handleOpenDelete}
                        onClone={handleOpenClone}
                        onViewPermissions={handleViewPermissions}
                        onPageChange={handleChangePage}
                        onRowsPerPageChange={handleChangeRowsPerPage}
                    />
                </>
            )}

            {/* ── Permission Matrix View ──────────────────────── */}
            {activeTab === 1 && (
                <PermissionMatrix
                    role={selectedRole}
                    groupedPermissions={groupedPermissions}
                    dataRanges={enums?.data_ranges || []}
                    isSystemRole={!!selectedRole?.is_system}
                    isLoading={permissionsLoading}
                    isSaving={savingPermissions}
                    onSave={handleSavePermissions}
                    onBack={handleBackToRoles}
                />
            )}

            {/* ── Dialogs ─────────────────────────────────────── */}
            <RoleEditorDialog
                open={openEditor}
                mode={editorMode}
                formData={roleForm}
                isLoading={editorMode === 'create' ? createLoading : updateLoading}
                onFormChange={handleRoleFormChange}
                onSubmit={editorMode === 'create' ? handleCreateRole : handleUpdateRole}
                onClose={handleClose}
            />

            <DeleteConfirmDialog
                open={openDelete}
                roleName={selectedRole?.name}
                onConfirm={handleDeleteRole}
                onClose={handleClose}
            />

            {/* Clone Dialog */}
            <Dialog open={openClone} onClose={handleClose} maxWidth="xs" fullWidth>
                <DialogTitle sx={{ fontWeight: 600 }}>Clone Role</DialogTitle>
                <DialogContent>
                    <TextField
                        label="New Role Name"
                        value={cloneName}
                        onChange={(e) => setCloneName(e.target.value)}
                        fullWidth
                        autoFocus
                        sx={{ mt: 1 }}
                    />
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={handleClose}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleCloneRole}
                        disabled={!cloneName?.trim()}
                        sx={{
                            bgcolor: '#E8833A',
                            '&:hover': { bgcolor: '#D4702E' },
                            textTransform: 'none',
                            fontWeight: 600,
                        }}
                    >
                        Clone
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Snackbar */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={handleCloseSnackbar}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert
                    onClose={handleCloseSnackbar}
                    severity={snackbar.severity}
                    variant="filled"
                    sx={{ width: '100%' }}
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default ManageRoles;
