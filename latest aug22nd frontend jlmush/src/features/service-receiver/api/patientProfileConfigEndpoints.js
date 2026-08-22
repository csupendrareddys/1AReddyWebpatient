/**
 * Patient Profile Configuration Endpoints (RTK Query)
 * Manages patient profile page config, field configs, and data sources.
 */
import { apiSlice } from '../../../app/api/apiSlice';
import { buildModuleEndpoints } from '../../admin/api/moduleEndpointsFactory';

const API_BASE = '/api/v1/patient-profile-config';

// Per-module lifecycle endpoints (Round 9, Phase 4).
const patientProfileModuleEndpoints = buildModuleEndpoints({
    basePath: `${API_BASE}/admin/patient_profile`,
    tagType: 'PatientProfileModule',
    prefix: 'PatientProfile',
});

const patientProfileConfigEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        ...patientProfileModuleEndpoints(builder),
        // ---- Public endpoint ----

        // Get LIVE patient profile config with translations and RBAC
        getPublicPatientProfileConfig: builder.query({
            query: ({ lang = 'en', userType } = {}) => ({
                url: `${API_BASE}/public/patient_profile`,
                method: 'GET',
                params: { lang, user_type: userType },
            }),
            // Extract the API envelope: { success, data: { page_config, field_configs, data_sources } }
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'PatientProfileConfig', id: 'PUBLIC' }],
        }),

        // ---- Admin config endpoints ----

        // Fetch all configs (draft, preview, live) with field configs
        getPatientProfileConfigs: builder.query({
            query: () => ({
                url: `${API_BASE}/admin/patient_profile`,
                method: 'GET',
            }),
            providesTags: [{ type: 'PatientProfileConfig', id: 'LIST' }],
        }),

        // Get or create draft configuration with field configs
        // Pass section (TAB_GROUP key) to fetch only that group's fields
        getPatientProfileDraft: builder.query({
            query: (section) => ({
                url: `${API_BASE}/admin/patient_profile/draft`,
                method: 'GET',
                params: section ? { section } : undefined,
            }),
            providesTags: (result, error, section) => [
                { type: 'PatientProfileConfig', id: 'DRAFT' },
                ...(section ? [{ type: 'PatientProfileConfig', id: `DRAFT_${section}` }] : []),
            ],
        }),

        // Update page-level draft (colors, title, translations, sections)
        updatePatientProfileDraft: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/admin/patient_profile/draft`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [
                { type: 'PatientProfileConfig', id: 'DRAFT' },
                { type: 'PatientProfileConfig', id: 'LIST' },
            ],
        }),

        // Update individual field configs within draft
        updatePatientProfileFieldConfigs: builder.mutation({
            query: (fields) => ({
                url: `${API_BASE}/admin/patient_profile/draft/fields`,
                method: 'PUT',
                data: { fields },
            }),
            invalidatesTags: [
                { type: 'PatientProfileConfig', id: 'DRAFT' },
                { type: 'PatientProfileConfig', id: 'LIST' },
            ],
        }),

        // Promote draft to preview
        promotePatientProfileToPreview: builder.mutation({
            query: () => ({
                url: `${API_BASE}/admin/patient_profile/preview`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: [{ type: 'PatientProfileConfig', id: 'LIST' }],
        }),

        // Get preview configuration
        getPatientProfilePreview: builder.query({
            query: () => ({
                url: `${API_BASE}/admin/patient_profile/preview`,
                method: 'GET',
            }),
        }),

        // Publish preview to live
        publishPatientProfile: builder.mutation({
            query: () => ({
                url: `${API_BASE}/admin/patient_profile/publish`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: [
                { type: 'PatientProfileConfig', id: 'LIST' },
                { type: 'PatientProfileConfig', id: 'PUBLIC' },
            ],
        }),

        // Get version history
        getPatientProfileVersionHistory: builder.query({
            query: (limit = 10) => ({
                url: `${API_BASE}/admin/patient_profile/history`,
                method: 'GET',
                params: { limit },
            }),
            transformResponse: (response) => response?.data?.versions || [],
        }),

        // Restore a specific version
        restorePatientProfileVersion: builder.mutation({
            query: (versionId) => ({
                url: `${API_BASE}/admin/patient_profile/restore/${versionId}`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: [
                { type: 'PatientProfileConfig', id: 'DRAFT' },
                { type: 'PatientProfileConfig', id: 'LIST' },
            ],
        }),

        // Get audit logs
        getPatientProfileAuditLogs: builder.query({
            query: (limit = 50) => ({
                url: `${API_BASE}/admin/patient_profile/audit-logs`,
                method: 'GET',
                params: { limit },
            }),
            transformResponse: (response) => response?.data?.logs || [],
        }),

        // Delete a non-default admin-added field from the draft
        deletePatientProfileFieldConfig: builder.mutation({
            query: (fieldId) => ({
                url: `${API_BASE}/admin/patient_profile/draft/fields/${fieldId}`,
                method: 'DELETE',
            }),
            invalidatesTags: [
                { type: 'PatientProfileConfig', id: 'DRAFT' },
                { type: 'PatientProfileConfig', id: 'LIST' },
            ],
        }),

        // ---- Public Data Source ----

        // Get data source options (for dropdowns like blood_group, languages, etc.)
        getDataSource: builder.query({
            query: (source) => ({
                url: `${API_BASE}/public/data-source/${source}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
        }),
    }),
    overrideExisting: false,
});

export const {
    // Public
    useGetPublicPatientProfileConfigQuery,
    useGetDataSourceQuery,
    // Admin config
    useGetPatientProfileConfigsQuery,
    useGetPatientProfileDraftQuery,
    useUpdatePatientProfileDraftMutation,
    useUpdatePatientProfileFieldConfigsMutation,
    usePromotePatientProfileToPreviewMutation,
    useGetPatientProfilePreviewQuery,
    usePublishPatientProfileMutation,
    useGetPatientProfileVersionHistoryQuery,
    useRestorePatientProfileVersionMutation,
    useGetPatientProfileAuditLogsQuery,
    useDeletePatientProfileFieldConfigMutation,
    // Per-module lifecycle (Round 9, Phase 4)
    useListPatientProfileModulesQuery,
    useGetPatientProfileModuleDraftQuery,
    useUpdatePatientProfileModuleFieldsMutation,
    useDeletePatientProfileModuleFieldMutation,
    usePromotePatientProfileModuleToPreviewMutation,
    useGetPatientProfileModulePreviewQuery,
    usePublishPatientProfileModuleMutation,
    useGetPatientProfileModuleHistoryQuery,
    useRestorePatientProfileModuleVersionMutation,
} = patientProfileConfigEndpoints;

export default patientProfileConfigEndpoints;
