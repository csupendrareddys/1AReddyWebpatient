/**
 * A tenant's OWN routing + first-run onboarding (RTK Query).
 *
 * Distinct from ``platformEndpoints`` — those hit ``/api/v1/platform/tenants/<id>/*``
 * and are PLATFORM_OWNER-only, operating on *another* tenant. These hit
 * ``/api/v1/admin/tenant-domain``, where the backend takes the tenant from the
 * request context, so a SUPER_ADMIN can only ever act on their own.
 *
 * Before these existed a tenant could not see whether its own site was live,
 * and every custom-domain change was a support request to the vendor.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const URL = '/api/v1/admin/tenant-domain';

// NOTE: every endpoint name here must be DISTINCT from the ones in
// platformEndpoints.js. Both inject into the same apiSlice, and RTK
// Query's injectEndpoints SILENTLY DISCARDS a duplicate name when
// ``overrideExisting`` is false — so a shared name meant this
// tenant-scoped endpoint quietly resolved to the platform one, and the
// tenant page called /platform/tenants/undefined/... and got a 403.
// Hence the ``*MyDomain*`` naming: tenant acts on ITS OWN domain.

export const tenantDomainEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getTenantDomain: builder.query({
            query: () => ({ url: URL, method: 'GET' }),
            transformResponse: (res) => res?.data || null,
            providesTags: [{ type: 'TenantDomain', id: 'SELF' }],
        }),

        // Claims the domain and returns the TXT record to publish. Does NOT
        // route traffic yet — that waits for verify.
        setMyDomain: builder.mutation({
            query: (domain) => ({ url: URL, method: 'PUT', data: { domain } }),
            transformResponse: (res) => res?.data || null,
            invalidatesTags: [{ type: 'TenantDomain', id: 'SELF' }],
        }),

        verifyMyDomain: builder.mutation({
            query: () => ({ url: `${URL}/verify`, method: 'POST' }),
            transformResponse: (res) => res?.data || null,
            invalidatesTags: [{ type: 'TenantDomain', id: 'SELF' }],
        }),

        // Self-serve routing probe — the same check the vendor console
        // runs. Returns {matches, reason, resolved_chain}; deliberately
        // NOT tag-invalidating (a probe reports, it changes nothing).
        checkMyDomainCname: builder.mutation({
            query: () => ({ url: `${URL}/check-cname`, method: 'POST' }),
        }),

        clearMyDomain: builder.mutation({
            query: () => ({ url: URL, method: 'DELETE' }),
            transformResponse: (res) => res?.data || null,
            invalidatesTags: [{ type: 'TenantDomain', id: 'SELF' }],
        }),

        getTenantOnboarding: builder.query({
            query: () => ({ url: `${URL}/onboarding`, method: 'GET' }),
            transformResponse: (res) => res?.data || null,
            providesTags: [{ type: 'TenantDomain', id: 'ONBOARDING' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetTenantDomainQuery,
    useSetMyDomainMutation,
    useVerifyMyDomainMutation,
    useCheckMyDomainCnameMutation,
    useClearMyDomainMutation,
    useGetTenantOnboardingQuery,
} = tenantDomainEndpoints;
