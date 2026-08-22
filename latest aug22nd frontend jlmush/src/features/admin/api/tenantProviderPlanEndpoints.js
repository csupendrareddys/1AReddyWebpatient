/**
 * Tenant-scoped provider-plan endpoints (RTK Query).
 *
 * The "in-tenant marketplace" — plans the tenant authors for the doctors
 * / clinics / hospitals registering inside their own subdomain. Distinct
 * from:
 *   * SaaS plans   — platform-owner-authored (``pricingEndpoints.js``).
 *   * Apex marketplace memberships — also platform-owner-authored
 *     (``membershipEndpoints.js``).
 *
 * Three audiences:
 *   * Tenant super-admin CRUD — ``/api/v1/tenant-provider-plans`` (this
 *     file's primary surface).
 *   * Anonymous signup picker — public read at
 *     ``/api/v1/tenant-provider-plans/public/<vertical>``. Used by the
 *     in-tenant doctor/clinic/hospital signup forms.
 *   * Provider's own "what plan am I on?" — ``/api/v1/tenant-provider-plans/me``.
 */
import { apiSlice } from '../../../app/api/apiSlice';


const BASE = '/api/v1/tenant-provider-plans';


const tenantProviderPlanEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ── Tenant super-admin CRUD ────────────────────────────────
        listTenantProviderPlans: builder.query({
            query: (vertical) => ({
                url: BASE,
                method: 'GET',
                params: vertical ? { vertical } : undefined,
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = []) => [
                { type: 'TenantProviderPlan', id: 'LIST' },
                ...result.map((p) => ({ type: 'TenantProviderPlan', id: p.id })),
            ],
        }),
        createTenantProviderPlan: builder.mutation({
            query: (data) => ({
                url: BASE,
                method: 'POST',
                data,
            }),
            invalidatesTags: [
                { type: 'TenantProviderPlan', id: 'LIST' },
                { type: 'TenantProviderPlan', id: 'SIGNUP_LIST' },
            ],
        }),
        updateTenantProviderPlan: builder.mutation({
            query: ({ id, data }) => ({
                url: `${BASE}/${id}`,
                method: 'PATCH',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'TenantProviderPlan', id: 'LIST' },
                { type: 'TenantProviderPlan', id: 'SIGNUP_LIST' },
                { type: 'TenantProviderPlan', id: arg.id },
            ],
        }),
        archiveTenantProviderPlan: builder.mutation({
            query: (id) => ({
                url: `${BASE}/${id}`,
                method: 'DELETE',
            }),
            invalidatesTags: [
                { type: 'TenantProviderPlan', id: 'LIST' },
                { type: 'TenantProviderPlan', id: 'SIGNUP_LIST' },
            ],
        }),

        // ── Anonymous signup picker (no auth required) ─────────────
        listTenantProviderPlansForSignup: builder.query({
            query: (vertical) => ({
                url: `${BASE}/public/${vertical}`,
                method: 'GET',
            }),
            transformResponse: (response) =>
                response?.data || { plans: [], selection_required: false },
            providesTags: () => [
                { type: 'TenantProviderPlan', id: 'SIGNUP_LIST' },
            ],
        }),

        // ── Provider's own subscription view ───────────────────────
        getMyTenantProviderSubscription: builder.query({
            query: () => ({
                url: `${BASE}/me`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || null,
        }),

        // ── Feature-paths whitelist (tenant SUPER_ADMIN auth) ──────
        // Mirrors ``/api/v1/platform/feature-paths`` but accepts tenant
        // super-admin auth so FeatureTreeEditor can be reused inside
        // the tenant-admin Provider Plans dialog without bumping the
        // editor's role gate to PLATFORM_OWNER-only.
        //
        // Accepts an optional ``vertical`` arg (``'doctor' | 'clinic'
        // | 'hospital'``) so the backend can return the vertical-
        // scoped subset — features that govern what a provider INSIDE
        // the tenant can do, NOT tenant-level capabilities (subdomain,
        // landing builder, marketplace listings, can_create_*_plans,
        // payments / communication / i18n config). Omitting the arg
        // falls back to the full platform whitelist for safety with
        // legacy callers.
        getTenantFeaturePaths: builder.query({
            query: (vertical) => ({
                url: vertical
                    ? `${BASE}/feature-paths?vertical=${encodeURIComponent(vertical)}`
                    : `${BASE}/feature-paths`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
        }),

        // ── Round 10 — provider-subscription management ────────────
        // Tenant SUPER_ADMIN reads the roster of in-tenant providers
        // (doctor/clinic/hospital) + their current plan + status, and
        // can change-plan or cancel. All tenant-scoped on the backend
        // via current_tenant_id_strict — caller can never see / write
        // another tenant's rows.
        listTenantProviderSubscriptions: builder.query({
            query: ({ vertical, status } = {}) => ({
                url: '/api/v1/tenant-provider-subscriptions',
                method: 'GET',
                params: {
                    ...(vertical ? { vertical } : {}),
                    ...(status ? { status } : {}),
                },
            }),
            transformResponse: (r) => r?.data?.subscriptions || [],
            providesTags: (result = []) => [
                { type: 'TenantProviderSubscription', id: 'LIST' },
                ...result.map((s) => (
                    { type: 'TenantProviderSubscription', id: s.id }
                )),
            ],
        }),
        changeTenantProviderSubscriptionPlan: builder.mutation({
            query: ({ id, plan_id }) => ({
                url: `/api/v1/tenant-provider-subscriptions/${id}`,
                method: 'PATCH',
                data: { plan_id },
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'TenantProviderSubscription', id: 'LIST' },
                { type: 'TenantProviderSubscription', id: arg.id },
            ],
        }),
        cancelTenantProviderSubscription: builder.mutation({
            query: (id) => ({
                url: `/api/v1/tenant-provider-subscriptions/${id}`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, id) => [
                { type: 'TenantProviderSubscription', id: 'LIST' },
                { type: 'TenantProviderSubscription', id },
            ],
        }),
        activateTenantProviderSubscription: builder.mutation({
            query: (id) => ({
                url: `/api/v1/tenant-provider-subscriptions/${id}/activate`,
                method: 'POST',
            }),
            invalidatesTags: (result, error, id) => [
                { type: 'TenantProviderSubscription', id: 'LIST' },
                { type: 'TenantProviderSubscription', id },
            ],
        }),

        // Providers (Doctor/Clinic/Hospital) in this tenant that
        // don't currently have a live TenantProviderSubscription.
        // Used by the "Subscribe Provider" picker to attach plans
        // retroactively (pre-Round 9 invites + signups without a
        // plan land in this list).
        listUnsubscribedProviders: builder.query({
            query: (vertical) => ({
                url: '/api/v1/tenant-provider-subscriptions/unsubscribed-providers',
                method: 'GET',
                params: { vertical },
            }),
            transformResponse: (r) => r?.data?.providers || [],
            providesTags: (result = [], error, vertical) => [
                { type: 'TenantProviderSubscription',
                  id: `UNSUBSCRIBED:${vertical}` },
            ],
        }),
        createTenantProviderSubscription: builder.mutation({
            query: ({ vertical, provider_id, user_id, plan_id }) => ({
                url: '/api/v1/tenant-provider-subscriptions',
                method: 'POST',
                data: { vertical, provider_id, user_id, plan_id },
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'TenantProviderSubscription', id: 'LIST' },
                { type: 'TenantProviderSubscription',
                  id: `UNSUBSCRIBED:${arg.vertical}` },
            ],
        }),

        // ── Phase A5 — doctor self-requests a plan; admin approves ──
        // Doctor picks an active plan; the live plan is unchanged until a
        // super/sub-admin approves the request.
        requestMyTenantPlan: builder.mutation({
            query: (plan_id) => ({
                url: `${BASE}/me/request`,
                method: 'POST',
                data: { plan_id },
            }),
            // The doctor's own /me query has no tag; the component refetches it
            // on success. Also nudge the admin roster so the request shows up.
            invalidatesTags: [{ type: 'TenantProviderSubscription', id: 'LIST' }],
        }),
        approveTenantProviderSubscriptionRequest: builder.mutation({
            query: (id) => ({
                url: `/api/v1/tenant-provider-subscriptions/${id}/approve-request`,
                method: 'POST',
            }),
            invalidatesTags: (result, error, id) => [
                { type: 'TenantProviderSubscription', id: 'LIST' },
                { type: 'TenantProviderSubscription', id },
            ],
        }),
    }),
});


export const {
    useListTenantProviderPlansQuery,
    useCreateTenantProviderPlanMutation,
    useUpdateTenantProviderPlanMutation,
    useArchiveTenantProviderPlanMutation,
    useListTenantProviderPlansForSignupQuery,
    useGetMyTenantProviderSubscriptionQuery,
    useGetTenantFeaturePathsQuery,
    useListTenantProviderSubscriptionsQuery,
    useChangeTenantProviderSubscriptionPlanMutation,
    useCancelTenantProviderSubscriptionMutation,
    useListUnsubscribedProvidersQuery,
    useCreateTenantProviderSubscriptionMutation,
    useActivateTenantProviderSubscriptionMutation,
    useRequestMyTenantPlanMutation,
    useApproveTenantProviderSubscriptionRequestMutation,
} = tenantProviderPlanEndpoints;
