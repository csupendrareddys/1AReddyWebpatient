/**
 * Appointment Endpoints (RTK Query)
 * Replaces: adminService.js listAppointments
 */
import { apiSlice } from '../../../app/api/apiSlice';

const ADMIN_URL = '/api/admin';

const appointmentsEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // List all appointments with pagination and status filter
        getAppointments: builder.query({
            query: (params = {}) => ({
                url: `${ADMIN_URL}/appointments`,
                method: 'GET',
                params,
            }),
            transformResponse: (response) => ({
                appointments: response.data?.appointments || [],
                pagination: response.data?.pagination || { total: 0 },
            }),
            providesTags: (result) =>
                result
                    ? [
                          ...result.appointments.map(({ id }) => ({ type: 'Appointment', id })),
                          { type: 'Appointment', id: 'LIST' },
                      ]
                    : [{ type: 'Appointment', id: 'LIST' }],
        }),
    }),
    overrideExisting: false,
});

export const { useGetAppointmentsQuery } = appointmentsEndpoints;
