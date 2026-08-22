/**
 * Seller-support endpoints (RTK Query) — CHANNEL bootstrap for the
 * seller↔tenant support conversation. The conversation itself (chat,
 * documents, video calls) rides the standard service-communication
 * endpoints via the shared ChannelChat/Panels components; these
 * endpoints only answer "which channel" and list the seller's inbox.
 *
 *   * tenant admins:  GET  /api/v1/admin/support/channel
 *   * vendor staff:   GET  /api/v1/platform/support/threads
 *                     POST /api/v1/platform/support/tenants/{id}/open
 *   * apex staff:     GET  /api/v1/admin/reseller/support/threads
 *                     POST /api/v1/admin/reseller/support/tenants/{id}/open
 */
import { apiSlice } from '../../../app/api/apiSlice';

const supportEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getMySupportChannel: builder.query({
            query: () => ({ url: '/api/v1/admin/support/channel', method: 'GET' }),
            transformResponse: (response) => response?.data || {},
            providesTags: [{ type: 'SupportThread', id: 'MINE' }],
        }),

        listSupportThreads: builder.query({
            query: () => ({ url: '/api/v1/platform/support/threads', method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'SupportInbox', id: 'PLATFORM' }],
        }),
        openSupportChannel: builder.mutation({
            query: (tenantId) => ({
                url: `/api/v1/platform/support/tenants/${tenantId}/open`,
                method: 'POST',
            }),
            transformResponse: (response) => response?.data || {},
            invalidatesTags: [{ type: 'SupportInbox', id: 'PLATFORM' }],
        }),

        listChildSupportThreads: builder.query({
            query: () => ({ url: '/api/v1/admin/reseller/support/threads', method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'SupportInbox', id: 'RESELLER' }],
        }),
        openChildSupportChannel: builder.mutation({
            query: (tenantId) => ({
                url: `/api/v1/admin/reseller/support/tenants/${tenantId}/open`,
                method: 'POST',
            }),
            transformResponse: (response) => response?.data || {},
            invalidatesTags: [{ type: 'SupportInbox', id: 'RESELLER' }],
        }),
    }),
});

export const {
    useGetMySupportChannelQuery,
    useListSupportThreadsQuery,
    useOpenSupportChannelMutation,
    useListChildSupportThreadsQuery,
    useOpenChildSupportChannelMutation,
} = supportEndpoints;

export default supportEndpoints;
