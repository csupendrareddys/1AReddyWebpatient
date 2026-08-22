/**
 * Family Doctor / Empanelment RTK endpoints. Base /api/family-doctor.
 * Used by both the patient (Family Doctor) and doctor (Panel Patients) pages.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const URL = '/api/v1/family-doctor';

const familyDoctorEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ── Patient side ──────────────────────────────────────────────
        getMyFamilyDoctor: builder.query({
            query: () => ({ url: `${URL}/me`, method: 'GET' }),
            transformResponse: (r) => r?.data?.family_doctor || null,
            providesTags: [{ type: 'FamilyDoctor', id: 'MINE' }],
        }),
        searchFamilyDoctors: builder.query({
            query: (q) => ({ url: `${URL}/doctors/search`, method: 'GET', params: { q } }),
            transformResponse: (r) => r?.data?.doctors || [],
        }),
        requestFamilyDoctor: builder.mutation({
            query: (body) => ({ url: `${URL}/request`, method: 'POST', data: body }),
            invalidatesTags: [{ type: 'FamilyDoctor', id: 'REQUESTS' }],
        }),
        joinFamilyDoctorByCode: builder.mutation({
            query: (code) => ({ url: `${URL}/join`, method: 'POST', data: { code } }),
            invalidatesTags: [{ type: 'FamilyDoctor', id: 'MINE' }],
        }),
        delinkMyFamilyDoctor: builder.mutation({
            query: () => ({ url: `${URL}/me`, method: 'DELETE' }),
            invalidatesTags: [{ type: 'FamilyDoctor', id: 'MINE' }],
        }),
        // The patient's OWN completed bookings + prescriptions (same table the
        // family doctor sees) so they can request a second opinion.
        getMySecondOpinionBookings: builder.query({
            query: () => ({ url: `${URL}/me/bookings`, method: 'GET' }),
            transformResponse: (r) => r?.data || { has_family_doctor: false, bookings: [] },
            providesTags: [{ type: 'FamilyDoctor', id: 'MY_BOOKINGS' }],
        }),
        startMySecondOpinion: builder.mutation({
            query: (body) => ({ url: `${URL}/me/second-opinion`, method: 'POST', data: body }),
            transformResponse: (r) => r?.data,
        }),

        // ── Doctor side ───────────────────────────────────────────────
        getEmpanelledPatients: builder.query({
            query: () => ({ url: `${URL}/patients`, method: 'GET' }),
            transformResponse: (r) => r?.data?.patients || [],
            providesTags: [{ type: 'FamilyDoctor', id: 'PANEL' }],
        }),
        getEmpanelledPatientBookings: builder.query({
            query: (patientId) => ({ url: `${URL}/patients/${patientId}/bookings`, method: 'GET' }),
            transformResponse: (r) => r?.data || { bookings: [] },
        }),
        generateEmpanelCode: builder.mutation({
            query: () => ({ url: `${URL}/generate-code`, method: 'POST' }),
            transformResponse: (r) => r?.data,
        }),
        requestPatient: builder.mutation({
            query: (body) => ({ url: `${URL}/patients/request`, method: 'POST', data: body }),
            invalidatesTags: [{ type: 'FamilyDoctor', id: 'REQUESTS' }],
        }),
        delinkPatient: builder.mutation({
            query: (patientId) => ({ url: `${URL}/patients/${patientId}`, method: 'DELETE' }),
            invalidatesTags: [{ type: 'FamilyDoctor', id: 'PANEL' }],
        }),
        startSecondOpinion: builder.mutation({
            query: (body) => ({ url: `${URL}/second-opinion`, method: 'POST', data: body }),
            transformResponse: (r) => r?.data,
        }),
        getSecondOpinionWallet: builder.query({
            query: () => ({ url: `${URL}/second-opinion/wallet`, method: 'GET' }),
            transformResponse: (r) => r?.data || { balance: 0, threshold: 0, ledger: [] },
            providesTags: [{ type: 'FamilyDoctor', id: 'SO_WALLET' }],
        }),
        redeemSecondOpinion: builder.mutation({
            query: (body = {}) => ({ url: `${URL}/second-opinion/redeem`, method: 'POST', data: body }),
            invalidatesTags: [{ type: 'FamilyDoctor', id: 'SO_WALLET' }],
        }),

        // ── Shared: requests inbox + actions ──────────────────────────
        getFamilyDoctorRequests: builder.query({
            query: () => ({ url: `${URL}/requests`, method: 'GET' }),
            transformResponse: (r) => r?.data || { sent: [], received: [] },
            providesTags: [{ type: 'FamilyDoctor', id: 'REQUESTS' }],
        }),
        acceptFamilyDoctorRequest: builder.mutation({
            query: (id) => ({ url: `${URL}/requests/${id}/accept`, method: 'POST' }),
            invalidatesTags: [
                { type: 'FamilyDoctor', id: 'REQUESTS' },
                { type: 'FamilyDoctor', id: 'MINE' },
                { type: 'FamilyDoctor', id: 'PANEL' },
            ],
        }),
        rejectFamilyDoctorRequest: builder.mutation({
            query: (id) => ({ url: `${URL}/requests/${id}/reject`, method: 'POST' }),
            invalidatesTags: [{ type: 'FamilyDoctor', id: 'REQUESTS' }],
        }),
        cancelFamilyDoctorRequest: builder.mutation({
            query: (id) => ({ url: `${URL}/requests/${id}/cancel`, method: 'POST' }),
            invalidatesTags: [{ type: 'FamilyDoctor', id: 'REQUESTS' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetMyFamilyDoctorQuery,
    useLazySearchFamilyDoctorsQuery,
    useRequestFamilyDoctorMutation,
    useJoinFamilyDoctorByCodeMutation,
    useDelinkMyFamilyDoctorMutation,
    useGetMySecondOpinionBookingsQuery,
    useStartMySecondOpinionMutation,
    useGetEmpanelledPatientsQuery,
    useGetEmpanelledPatientBookingsQuery,
    useGenerateEmpanelCodeMutation,
    useRequestPatientMutation,
    useDelinkPatientMutation,
    useStartSecondOpinionMutation,
    useGetSecondOpinionWalletQuery,
    useRedeemSecondOpinionMutation,
    useGetFamilyDoctorRequestsQuery,
    useAcceptFamilyDoctorRequestMutation,
    useRejectFamilyDoctorRequestMutation,
    useCancelFamilyDoctorRequestMutation,
} = familyDoctorEndpoints;

export default familyDoctorEndpoints;
