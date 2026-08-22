/**
 * Admin Group Offering (healthcare plan) builder endpoints (RTK Query).
 *
 * The admin-authored multidisciplinary plan builder. Separate from the
 * doctor-led group offering (marketplaceEndpoints/service-groups).
 */
import { apiSlice } from '../../../app/api/apiSlice';

const ADMIN_URL = '/api/v1/admin';

const groupOfferingEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getGroupOfferings: builder.query({
            query: (status = 'all') => ({
                url: `${ADMIN_URL}/group-offerings`,
                method: 'GET',
                params: status ? { status } : undefined,
            }),
            transformResponse: (res) => res.data?.offerings || res.offerings || [],
            providesTags: [{ type: 'AdminGroupOffering', id: 'LIST' }],
        }),

        getGroupOffering: builder.query({
            query: (id) => ({ url: `${ADMIN_URL}/group-offerings/${id}`, method: 'GET' }),
            transformResponse: (res) => res.data || res,
            providesTags: (r, e, id) => [{ type: 'AdminGroupOffering', id }],
        }),

        createGroupOffering: builder.mutation({
            query: (data) => ({ url: `${ADMIN_URL}/group-offerings`, method: 'POST', data }),
            invalidatesTags: [{ type: 'AdminGroupOffering', id: 'LIST' }],
        }),

        updateGroupOffering: builder.mutation({
            query: ({ id, ...data }) => ({
                url: `${ADMIN_URL}/group-offerings/${id}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (r, e, { id }) => [
                { type: 'AdminGroupOffering', id },
                { type: 'AdminGroupOffering', id: 'LIST' },
            ],
        }),

        publishGroupOffering: builder.mutation({
            query: ({ id, ...data }) => ({
                url: `${ADMIN_URL}/group-offerings/${id}/publish`,
                method: 'POST',
                data,
            }),
            invalidatesTags: (r, e, { id }) => [
                { type: 'AdminGroupOffering', id },
                { type: 'AdminGroupOffering', id: 'LIST' },
            ],
        }),

        archiveGroupOffering: builder.mutation({
            query: (id) => ({ url: `${ADMIN_URL}/group-offerings/${id}/archive`, method: 'POST' }),
            invalidatesTags: [{ type: 'AdminGroupOffering', id: 'LIST' }],
        }),

        deleteGroupOffering: builder.mutation({
            query: (id) => ({ url: `${ADMIN_URL}/group-offerings/${id}`, method: 'DELETE' }),
            invalidatesTags: [{ type: 'AdminGroupOffering', id: 'LIST' }],
        }),

        // Doctors eligible for a slot, matched against its full eligibility
        // (specializations + work-quals + experience). Pass the saved slot's
        // ``memberId``; ``qualificationId``/``kind`` remain as a legacy fallback.
        getQualificationCandidates: builder.query({
            query: ({ memberId, qualificationId, kind } = {}) => ({
                url: `${ADMIN_URL}/group-offerings/candidates`,
                method: 'GET',
                params: memberId
                    ? { member_id: memberId }
                    : { qualification_id: qualificationId, kind: kind || 'specialization' },
            }),
            transformResponse: (res) => res.data?.candidates || [],
        }),

        // Admin-managed category dropdown for the plan builder.
        getGroupOfferingCategories: builder.query({
            query: () => ({ url: `${ADMIN_URL}/group-offerings/categories`, method: 'GET' }),
            transformResponse: (res) => res.data?.categories || [],
            providesTags: [{ type: 'AdminGroupOffering', id: 'CATEGORIES' }],
        }),
        createGroupOfferingCategory: builder.mutation({
            query: (name) => ({
                url: `${ADMIN_URL}/group-offerings/categories`, method: 'POST', data: { name },
            }),
            invalidatesTags: [{ type: 'AdminGroupOffering', id: 'CATEGORIES' }],
        }),
        deleteGroupOfferingCategory: builder.mutation({
            query: (id) => ({
                url: `${ADMIN_URL}/group-offerings/categories/${id}`, method: 'DELETE',
            }),
            invalidatesTags: [{ type: 'AdminGroupOffering', id: 'CATEGORIES' }],
        }),

        // ── Teams (a plan is fulfilled by one or more teams) ──
        getPlanTeams: builder.query({
            query: (offeringId) => ({ url: `${ADMIN_URL}/group-offerings/${offeringId}/teams`, method: 'GET' }),
            transformResponse: (res) => res.data?.teams || [],
            providesTags: (r, e, id) => [{ type: 'GroupOfferingTeam', id }],
        }),
        createPlanTeam: builder.mutation({
            query: ({ offeringId, ...data }) => ({
                url: `${ADMIN_URL}/group-offerings/${offeringId}/teams`, method: 'POST', data,
            }),
            invalidatesTags: (r, e, { offeringId }) => [{ type: 'GroupOfferingTeam', id: offeringId }],
        }),
        updatePlanTeam: builder.mutation({
            query: ({ teamId, offeringId, ...data }) => ({
                url: `${ADMIN_URL}/group-offerings/teams/${teamId}`, method: 'PUT', data,
            }),
            invalidatesTags: (r, e, { offeringId }) => [{ type: 'GroupOfferingTeam', id: offeringId }],
        }),
        approvePlanTeam: builder.mutation({
            query: ({ teamId, offeringId }) => ({
                url: `${ADMIN_URL}/group-offerings/teams/${teamId}/approve`, method: 'POST',
            }),
            invalidatesTags: (r, e, { offeringId }) => [{ type: 'GroupOfferingTeam', id: offeringId }],
        }),
        deletePlanTeam: builder.mutation({
            query: ({ teamId, offeringId }) => ({
                url: `${ADMIN_URL}/group-offerings/teams/${teamId}`, method: 'DELETE',
            }),
            invalidatesTags: (r, e, { offeringId }) => [{ type: 'GroupOfferingTeam', id: offeringId }],
        }),

    }),
    overrideExisting: false,
});

export const {
    useGetGroupOfferingsQuery,
    useGetGroupOfferingQuery,
    useCreateGroupOfferingMutation,
    useUpdateGroupOfferingMutation,
    usePublishGroupOfferingMutation,
    useArchiveGroupOfferingMutation,
    useDeleteGroupOfferingMutation,
    useLazyGetQualificationCandidatesQuery,
    useGetGroupOfferingCategoriesQuery,
    useCreateGroupOfferingCategoryMutation,
    useDeleteGroupOfferingCategoryMutation,
    useGetPlanTeamsQuery,
    useCreatePlanTeamMutation,
    useUpdatePlanTeamMutation,
    useApprovePlanTeamMutation,
    useDeletePlanTeamMutation,
} = groupOfferingEndpoints;
