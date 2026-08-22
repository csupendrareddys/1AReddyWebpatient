/**
 * SaaS subscription billing (tenant → vendor) — RTK Query.
 *
 * Phase 5 of the vendor split: a tenant SUPER_ADMIN pays for the tenant's
 * own subscription one period at a time, on the VENDOR's Razorpay account.
 * Distinct from the marketplace payment endpoints, which run on the
 * tenant's own gateway (``/api/v1/admin/payment-gateway``).
 */
import { apiSlice } from '../../../app/api/apiSlice';

const URL = '/api/v1/payment/subscription';

export const billingEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getSaasSubscription: builder.query({
            query: () => ({ url: URL, method: 'GET' }),
            transformResponse: (res) => res?.data || null,
            providesTags: [{ type: 'SaasBilling', id: 'SELF' }],
        }),

        // Creates a Razorpay order for one period ({period: 'monthly'|'annual'}).
        // A zero-priced plan returns {no_payment_needed: true} and is already
        // applied — the caller must skip the checkout popup in that case.
        createSubscriptionOrder: builder.mutation({
            query: (body) => ({ url: `${URL}/create-order`, method: 'POST', data: body }),
            invalidatesTags: [{ type: 'SaasBilling', id: 'SELF' }],
        }),

        // Public add-on catalog (active add-ons with prices) for the
        // self-serve shop on the Billing page.
        listBuyableAddons: builder.query({
            // Plan-aware: the backend resolves each add-on's terms for
            // THIS tenant (plan overrides -> tier -> legacy), so
            // different plans see different prices and caps.
            query: () => ({ url: '/api/v1/pricing/my-addons', method: 'GET' }),
            transformResponse: (res) => res?.data || [],
        }),
        // {addon_code, period, quantity} -> Razorpay order (or
        // {no_payment_needed} for a free add-on, already applied).
        // Ask the gateway what really happened to an unsettled order —
        // the recovery path when neither the browser verify nor the
        // webhook settled a payment.
        reconcileSubscriptionPayment: builder.mutation({
            query: (body) => ({
                url: '/api/v1/payment/subscription/reconcile',
                method: 'POST',
                data: body || {},
            }),
        }),

        createAddonOrder: builder.mutation({
            query: (body) => ({
                url: `${URL}/addon-order`, method: 'POST', data: body,
            }),
            invalidatesTags: [
                { type: 'SaasBilling', id: 'SELF' }, 'MyPlan',
            ],
        }),
        verifySubscriptionPayment: builder.mutation({
            query: (body) => ({ url: `${URL}/verify`, method: 'POST', data: body }),
            invalidatesTags: [{ type: 'SaasBilling', id: 'SELF' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    useReconcileSubscriptionPaymentMutation,
    useGetSaasSubscriptionQuery,
    useCreateSubscriptionOrderMutation,
    useListBuyableAddonsQuery,
    useCreateAddonOrderMutation,
    useVerifySubscriptionPaymentMutation,
} = billingEndpoints;
