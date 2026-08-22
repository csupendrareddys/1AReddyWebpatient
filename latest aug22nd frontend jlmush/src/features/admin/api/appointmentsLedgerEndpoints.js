/**
 * Admin Appointments Ledger — read-only aggregated booking / payment / payout /
 * margin ledger across consultations, service orders and group offerings.
 *
 * Fetch-only: one GET that returns fully-computed rows; there are no mutations.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const API_BASE = '/api/v1/admin/appointments-ledger';

const appointmentsLedgerEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getAppointmentsLedger: builder.query({
            // ``types`` is an optional array of product-type filters
            // (service_plan, group_plan, video, audio, chat, voice, home_visit).
            query: ({ types, page = 1, per_page = 50 } = {}) => {
                const params = new URLSearchParams();
                params.set('page', page);
                params.set('per_page', per_page);
                (types || []).forEach((t) => params.append('type', t));
                return { url: `${API_BASE}?${params.toString()}`, method: 'GET' };
            },
            transformResponse: (res) => res?.data || { rows: [], pagination: {} },
            providesTags: [{ type: 'AppointmentsLedger', id: 'LIST' }],
        }),
    }),
});

export const { useGetAppointmentsLedgerQuery } = appointmentsLedgerEndpoints;
export default appointmentsLedgerEndpoints;
