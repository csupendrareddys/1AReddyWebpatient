/**
 * Doctor Signup Configuration Endpoints (RTK Query).
 *
 * Public consumer:
 *   useGetPublicDoctorSignupConfigQuery — what the signup page calls on mount.
 *     Returns { page_config, field_configs, data_sources, locked_field_keys }.
 *
 * Admin editor: same draft/preview/live/publish lifecycle as doctor_profile_config.
 *
 * Per-qualification-level master data (UG / PG / Super-Speciality):
 *   useGetMasterCollegesByLevelQuery, useGetMasterSpecializationsByLevelQuery,
 *   useGetMasterDegreesByLevelQuery — all support an optional ``level`` arg.
 *   Single-row CRUD + bulk-import variants.
 */
import { apiSlice } from '../../../app/api/apiSlice';
import { buildModuleEndpoints } from './moduleEndpointsFactory';

const API_BASE = '/api/v1/doctor-signup-config';

// Per-module lifecycle endpoints (Round 9, Phase 4).
const doctorSignupModuleEndpoints = buildModuleEndpoints({
    basePath: `${API_BASE}/admin/doctor_signup`,
    tagType: 'DoctorSignupModule',
    prefix: 'DoctorSignup',
});

const doctorSignupConfigEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        ...doctorSignupModuleEndpoints(builder),
        // ===================== PUBLIC =====================

        // Live signup config for the React signup page. Anonymous.
        getPublicDoctorSignupConfig: builder.query({
            query: ({ lang = 'en' } = {}) => ({
                url: `${API_BASE}/public/doctor_signup`,
                method: 'GET',
                params: { lang },
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'DoctorSignupConfig', id: 'PUBLIC' }],
        }),

        // ===================== ADMIN — CONFIG =====================

        getDoctorSignupConfigs: builder.query({
            query: () => ({
                url: `${API_BASE}/admin/doctor_signup`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'DoctorSignupConfig', id: 'LIST' }],
        }),

        getDoctorSignupDraft: builder.query({
            query: () => ({
                url: `${API_BASE}/admin/doctor_signup/draft`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'DoctorSignupConfig', id: 'DRAFT' }],
        }),

        updateDoctorSignupDraft: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/admin/doctor_signup/draft`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [
                { type: 'DoctorSignupConfig', id: 'DRAFT' },
                { type: 'DoctorSignupConfig', id: 'LIST' },
                { type: 'DoctorSignupConfig', id: 'PUBLIC' },
            ],
        }),

        updateDoctorSignupFields: builder.mutation({
            query: (fields) => ({
                url: `${API_BASE}/admin/doctor_signup/draft/fields`,
                method: 'PUT',
                data: { fields },
            }),
            transformResponse: (response) => response?.data || response,
            invalidatesTags: [
                { type: 'DoctorSignupConfig', id: 'DRAFT' },
                { type: 'DoctorSignupConfig', id: 'LIST' },
                { type: 'DoctorSignupConfig', id: 'PUBLIC' },
            ],
        }),

        deleteDoctorSignupField: builder.mutation({
            query: (fieldId) => ({
                url: `${API_BASE}/admin/doctor_signup/draft/fields/${fieldId}`,
                method: 'DELETE',
            }),
            invalidatesTags: [
                { type: 'DoctorSignupConfig', id: 'DRAFT' },
                { type: 'DoctorSignupConfig', id: 'PUBLIC' },
            ],
        }),

        promoteDoctorSignupToPreview: builder.mutation({
            query: () => ({
                url: `${API_BASE}/admin/doctor_signup/preview`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: [{ type: 'DoctorSignupConfig', id: 'LIST' }],
        }),

        publishDoctorSignupConfig: builder.mutation({
            query: () => ({
                url: `${API_BASE}/admin/doctor_signup/publish`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: [
                { type: 'DoctorSignupConfig', id: 'LIST' },
                { type: 'DoctorSignupConfig', id: 'PUBLIC' },
            ],
        }),

        getDoctorSignupVersionHistory: builder.query({
            query: (limit = 10) => ({
                url: `${API_BASE}/admin/doctor_signup/history`,
                method: 'GET',
                params: { limit },
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'DoctorSignupConfig', id: 'HISTORY' }],
        }),

        restoreDoctorSignupVersion: builder.mutation({
            query: (versionId) => ({
                url: `${API_BASE}/admin/doctor_signup/restore/${versionId}`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: [
                { type: 'DoctorSignupConfig', id: 'DRAFT' },
                { type: 'DoctorSignupConfig', id: 'LIST' },
            ],
        }),

        // ===================== ADMIN — MASTER DATA (level-scoped) =====================

        // ---- Colleges ----
        getMasterCollegesByLevel: builder.query({
            query: ({ level, activeOnly = true } = {}) => ({
                url: `${API_BASE}/admin/master/colleges`,
                method: 'GET',
                params: {
                    ...(level ? { level } : {}),
                    active_only: activeOnly,
                },
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, arg) => [
                { type: 'MasterCollege', id: `LIST_${(arg && arg.level) || 'ALL'}` },
            ],
        }),
        createMasterCollegeByLevel: builder.mutation({
            query: (body) => ({
                url: `${API_BASE}/admin/master/colleges`,
                method: 'POST',
                data: body,
            }),
            invalidatesTags: [{ type: 'MasterCollege' }],
        }),
        updateMasterCollegeByLevel: builder.mutation({
            query: ({ id, ...body }) => ({
                url: `${API_BASE}/admin/master/colleges/${id}`,
                method: 'PUT',
                data: body,
            }),
            invalidatesTags: [{ type: 'MasterCollege' }],
        }),
        deleteMasterCollegeByLevel: builder.mutation({
            query: (id) => ({
                url: `${API_BASE}/admin/master/colleges/${id}`,
                method: 'DELETE',
            }),
            invalidatesTags: [{ type: 'MasterCollege' }],
        }),
        bulkCreateMasterColleges: builder.mutation({
            query: (body) => ({
                url: `${API_BASE}/admin/master/colleges/bulk`,
                method: 'POST',
                data: body,
            }),
            invalidatesTags: [{ type: 'MasterCollege' }],
        }),

        // ---- Specializations ----
        getMasterSpecializationsByLevel: builder.query({
            query: ({ level, activeOnly = true } = {}) => ({
                url: `${API_BASE}/admin/master/specializations`,
                method: 'GET',
                params: {
                    ...(level ? { level } : {}),
                    active_only: activeOnly,
                },
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, arg) => [
                { type: 'MasterSpecialization', id: `LIST_${(arg && arg.level) || 'ALL'}` },
            ],
        }),
        createMasterSpecializationByLevel: builder.mutation({
            query: (body) => ({
                url: `${API_BASE}/admin/master/specializations`,
                method: 'POST',
                data: body,
            }),
            invalidatesTags: [{ type: 'MasterSpecialization' }],
        }),
        updateMasterSpecializationByLevel: builder.mutation({
            query: ({ id, ...body }) => ({
                url: `${API_BASE}/admin/master/specializations/${id}`,
                method: 'PUT',
                data: body,
            }),
            invalidatesTags: [{ type: 'MasterSpecialization' }],
        }),
        deleteMasterSpecializationByLevel: builder.mutation({
            query: (id) => ({
                url: `${API_BASE}/admin/master/specializations/${id}`,
                method: 'DELETE',
            }),
            invalidatesTags: [{ type: 'MasterSpecialization' }],
        }),
        bulkCreateMasterSpecializations: builder.mutation({
            query: (body) => ({
                url: `${API_BASE}/admin/master/specializations/bulk`,
                method: 'POST',
                data: body,
            }),
            invalidatesTags: [{ type: 'MasterSpecialization' }],
        }),

        // ---- Degrees ----
        getMasterDegreesByLevel: builder.query({
            query: ({ level, activeOnly = true } = {}) => ({
                url: `${API_BASE}/admin/master/degrees`,
                method: 'GET',
                params: {
                    ...(level ? { level } : {}),
                    active_only: activeOnly,
                },
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, arg) => [
                { type: 'MasterDegree', id: `LIST_${(arg && arg.level) || 'ALL'}` },
            ],
        }),
        createMasterDegreeByLevel: builder.mutation({
            query: (body) => ({
                url: `${API_BASE}/admin/master/degrees`,
                method: 'POST',
                data: body,
            }),
            invalidatesTags: [{ type: 'MasterDegree' }],
        }),
        updateMasterDegreeByLevel: builder.mutation({
            query: ({ id, ...body }) => ({
                url: `${API_BASE}/admin/master/degrees/${id}`,
                method: 'PUT',
                data: body,
            }),
            invalidatesTags: [{ type: 'MasterDegree' }],
        }),
        deleteMasterDegreeByLevel: builder.mutation({
            query: (id) => ({
                url: `${API_BASE}/admin/master/degrees/${id}`,
                method: 'DELETE',
            }),
            invalidatesTags: [{ type: 'MasterDegree' }],
        }),
        bulkCreateMasterDegrees: builder.mutation({
            query: (body) => ({
                url: `${API_BASE}/admin/master/degrees/bulk`,
                method: 'POST',
                data: body,
            }),
            invalidatesTags: [{ type: 'MasterDegree' }],
        }),
    }),
});

export const {
    useGetPublicDoctorSignupConfigQuery,
    useGetDoctorSignupConfigsQuery,
    useGetDoctorSignupDraftQuery,
    useUpdateDoctorSignupDraftMutation,
    useUpdateDoctorSignupFieldsMutation,
    useDeleteDoctorSignupFieldMutation,
    usePromoteDoctorSignupToPreviewMutation,
    usePublishDoctorSignupConfigMutation,
    useGetDoctorSignupVersionHistoryQuery,
    useRestoreDoctorSignupVersionMutation,

    useGetMasterCollegesByLevelQuery,
    useCreateMasterCollegeByLevelMutation,
    useUpdateMasterCollegeByLevelMutation,
    useDeleteMasterCollegeByLevelMutation,
    useBulkCreateMasterCollegesMutation,

    useGetMasterSpecializationsByLevelQuery,
    useCreateMasterSpecializationByLevelMutation,
    useUpdateMasterSpecializationByLevelMutation,
    useDeleteMasterSpecializationByLevelMutation,
    useBulkCreateMasterSpecializationsMutation,

    useGetMasterDegreesByLevelQuery,
    useCreateMasterDegreeByLevelMutation,
    useUpdateMasterDegreeByLevelMutation,
    useDeleteMasterDegreeByLevelMutation,
    useBulkCreateMasterDegreesMutation,

    // Per-module lifecycle (Round 9, Phase 4)
    useListDoctorSignupModulesQuery,
    useGetDoctorSignupModuleDraftQuery,
    useUpdateDoctorSignupModuleFieldsMutation,
    useDeleteDoctorSignupModuleFieldMutation,
    usePromoteDoctorSignupModuleToPreviewMutation,
    useGetDoctorSignupModulePreviewQuery,
    usePublishDoctorSignupModuleMutation,
    useGetDoctorSignupModuleHistoryQuery,
    useRestoreDoctorSignupModuleVersionMutation,
} = doctorSignupConfigEndpoints;

export default doctorSignupConfigEndpoints;
