/**
 * Marketplace ``MembershipPlan`` admin endpoints (RTK Query).
 *
 * Two product lines live side-by-side:
 *   * SaaS Plans   — ``../pricingEndpoints.js`` (clinic subscribes to get
 *                    their own subdomain).
 *   * Marketplace memberships (this file) — doctors / clinics / hospitals
 *                    register on the apex (``larazen.in``) and pay for
 *                    visibility + features there.
 *
 * Public read (apex pricing page) lives in ``publicEndpoints.js``.
 */
import { apiSlice } from '../../../app/api/apiSlice';

// Tenant-scoped endpoint — the same page serves a tenant SUPER_ADMIN
// (their own tenant) and the PLATFORM_OWNER (the apex/default tenant),
// resolved from the request host. Was ``/api/platform`` when membership
// plans were a global platform-owner-only catalog.
const PLATFORM_BASE = '/api/v1';

const membershipEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        listMembershipPlans: builder.query({
            query: () => ({
                url: `${PLATFORM_BASE}/membership-plans`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = []) => [
                { type: 'MembershipPlan', id: 'LIST' },
                ...result.map((p) => ({ type: 'MembershipPlan', id: p.code })),
            ],
        }),
        getMembershipPlan: builder.query({
            query: (code) => ({
                url: `${PLATFORM_BASE}/membership-plans/${code}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, code) => [
                { type: 'MembershipPlan', id: code },
            ],
        }),
        createMembershipPlan: builder.mutation({
            query: (data) => ({
                url: `${PLATFORM_BASE}/membership-plans`,
                method: 'POST',
                data,
            }),
            // Hits both admin list AND the public pricing page list —
            // invalidate both so the apex grid reflects new rows
            // without a manual reload.
            invalidatesTags: [
                { type: 'MembershipPlan', id: 'LIST' },
                { type: 'MembershipPlan', id: 'PUBLIC_LIST' },
            ],
        }),
        updateMembershipPlan: builder.mutation({
            query: ({ code, data }) => ({
                url: `${PLATFORM_BASE}/membership-plans/${code}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'MembershipPlan', id: 'LIST' },
                { type: 'MembershipPlan', id: 'PUBLIC_LIST' },
                { type: 'MembershipPlan', id: arg.code },
            ],
        }),
        // ─── Subscriber roster ─────────────────────────────────────────
        // Who currently holds one of this tenant's tiers, and the action to
        // move them onto a different one. Tenant scope is resolved from the
        // request on the backend — never passed from here.
        listMembershipSubscriptions: builder.query({
            query: ({ planType, status } = {}) => ({
                url: `${PLATFORM_BASE}/membership/subscriptions`,
                method: 'GET',
                params: {
                    ...(planType ? { plan_type: planType } : {}),
                    ...(status ? { status } : {}),
                },
            }),
            transformResponse: (response) => response?.data?.subscriptions || [],
            providesTags: (result = []) => [
                { type: 'MembershipSubscription', id: 'LIST' },
                ...result.map((s) => (
                    { type: 'MembershipSubscription', id: s.id }
                )),
            ],
        }),
        changeMembershipSubscriptionPlan: builder.mutation({
            query: ({ id, membership_plan_id }) => ({
                url: `${PLATFORM_BASE}/membership/subscriptions/${id}`,
                method: 'PATCH',
                data: { membership_plan_id },
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'MembershipSubscription', id: 'LIST' },
                { type: 'MembershipSubscription', id: arg.id },
                // The subscriber's own dashboard tile reads the same row.
                'MyMembership',
            ],
        }),

        // Put any vertical's entity (doctor/clinic/hospital/patient) onto a
        // membership tier — creates the subscription if they have none, else
        // swaps the tier. Accepts {vertical, entity_id, membership_plan_id};
        // the legacy {doctor_id, ...} shape still works server-side.
        assignMembershipToDoctor: builder.mutation({
            query: (data) => ({
                url: `${PLATFORM_BASE}/membership/subscriptions/assign`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [
                { type: 'MembershipSubscription', id: 'LIST' },
                'MyMembership',
            ],
        }),

        setSubscriptionHold: builder.mutation({
            query: ({ id, on_hold }) => ({
                url: `${PLATFORM_BASE}/membership/subscriptions/${id}/hold`,
                method: 'POST',
                data: { on_hold },
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'MembershipSubscription', id: 'LIST' },
                { type: 'MembershipSubscription', id: arg.id },
                'HeldVendors',
            ],
        }),
        endSubscriptionTrial: builder.mutation({
            query: (id) => ({
                url: `${PLATFORM_BASE}/membership/subscriptions/${id}/end-trial`,
                method: 'POST',
            }),
            invalidatesTags: (result, error, id) => [
                { type: 'MembershipSubscription', id: 'LIST' },
                { type: 'MembershipSubscription', id },
                'HeldVendors',
            ],
        }),
        extendSubscriptionTrial: builder.mutation({
            query: ({ id, days }) => ({
                url: `${PLATFORM_BASE}/membership/subscriptions/${id}/extend-trial`,
                method: 'POST',
                data: { days },
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'MembershipSubscription', id: 'LIST' },
                { type: 'MembershipSubscription', id: arg.id },
                'HeldVendors',
            ],
        }),

        archiveMembershipPlan: builder.mutation({
            query: (code) => ({
                url: `${PLATFORM_BASE}/membership-plans/${code}`,
                method: 'DELETE',
            }),
            invalidatesTags: [
                { type: 'MembershipPlan', id: 'LIST' },
                { type: 'MembershipPlan', id: 'PUBLIC_LIST' },
            ],
        }),

        // ─── Health-credit policies ────────────────────────────────────────
        // Each plan's credit grant + per-offering redemption caps, managed on
        // their own admin page. Edits go live for all current members instantly
        // (the backend reads the policy fresh at grant / quote time).
        listCreditPolicies: builder.query({
            query: () => ({
                url: `${PLATFORM_BASE}/membership-plans/credit-policies`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'CreditPolicy', id: 'LIST' }],
        }),
        upsertCreditPolicy: builder.mutation({
            // Pass every field through (grant_amount, scopes, validity, AND the
            // second-opinion config: grant/threshold/per-type grants + pct/pcts).
            // Destructuring a fixed subset here silently dropped the
            // second-opinion fields before they reached the backend.
            query: ({ plan_id, ...body }) => ({
                url: `${PLATFORM_BASE}/membership-plans/${plan_id}/credit-policy`,
                method: 'PUT',
                data: body,
            }),
            invalidatesTags: [{ type: 'CreditPolicy', id: 'LIST' }],
        }),
        // ─── Patient Family quotas ─────────────────────────────────────────
        // How many minors / linked adults / roles a receiver (patient) plan
        // lets an owner create. Members never buy their own plan, so the
        // owner's plan caps them. Enforced at create time; edits apply next.
        listFamilyPolicies: builder.query({
            query: () => ({
                url: `${PLATFORM_BASE}/membership-plans/family-policies`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'PatientFamilyPolicy', id: 'LIST' }],
        }),
        upsertFamilyPolicy: builder.mutation({
            query: ({ plan_id, ...body }) => ({
                url: `${PLATFORM_BASE}/membership-plans/${plan_id}/family-policy`,
                method: 'PUT',
                data: body,
            }),
            invalidatesTags: [{ type: 'PatientFamilyPolicy', id: 'LIST' }],
        }),
        // ─── Charge (platform-fee) policies ────────────────────────────────
        // Each plan's three platform charges + per-charge tax, managed on their
        // own admin page. Edits go live on the next payout for every doctor on
        // the plan (the backend reads the policy fresh at payout time).
        listChargePolicies: builder.query({
            query: () => ({
                url: `${PLATFORM_BASE}/membership-plans/charge-policies`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'ChargePolicy', id: 'LIST' }],
        }),
        upsertChargePolicy: builder.mutation({
            query: ({ plan_id, ...body }) => ({
                url: `${PLATFORM_BASE}/membership-plans/${plan_id}/charge-policy`,
                method: 'PUT',
                data: body,
            }),
            invalidatesTags: [{ type: 'ChargePolicy', id: 'LIST' }],
        }),
        // Ad-hoc admin top-up of a single user's credit wallet.
        manualCreditGrant: builder.mutation({
            query: ({ user_id, amount, note }) => ({
                url: `${PLATFORM_BASE}/membership-plans/credit-grants`,
                method: 'POST',
                data: { user_id, amount, note },
            }),
        }),
    }),
});

export const {
    useListMembershipPlansQuery,
    useGetMembershipPlanQuery,
    useCreateMembershipPlanMutation,
    useUpdateMembershipPlanMutation,
    useArchiveMembershipPlanMutation,
    useListMembershipSubscriptionsQuery,
    useChangeMembershipSubscriptionPlanMutation,
    useAssignMembershipToDoctorMutation,
    useSetSubscriptionHoldMutation,
    useEndSubscriptionTrialMutation,
    useExtendSubscriptionTrialMutation,
    useListCreditPoliciesQuery,
    useUpsertCreditPolicyMutation,
    useListFamilyPoliciesQuery,
    useUpsertFamilyPolicyMutation,
    useListChargePoliciesQuery,
    useUpsertChargePolicyMutation,
    useManualCreditGrantMutation,
} = membershipEndpoints;
