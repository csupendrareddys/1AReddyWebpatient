/**
 * useManageRoles — Custom hook for the ManageRoles page
 * Encapsulates all state management, form logic, and RTK Query API calls.
 * Pattern follows useManageAdmins.js
 */
import { useState, useMemo, useCallback } from 'react';
import {
    useGetRolesQuery,
    useGetRolePermissionsQuery,
    useGetRbacEnumsQuery,
    useCreateRoleMutation,
    useUpdateRoleMutation,
    useDeleteRoleMutation,
    useCloneRoleMutation,
    useBulkSetPermissionsMutation,
} from '../../api/rbacEndpoints';
import usePermissions from '../../../../common/hooks/usePermissions';

const INITIAL_ROLE_FORM = {
    name: '',
    description: '',
    level: '',
    is_active: true,
};

// Module groupings for PermissionMatrix display
const MODULE_GROUPS = [
    {
        label: 'Login & Signup',
        prefix: ['login_page_config', 'patient_login_page', 'patient_signup_page',
                 'doctor_login_page', 'doctor_signup_page', 'pharmacy_login_page',
                 'pharmacy_signup_page', 'diagnosis_login_page', 'diagnosis_signup_page',
                 'admin_login_page'],
    },
    { label: 'Patient Management', prefix: ['patient_'] },
    { label: 'Doctor Management', prefix: ['doctor_'] },
    { label: 'Appointments', prefix: ['appointment_'] },
    { label: 'Consultations', prefix: ['consultation_'] },
    { label: 'Prescriptions', prefix: ['prescription_'] },
    { label: 'Pharmacy', prefix: ['pharmacy_'] },
    { label: 'Hospital', prefix: ['hospital_'] },
    { label: 'Payments', prefix: ['payment_'] },
    {
        label: 'Masters',
        prefix: ['category_management', 'medicine_', 'symptom_management', 'questionnaire_blocks'],
    },
    {
        label: 'Admin & System',
        prefix: ['admin_', 'sub_admin_', 'approval_', 'system_settings', 'audit_logs'],
    },
    // Approvals-hub per-module scopes (approve_registration/appointment/profile/
    // working_days/education/bank/bank_account/payout). Distinct 'approve_' prefix
    // from the 'approval_' entries above — without this group they're dropped.
    { label: 'Approvals', prefix: ['approve_'] },
    { label: 'Reports', prefix: ['reports_'] },
    // Vendor-console modules (the backend only serves these for the
    // platform tenant's roles, and only the product modules above for
    // customer tenants — empty groups are filtered out below, so both
    // sides can share this one list).
    {
        label: 'SaaS Management',
        prefix: ['tenant_management', 'tenant_permissions', 'plan_catalog',
                 'plan_subscription', 'addon_catalog'],
    },
    { label: 'Landing & Branding', prefix: ['landing_'] },
    { label: 'Support', prefix: ['support_chat'] },
    { label: 'Operations', prefix: ['operations_'] },
    { label: 'Provider Subscriptions', prefix: ['provider_subscription_list'] },
];

const useManageRoles = () => {
    const { hasFullAccess } = usePermissions();

    // Pagination
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [search, setSearch] = useState('');

    // Active tab & selected role
    const [activeTab, setActiveTab] = useState(0);
    const [selectedRoleId, setSelectedRoleId] = useState(null);

    // Dialog states
    const [openEditor, setOpenEditor] = useState(false);
    const [openDelete, setOpenDelete] = useState(false);
    const [openClone, setOpenClone] = useState(false);
    const [editorMode, setEditorMode] = useState('create'); // 'create' | 'edit'
    const [roleForm, setRoleForm] = useState(INITIAL_ROLE_FORM);
    const [cloneName, setCloneName] = useState('');
    const [selectedRole, setSelectedRole] = useState(null);

    // Snackbar
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    // RTK Query hooks
    const {
        data: rolesData,
        isLoading: rolesLoading,
        error: rolesError,
    } = useGetRolesQuery({
        page: page + 1,
        per_page: rowsPerPage,
        search: search || undefined,
        include_inactive: 'true',
    });

    const {
        data: permissionsData,
        isLoading: permissionsLoading,
    } = useGetRolePermissionsQuery(selectedRoleId, { skip: !selectedRoleId });

    const { data: enumsData } = useGetRbacEnumsQuery();

    // Mutations
    const [createRole, { isLoading: createLoading }] = useCreateRoleMutation();
    const [updateRole, { isLoading: updateLoading }] = useUpdateRoleMutation();
    const [deleteRoleMutation] = useDeleteRoleMutation();
    const [cloneRoleMutation] = useCloneRoleMutation();
    const [bulkSetPermissions, { isLoading: savingPermissions }] = useBulkSetPermissionsMutation();

    const roles = rolesData?.roles || [];
    const pagination = rolesData?.pagination || { total: 0 };
    const permissionMatrix = permissionsData?.permissions || [];
    const enums = enumsData || {};

    // Group modules for the PermissionMatrix
    const groupedPermissions = useMemo(() => {
        if (!permissionMatrix.length) return [];
        return MODULE_GROUPS.map((group) => ({
            ...group,
            modules: permissionMatrix.filter((perm) =>
                group.prefix.some((p) =>
                    p.endsWith('_') ? perm.module.startsWith(p) : perm.module === p
                )
            ),
        })).filter((g) => g.modules.length > 0);
    }, [permissionMatrix]);

    // ── Handlers ─────────────────────────────────────────────

    const showSnackbar = useCallback((message, severity = 'success') => {
        setSnackbar({ open: true, message, severity });
    }, []);

    const handleCloseSnackbar = useCallback(() => {
        setSnackbar((prev) => ({ ...prev, open: false }));
    }, []);

    // Role CRUD
    const handleOpenCreate = useCallback(() => {
        setRoleForm(INITIAL_ROLE_FORM);
        setEditorMode('create');
        setOpenEditor(true);
    }, []);

    const handleOpenEdit = useCallback((role) => {
        setSelectedRole(role);
        setRoleForm({
            name: role.name || '',
            description: role.description || '',
            level: role.level ?? '',
            is_active: role.is_active !== false,
        });
        setEditorMode('edit');
        setOpenEditor(true);
    }, []);

    const handleOpenDelete = useCallback((role) => {
        setSelectedRole(role);
        setOpenDelete(true);
    }, []);

    const handleOpenClone = useCallback((role) => {
        setSelectedRole(role);
        setCloneName(`${role.name} (Copy)`);
        setOpenClone(true);
    }, []);

    const handleClose = useCallback(() => {
        setOpenEditor(false);
        setOpenDelete(false);
        setOpenClone(false);
        setSelectedRole(null);
    }, []);

    const handleRoleFormChange = useCallback((e) => {
        const { name, value } = e.target;
        setRoleForm((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleCreateRole = useCallback(async () => {
        try {
            await createRole({
                name: roleForm.name,
                description: roleForm.description,
                level: roleForm.level ? Number(roleForm.level) : null,
            }).unwrap();
            handleClose();
            showSnackbar('Role created successfully');
        } catch (err) {
            showSnackbar(err?.data?.error || 'Failed to create role', 'error');
        }
    }, [createRole, roleForm, handleClose, showSnackbar]);

    const handleUpdateRole = useCallback(async () => {
        try {
            await updateRole({
                roleId: selectedRole.id,
                data: {
                    name: roleForm.name,
                    description: roleForm.description,
                    level: roleForm.level ? Number(roleForm.level) : null,
                    is_active: roleForm.is_active,
                },
            }).unwrap();
            handleClose();
            showSnackbar('Role updated successfully');
        } catch (err) {
            showSnackbar(err?.data?.error || 'Failed to update role', 'error');
        }
    }, [updateRole, selectedRole, roleForm, handleClose, showSnackbar]);

    const handleDeleteRole = useCallback(async () => {
        try {
            await deleteRoleMutation(selectedRole.id).unwrap();
            handleClose();
            showSnackbar('Role deleted');
        } catch (err) {
            showSnackbar(err?.data?.error || 'Failed to delete role', 'error');
        }
    }, [deleteRoleMutation, selectedRole, handleClose, showSnackbar]);

    const handleCloneRole = useCallback(async () => {
        try {
            await cloneRoleMutation({
                roleId: selectedRole.id,
                name: cloneName,
            }).unwrap();
            handleClose();
            showSnackbar('Role cloned successfully');
        } catch (err) {
            showSnackbar(err?.data?.error || 'Failed to clone role', 'error');
        }
    }, [cloneRoleMutation, selectedRole, cloneName, handleClose, showSnackbar]);

    // Permission matrix
    const handleViewPermissions = useCallback((role) => {
        setSelectedRoleId(role.id);
        setSelectedRole(role);
        setActiveTab(1);
    }, []);

    const handleSavePermissions = useCallback(async (updatedPermissions) => {
        try {
            const result = await bulkSetPermissions({
                roleId: selectedRoleId,
                permissions: updatedPermissions,
            }).unwrap();
            showSnackbar('Permissions saved');
            if (result?.data?.warnings?.length) {
                showSnackbar(`Permissions saved with warnings: ${result.data.warnings.join(', ')}`, 'warning');
            }
        } catch (err) {
            showSnackbar(err?.data?.error || 'Failed to save permissions', 'error');
        }
    }, [bulkSetPermissions, selectedRoleId, showSnackbar]);

    const handleBackToRoles = useCallback(() => {
        setActiveTab(0);
        setSelectedRoleId(null);
        setSelectedRole(null);
    }, []);

    // Pagination
    const handleChangePage = useCallback((event, newPage) => {
        setPage(newPage);
    }, []);

    const handleChangeRowsPerPage = useCallback((event) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
    }, []);

    const handleSearchChange = useCallback((e) => {
        setSearch(e.target.value);
        setPage(0);
    }, []);

    return {
        // Auth
        hasFullAccess,
        // Data
        roles,
        pagination,
        permissionMatrix,
        groupedPermissions,
        enums,
        selectedRole,
        selectedRoleId,
        // Loading
        rolesLoading,
        permissionsLoading,
        createLoading,
        updateLoading,
        savingPermissions,
        rolesError: rolesError?.data?.error || null,
        // UI state
        activeTab,
        setActiveTab,
        page,
        rowsPerPage,
        search,
        // Dialog state
        openEditor,
        editorMode,
        openDelete,
        openClone,
        cloneName,
        setCloneName,
        roleForm,
        snackbar,
        // Handlers
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
    };
};

export default useManageRoles;
