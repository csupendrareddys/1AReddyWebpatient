/**
 * Provider-facing marketplace membership endpoints.
 *
 * Round 2 ships a single read — the doctor dashboard's "My Membership"
 * surface. Round 8 will extend this with self-serve plan change /
 * cancel mutations.
 */
import { apiSlice } from '../../../../app/api/apiSlice';

const MEMBERSHIP_BASE = '/api/v1/membership';

const myMembershipEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getMyMembership: builder.query({
            query: () => ({ url: `${MEMBERSHIP_BASE}/me`, method: 'GET' }),
            // Backend wraps payload as ``{ data: { subscription, plan } }``.
            // Pass the inner object through so the component reads
            // ``data.subscription`` and ``data.plan`` directly.
            transformResponse: (response) => response?.data || null,
            // 404 (no subscription) is a normal state, not an error
            // condition the user needs to see. Components check
            // ``error?.status === 404`` and hide rather than crash.
            providesTags: [{ type: 'MyMembership', id: 'CURRENT' }],
        }),

        // Active tiers the caller can move onto (same vertical), each tagged
        // current / upgrade / downgrade / lateral, with per-period prices.
        getMyMembershipPlans: builder.query({
            query: () => ({ url: `${MEMBERSHIP_BASE}/me/plans`, method: 'GET' }),
            transformResponse: (response) => response?.data || null,
            providesTags: [{ type: 'MyMembership', id: 'PLANS' }],
        }),

        // What the practice may still add, per the tier it holds: support
        // staff seats and My Link affiliations. Both meters in one response
        // because both render on My Link.
        //
        // It provides the CareNetworkConnection and MyStaff tags rather than
        // one of its own, so every mutation that already invalidates them —
        // adding staff, accepting a link, delinking — refreshes the meter
        // without each of those having to learn that limits exist. A meter
        // that lags the list it sits next to is worse than no meter.
        getMyPlanLimits: builder.query({
            query: () => ({ url: `${MEMBERSHIP_BASE}/me/limits`, method: 'GET' }),
            transformResponse: (r) => r?.data || null,
            providesTags: [
                { type: 'MyMembership', id: 'LIMITS' },
                'MyStaff', 'CareNetworkConnection',
            ],
        }),

        // The caller's own health-credit wallet — works for ANY member role
        // (patient or a provider such as a doctor). One hook, every vertical.
        getMyCredits: builder.query({
            query: () => ({ url: `${MEMBERSHIP_BASE}/me/credits`, method: 'GET' }),
            transformResponse: (r) => r?.data || { wallet: null, available: 0, ledger: [] },
            providesTags: [{ type: 'MyMembership', id: 'CREDITS' }],
        }),
        // How many credits the caller may redeem on ``price`` for an ``offering``
        // scope (incl. ``membership`` — spending credits toward a renewal).
        getMyCreditQuote: builder.query({
            query: ({ offering, price }) => ({
                url: `${MEMBERSHIP_BASE}/me/credits/quote`,
                method: 'GET',
                params: { offering, price },
            }),
            transformResponse: (r) => r?.data
                || { allowed: false, max_redeemable: 0, available: 0 },
        }),

        // Price an activate/renew/upgrade before checkout.
        quoteMyMembershipChange: builder.mutation({
            query: ({ membership_plan_id, period }) => ({
                url: `${MEMBERSHIP_BASE}/me/quote`,
                method: 'POST',
                data: { membership_plan_id, period },
            }),
            transformResponse: (response) => response?.data || response,
        }),

        // Razorpay pay-for-plan: create order (amount priced server-side) then
        // verify → activate. Mirrors the appointment/order checkout pair.
        createMembershipPaymentOrder: builder.mutation({
            query: (data) => ({
                url: '/api/v1/payment/membership/create-order',
                method: 'POST',
                data,
            }),
        }),
        verifyMembershipPayment: builder.mutation({
            query: (data) => ({
                url: '/api/v1/payment/membership/verify',
                method: 'POST',
                data,
            }),
            invalidatesTags: [
                { type: 'MyMembership', id: 'CURRENT' },
                { type: 'MyMembership', id: 'PLANS' },
                { type: 'MyMembership', id: 'CREDITS' },
                'AccountStatus',
            ],
        }),
    }),
});

export const {
    useGetMyMembershipQuery,
    useGetMyMembershipPlansQuery,
    useGetMyPlanLimitsQuery,
    useGetMyCreditsQuery,
    useGetMyCreditQuoteQuery,
    useQuoteMyMembershipChangeMutation,
    useCreateMembershipPaymentOrderMutation,
    useVerifyMembershipPaymentMutation,
} = myMembershipEndpoints;
