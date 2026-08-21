/**
 * Platform (owner) endpoints (RTK Query).
 *
 * PLATFORM_OWNER-only operations: tenant CRUD and per-tenant landing
 * module permission allocation.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const API_BASE = '/api/platform';

const platformEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        listPlatformTenants: builder.query({
            query: () => ({ url: `${API_BASE}/tenants`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = []) => [
                { type: 'PlatformTenant', id: 'LIST' },
                ...result.map((t) => ({ type: 'PlatformTenant', id: t.id })),
            ],
        }),
        createPlatformTenant: builder.mutation({
            query: (data) => ({ url: `${API_BASE}/tenants`, method: 'POST', data }),
            invalidatesTags: [{ type: 'PlatformTenant', id: 'LIST' }],
        }),
        getPlatformTenant: builder.query({
            query: (tenantId) => ({
                url: `${API_BASE}/tenants/${tenantId}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, tenantId) => [
                { type: 'PlatformTenant', id: tenantId },
            ],
        }),
        updatePlatformTenant: builder.mutation({
            query: ({ tenantId, data }) => ({
                url: `${API_BASE}/tenants/${tenantId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlatformTenant', id: arg.tenantId },
                { type: 'PlatformTenant', id: 'LIST' },
            ],
        }),
        listTenantPermissions: builder.query({
            query: (tenantId) => ({
                url: `${API_BASE}/tenants/${tenantId}/permissions`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result, error, tenantId) => [
                { type: 'TenantPermissions', id: tenantId },
            ],
        }),
        upsertTenantPermissions: builder.mutation({
            query: ({ tenantId, allocations }) => ({
                url: `${API_BASE}/tenants/${tenantId}/permissions`,
                method: 'PUT',
                data: { allocations },
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'TenantPermissions', id: arg.tenantId },
            ],
        }),
        createTenantSuperAdmin: builder.mutation({
            // Bootstrap a SUPER_ADMIN inside a specific tenant. Cross-tenant,
            // PLATFORM_OWNER-only.
            query: ({ tenantId, data }) => ({
                url: `${API_BASE}/tenants/${tenantId}/super-admin`,
                method: 'POST',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlatformTenant', id: arg.tenantId },
                { type: 'PlatformTenant', id: 'LIST' },   // refresh counts
                { type: 'TenantAdmins', id: arg.tenantId },
            ],
        }),
        listTenantAdmins: builder.query({
            query: ({ tenantId, role }) => ({
                url: `${API_BASE}/tenants/${tenantId}/admins`,
                method: 'GET',
                params: role ? { role } : undefined,
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result, error, arg) => [
                { type: 'TenantAdmins', id: arg.tenantId },
            ],
        }),
        updateTenantAdminStatus: builder.mutation({
            query: ({ tenantId, userId, status }) => ({
                url: `${API_BASE}/tenants/${tenantId}/admins/${userId}`,
                method: 'PUT',
                data: { status },
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'TenantAdmins', id: arg.tenantId },
            ],
        }),
        deleteTenantAdmin: builder.mutation({
            query: ({ tenantId, userId }) => ({
                url: `${API_BASE}/tenants/${tenantId}/admins/${userId}`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'TenantAdmins', id: arg.tenantId },
                { type: 'PlatformTenant', id: 'LIST' },  // counts may change
            ],
        }),
        setTenantPlan: builder.mutation({
            query: ({ tenantId, plan }) => ({
                url: `${API_BASE}/tenants/${tenantId}/plan`,
                method: 'PUT',
                data: { plan },
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlatformTenant', id: arg.tenantId },
                { type: 'PlatformTenant', id: 'LIST' },
            ],
        }),
        resyncTenantDns: builder.mutation({
            // ``scope`` lets the UI refresh just one record (the slug
            // subdomain or the custom-domain CNAME) without disturbing
            // the other. Defaults to ``all`` for back-compat.
            query: ({ tenantId, scope = 'all' } = {}) => ({
                url: `${API_BASE}/tenants/${tenantId}/dns/resync`,
                method: 'POST',
                data: {},
                params: scope && scope !== 'all' ? { scope } : undefined,
            }),
            invalidatesTags: (_r, _e, arg) => [
                { type: 'PlatformTenant', id: arg?.tenantId },
                { type: 'PlatformTenant', id: 'LIST' },
            ],
        }),
        getTenantDns: builder.query({
            query: (tenantId) => ({
                url: `${API_BASE}/tenants/${tenantId}/dns`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (_r, _e, tenantId) => [
                { type: 'PlatformTenant', id: tenantId },
            ],
        }),
        setTenantDomain: builder.mutation({
            // Issue a TXT-record verification challenge for the tenant's
            // chosen custom domain. Returns the token + ingress target so
            // the UI can show what records to publish at the registrar.
            query: ({ tenantId, domain }) => ({
                url: `${API_BASE}/tenants/${tenantId}/domain`,
                method: 'POST',
                data: { domain },
            }),
            invalidatesTags: (_r, _e, arg) => [
                { type: 'PlatformTenant', id: arg.tenantId },
                { type: 'PlatformTenant', id: 'LIST' },
            ],
        }),
        verifyTenantDomain: builder.mutation({
            query: (tenantId) => ({
                url: `${API_BASE}/tenants/${tenantId}/domain/verify`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: (_r, _e, tenantId) => [
                { type: 'PlatformTenant', id: tenantId },
                { type: 'PlatformTenant', id: 'LIST' },
            ],
        }),
        // Refresh / reset the tenant's Cloudflare Custom Hostname row.
        // Returns ``{provider: 'cloudflare', status, ssl_status,
        // ownership_verification, ssl_validation_records, error,
        // synced_at}``.
        refreshTenantDomain: builder.mutation({
            query: (tenantId) => ({
                url: `${API_BASE}/tenants/${tenantId}/domain/refresh`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: (_r, _e, tenantId) => [
                { type: 'PlatformTenant', id: tenantId },
                { type: 'PlatformTenant', id: 'LIST' },
            ],
        }),
        resetTenantDomain: builder.mutation({
            query: (tenantId) => ({
                url: `${API_BASE}/tenants/${tenantId}/domain/reset`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: (_r, _e, tenantId) => [
                { type: 'PlatformTenant', id: tenantId },
                { type: 'PlatformTenant', id: 'LIST' },
            ],
        }),

        checkTenantDomainCname: builder.mutation({
            // Public DNS probe of the tenant's custom-domain CNAME.
            // Distinct from ``verifyTenantDomain`` which checks the TXT
            // ownership record. Returns ``{ matches, resolved_chain,
            // reason, expected_target }``.
            query: (tenantId) => ({
                url: `${API_BASE}/tenants/${tenantId}/domain/check-cname`,
                method: 'POST',
                data: {},
            }),
            // Probe is read-only — no cache invalidation.
        }),
        clearTenantDomain: builder.mutation({
            query: (tenantId) => ({
                url: `${API_BASE}/tenants/${tenantId}/domain`,
                method: 'DELETE',
            }),
            invalidatesTags: (_r, _e, tenantId) => [
                { type: 'PlatformTenant', id: tenantId },
                { type: 'PlatformTenant', id: 'LIST' },
            ],
        }),
        deleteTenant: builder.mutation({
            // Soft-delete by default. Passing ``hard: true`` is meant for
            // local dev only; production should always soft-delete so
            // historical data stays queryable.
            query: ({ tenantId, hard = false }) => ({
                url: `${API_BASE}/tenants/${tenantId}`,
                method: 'DELETE',
                params: hard ? { hard: 'true' } : undefined,
            }),
            invalidatesTags: () => [{ type: 'PlatformTenant', id: 'LIST' }],
        }),
    }),
});

export const {
    useListPlatformTenantsQuery,
    useCreatePlatformTenantMutation,
    useGetPlatformTenantQuery,
    useUpdatePlatformTenantMutation,
    useListTenantPermissionsQuery,
    useUpsertTenantPermissionsMutation,
    useCreateTenantSuperAdminMutation,
    useListTenantAdminsQuery,
    useUpdateTenantAdminStatusMutation,
    useDeleteTenantAdminMutation,
    useSetTenantPlanMutation,
    useResyncTenantDnsMutation,
    useGetTenantDnsQuery,
    useSetTenantDomainMutation,
    useVerifyTenantDomainMutation,
    useRefreshTenantDomainMutation,
    useResetTenantDomainMutation,
    useCheckTenantDomainCnameMutation,
    useClearTenantDomainMutation,
    useDeleteTenantMutation,
} = platformEndpoints;

export default platformEndpoints;
