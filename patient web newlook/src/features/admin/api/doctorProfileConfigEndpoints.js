/**
 * Doctor Profile Configuration Endpoints (RTK Query)
 * Manages doctor profile page config, field configs, and master data (colleges, specializations).
 */
import { apiSlice } from '../../../app/api/apiSlice';
import { buildModuleEndpoints } from './moduleEndpointsFactory';

const API_BASE = '/api/doctor-profile-config';

// Round 9, Phase 4 — per-module CRUD endpoints share one factory
// across all five page_types. Each call slots its own URL prefix +
// tag-type into the shared builder; see ``moduleEndpointsFactory.js``.
const doctorProfileModuleEndpoints = buildModuleEndpoints({
    basePath: `${API_BASE}/admin/doctor_profile`,
    tagType: 'DoctorProfileModule',
    prefix: 'DoctorProfile',
});

const doctorProfileConfigEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        ...doctorProfileModuleEndpoints(builder),
        // ---- Public endpoint ----

        // Get LIVE doctor profile config with translations and RBAC
        getPublicDoctorProfileConfig: builder.query({
            query: ({ lang = 'en', userType } = {}) => ({
                url: `${API_BASE}/public/doctor_profile`,
                method: 'GET',
                params: { lang, user_type: userType },
            }),
            // Extract the API envelope: { success, data: { page_config, field_configs } } → { page_config, field_configs }
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'DoctorProfileConfig', id: 'PUBLIC' }],
        }),

        // ---- Admin config endpoints ----

        // Fetch all configs (draft, preview, live) with field configs
        getDoctorProfileConfigs: builder.query({
            query: () => ({
                url: `${API_BASE}/admin/doctor_profile`,
                method: 'GET',
            }),
            providesTags: [{ type: 'DoctorProfileConfig', id: 'LIST' }],
        }),

        // Get or create draft configuration with field configs
        // Pass section (TAB_GROUP key) to fetch only that group's fields
        getDoctorProfileDraft: builder.query({
            query: (section) => ({
                url: `${API_BASE}/admin/doctor_profile/draft`,
                method: 'GET',
                params: section ? { section } : undefined,
            }),
            providesTags: (result, error, section) => [
                { type: 'DoctorProfileConfig', id: section ? `DRAFT_${section}` : 'DRAFT' },
            ],
        }),

        // Update page-level draft (colors, title, translations, sections)
        updateDoctorProfileDraft: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/admin/doctor_profile/draft`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [
                { type: 'DoctorProfileConfig', id: 'DRAFT' },
                { type: 'DoctorProfileConfig', id: 'LIST' },
            ],
        }),

        // Update individual field configs within draft
        updateDoctorProfileFields: builder.mutation({
            query: (fields) => ({
                url: `${API_BASE}/admin/doctor_profile/draft/fields`,
                method: 'PUT',
                data: { fields },
            }),
            invalidatesTags: [
                { type: 'DoctorProfileConfig', id: 'DRAFT' },
                { type: 'DoctorProfileConfig', id: 'LIST' },
            ],
        }),

        // Promote draft to preview
        promoteDoctorProfileToPreview: builder.mutation({
            query: () => ({
                url: `${API_BASE}/admin/doctor_profile/preview`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: [{ type: 'DoctorProfileConfig', id: 'LIST' }],
        }),

        // Get preview configuration
        getDoctorProfilePreview: builder.query({
            query: () => ({
                url: `${API_BASE}/admin/doctor_profile/preview`,
                method: 'GET',
            }),
        }),

        // Publish preview to live. Optional ``note`` argument — short
        // free-text the operator can attach so the audit log records
        // what changed. Mirrors the Landing-page publish flow's note
        // semantics. Backend persists it on the PUBLISH audit row.
        publishDoctorProfileConfig: builder.mutation({
            query: (note) => ({
                url: `${API_BASE}/admin/doctor_profile/publish`,
                method: 'POST',
                data: { note: (note || '').trim() || undefined },
            }),
            invalidatesTags: [
                { type: 'DoctorProfileConfig', id: 'LIST' },
                { type: 'DoctorProfileConfig', id: 'PUBLIC' },
            ],
        }),

        // Get version history
        getDoctorProfileHistory: builder.query({
            query: (limit = 10) => ({
                url: `${API_BASE}/admin/doctor_profile/history`,
                method: 'GET',
                params: { limit },
            }),
            transformResponse: (response) => response?.data || [],
        }),

        // Restore a specific version
        restoreDoctorProfileVersion: builder.mutation({
            query: (versionId) => ({
                url: `${API_BASE}/admin/doctor_profile/restore/${versionId}`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: [
                { type: 'DoctorProfileConfig', id: 'DRAFT' },
                { type: 'DoctorProfileConfig', id: 'LIST' },
            ],
        }),

        // Get audit logs
        getDoctorProfileAuditLogs: builder.query({
            query: (limit = 50) => ({
                url: `${API_BASE}/admin/doctor_profile/audit-logs`,
                method: 'GET',
                params: { limit },
            }),
            transformResponse: (response) => response?.data || [],
        }),

        // ---- Master Data: Colleges ----

        getColleges: builder.query({
            query: (activeOnly = true) => ({
                url: `${API_BASE}/admin/master/colleges`,
                method: 'GET',
                params: { active_only: activeOnly },
            }),
            providesTags: [{ type: 'MasterCollege', id: 'LIST' }],
        }),

        createCollege: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/admin/master/colleges`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [{ type: 'MasterCollege', id: 'LIST' }],
        }),

        updateCollege: builder.mutation({
            query: ({ id, data }) => ({
                url: `${API_BASE}/admin/master/colleges/${id}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [{ type: 'MasterCollege', id: 'LIST' }],
        }),

        deleteCollege: builder.mutation({
            query: (id) => ({
                url: `${API_BASE}/admin/master/colleges/${id}`,
                method: 'DELETE',
            }),
            invalidatesTags: [{ type: 'MasterCollege', id: 'LIST' }],
        }),

        // Delete a non-default admin-added field from the doctor profile draft
        deleteDoctorProfileFieldConfig: builder.mutation({
            query: (fieldId) => ({
                url: `${API_BASE}/admin/doctor_profile/draft/fields/${fieldId}`,
                method: 'DELETE',
            }),
            invalidatesTags: [
                { type: 'DoctorProfileConfig', id: 'DRAFT' },
                { type: 'DoctorProfileConfig', id: 'LIST' },
            ],
        }),

        // ---- Master Data: Symptoms ----

        getSymptomsMaster: builder.query({
            query: (activeOnly = true) => ({
                url: `${API_BASE}/admin/master/symptoms`,
                method: 'GET',
                params: { active_only: activeOnly },
            }),
            transformResponse: (response) => response?.data || { symptoms: [], categories: [] },
            providesTags: [{ type: 'DoctorSymptoms', id: 'MASTER_LIST' }],
        }),

        createSymptomMaster: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/admin/master/symptoms`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [{ type: 'DoctorSymptoms', id: 'MASTER_LIST' }],
        }),

        updateSymptomMaster: builder.mutation({
            query: ({ id, data }) => ({
                url: `${API_BASE}/admin/master/symptoms/${id}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [{ type: 'DoctorSymptoms', id: 'MASTER_LIST' }],
        }),

        deleteSymptomMaster: builder.mutation({
            query: (id) => ({
                url: `${API_BASE}/admin/master/symptoms/${id}`,
                method: 'DELETE',
            }),
            invalidatesTags: [{ type: 'DoctorSymptoms', id: 'MASTER_LIST' }],
        }),

        // ---- Master Data: Specializations ----

        getSpecializations: builder.query({
            query: (activeOnly = true) => ({
                url: `${API_BASE}/admin/master/specializations`,
                method: 'GET',
                params: { active_only: activeOnly },
            }),
            providesTags: [{ type: 'MasterSpecialization', id: 'LIST' }],
        }),

        createSpecialization: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/admin/master/specializations`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [{ type: 'MasterSpecialization', id: 'LIST' }],
        }),

        updateSpecialization: builder.mutation({
            query: ({ id, data }) => ({
                url: `${API_BASE}/admin/master/specializations/${id}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [{ type: 'MasterSpecialization', id: 'LIST' }],
        }),

        deleteSpecialization: builder.mutation({
            query: (id) => ({
                url: `${API_BASE}/admin/master/specializations/${id}`,
                method: 'DELETE',
            }),
            invalidatesTags: [{ type: 'MasterSpecialization', id: 'LIST' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    // Public
    useGetPublicDoctorProfileConfigQuery,
    // Admin config
    useGetDoctorProfileConfigsQuery,
    useGetDoctorProfileDraftQuery,
    useUpdateDoctorProfileDraftMutation,
    useUpdateDoctorProfileFieldsMutation,
    usePromoteDoctorProfileToPreviewMutation,
    useGetDoctorProfilePreviewQuery,
    usePublishDoctorProfileConfigMutation,
    useGetDoctorProfileHistoryQuery,
    useRestoreDoctorProfileVersionMutation,
    useGetDoctorProfileAuditLogsQuery,
    // Master data
    useGetCollegesQuery,
    useCreateCollegeMutation,
    useUpdateCollegeMutation,
    useDeleteCollegeMutation,
    useGetSymptomsMasterQuery,
    useCreateSymptomMasterMutation,
    useUpdateSymptomMasterMutation,
    useDeleteSymptomMasterMutation,
    useGetSpecializationsQuery,
    useCreateSpecializationMutation,
    useUpdateSpecializationMutation,
    useDeleteSpecializationMutation,
    useDeleteDoctorProfileFieldConfigMutation,
    // Per-module lifecycle (Round 9, Phase 4). Each module on the
    // doctor_profile page (personal_professional / addresses /
    // education / etc.) carries its own DRAFT → PREVIEW → LIVE
    // state. Hook names come from ``buildModuleEndpoints`` —
    // ``moduleKey`` is the module identifier from
    // ``Backend/app/api/doctor_profile_config/modules.py``.
    useListDoctorProfileModulesQuery,
    useGetDoctorProfileModuleDraftQuery,
    useUpdateDoctorProfileModuleFieldsMutation,
    useDeleteDoctorProfileModuleFieldMutation,
    usePromoteDoctorProfileModuleToPreviewMutation,
    useGetDoctorProfileModulePreviewQuery,
    usePublishDoctorProfileModuleMutation,
    useGetDoctorProfileModuleHistoryQuery,
    useRestoreDoctorProfileModuleVersionMutation,
} = doctorProfileConfigEndpoints;

export default doctorProfileConfigEndpoints;
