/**
 * Patient Endpoints (RTK Query)
 * Replaces: adminService.js listPatients + updatePatientStatus
 */
import { apiSlice } from '../../../app/api/apiSlice';

const ADMIN_URL = '/api/admin';

const patientsEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // List all patients with pagination and search
        getPatients: builder.query({
            query: (params = {}) => ({
                url: `${ADMIN_URL}/patients`,
                method: 'GET',
                params,
            }),
            transformResponse: (response) => ({
                patients: response.data?.patients || [],
                pagination: response.data?.pagination || { total: 0 },
            }),
            providesTags: (result) =>
                result
                    ? [
                          ...result.patients.map(({ id }) => ({ type: 'Patient', id })),
                          { type: 'Patient', id: 'LIST' },
                      ]
                    : [{ type: 'Patient', id: 'LIST' }],
        }),

        // List corporate customers (patients with a non-individual entity).
        getCorporateCustomers: builder.query({
            query: (params = {}) => ({
                url: `${ADMIN_URL}/corporate-customers`,
                method: 'GET',
                params,
            }),
            transformResponse: (response) => ({
                customers: response.data?.customers || [],
                pagination: response.data?.pagination || { total: 0 },
            }),
            providesTags: [{ type: 'Patient', id: 'CORPORATE_LIST' }],
        }),

        // Per-customer booking history (appointments + services + group)
        // with lifecycle, prescription milestones and payment.
        getCustomerHistory: builder.query({
            query: (patientId) => ({
                url: `${ADMIN_URL}/appointments-ledger/customer/${patientId}`,
                method: 'GET',
            }),
            transformResponse: (response) => ({
                rows: response.data?.rows || [],
                summary: response.data?.summary || { total_bookings: 0 },
            }),
            providesTags: (result, error, patientId) => [
                { type: 'Patient', id: `${patientId}-HISTORY` },
            ],
        }),

        // Update patient status
        updatePatientStatus: builder.mutation({
            query: ({ patientId, status }) => ({
                url: `${ADMIN_URL}/patients/${patientId}/status`,
                method: 'PUT',
                data: { status },
            }),
            invalidatesTags: (result, error, { patientId }) => [
                { type: 'Patient', id: patientId },
                { type: 'Patient', id: 'LIST' },
            ],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetPatientsQuery,
    useGetCorporateCustomersQuery,
    useGetCustomerHistoryQuery,
    useUpdatePatientStatusMutation,
} = patientsEndpoints;
