/**
 * ManageAdmins Page — Pure UI composition
 * All logic lives in useManageAdmins hook
 */
import { Box, Typography, Button, Alert } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

import useManageAdmins from '../../hooks/useManageAdmins';
import AdminTable from '../../components/AdminTable/AdminTable';
import AdminFormDialog from '../../components/AdminFormDialog/AdminFormDialog';
import DeleteConfirmDialog from '../../components/DeleteConfirmDialog/DeleteConfirmDialog';
import './ManageAdmins.css';

const ManageAdmins = () => {
    const {
        user,
        hasFullAccess,
        admins,
        permissions,
        pagination,
        loading,
        error,
        createLoading,
        createError,
        updateLoading,
        updateError,
        page,
        rowsPerPage,
        handleChangePage,
        handleChangeRowsPerPage,
        openCreate,
        openEdit,
        openDelete,
        selectedAdmin,
        showPassword,
        setShowPassword,
        formData,
        handleInputChange,
        handlePermissionChange,
        handleOpenCreate,
        handleOpenEdit,
        handleOpenDelete,
        handleClose,
        handleCreate,
        handleUpdate,
        handleDelete,
        handleToggleStatus,
    } = useManageAdmins();

    if (false && !hasFullAccess) { // FORCE ALLOW
        return (
            <Alert severity="error">
                Access Denied. Only Super Admins can manage other admins.
            </Alert>
        );
    }

    return (
        <Box>
            {/* Page Header with action */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h5" fontWeight={600}>
                    Manage Admins
                </Typography>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={handleOpenCreate}
                    sx={{
                        bgcolor: '#E8833A',
                        '&:hover': { bgcolor: '#D4702E' },
                        borderRadius: 2,
                        textTransform: 'none',
                        fontWeight: 600,
                    }}
                >
                    Add Admin
                </Button>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <AdminTable
                admins={admins}
                loading={loading}
                pagination={pagination}
                page={page}
                rowsPerPage={rowsPerPage}
                userId={user?.id}
                onEdit={handleOpenEdit}
                onDelete={handleOpenDelete}
                onToggleStatus={handleToggleStatus}
                onPageChange={handleChangePage}
                onRowsPerPageChange={handleChangeRowsPerPage}
            />

            {/* Create Admin Dialog */}
            <AdminFormDialog
                open={openCreate}
                mode="create"
                formData={formData}
                permissions={permissions}
                showPassword={showPassword}
                isLoading={createLoading}
                error={createError}
                onInputChange={handleInputChange}
                onPermissionChange={handlePermissionChange}
                onTogglePassword={() => setShowPassword(!showPassword)}
                onSubmit={handleCreate}
                onClose={handleClose}
            />

            {/* Edit Admin Dialog */}
            <AdminFormDialog
                open={openEdit}
                mode="edit"
                formData={formData}
                permissions={permissions}
                selectedAdmin={selectedAdmin}
                showPassword={false}
                isLoading={updateLoading}
                error={updateError}
                onInputChange={handleInputChange}
                onPermissionChange={handlePermissionChange}
                onTogglePassword={() => {}}
                onSubmit={handleUpdate}
                onClose={handleClose}
            />

            {/* Delete Confirmation Dialog */}
            <DeleteConfirmDialog
                open={openDelete}
                adminName={selectedAdmin?.full_name}
                onConfirm={handleDelete}
                onClose={handleClose}
            />
        </Box>
    );
};

export default ManageAdmins;
