/**
 * Doctor Approvals Endpoints (RTK Query)
 * Super admin actions: slot visibility approvals + doctor admin requests.
 */
import { apiSlice } from '../../../app/api/apiSlice';
import {
    doctorScopedUrl, splitScope,
} from '../../service-provider/api/doctorScope';

const DOCTOR_URL = '/api/doctor';

const doctorApprovalsEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ── Slot Visibility — Doctor side ──

        // Scoped: the Slot Visibility tab is one of the doctor-profile tabs
        // Operations mounts, so "my" means the doctor being acted on there.
        getSlotVisibility: builder.query({
            query: (arg) => ({
                url: doctorScopedUrl(splitScope(arg)[0], '/slot-visibility'),
                method: 'GET',
            }),
            transformResponse: (res) => res?.data || {},
            providesTags: [{ type: 'SlotVisibilityApproval', id: 'MY' }],
        }),

        submitSlotVisibility: builder.mutation({
            query: (arg) => {
                const [ops, gapByType] = splitScope(arg);
                return {
                    url: doctorScopedUrl(ops, '/slot-visibility'),
                    method: 'PUT',
                    data: { gap_by_type: gapByType },
                };
            },
            invalidatesTags: [
                { type: 'SlotVisibilityApproval', id: 'MY' },
                { type: 'SlotVisibilityApproval', id: 'LIST' },
            ],
        }),

        // ── Slot Visibility — Admin Approvals ──

        getPendingSlotVisibilityRequests: builder.query({
            query: () => ({ url: `${DOCTOR_URL}/slot-visibility/pending`, method: 'GET' }),
            transformResponse: (res) => res?.data?.requests || [],
            providesTags: [{ type: 'SlotVisibilityApproval', id: 'LIST' }],
        }),

        approveSlotVisibility: builder.mutation({
            query: (doctorId) => ({
                url: `${DOCTOR_URL}/slot-visibility/${doctorId}/approve`,
                method: 'POST',
            }),
            invalidatesTags: [{ type: 'SlotVisibilityApproval', id: 'LIST' }],
        }),

        rejectSlotVisibility: builder.mutation({
            query: ({ doctorId, reason }) => ({
                url: `${DOCTOR_URL}/slot-visibility/${doctorId}/reject`,
                method: 'POST',
                data: { reason },
            }),
            invalidatesTags: [{ type: 'SlotVisibilityApproval', id: 'LIST' }],
        }),

        // ── Doctor Admin Requests ──

        getAllDoctorAdminRequests: builder.query({
            query: ({ status, page = 1, perPage = 20 } = {}) => ({
                url: `${DOCTOR_URL}/admin-requests/all`,
                method: 'GET',
                params: { status, page, per_page: perPage },
            }),
            transformResponse: (res) => res?.data || { requests: [], total: 0, page: 1, pages: 1 },
            providesTags: [{ type: 'DoctorAdminRequest', id: 'LIST' }],
        }),

        respondDoctorAdminRequest: builder.mutation({
            query: ({ requestId, status, adminResponse }) => ({
                url: `${DOCTOR_URL}/admin-requests/${requestId}/respond`,
                method: 'PUT',
                data: { status, admin_response: adminResponse },
            }),
            invalidatesTags: [{ type: 'DoctorAdminRequest', id: 'LIST' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetSlotVisibilityQuery,
    useSubmitSlotVisibilityMutation,
    useGetPendingSlotVisibilityRequestsQuery,
    useApproveSlotVisibilityMutation,
    useRejectSlotVisibilityMutation,
    useGetAllDoctorAdminRequestsQuery,
    useRespondDoctorAdminRequestMutation,
} = doctorApprovalsEndpoints;

export default doctorApprovalsEndpoints;
