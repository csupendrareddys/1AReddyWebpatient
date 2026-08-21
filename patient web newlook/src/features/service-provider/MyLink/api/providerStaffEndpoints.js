/**
 * Provider self-service staff endpoints.
 * Base: /api/provider-staff.
 *
 * The provider's own view of the same rows Operations administers. Every
 * route resolves the practice from the signed-in user, so nothing here takes
 * a provider id — there is no scope to get wrong from this side.
 *
 * Roles come in two tiers and the split runs through every route below. A
 * SHARED role (``is_shared``) is the tenant admin's, curated per vertical under
 * Operations → Manage Roles & Permissions: readable here, assignable here, and
 * rejected by the server on write. A role this practice authored is its own to
 * rename, deactivate, delete and re-grant. The mutations don't try to tell the
 * two apart — the server owns that call, and duplicating the rule here would
 * only mean two places to get it wrong.
 */
import { apiSlice } from '../../../../app/api/apiSlice';

const BASE = '/api/provider-staff';

export const providerStaffEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ``include_inactive`` separates the two callers: the assignment picker
        // wants only roles that can be given out, the role editor has to keep
        // showing a role the practice switched off or there'd be no way back on.
        getMyStaffRoles: builder.query({
            query: ({ includeInactive } = {}) => ({
                url: `${BASE}/roles${includeInactive ? '?include_inactive=1' : ''}`,
                method: 'GET',
            }),
            transformResponse: (res) => res.data?.roles || [],
            providesTags: ['MyStaffRoles'],
        }),
        createMyStaffRole: builder.mutation({
            query: (body) => ({ url: `${BASE}/roles`, method: 'POST', data: body }),
            invalidatesTags: ['MyStaffRoles'],
        }),
        updateMyStaffRole: builder.mutation({
            query: ({ roleId, ...body }) => ({
                url: `${BASE}/roles/${roleId}`, method: 'PUT', data: body,
            }),
            invalidatesTags: ['MyStaffRoles'],
        }),
        deleteMyStaffRole: builder.mutation({
            query: (roleId) => ({ url: `${BASE}/roles/${roleId}`, method: 'DELETE' }),
            invalidatesTags: ['MyStaffRoles'],
        }),

        // The module tree plus the column and data-range vocabulary drawn over
        // it. One catalog for every role, so it's fetched once and cached
        // rather than bundled into each role's permissions response.
        getMyStaffModules: builder.query({
            query: () => ({ url: `${BASE}/modules`, method: 'GET' }),
            transformResponse: (res) => res.data || {},
            providesTags: ['MyStaffModules'],
        }),
        // Readable for shared roles too — a provider deciding whether to assign
        // one needs to see what it actually grants, not just its name.
        getMyStaffRolePermissions: builder.query({
            query: (roleId) => ({ url: `${BASE}/roles/${roleId}/permissions`, method: 'GET' }),
            transformResponse: (res) => res.data?.permissions || [],
            providesTags: (r, e, roleId) => [{ type: 'MyStaffRolePerms', id: roleId }],
        }),
        saveMyStaffRolePermissions: builder.mutation({
            query: ({ roleId, permissions }) => ({
                url: `${BASE}/roles/${roleId}/permissions`, method: 'PUT',
                data: { permissions },
            }),
            // The role list carries a granted-module count, so it goes stale on
            // every save too.
            invalidatesTags: (r, e, { roleId }) => [
                { type: 'MyStaffRolePerms', id: roleId },
                'MyStaffRoles',
            ],
        }),

        getMyStaff: builder.query({
            query: (params = {}) => {
                const qs = new URLSearchParams(
                    Object.fromEntries(Object.entries(params).filter(
                        ([, v]) => v !== undefined && v !== null && v !== '',
                    )),
                ).toString();
                return { url: `${BASE}${qs ? `?${qs}` : ''}`, method: 'GET' };
            },
            transformResponse: (res) => res.data?.staff || [],
            providesTags: ['MyStaff'],
        }),
        createMyStaff: builder.mutation({
            query: (body) => ({ url: BASE, method: 'POST', data: body }),
            // The role list carries how many staff hold each role, so anything
            // that adds, removes or re-assigns a person dates it.
            invalidatesTags: ['MyStaff', 'MyStaffRoles'],
        }),
        updateMyStaff: builder.mutation({
            query: ({ staffId, ...body }) => ({
                url: `${BASE}/${staffId}`, method: 'PUT', data: body,
            }),
            invalidatesTags: ['MyStaff'],
        }),
        deleteMyStaff: builder.mutation({
            query: (staffId) => ({ url: `${BASE}/${staffId}`, method: 'DELETE' }),
            invalidatesTags: ['MyStaff', 'MyStaffRoles'],
        }),
        setMyStaffRoles: builder.mutation({
            query: ({ staffId, roleIds }) => ({
                url: `${BASE}/${staffId}/roles`, method: 'PUT',
                data: { role_ids: roleIds },
            }),
            invalidatesTags: ['MyStaff', 'MyStaffRoles'],
        }),
        // Which of the practice's BRANCH clinics this staff member may act on —
        // the granular "which branches" dimension (clinic only). Their role's
        // modules still decide WHAT they may do; this decides WHERE.
        getMyStaffBranches: builder.query({
            query: (staffId) => ({ url: `${BASE}/${staffId}/branches`, method: 'GET' }),
            transformResponse: (res) => res.data?.branch_ids || [],
            providesTags: (r, e, staffId) => [{ type: 'MyStaff', id: `branches-${staffId}` }],
        }),
        setMyStaffBranches: builder.mutation({
            query: ({ staffId, branchIds }) => ({
                url: `${BASE}/${staffId}/branches`, method: 'PUT',
                data: { branch_ids: branchIds },
            }),
            invalidatesTags: (r, e, { staffId }) => [
                'MyStaff', { type: 'MyStaff', id: `branches-${staffId}` },
            ],
        }),
        // What a staff member's roles add up to — the provider's answer to
        // "what did I just give them?", which a role name alone doesn't give.
        getMyStaffPermissions: builder.query({
            query: (staffId) => ({ url: `${BASE}/${staffId}/permissions`, method: 'GET' }),
            transformResponse: (res) => res.data || {},
        }),
    }),
});

export const {
    useGetMyStaffRolesQuery,
    useCreateMyStaffRoleMutation,
    useUpdateMyStaffRoleMutation,
    useDeleteMyStaffRoleMutation,
    useGetMyStaffModulesQuery,
    useGetMyStaffRolePermissionsQuery,
    useSaveMyStaffRolePermissionsMutation,
    useGetMyStaffQuery,
    useCreateMyStaffMutation,
    useUpdateMyStaffMutation,
    useDeleteMyStaffMutation,
    useSetMyStaffRolesMutation,
    useGetMyStaffBranchesQuery,
    useSetMyStaffBranchesMutation,
    useLazyGetMyStaffPermissionsQuery,
} = providerStaffEndpoints;
