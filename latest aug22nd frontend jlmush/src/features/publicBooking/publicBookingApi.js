/**
 * RTK Query slice for the public anonymous-booking flow.
 *
 * Backed by ``/api/v1/public/booking/*`` (anonymous, tenant resolved from
 * host) and the ``/auth/login-via-otp`` + ``/auth/set-initial-password``
 * endpoints used in the post-payment first-login leg.
 *
 * All endpoints transformResponse to unwrap the standard envelope so
 * components consume ``data`` shape directly without knowing about the
 * ``{success, data, ...}`` wrapper.
 */
import { apiSlice } from '../../app/api/apiSlice';

const PUBLIC = '/api/v1/public/booking';

const publicBookingEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ── Catalog reads ──────────────────────────────────────── //

        getPublicSpecializations: builder.query({
            query: () => ({ url: `${PUBLIC}/specializations`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'PublicBookingSpecialization', id: 'LIST' }],
        }),

        getPublicBookingDoctors: builder.query({
            query: ({ specializationId, consultationType, name, page = 1, perPage = 20 } = {}) => ({
                url: `${PUBLIC}/doctors`,
                method: 'GET',
                params: {
                    ...(specializationId ? { specialization_id: specializationId } : {}),
                    ...(consultationType ? { consultation_type: consultationType } : {}),
                    ...(name ? { name } : {}),
                    page,
                    per_page: perPage,
                },
            }),
            transformResponse: (response) => response?.data
                || { items: [], page: 1, per_page: 20, total: 0 },
            providesTags: [{ type: 'PublicBookingDoctor', id: 'LIST' }],
        }),

        getPublicDoctorTimeslots: builder.query({
            // ``date`` is required, ISO ``YYYY-MM-DD``. Cache key
            // keys off (doctorId, date, consultationType) so switching
            // dates / consultation types triggers a fresh fetch.
            query: ({ doctorId, date, consultationType }) => ({
                url: `${PUBLIC}/doctors/${doctorId}/timeslots`,
                method: 'GET',
                params: {
                    date,
                    ...(consultationType ? { consultation_type: consultationType } : {}),
                },
            }),
            transformResponse: (response) => response?.data || [],
            // Fresh-on-focus: a slot picker should reflect race
            // condition losses without a manual refresh.
            keepUnusedDataFor: 30,
            providesTags: (result, error, arg) => [
                { type: 'PublicBookingSlot', id: `${arg.doctorId}/${arg.date}` },
            ],
        }),

        // ── Booking transaction ────────────────────────────────── //

        initiatePublicBooking: builder.mutation({
            query: (data) => ({
                url: `${PUBLIC}/initiate`,
                method: 'POST',
                data,
            }),
            // The slot becomes "held" by us — invalidate the slot list
            // so re-fetches hide it from concurrent visitors.
            invalidatesTags: (result, error, arg) => [
                { type: 'PublicBookingSlot', id: `${arg.doctor_id}/${arg.dateKey || ''}` },
                { type: 'PublicBookingSlot', id: 'LIST' },
            ],
        }),

        verifyPublicBooking: builder.mutation({
            query: (data) => ({
                url: `${PUBLIC}/verify`,
                method: 'POST',
                data,
            }),
            // After verify, the slot is hard-booked; refresh listings.
            invalidatesTags: [
                { type: 'PublicBookingSlot', id: 'LIST' },
                { type: 'PublicBookingDoctor', id: 'LIST' },
            ],
        }),

        // ── Auth handoff: first-time password set ───────────────── //
        //
        // ``sendLoginOtp`` + ``loginViaOtp`` used to live here as well,
        // but they duplicated the SAME mutation names already defined
        // in ``authEndpoints.js`` — both modules call
        // ``apiSlice.injectEndpoints`` against the SHARED apiSlice, so
        // whichever module imported first won and the other was
        // silently ignored (``overrideExisting: false``). When the
        // public module won, LoginForm's snake_case ``phone_number``
        // arg destructured to ``undefined`` against the public mutation
        // (which expected camelCase ``phoneNumber``), the request body
        // dropped the field, and the backend returned 422 "missing
        // phone_number". Single source of truth is now authEndpoints.

        setInitialPassword: builder.mutation({
            query: (newPassword) => ({
                url: '/api/v1/auth/set-initial-password',
                method: 'POST',
                data: { new_password: newPassword },
            }),
        }),
    }),
});

export const {
    useGetPublicSpecializationsQuery,
    useGetPublicBookingDoctorsQuery,
    useGetPublicDoctorTimeslotsQuery,
    useInitiatePublicBookingMutation,
    useVerifyPublicBookingMutation,
    useSetInitialPasswordMutation,
} = publicBookingEndpoints;

// Re-export from authEndpoints so existing consumers (FirstLoginOtpPage)
// don't break — they imported these from this module before the
// duplicate definitions were consolidated.
export {
    useSendLoginOtpMutation,
    useLoginViaOtpMutation,
} from '../auth/api/authEndpoints';

export default publicBookingEndpoints;
