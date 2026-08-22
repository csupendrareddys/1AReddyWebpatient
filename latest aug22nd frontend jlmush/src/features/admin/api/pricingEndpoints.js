/**
 * Pricing / Plans endpoints (RTK Query).
 *
 * Tenant-facing reads under ``/api/v1/pricing``; PLATFORM_OWNER plan + add-on
 * catalog + tenant-subscription writes under ``/api/v1/platform``.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const PRICING_BASE = '/api/v1/pricing';
const PLATFORM_BASE = '/api/v1/platform';
// The plan-authoring endpoints serve TWO surfaces with one implementation:
// the vendor console ('platform', default - existing callers unchanged)
// and the apex reseller console ('reseller' -> /api/v1/admin/reseller).
// Tags are scope-keyed so the two catalogs never cross-invalidate.
const SCOPE_BASES = {
    platform: PLATFORM_BASE,
    reseller: '/api/v1/admin/reseller',
};
const scopeBase = (scope) => SCOPE_BASES[scope] || PLATFORM_BASE;

const pricingEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ─── Apex storefront presentation settings ────────────────────
        // Label knobs only — hiding the nav entry never closes the
        // storefront routes and never touches child tenants.
        getResellerStorefront: builder.query({
            query: () => ({
                url: `${SCOPE_BASES.reseller}/storefront`, method: 'GET',
            }),
            transformResponse: (response) => response?.data || {},
            providesTags: [{ type: 'Plan', id: 'STOREFRONT' }],
        }),
        updateResellerStorefront: builder.mutation({
            query: (body) => ({
                url: `${SCOPE_BASES.reseller}/storefront`, method: 'PUT', body,
            }),
            invalidatesTags: [{ type: 'Plan', id: 'STOREFRONT' }],
        }),

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
            query: (scope) => ({
                url: `${scopeBase(scope)}/feature-paths`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            // Catalog data — long-lived; tag for manual invalidation
            // when an admin edits the backend whitelist.
            providesTags: (r, e, scope) => [
                { type: 'FeaturePaths', id: `${scope || 'platform'}:LIST` },
            ],
        }),
        listPlans: builder.query({
            // arg: scope string ('platform' default | 'reseller')
            query: (scope) => ({
                url: `${scopeBase(scope)}/plans`, method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = [], e, scope) => [
                { type: 'Plan', id: `${scope || 'platform'}:LIST` },
                ...result.map((p) => (
                    { type: 'Plan', id: `${scope || 'platform'}:${p.code}` })),
            ],
        }),
        getPlan: builder.query({
            // arg: code string (platform) OR {code, scope}
            query: (arg) => {
                const norm = typeof arg === 'string'
                    ? { code: arg, scope: 'platform' } : arg;
                return {
                    url: `${scopeBase(norm.scope)}/plans/${norm.code}`,
                    method: 'GET',
                };
            },
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, arg) => {
                const norm = typeof arg === 'string'
                    ? { code: arg, scope: 'platform' } : arg;
                return [{
                    type: 'Plan',
                    id: `${norm.scope || 'platform'}:${norm.code}`,
                }];
            },
        }),
        createPlan: builder.mutation({
            // arg: data object (platform) OR {data, scope}
            query: (arg) => {
                const norm = arg && arg.data
                    ? arg : { data: arg, scope: 'platform' };
                return {
                    url: `${scopeBase(norm.scope)}/plans`,
                    method: 'POST',
                    data: norm.data,
                };
            },
            invalidatesTags: (r, e, arg) => {
                const scope = arg && arg.data
                    ? (arg.scope || 'platform') : 'platform';
                return [{ type: 'Plan', id: `${scope}:LIST` }];
            },
        }),
        updatePlan: builder.mutation({
            query: ({ code, data, scope }) => ({
                url: `${scopeBase(scope)}/plans/${code}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'Plan', id: `${arg.scope || 'platform'}:LIST` },
                { type: 'Plan', id: `${arg.scope || 'platform'}:${arg.code}` },
            ],
        }),
        archivePlan: builder.mutation({
            // arg: code string (platform) OR {code, scope}
            query: (arg) => {
                const norm = typeof arg === 'string'
                    ? { code: arg, scope: 'platform' } : arg;
                return {
                    url: `${scopeBase(norm.scope)}/plans/${norm.code}`,
                    method: 'DELETE',
                };
            },
            invalidatesTags: (r, e, arg) => {
                const scope = typeof arg === 'string'
                    ? 'platform' : (arg.scope || 'platform');
                return [{ type: 'Plan', id: `${scope}:LIST` }];
            },
        }),
        // SaaS categories — the industry segments (healthcare, legal, ...)
        // plan types hang off; each drives one vendor pricing page.
        listSaasCategories: builder.query({
            query: () => ({ url: `${PLATFORM_BASE}/saas-categories`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = []) => [
                { type: 'SaasCategory', id: 'LIST' },
                ...result.map((c) => ({ type: 'SaasCategory', id: c.id })),
            ],
        }),
        createSaasCategory: builder.mutation({
            query: (data) => ({
                url: `${PLATFORM_BASE}/saas-categories`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [{ type: 'SaasCategory', id: 'LIST' }],
        }),
        updateSaasCategory: builder.mutation({
            query: ({ id, data }) => ({
                url: `${PLATFORM_BASE}/saas-categories/${id}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'SaasCategory', id: 'LIST' },
                { type: 'SaasCategory', id: arg.id },
            ],
        }),
        deleteSaasCategory: builder.mutation({
            query: (id) => ({
                url: `${PLATFORM_BASE}/saas-categories/${id}`,
                method: 'DELETE',
            }),
            invalidatesTags: [{ type: 'SaasCategory', id: 'LIST' }],
        }),

        listPlanTypes: builder.query({
            // arg: scope string — reseller gets the read-only mirror.
            query: (scope) => ({
                url: `${scopeBase(scope)}/plan-types`, method: 'GET',
            }),
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
        // Seller-side twin of getMyPlan: what tenantId ACTUALLY resolves
        // to right now (snapshot < add-ons < overrides), with sources,
        // live seat counts, and is_apex. Tagged with both the tenant's
        // subscription and add-ons so plan changes and attach/detach
        // refresh it.
        getTenantEntitlements: builder.query({
            query: (tenantId) => ({
                url: `${PLATFORM_BASE}/tenants/${tenantId}/entitlements`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, tenantId) => [
                { type: 'TenantSubscription', id: tenantId },
                { type: 'TenantAddons', id: tenantId },
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
        // Vendor's manual subscription lifecycle. arg:
        // {tenantId, action: 'extend-trial'|'activate'|'suspend'|'restore',
        //  body?}
        tenantSubscriptionLifecycle: builder.mutation({
            query: ({ tenantId, action, body }) => ({
                url: `${PLATFORM_BASE}/tenants/${tenantId}/subscription/${action}`,
                method: 'POST',
                data: body || {},
            }),
            invalidatesTags: (r, e, { tenantId }) => [
                { type: 'TenantSubscription', id: tenantId },
                { type: 'Tenant', id: 'LIST' },
            ],
        }),

        resyncPlanSubscribers: builder.mutation({
            // Push a plan's CURRENT terms to every existing subscriber —
            // the owner's explicit opt-out of grandfathering for one plan.
            // arg: code string (vendor) or {code, scope: 'reseller'}.
            query: (arg) => {
                const code = typeof arg === 'string' ? arg : arg.code;
                const scope = typeof arg === 'string' ? 'platform' : arg.scope;
                return {
                    url: `${scopeBase(scope)}/plans/${code}/resync-subscribers`,
                    method: 'POST',
                };
            },
            invalidatesTags: [
                { type: 'Plan', id: 'LIST' },
                { type: 'TenantSubscription', id: 'LIST' },
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
    useTenantSubscriptionLifecycleMutation,
    useResyncPlanSubscribersMutation,
    useGetResellerStorefrontQuery,
    useUpdateResellerStorefrontMutation,
    useGetMyPlanQuery,
    useListPublicPlansQuery,
    useListPublicAddonsQuery,
    useGetFeaturePathsQuery,
    useListPlansQuery,
    useGetPlanQuery,
    useCreatePlanMutation,
    useUpdatePlanMutation,
    useArchivePlanMutation,
    useListSaasCategoriesQuery,
    useCreateSaasCategoryMutation,
    useUpdateSaasCategoryMutation,
    useDeleteSaasCategoryMutation,
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
    useGetTenantEntitlementsQuery,
    useAssignTenantSubscriptionMutation,
    useUpdateTenantSubscriptionMutation,
    useListTenantAddonsQuery,
    useAttachTenantAddonMutation,
    useDetachTenantAddonMutation,
} = pricingEndpoints;