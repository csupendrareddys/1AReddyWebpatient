/**
 * Doctor Care Network endpoints (RTK Query).
 * Backs both My Network (context='network', referral A/B/C) and My Link
 * (context='link', relationship partner/associate/employee), plus the
 * super-admin-gated Discover directory.
 */
import { apiSlice } from '../../../../app/api/apiSlice';
import { splitScope, doctorScopedUrl } from '../../api/doctorScope';

const NET_URL = '/api/doctor/network';

export const networkEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // Scoped: the Group Offering dialog picks co-doctors from this list,
        // and that dialog is mounted in Operations. It has to be the LEAD
        // doctor's network — the admin's own is not who the group can be
        // built from. The rest of the network surfaces stay doctor-only.
        getNetworkConnections: builder.query({
            // arg: { type?: 'doctor'|'hospital'|'clinic', context?: 'network'|'link' }
            query: (arg) => {
                const [ops, { type, context = 'network' } = {}] = splitScope(arg);
                return {
                    url: doctorScopedUrl(ops, '/network/connections'),
                    method: 'GET',
                    params: { ...(type ? { type } : {}), context },
                };
            },
            transformResponse: (res) => res.data?.connections || res.connections || [],
            providesTags: ['CareNetworkConnection'],
        }),
        getNetworkRequests: builder.query({
            query: ({ context = 'network' } = {}) => ({
                url: `${NET_URL}/requests`,
                method: 'GET',
                params: { context },
            }),
            transformResponse: (res) => ({
                sent: res.data?.sent_requests || res.sent_requests || [],
                received: res.data?.received_requests || res.received_requests || [],
            }),
            providesTags: ['CareNetworkRequest'],
        }),
        getNetworkDiscover: builder.query({
            query: (type) => ({ url: `${NET_URL}/discover`, method: 'GET', params: { type } }),
            transformResponse: (res) => res.data?.providers || res.providers || [],
            providesTags: ['CareNetworkConnection'],
        }),
        getNetworkVisibility: builder.query({
            query: () => ({ url: `${NET_URL}/visibility`, method: 'GET' }),
            transformResponse: (res) => res.data?.visibility || res.visibility
                || { doctors: false, hospitals: false, clinics: false },
        }),
        sendNetworkRequest: builder.mutation({
            query: (data) => ({ url: `${NET_URL}/requests`, method: 'POST', data }),
            invalidatesTags: ['CareNetworkRequest', 'CareNetworkConnection'],
        }),
        acceptNetworkRequest: builder.mutation({
            query: (requestId) => ({ url: `${NET_URL}/requests/${requestId}/accept`, method: 'POST' }),
            invalidatesTags: ['CareNetworkRequest', 'CareNetworkConnection'],
        }),
        rejectNetworkRequest: builder.mutation({
            query: (requestId) => ({ url: `${NET_URL}/requests/${requestId}/reject`, method: 'POST' }),
            invalidatesTags: ['CareNetworkRequest'],
        }),
        cancelNetworkRequest: builder.mutation({
            query: (requestId) => ({ url: `${NET_URL}/requests/${requestId}/cancel`, method: 'POST' }),
            invalidatesTags: ['CareNetworkRequest'],
        }),
        generateNetworkInvite: builder.mutation({
            query: (data) => ({ url: `${NET_URL}/generate-invite`, method: 'POST', data }),
            invalidatesTags: ['CareNetworkRequest'],
        }),
        joinNetworkByCode: builder.mutation({
            query: (inviteCode) => ({ url: `${NET_URL}/join/${inviteCode}`, method: 'POST' }),
            invalidatesTags: ['CareNetworkConnection', 'CareNetworkRequest'],
        }),
        // Leave a network, or end a My Link affiliation. One endpoint for both
        // surfaces, as with every other verb here — the row knows its own
        // context and the server decides what that costs.
        removeNetworkConnection: builder.mutation({
            query: (connectionId) => ({
                url: `${NET_URL}/connections/${connectionId}`, method: 'DELETE',
            }),
            invalidatesTags: ['CareNetworkConnection'],
        }),

        // ── Facility (clinic/hospital) inbox — accept/reject the pending
        //    connection requests doctors sent to this facility. ──
        getFacilityNetworkRequests: builder.query({
            query: () => ({ url: '/api/facility/network/requests', method: 'GET' }),
            transformResponse: (res) => res.data?.received_requests || res.received_requests || [],
            providesTags: ['CareNetworkRequest'],
        }),
        acceptFacilityNetworkRequest: builder.mutation({
            query: (requestId) => ({ url: `/api/facility/network/requests/${requestId}/accept`, method: 'POST' }),
            invalidatesTags: ['CareNetworkRequest'],
        }),
        rejectFacilityNetworkRequest: builder.mutation({
            query: (requestId) => ({ url: `/api/facility/network/requests/${requestId}/reject`, method: 'POST' }),
            invalidatesTags: ['CareNetworkRequest'],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetNetworkConnectionsQuery,
    useGetNetworkRequestsQuery,
    useGetNetworkDiscoverQuery,
    useGetNetworkVisibilityQuery,
    useSendNetworkRequestMutation,
    useAcceptNetworkRequestMutation,
    useRejectNetworkRequestMutation,
    useCancelNetworkRequestMutation,
    useGenerateNetworkInviteMutation,
    useJoinNetworkByCodeMutation,
    useRemoveNetworkConnectionMutation,
    useGetFacilityNetworkRequestsQuery,
    useAcceptFacilityNetworkRequestMutation,
    useRejectFacilityNetworkRequestMutation,
} = networkEndpoints;
