/**
 * Pricing / Plans endpoints (RTK Query).
 *
 * Tenant-facing reads under ``/api/pricing``; PLATFORM_OWNER plan + add-on
 * catalog + tenant-subscription writes under ``/api/platform``.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const PRICING_BASE = '/api/pricing';
const PLATFORM_BASE = '/api/platform';

const pricingEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ─── Tenant-facing ─────────────────────────────────────────────
        getMyPlan: builder.query({
            query: (debug) => ({
                url: `${PRICING_BASE}/me${debug ? '?debug=1' : ''}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: ['MyPlan'],
        }),
        listPublicPlans: builder.query({
            query: () => ({ url: `${PRICING_BASE}/plans`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'Plan', id: 'LIST' }],
        }),
        listPublicAddons: builder.query({
            query: () => ({ url: `${PRICING_BASE}/addons`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'Addon', id: 'LIST' }],
        }),

        // ─── Platform-owner catalog ────────────────────────────────────
        // Authoritative list of dotted feature paths the structured
        // FeatureTreeEditor renders. Mirrors backend
        // ALLOWED_FEATURE_PATHS so a new path added in code shows
        // up in the dialog without a frontend change.
        getFeaturePaths: builder.query({
            query: () => ({
                url: `${PLATFORM_BASE}/feature-paths`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            // Catalog data — long-lived; tag for manual invalidation
            // when an admin edits the backend whitelist.
            providesTags: [{ type: 'FeaturePaths', id: 'LIST' }],
        }),
        listPlans: builder.query({
            query: () => ({ url: `${PLATFORM_BASE}/plans`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = []) => [
                { type: 'Plan', id: 'LIST' },
                ...result.map((p) => ({ type: 'Plan', id: p.code })),
            ],
        }),
        getPlan: builder.query({
            query: (code) => ({
                url: `${PLATFORM_BASE}/plans/${code}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, code) => [{ type: 'Plan', id: code }],
        }),
        createPlan: builder.mutation({
            query: (data) => ({
                url: `${PLATFORM_BASE}/plans`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [{ type: 'Plan', id: 'LIST' }],
        }),
        updatePlan: builder.mutation({
            query: ({ code, data }) => ({
                url: `${PLATFORM_BASE}/plans/${code}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'Plan', id: 'LIST' },
                { type: 'Plan', id: arg.code },
            ],
        }),
        archivePlan: builder.mutation({
            query: (code) => ({
                url: `${PLATFORM_BASE}/plans/${code}`,
                method: 'DELETE',
            }),
            invalidatesTags: [{ type: 'Plan', id: 'LIST' }],
        }),
        listPlanTypes: builder.query({
            query: () => ({ url: `${PLATFORM_BASE}/plan-types`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = []) => [
                { type: 'PlanType', id: 'LIST' },
                ...result.map((pt) => ({ type: 'PlanType', id: pt.id })),
            ],
        }),
        createPlanType: builder.mutation({
            query: (data) => ({
                url: `${PLATFORM_BASE}/plan-types`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [{ type: 'PlanType', id: 'LIST' }],
        }),
        updatePlanType: builder.mutation({
            query: ({ id, data }) => ({
                url: `${PLATFORM_BASE}/plan-types/${id}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlanType', id: 'LIST' },
                { type: 'PlanType', id: arg.id },
            ],
        }),
        deletePlanType: builder.mutation({
            query: (id) => ({
                url: `${PLATFORM_BASE}/plan-types/${id}`,
                method: 'DELETE',
            }),
            invalidatesTags: [{ type: 'PlanType', id: 'LIST' }],
        }),

        listAddons: builder.query({
            query: () => ({ url: `${PLATFORM_BASE}/addons`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'Addon', id: 'LIST' }],
        }),
        createAddon: builder.mutation({
            query: (data) => ({
                url: `${PLATFORM_BASE}/addons`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [{ type: 'Addon', id: 'LIST' }],
        }),
        updateAddon: builder.mutation({
            query: ({ code, data }) => ({
                url: `${PLATFORM_BASE}/addons/${code}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [{ type: 'Addon', id: 'LIST' }],
        }),
        archiveAddon: builder.mutation({
            query: (code) => ({
                url: `${PLATFORM_BASE}/addons/${code}`,
                method: 'DELETE',
            }),
            invalidatesTags: [{ type: 'Addon', id: 'LIST' }],
        }),

        // ─── Platform-owner: cross-tenant subscription roster ──────────
        // "Who is on plan type X?" — the inverse of the per-tenant reads
        // below. Powers SaasSubscriptionsAdmin; writes go through
        // ``assignTenantSubscription`` so there's one change-plan path.
        listAllTenantSubscriptions: builder.query({
            query: ({ planType, status } = {}) => ({
                url: `${PLATFORM_BASE}/subscriptions`,
                method: 'GET',
                params: {
                    ...(planType ? { plan_type: planType } : {}),
                    ...(status ? { status } : {}),
                },
            }),
            transformResponse: (response) => response?.data?.subscriptions || [],
            providesTags: (result = []) => [
                { type: 'TenantSubscription', id: 'LIST' },
                ...result.map((s) => (
                    { type: 'TenantSubscription', id: s.tenant_id }
                )),
            ],
        }),

        // ─── Platform-owner: per-tenant subscription ───────────────────
        getTenantSubscription: builder.query({
            query: (tenantId) => ({
                url: `${PLATFORM_BASE}/tenants/${tenantId}/subscription`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, tenantId) => [
                { type: 'TenantSubscription', id: tenantId },
            ],
        }),
        assignTenantSubscription: builder.mutation({
            query: ({ tenantId, data }) => ({
                url: `${PLATFORM_BASE}/tenants/${tenantId}/subscription`,
                method: 'POST',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'TenantSubscription', id: arg.tenantId },
                { type: 'TenantSubscription', id: 'LIST' },
                'MyPlan',
            ],
        }),
        updateTenantSubscription: builder.mutation({
            query: ({ tenantId, data }) => ({
                url: `${PLATFORM_BASE}/tenants/${tenantId}/subscription`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'TenantSubscription', id: arg.tenantId },
                'MyPlan',
            ],
        }),
        listTenantAddons: builder.query({
            query: (tenantId) => ({
                url: `${PLATFORM_BASE}/tenants/${tenantId}/addons`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result, error, tenantId) => [
                { type: 'TenantAddons', id: tenantId },
            ],
        }),
        attachTenantAddon: builder.mutation({
            query: ({ tenantId, data }) => ({
                url: `${PLATFORM_BASE}/tenants/${tenantId}/addons`,
                method: 'POST',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'TenantAddons', id: arg.tenantId },
                'MyPlan',
            ],
        }),
        detachTenantAddon: builder.mutation({
            query: ({ tenantId, code }) => ({
                url: `${PLATFORM_BASE}/tenants/${tenantId}/addons/${code}`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'TenantAddons', id: arg.tenantId },
                'MyPlan',
            ],
        }),
    }),
});

export const {
    useGetMyPlanQuery,
    useListPublicPlansQuery,
    useListPublicAddonsQuery,
    useGetFeaturePathsQuery,
    useListPlansQuery,
    useGetPlanQuery,
    useCreatePlanMutation,
    useUpdatePlanMutation,
    useArchivePlanMutation,
    useListPlanTypesQuery,
    useCreatePlanTypeMutation,
    useUpdatePlanTypeMutation,
    useDeletePlanTypeMutation,
    useListAddonsQuery,
    useCreateAddonMutation,
    useUpdateAddonMutation,
    useArchiveAddonMutation,
    useListAllTenantSubscriptionsQuery,
    useGetTenantSubscriptionQuery,
    useAssignTenantSubscriptionMutation,
    useUpdateTenantSubscriptionMutation,
    useListTenantAddonsQuery,
    useAttachTenantAddonMutation,
    useDetachTenantAddonMutation,
} = pricingEndpoints;