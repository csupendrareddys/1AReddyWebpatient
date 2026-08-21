/**
 * Doctor Attendance & Activity Endpoints (RTK Query)
 * Metrics, appointment tracking flags, metric overrides, and admin config.
 */
import { apiSlice } from '../../../app/api/apiSlice';
import { apiScopedUrl, splitScope } from '../../service-provider/api/doctorScope';

const API_BASE = '/api/doctor-attendance';

const doctorAttendanceEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ── Acceptance Metrics ──
        getAcceptanceMetrics: builder.query({
            query: ({ doctorId, period = 'day', date, consultationType }) => ({
                url: `${API_BASE}/${doctorId}/acceptance-metrics`,
                method: 'GET',
                params: {
                    period,
                    ...(date ? { date } : {}),
                    ...(consultationType ? { consultation_type: consultationType } : {}),
                },
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, arg) => [
                { type: 'DoctorAttendance', id: `METRICS_${arg.doctorId}` },
            ],
        }),

        // ── Doctor Actions ──
        // Scoped: unlike the metrics endpoints above, which take the doctor as
        // a path parameter and are admin-callable as-is, this one resolves the
        // doctor from ``current_user`` — so from Operations it has to go
        // through the act-on-behalf proxy or it 403s.
        verifyAppointment: builder.mutation({
            query: (arg) => {
                const [ops, { appointmentId }] = splitScope(arg);
                return {
                    url: apiScopedUrl(ops, `/doctor-attendance/appointments/${appointmentId}/verify`),
                    method: 'POST',
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'DoctorAttendance' },
                { type: 'Appointment' },
            ],
        }),

        doctorAcceptAppointment: builder.mutation({
            query: ({ appointmentId }) => ({
                url: `${API_BASE}/appointments/${appointmentId}/doctor-accept`,
                method: 'POST',
            }),
            invalidatesTags: [{ type: 'DoctorAttendance' }, { type: 'Appointment' }],
        }),

        doctorRejectAppointment: builder.mutation({
            query: ({ appointmentId, reason }) => ({
                url: `${API_BASE}/appointments/${appointmentId}/doctor-reject`,
                method: 'POST',
                data: { reason },
            }),
            invalidatesTags: [{ type: 'DoctorAttendance' }, { type: 'Appointment' }],
        }),

        doctorCancelAppointment: builder.mutation({
            query: ({ appointmentId, reason }) => ({
                url: `${API_BASE}/appointments/${appointmentId}/doctor-cancel`,
                method: 'POST',
                data: { reason },
            }),
            invalidatesTags: [{ type: 'DoctorAttendance' }, { type: 'Appointment' }],
        }),

        // ── Execution Stage Metrics ──
        getExecutionMetrics: builder.query({
            query: ({ doctorId, period = 'day', date, consultationType }) => ({
                url: `${API_BASE}/${doctorId}/execution-metrics`,
                method: 'GET',
                params: {
                    period,
                    ...(date ? { date } : {}),
                    ...(consultationType ? { consultation_type: consultationType } : {}),
                },
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, arg) => [
                { type: 'DoctorAttendance', id: `EXEC_${arg.doctorId}` },
            ],
        }),

        // ── Live / Call Stage Metrics ──
        getLiveCallMetrics: builder.query({
            query: ({ doctorId, period = 'day', date, consultationType }) => ({
                url: `${API_BASE}/${doctorId}/livecall-metrics`,
                method: 'GET',
                params: {
                    period,
                    ...(date ? { date } : {}),
                    ...(consultationType ? { consultation_type: consultationType } : {}),
                },
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, arg) => [
                { type: 'DoctorAttendance', id: `LIVE_${arg.doctorId}` },
            ],
        }),

        // ── Execution Actions ──
        markDoctorJoined: builder.mutation({
            query: ({ appointmentId }) => ({
                url: `${API_BASE}/appointments/${appointmentId}/doctor-joined`,
                method: 'POST',
            }),
            invalidatesTags: [{ type: 'DoctorAttendance' }, { type: 'Appointment' }],
        }),

        markPatientJoined: builder.mutation({
            query: ({ appointmentId }) => ({
                url: `${API_BASE}/appointments/${appointmentId}/patient-joined`,
                method: 'POST',
            }),
            invalidatesTags: [{ type: 'DoctorAttendance' }, { type: 'Appointment' }],
        }),

        markMissed: builder.mutation({
            query: ({ appointmentId, missedBy }) => ({
                url: `${API_BASE}/appointments/${appointmentId}/mark-missed`,
                method: 'POST',
                data: { missed_by: missedBy },
            }),
            invalidatesTags: [{ type: 'DoctorAttendance' }, { type: 'Appointment' }],
        }),

        // ── Live/Call Actions ──
        trackMediaUsage: builder.mutation({
            query: ({ appointmentId, mediaType }) => ({
                url: `${API_BASE}/appointments/${appointmentId}/track-media`,
                method: 'POST',
                data: { media_type: mediaType },
            }),
            invalidatesTags: [{ type: 'DoctorAttendance' }, { type: 'Appointment' }],
        }),

        // ── Metric Overrides ──
        getMetricOverrides: builder.query({
            query: ({ doctorId, status }) => ({
                url: `${API_BASE}/${doctorId}/metric-overrides`,
                method: 'GET',
                params: status ? { status } : {},
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, arg) => [
                { type: 'DoctorAttendance', id: `OVERRIDES_${arg.doctorId}` },
            ],
        }),

        submitMetricOverride: builder.mutation({
            query: ({ doctorId, ...data }) => ({
                url: `${API_BASE}/${doctorId}/metric-overrides`,
                method: 'POST',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'DoctorAttendance', id: `OVERRIDES_${arg.doctorId}` },
            ],
        }),

        reviewMetricOverride: builder.mutation({
            query: ({ overrideId, status, comment }) => ({
                url: `${API_BASE}/metric-overrides/${overrideId}/review`,
                method: 'PUT',
                data: { status, comment },
            }),
            invalidatesTags: [{ type: 'DoctorAttendance' }],
        }),

        // ── Attendance Page Config ──
        getAttendanceConfig: builder.query({
            query: ({ doctorId } = {}) => ({
                url: `${API_BASE}/config`,
                method: 'GET',
                params: doctorId ? { doctor_id: doctorId } : {},
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'DoctorAttendance', id: 'CONFIG' }],
        }),

        updateAttendanceConfig: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/config`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [{ type: 'DoctorAttendance', id: 'CONFIG' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetAcceptanceMetricsQuery,
    useGetExecutionMetricsQuery,
    useGetLiveCallMetricsQuery,
    useVerifyAppointmentMutation,
    useDoctorAcceptAppointmentMutation,
    useDoctorRejectAppointmentMutation,
    useDoctorCancelAppointmentMutation,
    useMarkDoctorJoinedMutation,
    useMarkPatientJoinedMutation,
    useMarkMissedMutation,
    useTrackMediaUsageMutation,
    useGetMetricOverridesQuery,
    useSubmitMetricOverrideMutation,
    useReviewMetricOverrideMutation,
    useGetAttendanceConfigQuery,
    useUpdateAttendanceConfigMutation,
} = doctorAttendanceEndpoints;

export default doctorAttendanceEndpoints;
