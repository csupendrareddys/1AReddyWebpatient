/**
 * Patient Health Endpoints (RTK Query)
 * Manages health records, vitals, habits, surgeries, and house group requests.
 *
 * Every endpoint here is scope-aware: called with no scope it hits the
 * patient's own ``/api/patient/*`` route; called through the Operations
 * act-on-behalf scope (see ./patientScope.js) it hits the proxy for a specific
 * patient and gets its own cache entries + tags. Components don't opt in
 * field-by-field — they import the wrapped hooks from
 * ``ProfileSetting/api/scopedPatientApi`` and the scope comes from context.
 */
import { apiSlice } from '../../../app/api/apiSlice';
import {
    splitScope, scopeOf, patientScopedUrl, scopeTag, invalidatesProfile,
} from './patientScope';

const patientHealthEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ---- Health Records ----

        getHealthRecords: builder.query({
            query: (arg) => {
                const [scope, { page = 1, perPage = 20, recordType } = {}] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, '/health-records'),
                    method: 'GET',
                    params: { page, per_page: perPage, ...(recordType && { record_type: recordType }) },
                };
            },
            transformResponse: (response) => response?.data || response,
            providesTags: (r, e, arg) => [
                { type: 'HealthRecord', id: scopeTag(scopeOf(arg), 'LIST') },
            ],
        }),

        addHealthRecord: builder.mutation({
            query: (arg) => {
                const [scope, data] = splitScope(arg);
                return { url: patientScopedUrl(scope, '/health-records'), method: 'POST', data };
            },
            invalidatesTags: (r, e, arg) => invalidatesProfile(
                scopeOf(arg),
                { type: 'HealthRecord', id: scopeTag(scopeOf(arg), 'LIST') },
            ),
        }),

        getHealthRecord: builder.query({
            query: (arg) => {
                const [scope, recordId] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, `/health-records/${recordId}`),
                    method: 'GET',
                };
            },
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, arg) => {
                const [scope, recordId] = splitScope(arg);
                return [{ type: 'HealthRecord', id: scopeTag(scope, recordId) }];
            },
        }),

        updateHealthRecord: builder.mutation({
            query: (arg) => {
                const [scope, { recordId, data }] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, `/health-records/${recordId}`),
                    method: 'PUT',
                    data,
                };
            },
            invalidatesTags: (r, e, arg) => invalidatesProfile(
                scopeOf(arg),
                { type: 'HealthRecord', id: scopeTag(scopeOf(arg), 'LIST') },
            ),
        }),

        deleteHealthRecord: builder.mutation({
            query: (arg) => {
                const [scope, recordId] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, `/health-records/${recordId}`),
                    method: 'DELETE',
                };
            },
            invalidatesTags: (r, e, arg) => {
                const scope = scopeOf(arg);
                return invalidatesProfile(
                    scope,
                    { type: 'HealthRecord', id: scopeTag(scope, 'LIST') },
                    { type: 'HealthRecord', id: scopeTag(scope, 'SURGERIES') },
                    // Prescriptions live in the same table, filtered by type.
                    { type: 'HealthRecord', id: scopeTag(scope, 'TYPE_prescription') },
                );
            },
        }),

        getHealthRecordsByType: builder.query({
            query: (arg) => {
                const [scope, recordType] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, `/health-records/by-type/${recordType}`),
                    method: 'GET',
                };
            },
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, arg) => {
                const [scope, recordType] = splitScope(arg);
                return [{ type: 'HealthRecord', id: scopeTag(scope, `TYPE_${recordType}`) }];
            },
        }),

        // ---- Vitals ----

        getVitals: builder.query({
            query: (arg) => ({
                url: patientScopedUrl(scopeOf(arg), '/vitals'),
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (r, e, arg) => [
                { type: 'Vitals', id: scopeTag(scopeOf(arg), 'CURRENT') },
            ],
        }),

        updateVitals: builder.mutation({
            query: (arg) => {
                const [scope, data] = splitScope(arg);
                return { url: patientScopedUrl(scope, '/vitals'), method: 'PUT', data };
            },
            invalidatesTags: (r, e, arg) => invalidatesProfile(
                scopeOf(arg),
                { type: 'Vitals', id: scopeTag(scopeOf(arg), 'CURRENT') },
            ),
        }),

        // ---- Allergy master list (admin-managed, any auth user can read) ----
        // Tenant-level catalogue, not patient data — never scoped.
        getAllergyMasterList: builder.query({
            query: () => ({
                url: '/api/admin/medicine-catalog/allergies',
                method: 'GET',
            }),
            transformResponse: (response) => response?.data?.allergies || [],
            providesTags: [{ type: 'AllergyMaster', id: 'LIST' }],
        }),

        // ---- Habits ----

        getHabits: builder.query({
            query: (arg) => ({
                url: patientScopedUrl(scopeOf(arg), '/habits'),
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (r, e, arg) => [
                { type: 'Habits', id: scopeTag(scopeOf(arg), 'CURRENT') },
            ],
        }),

        updateHabits: builder.mutation({
            query: (arg) => {
                const [scope, data] = splitScope(arg);
                return { url: patientScopedUrl(scope, '/habits'), method: 'PUT', data };
            },
            invalidatesTags: (r, e, arg) => invalidatesProfile(
                scopeOf(arg),
                { type: 'Habits', id: scopeTag(scopeOf(arg), 'CURRENT') },
            ),
        }),

        // ---- Health Record Attachments ----

        getHealthRecordAttachments: builder.query({
            query: (arg) => {
                const [scope, recordId] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, `/health-records/${recordId}/attachments`),
                    method: 'GET',
                };
            },
            transformResponse: (response) => response?.data?.attachments || response?.data || [],
            providesTags: (result, error, arg) => {
                const [scope, recordId] = splitScope(arg);
                return [{ type: 'HealthRecord', id: scopeTag(scope, `ATTACHMENTS_${recordId}`) }];
            },
        }),

        uploadHealthRecordAttachment: builder.mutation({
            query: (arg) => {
                const [scope, { recordId, file, description }] = splitScope(arg);
                const formData = new FormData();
                formData.append('file', file);
                if (description) formData.append('description', description);
                return {
                    url: patientScopedUrl(scope, `/health-records/${recordId}/attachments`),
                    method: 'POST',
                    data: formData,
                    headers: { 'Content-Type': 'multipart/form-data' },
                };
            },
            invalidatesTags: (result, error, arg) => {
                const [scope, { recordId }] = splitScope(arg);
                return invalidatesProfile(
                    scope,
                    { type: 'HealthRecord', id: scopeTag(scope, 'LIST') },
                    { type: 'HealthRecord', id: scopeTag(scope, recordId) },
                    { type: 'HealthRecord', id: scopeTag(scope, `ATTACHMENTS_${recordId}`) },
                    { type: 'HealthRecord', id: scopeTag(scope, 'SURGERIES') },
                );
            },
        }),

        deleteHealthRecordAttachment: builder.mutation({
            query: (arg) => {
                const [scope, { recordId, attachmentId }] = splitScope(arg);
                return {
                    url: patientScopedUrl(
                        scope, `/health-records/${recordId}/attachments/${attachmentId}`,
                    ),
                    method: 'DELETE',
                };
            },
            invalidatesTags: (result, error, arg) => {
                const [scope, { recordId }] = splitScope(arg);
                return invalidatesProfile(
                    scope,
                    { type: 'HealthRecord', id: scopeTag(scope, 'LIST') },
                    { type: 'HealthRecord', id: scopeTag(scope, recordId) },
                    { type: 'HealthRecord', id: scopeTag(scope, `ATTACHMENTS_${recordId}`) },
                    { type: 'HealthRecord', id: scopeTag(scope, 'SURGERIES') },
                );
            },
        }),

        // ---- Surgeries ----

        getSurgeries: builder.query({
            query: (arg) => ({
                url: patientScopedUrl(scopeOf(arg), '/surgeries'),
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (r, e, arg) => [
                { type: 'HealthRecord', id: scopeTag(scopeOf(arg), 'SURGERIES') },
            ],
        }),

        addSurgery: builder.mutation({
            query: (arg) => {
                const [scope, data] = splitScope(arg);
                return { url: patientScopedUrl(scope, '/surgeries'), method: 'POST', data };
            },
            invalidatesTags: (r, e, arg) => {
                const scope = scopeOf(arg);
                return invalidatesProfile(
                    scope,
                    { type: 'HealthRecord', id: scopeTag(scope, 'SURGERIES') },
                    { type: 'HealthRecord', id: scopeTag(scope, 'LIST') },
                );
            },
        }),

        // ---- House Group Requests ----

        getHouseGroupRequests: builder.query({
            query: (arg) => ({
                url: patientScopedUrl(scopeOf(arg), '/house-group/requests'),
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (r, e, arg) => [
                { type: 'HouseGroupRequest', id: scopeTag(scopeOf(arg), 'LIST') },
            ],
        }),

        sendHouseGroupRequest: builder.mutation({
            query: (arg) => {
                const [scope, data] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, '/house-group/requests'),
                    method: 'POST',
                    data,
                };
            },
            invalidatesTags: (r, e, arg) => {
                const scope = scopeOf(arg);
                return invalidatesProfile(
                    scope,
                    { type: 'HouseGroupRequest', id: scopeTag(scope, 'LIST') },
                    { type: 'HouseGroup', id: scopeTag(scope, 'CURRENT') },
                );
            },
        }),

        acceptHouseGroupRequest: builder.mutation({
            query: (arg) => {
                const [scope, { requestId, receiver_relation }] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, `/house-group/requests/${requestId}/accept`),
                    method: 'POST',
                    // axiosBaseQuery reads `data`, not `body` — sending `body`
                    // dropped receiver_relation on the floor.
                    data: { receiver_relation },
                };
            },
            invalidatesTags: (r, e, arg) => {
                const scope = scopeOf(arg);
                return invalidatesProfile(
                    scope,
                    { type: 'HouseGroupRequest', id: scopeTag(scope, 'LIST') },
                    { type: 'HouseGroup', id: scopeTag(scope, 'CURRENT') },
                );
            },
        }),

        rejectHouseGroupRequest: builder.mutation({
            query: (arg) => {
                const [scope, requestId] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, `/house-group/requests/${requestId}/reject`),
                    method: 'POST',
                    data: {},
                };
            },
            invalidatesTags: (r, e, arg) => invalidatesProfile(
                scopeOf(arg),
                { type: 'HouseGroupRequest', id: scopeTag(scopeOf(arg), 'LIST') },
            ),
        }),

        cancelHouseGroupRequest: builder.mutation({
            query: (arg) => {
                const [scope, requestId] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, `/house-group/requests/${requestId}/cancel`),
                    method: 'POST',
                    data: {},
                };
            },
            invalidatesTags: (r, e, arg) => invalidatesProfile(
                scopeOf(arg),
                { type: 'HouseGroupRequest', id: scopeTag(scopeOf(arg), 'LIST') },
            ),
        }),

        generateInviteCode: builder.mutation({
            query: (arg) => {
                const [scope, data] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, '/house-group/generate-invite'),
                    method: 'POST',
                    data,
                };
            },
            invalidatesTags: (r, e, arg) => invalidatesProfile(
                scopeOf(arg),
                { type: 'HouseGroupRequest', id: scopeTag(scopeOf(arg), 'LIST') },
            ),
        }),

        joinByInviteCode: builder.mutation({
            query: (arg) => {
                const [scope, { invite_code, receiver_relation }] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, `/house-group/join/${invite_code}`),
                    method: 'POST',
                    data: { receiver_relation },
                };
            },
            invalidatesTags: (r, e, arg) => {
                const scope = scopeOf(arg);
                return invalidatesProfile(
                    scope,
                    { type: 'HouseGroupRequest', id: scopeTag(scope, 'LIST') },
                    { type: 'HouseGroup', id: scopeTag(scope, 'CURRENT') },
                );
            },
        }),

        updateMemberPermissions: builder.mutation({
            query: (arg) => {
                const [scope, { memberId, data }] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, `/house-group/${memberId}/permissions`),
                    method: 'PUT',
                    data,
                };
            },
            invalidatesTags: (r, e, arg) => invalidatesProfile(
                scopeOf(arg),
                { type: 'HouseGroup', id: scopeTag(scopeOf(arg), 'CURRENT') },
            ),
        }),
    }),
    overrideExisting: false,
});

export const {
    // Health Records
    useGetHealthRecordsQuery,
    useAddHealthRecordMutation,
    useGetHealthRecordQuery,
    useUpdateHealthRecordMutation,
    useDeleteHealthRecordMutation,
    useGetHealthRecordsByTypeQuery,
    // Health Record Attachments
    useGetHealthRecordAttachmentsQuery,
    useUploadHealthRecordAttachmentMutation,
    useDeleteHealthRecordAttachmentMutation,
    // Vitals
    useGetVitalsQuery,
    useUpdateVitalsMutation,
    // Allergies master
    useGetAllergyMasterListQuery,
    // Habits
    useGetHabitsQuery,
    useUpdateHabitsMutation,
    // Surgeries
    useGetSurgeriesQuery,
    useAddSurgeryMutation,
    // House Group Requests
    useGetHouseGroupRequestsQuery,
    useSendHouseGroupRequestMutation,
    useAcceptHouseGroupRequestMutation,
    useRejectHouseGroupRequestMutation,
    useCancelHouseGroupRequestMutation,
    useGenerateInviteCodeMutation,
    useJoinByInviteCodeMutation,
    useUpdateMemberPermissionsMutation,
} = patientHealthEndpoints;

export default patientHealthEndpoints;
