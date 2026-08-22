/**
 * Admin document-approval endpoints — /api/admin/document-config/*.
 *
 * The approval half of `prescriptionConfigEndpoints`. There is no template
 * CRUD here on purpose: documents render with the prescription letterhead,
 * so `/api/v1/admin/prescription-config/template` stays the one place a
 * template is edited (see the backend module docstring).
 */
import { apiSlice } from '../../../app/api/apiSlice';

const ADMIN_URL = '/api/v1/admin/document-config';

const documentConfigEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // status: pending | approved | rejected | all
        getDocumentApprovals: builder.query({
            query: (params = {}) => {
                const qs = new URLSearchParams(params).toString();
                return { url: `${ADMIN_URL}/pending-approvals?${qs}`, method: 'GET' };
            },
            transformResponse: (res) => res.data || {},
            providesTags: ['DocumentApprovals'],
        }),
        getAdminDocument: builder.query({
            query: (id) => ({ url: `${ADMIN_URL}/document/${id}`, method: 'GET' }),
            transformResponse: (res) => res.data || {},
            providesTags: (result, error, id) => [{ type: 'DocumentApprovals', id }],
        }),
        approveDocument: builder.mutation({
            query: (id) => ({ url: `${ADMIN_URL}/approve/${id}`, method: 'POST' }),
            // Also invalidates 'Document' so the doctor's own list reflects
            // the new status without a hard refresh.
            invalidatesTags: ['DocumentApprovals', { type: 'Document', id: 'LIST' }],
        }),
        rejectDocument: builder.mutation({
            query: ({ id, reason }) => ({
                url: `${ADMIN_URL}/reject/${id}`, method: 'POST', data: { reason },
            }),
            invalidatesTags: ['DocumentApprovals', { type: 'Document', id: 'LIST' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetDocumentApprovalsQuery,
    useGetAdminDocumentQuery,
    useApproveDocumentMutation,
    useRejectDocumentMutation,
} = documentConfigEndpoints;
