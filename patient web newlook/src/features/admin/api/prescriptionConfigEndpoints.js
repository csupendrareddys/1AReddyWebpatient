import { apiSlice } from '../../../app/api/apiSlice';

const ADMIN_URL = '/api/admin/prescription-config';

const prescriptionConfigEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // Template
        getPrescriptionTemplate: builder.query({
            query: () => ({ url: `${ADMIN_URL}/template`, method: 'GET' }),
            transformResponse: (res) => res.data || {},
            providesTags: ['PrescriptionTemplate'],
        }),
        updatePrescriptionTemplate: builder.mutation({
            query: (data) => ({ url: `${ADMIN_URL}/template`, method: 'PUT', data }),
            invalidatesTags: ['PrescriptionTemplate'],
        }),
        uploadTemplateLogo: builder.mutation({
            query: (file) => {
                const formData = new FormData();
                formData.append('file', file);
                return { url: `${ADMIN_URL}/template/upload-logo`, method: 'POST', data: formData };
            },
            invalidatesTags: ['PrescriptionTemplate'],
        }),
        uploadRxSymbol: builder.mutation({
            query: (file) => {
                const formData = new FormData();
                formData.append('file', file);
                return { url: `${ADMIN_URL}/template/upload-rx-symbol`, method: 'POST', data: formData };
            },
            invalidatesTags: ['PrescriptionTemplate'],
        }),

        // Single prescription view (for admin review)
        getAdminPrescription: builder.query({
            query: (id) => ({ url: `${ADMIN_URL}/prescription/${id}`, method: 'GET' }),
            transformResponse: (res) => res.data || {},
        }),

        // Approvals
        getPendingApprovals: builder.query({
            query: (params = {}) => {
                const qs = new URLSearchParams(params).toString();
                return { url: `${ADMIN_URL}/pending-approvals?${qs}`, method: 'GET' };
            },
            transformResponse: (res) => res.data || {},
            providesTags: ['PrescriptionApprovals'],
        }),
        approvePrescription: builder.mutation({
            query: (id) => ({ url: `${ADMIN_URL}/approve/${id}`, method: 'POST' }),
            invalidatesTags: ['PrescriptionApprovals'],
        }),
        rejectPrescription: builder.mutation({
            query: ({ id, reason }) => ({ url: `${ADMIN_URL}/reject/${id}`, method: 'POST', data: { reason } }),
            invalidatesTags: ['PrescriptionApprovals'],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetPrescriptionTemplateQuery,
    useUpdatePrescriptionTemplateMutation,
    useUploadTemplateLogoMutation,
    useUploadRxSymbolMutation,
    useGetAdminPrescriptionQuery,
    useGetPendingApprovalsQuery,
    useApprovePrescriptionMutation,
    useRejectPrescriptionMutation,
} = prescriptionConfigEndpoints;
