/**
 * Billing Configuration Endpoints (RTK Query)
 * Admin endpoints for managing platform charges, GST, and TDS rates.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const API_BASE = '/api/admin/billing-config';

const billingConfigEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getBillingConfig: builder.query({
            query: () => ({
                url: API_BASE,
                method: 'GET',
            }),
            transformResponse: (res) => res.data || {},
            providesTags: [{ type: 'BillingConfig', id: 'ACTIVE' }],
        }),

        updateBillingConfig: builder.mutation({
            query: (data) => ({
                url: API_BASE,
                method: 'PUT',
                data,
            }),
            transformResponse: (res) => res.data || {},
            invalidatesTags: [
                { type: 'BillingConfig', id: 'ACTIVE' },
                { type: 'Billing', id: 'LIST' },
            ],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetBillingConfigQuery,
    useUpdateBillingConfigMutation,
} = billingConfigEndpoints;
