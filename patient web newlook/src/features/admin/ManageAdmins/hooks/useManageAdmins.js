/**
 * useManageAdmins — Custom hook for the ManageAdmins page
 * Encapsulates all state management, form logic, and RTK Query API calls
 */
import { useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
    useGetAdminsQuery,
    useGetPermissionsQuery,
    useCreateAdminMutation,
    useUpdateAdminMutation,
    useDeleteAdminMutation,
    useToggleAdminStatusMutation,
} from '../../api/adminEndpoints';

const INITIAL_FORM_DATA = {
    email: '',
    phone_number: '',
    password: '',
    first_name: '',
    last_name: '',
    role: 'sub_admin',
    permissions: [],
};

const useManageAdmins = () => {
    const navigate = useNavigate();
    const { user } = useSelector((state) => state.auth);
    const hasFullAccess = user?.role === 'super_admin';

    // Pagination
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    // RTK Query hooks
    const {
        data: adminsData,
        isLoading: loading,
        error: queryError,
    } = useGetAdminsQuery({ page: page + 1, per_page: rowsPerPage });

    const { data: permissions = [] } = useGetPermissionsQuery();

    const [createAdmin, { isLoading: createLoading, error: createError }] =
        useCreateAdminMutation();
    const [updateAdmin, { isLoading: updateLoading, error: updateError }] =
        useUpdateAdminMutation();
    const [deleteAdminMutation] = useDeleteAdminMutation();
    const [toggleAdminStatus] = useToggleAdminStatusMutation();

    const admins = adminsData?.admins || [];
    const pagination = adminsData?.pagination || { total: 0 };
    const error = queryError?.data?.message || queryError?.data?.error || null;

    // Dialog states
    const [openCreate, setOpenCreate] = useState(false);
    const [openEdit, setOpenEdit] = useState(false);
    const [openDelete, setOpenDelete] = useState(false);
    const [selectedAdmin, setSelectedAdmin] = useState(null);
    const [showPassword, setShowPassword] = useState(false);

    // Form state
    const [formData, setFormData] = useState(INITIAL_FORM_DATA);

    // Handlers
    const handleOpenCreate = () => {
        setFormData(INITIAL_FORM_DATA);
        setOpenCreate(true);
    };

    const handleOpenEdit = (admin) => {
        setSelectedAdmin(admin);
        setFormData({
            first_name: admin.first_name || '',
            last_name: admin.last_name || '',
            permissions: admin.permissions || [],
        });
        setOpenEdit(true);
    };

    const handleOpenDelete = (admin) => {
        setSelectedAdmin(admin);
        setOpenDelete(true);
    };

    const handleClose = () => {
        setOpenCreate(false);
        setOpenEdit(false);
        setOpenDelete(false);
        setSelectedAdmin(null);
        setShowPassword(false);
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handlePermissionChange = (permValue) => {
        setFormData((prev) => ({
            ...prev,
            permissions: prev.permissions.includes(permValue)
                ? prev.permissions.filter((p) => p !== permValue)
                : [...prev.permissions, permValue],
        }));
    };

    const handleCreate = async () => {
        try {
            await createAdmin(formData).unwrap();
            handleClose();
        } catch {
            // Error is handled via createError from the mutation hook
        }
    };

    const handleUpdate = async () => {
        try {
            await updateAdmin({
                adminId: selectedAdmin.id,
                updateData: {
                    first_name: formData.first_name,
                    last_name: formData.last_name,
                    permissions: formData.permissions,
                },
            }).unwrap();
            handleClose();
        } catch {
            // Error is handled via updateError from the mutation hook
        }
    };

    const handleDelete = async () => {
        try {
            await deleteAdminMutation({ adminId: selectedAdmin.id }).unwrap();
            handleClose();
        } catch {
            // Silently handled
        }
    };

    const handleToggleStatus = async (admin) => {
        const newStatus = admin.status === 'active' ? 'blocked' : 'active';
        await toggleAdminStatus({ adminId: admin.id, status: newStatus });
    };

    const handleChangePage = (event, newPage) => {
        setPage(newPage);
    };

    const handleChangeRowsPerPage = (event) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
    };

    const handleGoBack = () => navigate('/dashboard/admin');

    return {
        // Auth
        user,
        hasFullAccess,
        // Data
        admins,
        permissions,
        pagination,
        // Loading / Error
        loading,
        error,
        createLoading,
        createError: createError?.data?.message || createError?.data?.error || null,
        updateLoading,
        updateError: updateError?.data?.message || updateError?.data?.error || null,
        // Pagination
        page,
        rowsPerPage,
        handleChangePage,
        handleChangeRowsPerPage,
        // Dialog state
        openCreate,
        openEdit,
        openDelete,
        selectedAdmin,
        showPassword,
        setShowPassword,
        // Form
        formData,
        handleInputChange,
        handlePermissionChange,
        // Actions
        handleOpenCreate,
        handleOpenEdit,
        handleOpenDelete,
        handleClose,
        handleCreate,
        handleUpdate,
        handleDelete,
        handleToggleStatus,
        handleGoBack,
    };
};

export default useManageAdmins;
