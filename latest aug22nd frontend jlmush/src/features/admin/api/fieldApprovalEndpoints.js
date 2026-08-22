/**
 * Field Approval Endpoints (RTK Query)
 * Manages field-level approval workflow for doctor/admin profile changes.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const API_BASE = '/api/v1/field-approval';

const fieldApprovalEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ---- Submitter Endpoints (Doctor / Sub-Admin) ----

        submitFieldChanges: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/submit`,
                method: 'POST',
                data,
            }),
            invalidatesTags: ['FieldApproval'],
        }),

        getMyFieldRequests: builder.query({
            query: ({ entityType, status, page = 1, perPage = 20 } = {}) => ({
                url: `${API_BASE}/my-requests`,
                method: 'GET',
                params: {
                    entity_type: entityType,
                    status,
                    page,
                    per_page: perPage,
                },
            }),
            providesTags: ['FieldApproval'],
        }),

        getFieldStatuses: builder.query({
            query: ({ entityType, entityId }) => ({
                url: `${API_BASE}/status/${entityType}/${entityId}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, { entityType, entityId }) => [
                { type: 'FieldApproval', id: `${entityType}_${entityId}` },
            ],
        }),

        getAccountStatus: builder.query({
            query: ({ entityType, entityId }) => ({
                url: `${API_BASE}/account-status/${entityType}/${entityId}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, { entityType, entityId }) => [
                { type: 'AccountStatus', id: `${entityType}_${entityId}` },
            ],
        }),

        // ---- Super Admin Endpoints (Reviewers) ----

        getPendingFieldApprovals: builder.query({
            query: ({ entityType, section, status = 'pending', page = 1, perPage = 20 } = {}) => ({
                url: `${API_BASE}/pending`,
                method: 'GET',
                params: {
                    entity_type: entityType,
                    section,
                    status,
                    page,
                    per_page: perPage,
                },
            }),
            providesTags: ['FieldApproval'],
        }),

        getFieldApprovalDetail: builder.query({
            query: (requestId) => ({
                url: `${API_BASE}/${requestId}`,
                method: 'GET',
            }),
        }),

        approveFieldChange: builder.mutation({
            query: ({ requestId, comment }) => ({
                url: `${API_BASE}/${requestId}/approve`,
                method: 'POST',
                data: { comment },
            }),
            invalidatesTags: ['FieldApproval', 'AccountStatus'],
        }),

        rejectFieldChange: builder.mutation({
            query: ({ requestId, comment }) => ({
                url: `${API_BASE}/${requestId}/reject`,
                method: 'POST',
                data: { comment },
            }),
            invalidatesTags: ['FieldApproval', 'AccountStatus'],
        }),

        queryFieldChange: builder.mutation({
            query: ({ requestId, comment }) => ({
                url: `${API_BASE}/${requestId}/query`,
                method: 'POST',
                data: { comment },
            }),
            invalidatesTags: ['FieldApproval', 'AccountStatus'],
        }),

        bulkApproveFieldChanges: builder.mutation({
            query: ({ requestIds, comment }) => ({
                url: `${API_BASE}/bulk-approve`,
                method: 'POST',
                data: { request_ids: requestIds, comment },
            }),
            invalidatesTags: ['FieldApproval', 'AccountStatus'],
        }),

        // ---- Publish Status ----

        getPublishStatus: builder.query({
            query: ({ entityType, entityId }) => ({
                url: `${API_BASE}/publish-status/${entityType}/${entityId}`,
                method: 'GET',
            }),
            providesTags: (result, error, { entityType, entityId }) => [
                { type: 'AccountStatus', id: `publish_${entityType}_${entityId}` },
            ],
        }),

        updatePublishStatus: builder.mutation({
            query: ({ entityType, entityId, publishStatus }) => ({
                url: `${API_BASE}/publish-status/${entityType}/${entityId}`,
                method: 'PUT',
                data: { publish_status: publishStatus },
            }),
            invalidatesTags: ['AccountStatus'],
        }),

        // ---- Per-Type Publish Status (Super Admin) ----

        getPublishStatusByType: builder.query({
            query: ({ entityType, entityId }) => ({
                url: `${API_BASE}/publish-status-by-type/${entityType}/${entityId}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, { entityType, entityId }) => [
                { type: 'AccountStatus', id: `by_type_${entityType}_${entityId}` },
            ],
        }),

        updatePublishStatusByType: builder.mutation({
            query: ({ entityType, entityId, statusByType }) => ({
                url: `${API_BASE}/publish-status-by-type/${entityType}/${entityId}`,
                method: 'PUT',
                data: { status_by_type: statusByType },
            }),
            invalidatesTags: (result, error, { entityType, entityId }) => [
                'AccountStatus',
                { type: 'AccountStatus', id: `by_type_${entityType}_${entityId}` },
            ],
        }),
    }),
    overrideExisting: false,
});

export const {
    // Submitter
    useSubmitFieldChangesMutation,
    useGetMyFieldRequestsQuery,
    useGetFieldStatusesQuery,
    useGetAccountStatusQuery,
    // Super Admin
    useGetPendingFieldApprovalsQuery,
    useGetFieldApprovalDetailQuery,
    useApproveFieldChangeMutation,
    useRejectFieldChangeMutation,
    useQueryFieldChangeMutation,
    useBulkApproveFieldChangesMutation,
    // Publish Status
    useGetPublishStatusQuery,
    useUpdatePublishStatusMutation,
    // Per-Type Publish Status
    useGetPublishStatusByTypeQuery,
    useUpdatePublishStatusByTypeMutation,
} = fieldApprovalEndpoints;

export default fieldApprovalEndpoints;
