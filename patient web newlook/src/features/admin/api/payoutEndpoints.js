/**
 * Payout Management Endpoints (RTK Query)
 * Admin endpoints for managing doctor payouts, bank verification, retry.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const API_BASE = '/api/admin/payouts';

const payoutEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // List all payouts
        getAdminPayouts: builder.query({
            query: (params = {}) => {
                const queryParams = new URLSearchParams(params).toString();
                return { url: `${API_BASE}?${queryParams}`, method: 'GET' };
            },
            transformResponse: (res) => res.data || {},
            providesTags: (result) =>
                result?.payouts
                    ? [
                          ...result.payouts.map(({ id }) => ({ type: 'Payout', id })),
                          { type: 'Payout', id: 'ADMIN_LIST' },
                      ]
                    : [{ type: 'Payout', id: 'ADMIN_LIST' }],
        }),

        // List payouts needing bank verification
        getPayoutsNeedingBank: builder.query({
            query: (params = {}) => {
                const queryParams = new URLSearchParams(params).toString();
                return { url: `${API_BASE}/needs-bank?${queryParams}`, method: 'GET' };
            },
            transformResponse: (res) => res.data || {},
            providesTags: [{ type: 'Payout', id: 'NEEDS_BANK' }],
        }),

        // Doctors whose bank account is verified (payout-ready).
        getVerifiedBanks: builder.query({
            query: (params = {}) => {
                const queryParams = new URLSearchParams(params).toString();
                return { url: `${API_BASE}/verified-banks?${queryParams}`, method: 'GET' };
            },
            transformResponse: (res) => res.data || {},
            providesTags: [{ type: 'Payout', id: 'VERIFIED_BANKS' }],
        }),

        // Initiate payout for appointment
        initiatePayout: builder.mutation({
            query: (data) => ({ url: `${API_BASE}/initiate`, method: 'POST', data }),
            transformResponse: (res) => res,
            invalidatesTags: [{ type: 'Payout', id: 'ADMIN_LIST' }, { type: 'Payout', id: 'NEEDS_BANK' }],
        }),

        // Bulk initiate payouts
        bulkInitiatePayouts: builder.mutation({
            query: (data) => ({ url: `${API_BASE}/bulk-initiate`, method: 'POST', data }),
            transformResponse: (res) => res,
            invalidatesTags: [{ type: 'Payout', id: 'ADMIN_LIST' }, { type: 'Payout', id: 'NEEDS_BANK' }],
        }),

        // Update payout status
        updatePayoutStatus: builder.mutation({
            query: ({ payoutId, ...data }) => ({
                url: `${API_BASE}/${payoutId}/status`,
                method: 'PUT',
                data,
            }),
            transformResponse: (res) => res,
            invalidatesTags: (result, error, { payoutId }) => [
                { type: 'Payout', id: payoutId },
                { type: 'Payout', id: 'ADMIN_LIST' },
                { type: 'Payout', id: 'NEEDS_BANK' },
            ],
        }),

        // Release a matured payout to the doctor to collect. This moves no money —
        // the transfer is only sent when the doctor claims it.
        pushPayout: builder.mutation({
            query: ({ payoutId }) => ({ url: `${API_BASE}/${payoutId}/push`, method: 'POST' }),
            transformResponse: (res) => res,
            invalidatesTags: (result, error, { payoutId }) => [
                { type: 'Payout', id: payoutId },
                { type: 'Payout', id: 'ADMIN_LIST' },
            ],
        }),

        // Ask Cashfree for the terminal state of every in-flight payout.
        reconcilePayouts: builder.mutation({
            query: () => ({ url: `${API_BASE}/reconcile`, method: 'POST' }),
            transformResponse: (res) => res,
            invalidatesTags: [{ type: 'Payout', id: 'ADMIN_LIST' }],
        }),

        // Retry a payout
        retryPayout: builder.mutation({
            query: ({ payoutId, ...data }) => ({
                url: `${API_BASE}/${payoutId}/retry`,
                method: 'POST',
                data,
            }),
            transformResponse: (res) => res,
            invalidatesTags: (result, error, { payoutId }) => [
                { type: 'Payout', id: payoutId },
                { type: 'Payout', id: 'ADMIN_LIST' },
                { type: 'Payout', id: 'NEEDS_BANK' },
            ],
        }),

    }),
    overrideExisting: false,
});

export const {
    useGetAdminPayoutsQuery,
    useGetPayoutsNeedingBankQuery,
    useGetVerifiedBanksQuery,
    useInitiatePayoutMutation,
    useBulkInitiatePayoutsMutation,
    useUpdatePayoutStatusMutation,
    usePushPayoutMutation,
    useReconcilePayoutsMutation,
    useRetryPayoutMutation,
} = payoutEndpoints;
