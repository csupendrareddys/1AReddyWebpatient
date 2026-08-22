/**
 * Admin doctor-billing endpoints (RTK Query) — Phase 2.
 * Convert a doctor's billing type, edit the employment agreement, and
 * generate/settle salary payouts.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const URL = '/api/v1/admin/doctor-billing';

export const doctorBillingEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getDoctorBilling: builder.query({
            query: (doctorId) => ({ url: `${URL}/${doctorId}`, method: 'GET' }),
            transformResponse: (res) => res.data || {},
            providesTags: (r, e, id) => [{ type: 'DoctorBilling', id }],
        }),
        convertDoctorType: builder.mutation({
            query: ({ doctorId, ...data }) => ({ url: `${URL}/${doctorId}/convert`, method: 'PUT', data }),
            invalidatesTags: (r, e, { doctorId }) => [{ type: 'DoctorBilling', id: doctorId }],
        }),
        updateAgreement: builder.mutation({
            query: ({ doctorId, ...data }) => ({ url: `${URL}/${doctorId}/agreement`, method: 'PUT', data }),
            invalidatesTags: (r, e, { doctorId }) => [{ type: 'DoctorBilling', id: doctorId }],
        }),
        generateSalaryPayout: builder.mutation({
            query: ({ doctorId, ...data }) => ({ url: `${URL}/${doctorId}/salary-payouts`, method: 'POST', data }),
            invalidatesTags: ['SalaryPayout'],
        }),
        getSalaryPayouts: builder.query({
            query: (params = {}) => ({ url: `${URL}/salary-payouts`, method: 'GET', params }),
            transformResponse: (res) => res.data?.salary_payouts || [],
            providesTags: ['SalaryPayout'],
        }),
        updateSalaryStatus: builder.mutation({
            query: ({ id, ...data }) => ({ url: `${URL}/salary-payouts/${id}/status`, method: 'PUT', data }),
            invalidatesTags: ['SalaryPayout'],
        }),
        // Record an admin correction (LWP / penalty / bonus / fix). The original
        // salary is never overwritten — this appends to the audit trail.
        adjustSalaryPayout: builder.mutation({
            query: ({ id, ...data }) => ({ url: `${URL}/salary-payouts/${id}/adjust`, method: 'POST', data }),
            invalidatesTags: ['SalaryPayout'],
        }),
        // Release a salary to the doctor. Does NOT send money — the doctor's
        // claim does, mirroring the per-patient rail.
        pushSalaryPayout: builder.mutation({
            query: ({ id }) => ({ url: `${URL}/salary-payouts/${id}/push`, method: 'POST' }),
            invalidatesTags: ['SalaryPayout'],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetDoctorBillingQuery,
    useConvertDoctorTypeMutation,
    useUpdateAgreementMutation,
    useGenerateSalaryPayoutMutation,
    useGetSalaryPayoutsQuery,
    useUpdateSalaryStatusMutation,
    useAdjustSalaryPayoutMutation,
    usePushSalaryPayoutMutation,
} = doctorBillingEndpoints;
