/**
 * Clinic branch endpoints — base ``/api/v1/clinic/branches``.
 *
 * A main clinic manages its login-less BRANCH clinics here (list / create /
 * edit / remove). Switching INTO a branch to edit its Entity Profile rides the
 * shared facility scope (``facilityScope.js`` with ``kind:'branch'``), not these
 * hooks. Owner-only on the backend (``@role_required(CLINIC)``).
 */
import { apiSlice } from '../../../../app/api/apiSlice';

const BASE = '/api/v1/clinic/branches';

const clinicBranchEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getClinicBranches: builder.query({
            query: () => ({ url: BASE, method: 'GET' }),
            transformResponse: (r) => r?.data?.branches || [],
            providesTags: [{ type: 'ClinicBranch', id: 'LIST' }],
        }),
        createClinicBranch: builder.mutation({
            query: (body) => ({ url: BASE, method: 'POST', data: body }),
            invalidatesTags: [{ type: 'ClinicBranch', id: 'LIST' }],
        }),
        updateClinicBranch: builder.mutation({
            query: ({ branchId, ...body }) => ({ url: `${BASE}/${branchId}`, method: 'PUT', data: body }),
            invalidatesTags: [{ type: 'ClinicBranch', id: 'LIST' }],
        }),
        deleteClinicBranch: builder.mutation({
            query: (branchId) => ({ url: `${BASE}/${branchId}`, method: 'DELETE' }),
            invalidatesTags: [{ type: 'ClinicBranch', id: 'LIST' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetClinicBranchesQuery,
    useCreateClinicBranchMutation,
    useUpdateClinicBranchMutation,
    useDeleteClinicBranchMutation,
} = clinicBranchEndpoints;

export default clinicBranchEndpoints;
