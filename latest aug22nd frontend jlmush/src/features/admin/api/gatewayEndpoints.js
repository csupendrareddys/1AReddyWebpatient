/**
 * Tenant self-serve payment gateway + SMS/DLT configuration (RTK Query).
 *
 * The tenant's OWN money + messaging rails:
 *   * Razorpay (collection)  — patient payments settle into the tenant's
 *     account. NO platform fallback: unconfigured tenants can't collect.
 *   * Cashfree (payouts)     — doctor disbursals leave the tenant's account.
 *   * SMS / DLT              — plan-gated switch from the shared vendor
 *     templates to the tenant's own DLT registration.
 *
 * Secrets are write-only: the backend returns masks / has_* booleans and
 * never echoes a stored secret back.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const GATEWAY_URL = '/api/v1/admin/payment-gateway';
const SMS_URL = '/api/v1/admin/sms-config';
const EMAIL_URL = '/api/v1/admin/email-config';

export const gatewayEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getGatewayConfig: builder.query({
            query: () => ({ url: GATEWAY_URL, method: 'GET' }),
            transformResponse: (res) => res?.data || null,
            providesTags: [{ type: 'TenantGateway', id: 'SELF' }],
        }),
        saveGatewayConfig: builder.mutation({
            query: (body) => ({ url: GATEWAY_URL, method: 'PUT', data: body }),
            transformResponse: (res) => res?.data || null,
            invalidatesTags: [{ type: 'TenantGateway', id: 'SELF' }],
        }),
        testGatewayRail: builder.mutation({
            query: (rail) => ({ url: `${GATEWAY_URL}/test`, method: 'POST', data: { rail } }),
            transformResponse: (res) => res?.data || null,
            invalidatesTags: [{ type: 'TenantGateway', id: 'SELF' }],
        }),
        disableGateway: builder.mutation({
            query: () => ({ url: GATEWAY_URL, method: 'DELETE' }),
            transformResponse: (res) => res?.data || null,
            invalidatesTags: [{ type: 'TenantGateway', id: 'SELF' }],
        }),

        getSmsConfig: builder.query({
            query: () => ({ url: SMS_URL, method: 'GET' }),
            transformResponse: (res) => res?.data || null,
            providesTags: [{ type: 'TenantSmsConfig', id: 'SELF' }],
        }),
        saveSmsConfig: builder.mutation({
            query: (body) => ({ url: SMS_URL, method: 'PUT', data: body }),
            transformResponse: (res) => res?.data || null,
            invalidatesTags: [{ type: 'TenantSmsConfig', id: 'SELF' }],
        }),
        disableSmsConfig: builder.mutation({
            query: () => ({ url: SMS_URL, method: 'DELETE' }),
            transformResponse: (res) => res?.data || null,
            invalidatesTags: [{ type: 'TenantSmsConfig', id: 'SELF' }],
        }),

        getEmailConfig: builder.query({
            query: () => ({ url: EMAIL_URL, method: 'GET' }),
            transformResponse: (res) => res?.data || null,
            providesTags: [{ type: 'TenantEmailConfig', id: 'SELF' }],
        }),
        saveEmailConfig: builder.mutation({
            query: (body) => ({ url: EMAIL_URL, method: 'PUT', data: body }),
            transformResponse: (res) => res?.data || null,
            invalidatesTags: [{ type: 'TenantEmailConfig', id: 'SELF' }],
        }),
        disableEmailConfig: builder.mutation({
            query: () => ({ url: EMAIL_URL, method: 'DELETE' }),
            transformResponse: (res) => res?.data || null,
            invalidatesTags: [{ type: 'TenantEmailConfig', id: 'SELF' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetGatewayConfigQuery,
    useSaveGatewayConfigMutation,
    useTestGatewayRailMutation,
    useDisableGatewayMutation,
    useGetSmsConfigQuery,
    useSaveSmsConfigMutation,
    useDisableSmsConfigMutation,
    useGetEmailConfigQuery,
    useSaveEmailConfigMutation,
    useDisableEmailConfigMutation,
} = gatewayEndpoints;
