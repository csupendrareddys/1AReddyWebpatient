/**
 * Public (unauthenticated) endpoints — pricing catalog + tenant self-serve
 * signup. These hit ``/api/v1/public/*`` on the backend which runs without a
 * JWT requirement. Injected into the shared ``apiSlice`` so RTK Query
 * caching + tag invalidation behave exactly like every other feature.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const PUBLIC_BASE = '/api/v1/public';

const publicEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // Accepts an optional `vertical` arg — becomes both the RTK Query
        // cache key AND the `?vertical=` query string, so switching the
        // doctor/clinic/hospital toggle in PricingSection actually refetches
        // a filtered list instead of always hitting the unfiltered route.
        listPublicPlansCatalog: builder.query({
            query: (vertical) => {
                const qs = vertical ? `?plan_type=${encodeURIComponent(vertical)}` : '';
                return { url: `${PUBLIC_BASE}/plans${qs}`, method: 'GET' };
            },
            transformResponse: (response) => response?.data || [],
            providesTags: (result, error, vertical) => [
                { type: 'Plan', id: `PUBLIC_LIST:${vertical || 'ALL'}` },
            ],
        }),

        listPublicPlanTypes: builder.query({
            // Optional ``category`` (SaaS category code) scopes the types to
            // one industry segment's pricing page.
            query: (category) => {
                const qs = category ? `?category=${encodeURIComponent(category)}` : '';
                return { url: `${PUBLIC_BASE}/plan-types${qs}`, method: 'GET' };
            },
            transformResponse: (response) => response?.data || [],
            providesTags: (result, error, category) => [
                { type: 'PlanType', id: `PUBLIC_LIST:${category || 'ALL'}` },
            ],
        }),

        // Industry segments for the vendor pricing site — each row carries
        // its page's hero copy; the default one renders at bare /pricing.
        listPublicSaasCategories: builder.query({
            query: () => ({ url: `${PUBLIC_BASE}/saas-categories`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'SaasCategory', id: 'PUBLIC_LIST' }],
        }),

        // The marketplace verticals — ``{code, name, description, icon_key,
        // is_receiver}``, the same shape as ``plan-types`` above. This is the
        // source of truth for WHICH funnels exist: the /register tiles are
        // built from it, ``is_receiver`` picks /join_receiver vs /join, and
        // both of those pages build their tab rows from it. Pair it with
        // ``listPublicMembershipPlansCatalog(code)`` for a vertical's plans.
        //
        // Distinct from ``plan-types``, which classifies the SaaS-subdomain
        // catalog at /pricing and has nothing to do with the marketplace.
        listPublicVerticalTypes: builder.query({
            query: () => ({ url: `${PUBLIC_BASE}/vertical-plan-types`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'VerticalType', id: 'PUBLIC_LIST' }],
        }),

        listPublicAddonsCatalog: builder.query({
            query: () => ({ url: `${PUBLIC_BASE}/addons`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'Addon', id: 'PUBLIC_LIST' }],
        }),

        // Marketplace (apex) membership catalog — feeds the public
        // pricing grid on ``larazen.in``. Distinct from the SaaS
        // ``listPublicPlansCatalog`` above (those are tenant-subdomain
        // plans). Backend returns ``{ plans: [...] }``, so the
        // transform unwraps to the plain array.
        listPublicMembershipPlansCatalog: builder.query({
            query: (vertical) => {
                const qs = vertical ? `?vertical=${encodeURIComponent(vertical)}` : '';
                return {
                    url: `${PUBLIC_BASE}/membership-plans${qs}`,
                    method: 'GET',
                };
            },
            transformResponse: (response) => response?.data?.plans || [],
            providesTags: [{ type: 'MembershipPlan', id: 'PUBLIC_LIST' }],
        }),

        // Single-plan fetch by code. Used by the doctor signup page's
        // "You're signing up for …" banner so we don't have to fetch
        // the whole 9-tier catalog just to render one card header.
        // Returns 404 from the backend when the plan is missing or
        // not ACTIVE — RTK Query surfaces that via ``error``.
        getPublicMembershipPlanByCode: builder.query({
            query: (code) => ({
                url: `${PUBLIC_BASE}/membership-plans/${encodeURIComponent(code)}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || null,
            providesTags: (result, error, code) => [
                { type: 'MembershipPlan', id: `PUBLIC:${code}` },
            ],
        }),

        // Tenant-scoped provider plans for the in-tenant signup picker.
        // On the apex (larazen.in) returns an empty list — apex plans
        // are served by listPublicMembershipPlansCatalog instead.
        // On a subscriber subdomain (e.g. jlmush.in) returns whatever
        // the tenant super-admin authored under
        // /dashboard/admin/provider-plans.
        listPublicTenantProviderPlans: builder.query({
            query: (vertical) => ({
                url: `/api/v1/tenant-provider-plans/public/${encodeURIComponent(vertical)}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || { plans: [], selection_required: false },
            providesTags: (_result, _error, vertical) => [
                { type: 'TenantProviderPlan', id: `PUBLIC:${vertical}` },
            ],
        }),

        // Does THIS host sell SaaS tenancies? ``{sells_tenancies, seller}``
        // with seller 'vendor' | 'reseller' | null. Anonymous — drives the
        // SellerOnlyRoute guard and the public nav before anyone logs in.
        getPublicSellingStatus: builder.query({
            query: () => ({ url: `${PUBLIC_BASE}/selling-status`, method: 'GET' }),
            transformResponse: (response) => response?.data || null,
        }),

        signupTenant: builder.mutation({
            query: (data) => ({
                url: `${PUBLIC_BASE}/signup/tenant`,
                method: 'POST',
                data,
            }),
            // Fresh signup installs the user's auth cookies server-side.
            // Invalidate the MyPlan tag so the first ``/me`` read hits the
            // new subscription, not any cached state from a prior session.
            invalidatesTags: ['MyPlan'],
        }),
    }),
});

export const {
    useListPublicPlansCatalogQuery,
    useListPublicPlanTypesQuery,
    useListPublicSaasCategoriesQuery,
    useListPublicVerticalTypesQuery,
    useListPublicAddonsCatalogQuery,
    useListPublicMembershipPlansCatalogQuery,
    useGetPublicMembershipPlanByCodeQuery,
    useListPublicTenantProviderPlansQuery,
    useGetPublicSellingStatusQuery,
    useSignupTenantMutation,
} = publicEndpoints;