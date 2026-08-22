/**
 * useManageSubAdmins — Hook for Sub-Admin list and detail pages
 * Encapsulates all state, API calls, form logic
 */
import { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    useGetSubAdminsQuery,
    useGetAdminRolesQuery,
    useGetEffectivePermissionsQuery,
    useGetOverridesQuery,
    useGetRolesQuery,
    useAssignRoleMutation,
    useUnassignRoleMutation,
    useCreateOverrideMutation,
    useUpdateOverrideMutation,
    useDeactivateOverrideMutation,
    useRevokeSubAdminAccessMutation,
    useRestoreSubAdminAccessMutation,
    useGetRbacEnumsQuery,
} from '../../api/rbacEndpoints';
import usePermissions from '../../../../common/hooks/usePermissions';

const INITIAL_OVERRIDE_FORM = {
    module: '',
    // Instance-scoping for per-module ACL. Empty string ⇒ module-wide (NULL
    // resource_id on the backend). Populated only when the selected module is
    // instance-scoped (e.g. landing_module).
    resource_id: '',
    override_type: 'grant',
    can_view: false,
    can_create: false,
    can_edit: false,
    can_delete: false,
    reason: '',
    expires_at: '',
};

const useManageSubAdmins = () => {
    const navigate = useNavigate();
    const { adminId } = useParams();
    const { hasFullAccess, can } = usePermissions();

    // ── List page state ──────────────────────────────────────
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [search, setSearch] = useState('');

    // ── Detail page state ────────────────────────────────────
    const [activeDetailTab, setActiveDetailTab] = useState(0);
    const [openRoleAssign, setOpenRoleAssign] = useState(false);
    const [selectedRoleToAssign, setSelectedRoleToAssign] = useState('');
    const [openOverrideDialog, setOpenOverrideDialog] = useState(false);
    const [overrideMode, setOverrideMode] = useState('create');
    const [overrideForm, setOverrideForm] = useState(INITIAL_OVERRIDE_FORM);
    const [selectedOverride, setSelectedOverride] = useState(null);

    // Snackbar
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    // ── RTK Query: List ──────────────────────────────────────
    const { data: subAdminsData, isLoading: listLoading, error: listError } = useGetSubAdminsQuery({
        page: page + 1,
        per_page: rowsPerPage,
        search: search || undefined,
    });

    // ── RTK Query: Detail ────────────────────────────────────
    const { data: adminRolesData, isLoading: rolesLoading } = useGetAdminRolesQuery(adminId, {
        skip: !adminId,
    });

    const { data: effectivePerms, isLoading: effectiveLoading } = useGetEffectivePermissionsQuery(
        adminId, { skip: !adminId }
    );

    const { data: overridesData, isLoading: overridesLoading } = useGetOverridesQuery(adminId, {
        skip: !adminId,
    });

    const { data: allRolesData } = useGetRolesQuery({ per_page: 100 }, { skip: !adminId });
    const { data: enumsData } = useGetRbacEnumsQuery(undefined, { skip: !adminId });

    // Mutations
    const [assignRole] = useAssignRoleMutation();
    const [unassignRole] = useUnassignRoleMutation();
    const [createOverride] = useCreateOverrideMutation();
    const [updateOverride] = useUpdateOverrideMutation();
    const [deactivateOverride] = useDeactivateOverrideMutation();
    const [revokeAccess] = useRevokeSubAdminAccessMutation();
    const [restoreAccess] = useRestoreSubAdminAccessMutation();

    // Derived
    const subAdmins = subAdminsData?.subAdmins || [];
    const pagination = subAdminsData?.pagination || { total: 0 };
    const adminRoles = adminRolesData?.roles || [];
    const adminInfo = adminRolesData?.admin || {};
    const overrides = overridesData?.overrides || [];
    const allRoles = allRolesData?.roles || [];
    const enums = enumsData || {};

    // ── Handlers ─────────────────────────────────────────────

    const showSnackbar = useCallback((message, severity = 'success') => {
        setSnackbar({ open: true, message, severity });
    }, []);
    const handleCloseSnackbar = useCallback(() => {
        setSnackbar((prev) => ({ ...prev, open: false }));
    }, []);

    // Navigation
    const handleViewDetail = useCallback((admin) => {
        navigate(`/dashboard/admin/sub-admins/${admin.id}`);
    }, [navigate]);

    const handleBackToList = useCallback(() => {
        navigate('/dashboard/admin/sub-admins');
    }, [navigate]);

    // Pagination
    const handleChangePage = useCallback((_, newPage) => setPage(newPage), []);
    const handleChangeRowsPerPage = useCallback((e) => {
        setRowsPerPage(parseInt(e.target.value, 10));
        setPage(0);
    }, []);
    const handleSearchChange = useCallback((e) => {
        setSearch(e.target.value);
        setPage(0);
    }, []);

    // Role assignment
    const handleOpenRoleAssign = useCallback(() => {
        setSelectedRoleToAssign('');
        setOpenRoleAssign(true);
    }, []);

    const handleAssignRole = useCallback(async () => {
        if (!selectedRoleToAssign) return;
        try {
            await assignRole({ adminId, roleId: selectedRoleToAssign }).unwrap();
            setOpenRoleAssign(false);
            showSnackbar('Role assigned');
        } catch (err) {
            showSnackbar(err?.data?.error || 'Failed to assign role', 'error');
        }
    }, [assignRole, adminId, selectedRoleToAssign, showSnackbar]);

    const handleUnassignRole = useCallback(async (roleId) => {
        try {
            await unassignRole({ adminId, roleId }).unwrap();
            showSnackbar('Role unassigned');
        } catch (err) {
            showSnackbar(err?.data?.error || 'Failed to unassign role', 'error');
        }
    }, [unassignRole, adminId, showSnackbar]);

    // Overrides
    const handleOpenCreateOverride = useCallback(() => {
        setOverrideForm(INITIAL_OVERRIDE_FORM);
        setOverrideMode('create');
        setOpenOverrideDialog(true);
    }, []);

    const handleOpenEditOverride = useCallback((override) => {
        setSelectedOverride(override);
        setOverrideForm({
            module: override.module || '',
            resource_id: override.resource_id || '',
            override_type: override.override_type || 'GRANT',
            can_view: override.can_view || false,
            can_create: override.can_create || false,
            can_edit: override.can_edit || false,
            can_delete: override.can_delete || false,
            reason: override.reason || '',
            expires_at: override.expires_at || '',
        });
        setOverrideMode('edit');
        setOpenOverrideDialog(true);
    }, []);

    const handleCloseOverride = useCallback(() => {
        setOpenOverrideDialog(false);
        setSelectedOverride(null);
    }, []);

    const handleOverrideFormChange = useCallback((e) => {
        const { name, value, type, checked } = e.target;
        setOverrideForm((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    }, []);

    const handleSaveOverride = useCallback(async () => {
        const payload = {
            ...overrideForm,
            override_type: overrideForm.override_type.toLowerCase(),
            // Empty string means "module-wide" on the UI but NULL on the
            // backend — the service treats falsy as NULL so we coerce here.
            resource_id: overrideForm.resource_id || null,
        };
        try {
            if (overrideMode === 'create') {
                await createOverride({ adminId, data: payload }).unwrap();
                showSnackbar('Override created');
            } else {
                await updateOverride({
                    adminId,
                    overrideId: selectedOverride.id,
                    data: payload,
                }).unwrap();
                showSnackbar('Override updated');
            }
            handleCloseOverride();
        } catch (err) {
            showSnackbar(err?.data?.error || 'Failed to save override', 'error');
        }
    }, [overrideMode, overrideForm, adminId, selectedOverride, createOverride, updateOverride, handleCloseOverride, showSnackbar]);

    const handleDeactivateOverride = useCallback(async (overrideId) => {
        try {
            await deactivateOverride({ adminId, overrideId }).unwrap();
            showSnackbar('Override deactivated');
        } catch (err) {
            showSnackbar(err?.data?.error || 'Failed to deactivate', 'error');
        }
    }, [deactivateOverride, adminId, showSnackbar]);

    // Quick access revoke/restore
    const handleRevokeAccess = useCallback(async (module) => {
        try {
            await revokeAccess({ adminId, module, reason: 'Admin revoked access' }).unwrap();
            showSnackbar('Access revoked');
        } catch (err) {
            showSnackbar(err?.data?.error || 'Failed to revoke', 'error');
        }
    }, [revokeAccess, adminId, showSnackbar]);

    const handleRestoreAccess = useCallback(async (module) => {
        try {
            await restoreAccess({ adminId, module }).unwrap();
            showSnackbar('Access restored');
        } catch (err) {
            showSnackbar(err?.data?.error || 'Failed to restore', 'error');
        }
    }, [restoreAccess, adminId, showSnackbar]);

    return {
        // Auth
        hasFullAccess,
        can,
        // List data
        subAdmins,
        pagination,
        listLoading,
        listError: listError?.data?.error || null,
        page,
        rowsPerPage,
        search,
        // Detail data
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
        // UI state
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
        // Handlers
        handleViewDetail,
        handleBackToList,
        handleChangePage,
        handleChangeRowsPerPage,
        handleSearchChange,
        handleOpenRoleAssign,
        handleAssignRole,
        handleUnassignRole,
        handleOpenCreateOverride,
        handleOpenEditOverride,
        handleCloseOverride,
        handleOverrideFormChange,
        handleSaveOverride,
        handleDeactivateOverride,
        handleRevokeAccess,
        handleRestoreAccess,
        handleCloseSnackbar,
        showSnackbar,
    };
};

export default useManageSubAdmins;
