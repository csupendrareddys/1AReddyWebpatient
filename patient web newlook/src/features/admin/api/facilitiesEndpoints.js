/**
 * Hospital + Clinic admin endpoints (RTK Query).
 *
 * Surfaces:
 *   GET    /api/admin/hospitals               — paginated list
 *   GET    /api/admin/hospitals/<id>          — detail + presigned docs
 *   PUT    /api/admin/hospitals/<id>/verification
 *   GET    /api/admin/clinics                 — paginated list
 *   GET    /api/admin/clinics/<id>            — detail + presigned docs
 *   PUT    /api/admin/clinics/<id>/verification
 *
 * Single file because the two resources mirror each other exactly —
 * a future "/api/admin/<vertical>" generalisation can fold both into
 * one factory.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const ADMIN_URL = '/api/admin';

const facilitiesEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ── Hospitals ─────────────────────────────────────────────
        getHospitals: builder.query({
            query: (params = {}) => ({
                url: `${ADMIN_URL}/hospitals`,
                method: 'GET',
                params,
            }),
            transformResponse: (response) => ({
                hospitals: response?.data?.hospitals || [],
                pagination: response?.data?.pagination || { total: 0 },
            }),
            providesTags: (result) =>
                result
                    ? [
                          ...result.hospitals.map(({ id }) => ({ type: 'Hospital', id })),
                          { type: 'Hospital', id: 'LIST' },
                      ]
                    : [{ type: 'Hospital', id: 'LIST' }],
        }),

        getHospitalDetail: builder.query({
            query: (hospitalId) => ({
                url: `${ADMIN_URL}/hospitals/${hospitalId}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data,
            providesTags: (result, error, hospitalId) => [
                { type: 'Hospital', id: hospitalId },
            ],
        }),

        // Roster of doctors affiliated to one hospital — name, relation
        // type (employment_type) and status, plus summary counts. Powers
        // the "View Vendor" affiliated-doctors drill-down.
        getHospitalDoctors: builder.query({
            query: (hospitalId) => ({
                url: `${ADMIN_URL}/hospitals/${hospitalId}/doctors`,
                method: 'GET',
            }),
            transformResponse: (response) => ({
                facility: response?.data?.facility || null,
                doctors: response?.data?.doctors || [],
                counts: response?.data?.counts || { total: 0 },
            }),
            providesTags: (result, error, hospitalId) => [
                { type: 'Hospital', id: `${hospitalId}-DOCTORS` },
            ],
        }),

        updateHospitalVerification: builder.mutation({
            query: ({ hospitalId, verificationStatus }) => ({
                url: `${ADMIN_URL}/hospitals/${hospitalId}/verification`,
                method: 'PUT',
                data: { verification_status: verificationStatus },
            }),
            invalidatesTags: (result, error, { hospitalId }) => [
                { type: 'Hospital', id: hospitalId },
                { type: 'Hospital', id: 'LIST' },
            ],
        }),

        // Toggle the hospital admin user's account status independent
        // of the verification flow. Used by the operator to (re-)activate
        // a verified hospital whose admin user is stuck INACTIVE.
        updateHospitalAdminStatus: builder.mutation({
            query: ({ hospitalId, status }) => ({
                url: `${ADMIN_URL}/hospitals/${hospitalId}/admin-status`,
                method: 'PUT',
                data: { status },
            }),
            invalidatesTags: (result, error, { hospitalId }) => [
                { type: 'Hospital', id: hospitalId },
                { type: 'Hospital', id: 'LIST' },
            ],
        }),

        // ── Clinics ───────────────────────────────────────────────
        getClinics: builder.query({
            query: (params = {}) => ({
                url: `${ADMIN_URL}/clinics`,
                method: 'GET',
                params,
            }),
            transformResponse: (response) => ({
                clinics: response?.data?.clinics || [],
                pagination: response?.data?.pagination || { total: 0 },
            }),
            providesTags: (result) =>
                result
                    ? [
                          ...result.clinics.map(({ id }) => ({ type: 'Clinic', id })),
                          { type: 'Clinic', id: 'LIST' },
                      ]
                    : [{ type: 'Clinic', id: 'LIST' }],
        }),

        getClinicDetail: builder.query({
            query: (clinicId) => ({
                url: `${ADMIN_URL}/clinics/${clinicId}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data,
            providesTags: (result, error, clinicId) => [
                { type: 'Clinic', id: clinicId },
            ],
        }),

        // Roster of doctors affiliated to one clinic — mirror of the
        // hospital sibling above.
        getClinicDoctors: builder.query({
            query: (clinicId) => ({
                url: `${ADMIN_URL}/clinics/${clinicId}/doctors`,
                method: 'GET',
            }),
            transformResponse: (response) => ({
                facility: response?.data?.facility || null,
                doctors: response?.data?.doctors || [],
                counts: response?.data?.counts || { total: 0 },
            }),
            providesTags: (result, error, clinicId) => [
                { type: 'Clinic', id: `${clinicId}-DOCTORS` },
            ],
        }),

        updateClinicVerification: builder.mutation({
            query: ({ clinicId, verificationStatus }) => ({
                url: `${ADMIN_URL}/clinics/${clinicId}/verification`,
                method: 'PUT',
                data: { verification_status: verificationStatus },
            }),
            invalidatesTags: (result, error, { clinicId }) => [
                { type: 'Clinic', id: clinicId },
                { type: 'Clinic', id: 'LIST' },
            ],
        }),

        // Toggle the clinic admin user's account status — same shape as
        // the hospital sibling above. See its comment for rationale.
        updateClinicAdminStatus: builder.mutation({
            query: ({ clinicId, status }) => ({
                url: `${ADMIN_URL}/clinics/${clinicId}/admin-status`,
                method: 'PUT',
                data: { status },
            }),
            invalidatesTags: (result, error, { clinicId }) => [
                { type: 'Clinic', id: clinicId },
                { type: 'Clinic', id: 'LIST' },
            ],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetHospitalsQuery,
    useGetHospitalDetailQuery,
    useGetHospitalDoctorsQuery,
    useUpdateHospitalVerificationMutation,
    useUpdateHospitalAdminStatusMutation,
    useGetClinicsQuery,
    useGetClinicDetailQuery,
    useGetClinicDoctorsQuery,
    useUpdateClinicVerificationMutation,
    useUpdateClinicAdminStatusMutation,
} = facilitiesEndpoints;

export default facilitiesEndpoints;
