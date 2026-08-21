/**
 * RBAC Endpoints (RTK Query)
 * All Role-Based Access Control API integrations.
 * Pattern: matches adminEndpoints.js — injects into the global apiSlice.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const RBAC_URL = '/api/admin/rbac';

const rbacEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({

        // ── My Permissions (current user) ────────────────────────
        getMyPermissions: builder.query({
            query: () => ({ url: `${RBAC_URL}/me/permissions`, method: 'GET' }),
            transformResponse: (response) => response.data || {},
            providesTags: ['MyPermissions'],
        }),

        // ── Enums ────────────────────────────────────────────────
        getRbacEnums: builder.query({
            query: () => ({ url: `${RBAC_URL}/enums`, method: 'GET' }),
            transformResponse: (response) => response.data || {},
        }),

        // ── Roles CRUD ───────────────────────────────────────────
        getRoles: builder.query({
            query: (params = {}) => ({ url: `${RBAC_URL}/roles`, method: 'GET', params }),
            transformResponse: (response) => ({
                roles: response.data?.roles || [],
                pagination: response.data?.pagination || { total: 0 },
            }),
            providesTags: (result) =>
                result
                    ? [
                          ...result.roles.map(({ id }) => ({ type: 'Roles', id })),
                          { type: 'Roles', id: 'LIST' },
                      ]
                    : [{ type: 'Roles', id: 'LIST' }],
        }),

        getRole: builder.query({
            query: (roleId) => ({ url: `${RBAC_URL}/roles/${roleId}`, method: 'GET' }),
            transformResponse: (response) => response.data || {},
            providesTags: (result, error, roleId) => [{ type: 'Roles', id: roleId }],
        }),

        createRole: builder.mutation({
            query: (data) => ({ url: `${RBAC_URL}/roles`, method: 'POST', data }),
            invalidatesTags: [{ type: 'Roles', id: 'LIST' }],
        }),

        updateRole: builder.mutation({
            query: ({ roleId, data }) => ({ url: `${RBAC_URL}/roles/${roleId}`, method: 'PUT', data }),
            invalidatesTags: (result, error, { roleId }) => [
                { type: 'Roles', id: roleId },
                { type: 'Roles', id: 'LIST' },
            ],
        }),

        deleteRole: builder.mutation({
            query: (roleId) => ({ url: `${RBAC_URL}/roles/${roleId}`, method: 'DELETE' }),
            invalidatesTags: [{ type: 'Roles', id: 'LIST' }],
        }),

        cloneRole: builder.mutation({
            query: ({ roleId, name }) => ({
                url: `${RBAC_URL}/roles/${roleId}/clone`,
                method: 'POST',
                data: { name },
            }),
            invalidatesTags: [{ type: 'Roles', id: 'LIST' }],
        }),

        // ── Role Permissions ─────────────────────────────────────
        getRolePermissions: builder.query({
            query: (roleId) => ({ url: `${RBAC_URL}/roles/${roleId}/permissions`, method: 'GET' }),
            transformResponse: (response) => response.data || {},
            providesTags: (result, error, roleId) => [{ type: 'RolePermissions', id: roleId }],
        }),

        bulkSetPermissions: builder.mutation({
            query: ({ roleId, permissions }) => ({
                url: `${RBAC_URL}/roles/${roleId}/permissions`,
                method: 'PUT',
                data: { permissions },
            }),
            invalidatesTags: (result, error, { roleId }) => [
                { type: 'RolePermissions', id: roleId },
                { type: 'Roles', id: roleId },
            ],
        }),

        setSinglePermission: builder.mutation({
            query: ({ roleId, module, data }) => ({
                url: `${RBAC_URL}/roles/${roleId}/permissions/${module}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, { roleId }) => [
                { type: 'RolePermissions', id: roleId },
            ],
        }),

        revokeRolePermission: builder.mutation({
            query: ({ roleId, module, actions }) => ({
                url: `${RBAC_URL}/roles/${roleId}/permissions/${module}/revoke`,
                method: 'POST',
                data: { actions },
            }),
            invalidatesTags: (result, error, { roleId }) => [
                { type: 'RolePermissions', id: roleId },
            ],
        }),

        restoreRolePermission: builder.mutation({
            query: ({ roleId, module, actions }) => ({
                url: `${RBAC_URL}/roles/${roleId}/permissions/${module}/restore`,
                method: 'POST',
                data: { actions },
            }),
            invalidatesTags: (result, error, { roleId }) => [
                { type: 'RolePermissions', id: roleId },
            ],
        }),

        // ── Sub-Admins ───────────────────────────────────────────
        getSubAdmins: builder.query({
            query: (params = {}) => ({ url: `${RBAC_URL}/sub-admins`, method: 'GET', params }),
            transformResponse: (response) => {
                const subAdmins = (response.data?.sub_admins || []).map(admin => ({
                    ...admin,
                    email: admin.user_details?.email || admin.email, // Fallback just in case
                    roles: (admin.rbac_roles || []).map(r => ({
                        ...r,
                        name: r.name || r.role_name || 'Unknown Role' 
                    })),
                    is_active: admin.status === 'active',
                }));
                return {
                    subAdmins,
                    pagination: response.data?.pagination || { total: 0 },
                };
            },
            providesTags: (result) =>
                result
                    ? [
                          ...result.subAdmins.map(({ id }) => ({ type: 'SubAdmins', id })),
                          { type: 'SubAdmins', id: 'LIST' },
                      ]
                    : [{ type: 'SubAdmins', id: 'LIST' }],
        }),

        getAdminRoles: builder.query({
            query: (adminId) => ({ url: `${RBAC_URL}/sub-admins/${adminId}/roles`, method: 'GET' }),
            transformResponse: (response) => response.data || {},
            providesTags: (result, error, adminId) => [{ type: 'SubAdmins', id: adminId }],
        }),

        assignRole: builder.mutation({
            query: ({ adminId, roleId }) => ({
                url: `${RBAC_URL}/sub-admins/${adminId}/roles`,
                method: 'POST',
                data: { role_id: roleId },
            }),
            invalidatesTags: (result, error, { adminId }) => [
                { type: 'SubAdmins', id: adminId },
                { type: 'SubAdmins', id: 'LIST' },
                { type: 'EffectivePermissions', id: adminId },
                'MyPermissions',
            ],
        }),

        unassignRole: builder.mutation({
            query: ({ adminId, roleId }) => ({
                url: `${RBAC_URL}/sub-admins/${adminId}/roles/${roleId}`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, { adminId }) => [
                { type: 'SubAdmins', id: adminId },
                { type: 'SubAdmins', id: 'LIST' },
                { type: 'EffectivePermissions', id: adminId },
                'MyPermissions',
            ],
        }),

        getEffectivePermissions: builder.query({
            query: (adminId) => ({
                url: `${RBAC_URL}/sub-admins/${adminId}/effective-permissions`,
                method: 'GET',
            }),
            transformResponse: (response) => response.data || {},
            providesTags: (result, error, adminId) => [
                { type: 'EffectivePermissions', id: adminId }
            ],
        }),

        revokeSubAdminAccess: builder.mutation({
            query: ({ adminId, module, reason }) => ({
                url: `${RBAC_URL}/sub-admins/${adminId}/revoke`,
                method: 'POST',
                data: { module, reason },
            }),
            invalidatesTags: (result, error, { adminId }) => [
                { type: 'Overrides', id: adminId },
                { type: 'SubAdmins', id: adminId },
                { type: 'EffectivePermissions', id: adminId },
            ],
        }),

        restoreSubAdminAccess: builder.mutation({
            query: ({ adminId, module }) => ({
                url: `${RBAC_URL}/sub-admins/${adminId}/restore`,
                method: 'POST',
                data: { module },
            }),
            invalidatesTags: (result, error, { adminId }) => [
                { type: 'Overrides', id: adminId },
                { type: 'SubAdmins', id: adminId },
                { type: 'EffectivePermissions', id: adminId },
            ],
        }),

        // ── Overrides ────────────────────────────────────────────
        getOverrides: builder.query({
            query: (adminId) => ({ url: `${RBAC_URL}/sub-admins/${adminId}/overrides`, method: 'GET' }),
            transformResponse: (response) => ({
                overrides: response.data?.active || [],
                expired: response.data?.expired || [],
                summary: response.data || {}
            }),
            providesTags: (result, error, adminId) => [{ type: 'Overrides', id: adminId }],
        }),

        createOverride: builder.mutation({
            query: ({ adminId, data }) => ({
                url: `${RBAC_URL}/sub-admins/${adminId}/overrides`,
                method: 'POST',
                data,
            }),
            invalidatesTags: (result, error, { adminId }) => [
                { type: 'Overrides', id: adminId },
                'MyPermissions',
            ],
        }),

        updateOverride: builder.mutation({
            query: ({ adminId, overrideId, data }) => ({
                url: `${RBAC_URL}/sub-admins/${adminId}/overrides/${overrideId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, { adminId }) => [
                { type: 'Overrides', id: adminId },
                'MyPermissions',
            ],
        }),

        deactivateOverride: builder.mutation({
            query: ({ adminId, overrideId }) => ({
                url: `${RBAC_URL}/sub-admins/${adminId}/overrides/${overrideId}`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, { adminId }) => [
                { type: 'Overrides', id: adminId },
                'MyPermissions',
            ],
        }),

        // ── Approvals ────────────────────────────────────────────
        getApprovals: builder.query({
            query: (params = {}) => ({ url: `${RBAC_URL}/approvals`, method: 'GET', params }),
            transformResponse: (response) => ({
                approvals: response.data?.approvals || [],
                pagination: response.data?.pagination || { total: 0 },
            }),
            providesTags: (result) =>
                result
                    ? [
                          ...result.approvals.map(({ id }) => ({ type: 'Approvals', id })),
                          { type: 'Approvals', id: 'LIST' },
                      ]
                    : [{ type: 'Approvals', id: 'LIST' }],
        }),

        getApproval: builder.query({
            query: (requestId) => ({ url: `${RBAC_URL}/approvals/${requestId}`, method: 'GET' }),
            transformResponse: (response) => response.data || {},
            providesTags: (result, error, requestId) => [{ type: 'Approvals', id: requestId }],
        }),

        approveRequest: builder.mutation({
            query: ({ requestId, comments }) => ({
                url: `${RBAC_URL}/approvals/${requestId}/approve`,
                method: 'POST',
                data: { comments },
            }),
            invalidatesTags: (result, error, { requestId }) => [
                { type: 'Approvals', id: requestId },
                { type: 'Approvals', id: 'LIST' },
            ],
        }),

        rejectRequest: builder.mutation({
            query: ({ requestId, comments }) => ({
                url: `${RBAC_URL}/approvals/${requestId}/reject`,
                method: 'POST',
                data: { comments },
            }),
            invalidatesTags: (result, error, { requestId }) => [
                { type: 'Approvals', id: requestId },
                { type: 'Approvals', id: 'LIST' },
            ],
        }),

        cancelRequest: builder.mutation({
            query: ({ requestId, comments }) => ({
                url: `${RBAC_URL}/approvals/${requestId}/cancel`,
                method: 'POST',
                data: { comments },
            }),
            invalidatesTags: (result, error, { requestId }) => [
                { type: 'Approvals', id: requestId },
                { type: 'Approvals', id: 'LIST' },
            ],
        }),

        queryRequest: builder.mutation({
            query: ({ requestId, comments }) => ({
                url: `${RBAC_URL}/approvals/${requestId}/query`,
                method: 'POST',
                data: { comments },
            }),
            invalidatesTags: (result, error, { requestId }) => [
                { type: 'Approvals', id: requestId },
                { type: 'Approvals', id: 'LIST' },
            ],
        }),

        respondToQuery: builder.mutation({
            query: ({ requestId, comments, attachments }) => ({
                url: `${RBAC_URL}/approvals/${requestId}/respond`,
                method: 'POST',
                data: { comments, attachments },
            }),
            invalidatesTags: (result, error, { requestId }) => [
                { type: 'Approvals', id: requestId },
                { type: 'Approvals', id: 'LIST' },
            ],
        }),

        escalateRequest: builder.mutation({
            query: ({ requestId, comments }) => ({
                url: `${RBAC_URL}/approvals/${requestId}/escalate`,
                method: 'POST',
                data: { comments },
            }),
            invalidatesTags: (result, error, { requestId }) => [
                { type: 'Approvals', id: requestId },
                { type: 'Approvals', id: 'LIST' },
            ],
        }),

        // ── Audit Logs ───────────────────────────────────────────
        getAuditLogs: builder.query({
            query: (params = {}) => ({ url: `${RBAC_URL}/audit-logs`, method: 'GET', params }),
            transformResponse: (response) => ({
                auditLogs: response.data?.audit_logs || [],
                pagination: response.data?.pagination || { total: 0 },
            }),
            providesTags: ['AuditLogs'],
        }),

        // ── Seed ─────────────────────────────────────────────────
        seedRoles: builder.mutation({
            query: () => ({ url: `${RBAC_URL}/seed`, method: 'POST' }),
            invalidatesTags: [{ type: 'Roles', id: 'LIST' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    // My permissions
    useGetMyPermissionsQuery,
    // Enums
    useGetRbacEnumsQuery,
    // Roles
    useGetRolesQuery,
    useGetRoleQuery,
    useCreateRoleMutation,
    useUpdateRoleMutation,
    useDeleteRoleMutation,
    useCloneRoleMutation,
    // Role Permissions
    useGetRolePermissionsQuery,
    useBulkSetPermissionsMutation,
    useSetSinglePermissionMutation,
    useRevokeRolePermissionMutation,
    useRestoreRolePermissionMutation,
    // Sub-Admins
    useGetSubAdminsQuery,
    useGetAdminRolesQuery,
    useAssignRoleMutation,
    useUnassignRoleMutation,
    useGetEffectivePermissionsQuery,
    useRevokeSubAdminAccessMutation,
    useRestoreSubAdminAccessMutation,
    // Overrides
    useGetOverridesQuery,
    useCreateOverrideMutation,
    useUpdateOverrideMutation,
    useDeactivateOverrideMutation,
    // Approvals
    useGetApprovalsQuery,
    useGetApprovalQuery,
    useApproveRequestMutation,
    useRejectRequestMutation,
    useCancelRequestMutation,
    useQueryRequestMutation,
    useRespondToQueryMutation,
    useEscalateRequestMutation,
    // Audit
    useGetAuditLogsQuery,
    // Seed
    useSeedRolesMutation,
} = rbacEndpoints;

export default rbacEndpoints;
