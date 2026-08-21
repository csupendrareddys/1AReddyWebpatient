/**
 * Provider-staff RBAC RTK-Query endpoints.
 * Base: /api/admin/provider-rbac.
 *
 * Backs Operations → Manage Roles & Permissions for the three provider
 * verticals (doctor | clinic | hospital). Patient and Admin have no staff
 * entity, so they have no endpoints here and stay preview-only — see
 * ``RolesPermissions``.
 *
 * The module tree is fetched, not bundled. It used to live in a frontend
 * constant; the backend owns it now (``module_catalog.py``), so adding a
 * screen to the matrix no longer needs a frontend deploy, and the keys the
 * client saves are by construction the keys the server validates against.
 */
import { apiSlice } from '../../../../../app/api/apiSlice';

const BASE = '/api/admin/provider-rbac';

export const providerRbacEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ── The module tree + column/data-range vocabulary for a vertical ──
        // Cached per vertical and reused across every role in it, which is why
        // the catalog isn't bundled into the per-role permissions response.
        getProviderModules: builder.query({
            query: (providerType) => ({ url: `${BASE}/${providerType}/modules`, method: 'GET' }),
            transformResponse: (res) => res.data || {},
            providesTags: (r, e, providerType) => [
                { type: 'ProviderModules', id: providerType },
            ],
        }),

        // ── Roles ──────────────────────────────────────────────────────────
        getProviderRoles: builder.query({
            query: (providerType) => ({ url: `${BASE}/${providerType}/roles`, method: 'GET' }),
            transformResponse: (res) => res.data?.roles || [],
            providesTags: (r, e, providerType) => [
                { type: 'ProviderRole', id: `LIST-${providerType}` },
            ],
        }),
        createProviderRole: builder.mutation({
            query: ({ providerType, ...body }) => ({
                url: `${BASE}/${providerType}/roles`, method: 'POST', data: body,
            }),
            invalidatesTags: (r, e, { providerType }) => [
                { type: 'ProviderRole', id: `LIST-${providerType}` },
            ],
        }),
        updateProviderRole: builder.mutation({
            query: ({ roleId, ...body }) => ({
                url: `${BASE}/roles/${roleId}`, method: 'PUT', data: body,
            }),
            invalidatesTags: (r, e, { providerType }) => [
                { type: 'ProviderRole', id: `LIST-${providerType}` },
            ],
        }),
        deleteProviderRole: builder.mutation({
            query: ({ roleId }) => ({ url: `${BASE}/roles/${roleId}`, method: 'DELETE' }),
            invalidatesTags: (r, e, { providerType }) => [
                { type: 'ProviderRole', id: `LIST-${providerType}` },
            ],
        }),

        // ── The matrix ─────────────────────────────────────────────────────
        getProviderRolePermissions: builder.query({
            query: (roleId) => ({ url: `${BASE}/roles/${roleId}/permissions`, method: 'GET' }),
            transformResponse: (res) => res.data?.permissions || [],
            providesTags: (r, e, roleId) => [{ type: 'ProviderRolePerms', id: roleId }],
        }),
        saveProviderRolePermissions: builder.mutation({
            query: ({ roleId, permissions }) => ({
                url: `${BASE}/roles/${roleId}/permissions`, method: 'PUT',
                data: { permissions },
            }),
            // The role list carries a granted-module count, so it goes stale
            // on every save too.
            invalidatesTags: (r, e, { roleId, providerType }) => [
                { type: 'ProviderRolePerms', id: roleId },
                { type: 'ProviderRole', id: `LIST-${providerType}` },
            ],
        }),

        // ── Staff ──────────────────────────────────────────────────────────
        getProviderStaff: builder.query({
            query: ({ providerType, ...params }) => {
                const qs = new URLSearchParams(
                    Object.fromEntries(Object.entries(params).filter(
                        ([, v]) => v !== undefined && v !== null && v !== '',
                    )),
                ).toString();
                return {
                    url: `${BASE}/${providerType}/staff${qs ? `?${qs}` : ''}`,
                    method: 'GET',
                };
            },
            transformResponse: (res) => ({
                staff: res.data?.staff || [],
                pagination: res.data?.pagination || {},
            }),
            providesTags: (r, e, { providerType }) => [
                { type: 'ProviderStaff', id: `LIST-${providerType}` },
            ],
        }),
        createProviderStaff: builder.mutation({
            query: ({ providerType, ...body }) => ({
                url: `${BASE}/${providerType}/staff`, method: 'POST', data: body,
            }),
            invalidatesTags: (r, e, { providerType }) => [
                { type: 'ProviderStaff', id: `LIST-${providerType}` },
                { type: 'ProviderRole', id: `LIST-${providerType}` },
            ],
        }),
        updateProviderStaff: builder.mutation({
            query: ({ staffId, ...body }) => ({
                url: `${BASE}/staff/${staffId}`, method: 'PUT', data: body,
            }),
            invalidatesTags: (r, e, { providerType }) => [
                { type: 'ProviderStaff', id: `LIST-${providerType}` },
            ],
        }),
        deleteProviderStaff: builder.mutation({
            query: ({ staffId }) => ({ url: `${BASE}/staff/${staffId}`, method: 'DELETE' }),
            invalidatesTags: (r, e, { providerType }) => [
                { type: 'ProviderStaff', id: `LIST-${providerType}` },
                { type: 'ProviderRole', id: `LIST-${providerType}` },
            ],
        }),
        // Re-anchor a staff member to a different practice. ``fromProviderType``
        // is not sent — it is only here so the cache knows which OTHER roster
        // just changed: the row leaves one vertical's list and joins another's,
        // and only the caller knows where it was standing before. Passing the
        // same value twice is harmless, so callers needn't special-case a move
        // within one vertical.
        linkProviderStaff: builder.mutation({
            query: ({ staffId, providerType, providerId }) => ({
                url: `${BASE}/staff/${staffId}/provider`, method: 'PUT',
                data: { provider_type: providerType, provider_id: providerId },
            }),
            invalidatesTags: (r, e, { providerType, fromProviderType }) => [
                { type: 'ProviderStaff', id: `LIST-${providerType}` },
                { type: 'ProviderStaff', id: `LIST-${fromProviderType || providerType}` },
                // Role lists carry a staff_count, and a cross-vertical move
                // drops the roles held in the old one — both counts move.
                { type: 'ProviderRole', id: `LIST-${providerType}` },
                { type: 'ProviderRole', id: `LIST-${fromProviderType || providerType}` },
            ],
        }),
        setProviderStaffRoles: builder.mutation({
            query: ({ staffId, roleIds }) => ({
                url: `${BASE}/staff/${staffId}/roles`, method: 'PUT',
                data: { role_ids: roleIds },
            }),
            invalidatesTags: (r, e, { providerType }) => [
                { type: 'ProviderStaff', id: `LIST-${providerType}` },
                { type: 'ProviderRole', id: `LIST-${providerType}` },
            ],
        }),

        // ── My Link relationship tiers ───────────────────────────────────
        // One matrix for the tenant, not per vertical: a relationship is
        // between a doctor and a facility, so there is nothing to key it by.
        getLinkRelationshipPolicy: builder.query({
            query: () => ({ url: `${BASE}/link-relationships`, method: 'GET' }),
            transformResponse: (res) => res.data || res,
            providesTags: [{ type: 'ProviderRole', id: 'LINK-POLICY' }],
        }),
        saveLinkRelationshipPolicy: builder.mutation({
            query: (relationships) => ({
                url: `${BASE}/link-relationships`, method: 'PUT',
                data: { relationships },
            }),
            invalidatesTags: [{ type: 'ProviderRole', id: 'LINK-POLICY' }],
        }),
    }),
});

export const {
    useGetLinkRelationshipPolicyQuery,
    useSaveLinkRelationshipPolicyMutation,
    useGetProviderModulesQuery,
    useGetProviderRolesQuery,
    useCreateProviderRoleMutation,
    useUpdateProviderRoleMutation,
    useDeleteProviderRoleMutation,
    useGetProviderRolePermissionsQuery,
    useSaveProviderRolePermissionsMutation,
    useGetProviderStaffQuery,
    useCreateProviderStaffMutation,
    useUpdateProviderStaffMutation,
    useDeleteProviderStaffMutation,
    useLinkProviderStaffMutation,
    useSetProviderStaffRolesMutation,
} = providerRbacEndpoints;
