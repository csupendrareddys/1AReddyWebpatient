/**
 * Doctor Analytics Endpoints (RTK Query)
 * Metrics, appointment settings, and live status management.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const API_BASE = '/api/doctor-analytics';

const doctorAnalyticsEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // Get current doctor's profile ID (for doctor role)
        getMyDoctorId: builder.query({
            query: () => ({
                url: `${API_BASE}/me`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data?.doctor_id || null,
        }),

        // Get analytics metrics for a doctor
        getDoctorAnalyticsMetrics: builder.query({
            query: ({ doctorId, period = 'day', date }) => ({
                url: `${API_BASE}/${doctorId}/metrics`,
                method: 'GET',
                params: { period, ...(date ? { date } : {}) },
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, arg) => [
                { type: 'DoctorAnalytics', id: `METRICS_${arg.doctorId}` },
            ],
        }),

        // Get doctor settings (is_live, appointment modes)
        getDoctorAnalyticsSettings: builder.query({
            query: ({ doctorId }) => ({
                url: `${API_BASE}/${doctorId}/settings`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, arg) => [
                { type: 'DoctorAnalytics', id: `SETTINGS_${arg.doctorId}` },
            ],
        }),

        // Update doctor settings
        updateDoctorAnalyticsSettings: builder.mutation({
            query: ({ doctorId, ...data }) => ({
                url: `${API_BASE}/${doctorId}/settings`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'DoctorAnalytics', id: `SETTINGS_${arg.doctorId}` },
                { type: 'DoctorAnalytics', id: `METRICS_${arg.doctorId}` },
                { type: 'Doctor', id: arg.doctorId },
            ],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetMyDoctorIdQuery,
    useGetDoctorAnalyticsMetricsQuery,
    useGetDoctorAnalyticsSettingsQuery,
    useUpdateDoctorAnalyticsSettingsMutation,
} = doctorAnalyticsEndpoints;

export default doctorAnalyticsEndpoints;
