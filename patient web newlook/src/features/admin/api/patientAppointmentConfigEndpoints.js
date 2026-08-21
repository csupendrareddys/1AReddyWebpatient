/**
 * Patient Appointment Configuration Endpoints (RTK Query)
 * Manages patient appointment page config (filter & symptoms) and field configs.
 */
import { apiSlice } from '../../../app/api/apiSlice';
import { buildModuleEndpoints } from './moduleEndpointsFactory';

const API_BASE = '/api/patient-appointment-config';

// Per-module lifecycle endpoints (Round 9, Phase 4). Patient
// appointment is unique — it splits into two PageType enum values
// (FILTER and SYMPTOMS) that share a blueprint, so we register the
// per-module factory TWICE with different URL prefixes + prefixes.
const patientAppointmentFilterModuleEndpoints = buildModuleEndpoints({
    basePath: `${API_BASE}/admin/patient_appointment_filter`,
    tagType: 'PatientAppointmentFilterModule',
    prefix: 'PatientAppointmentFilter',
});

const patientAppointmentSymptomsModuleEndpoints = buildModuleEndpoints({
    basePath: `${API_BASE}/admin/patient_appointment_symptoms`,
    tagType: 'PatientAppointmentSymptomsModule',
    prefix: 'PatientAppointmentSymptoms',
});

const patientAppointmentConfigEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        ...patientAppointmentFilterModuleEndpoints(builder),
        ...patientAppointmentSymptomsModuleEndpoints(builder),
        // ---- Public endpoint ----

        // Get LIVE patient appointment config with translations
        getPublicPatientAppointmentConfig: builder.query({
            query: ({ pageType, lang = 'en' } = {}) => ({
                url: `${API_BASE}/public/${pageType}`,
                method: 'GET',
                params: { lang },
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, { pageType }) => [
                { type: 'PatientAppointmentConfig', id: `PUBLIC_${pageType}` },
            ],
        }),

        // ---- Admin config endpoints ----

        // Get or create draft configuration with field configs
        getPatientAppointmentDraft: builder.query({
            query: ({ pageType, section }) => ({
                url: `${API_BASE}/admin/${pageType}/draft`,
                method: 'GET',
                params: section ? { section } : undefined,
            }),
            providesTags: (result, error, { pageType, section }) => [
                { type: 'PatientAppointmentConfig', id: section ? `DRAFT_${pageType}_${section}` : `DRAFT_${pageType}` },
            ],
        }),

        // Update page-level draft (colors, title, translations, sections)
        updatePatientAppointmentDraft: builder.mutation({
            query: ({ pageType, ...data }) => ({
                url: `${API_BASE}/admin/${pageType}/draft`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, { pageType }) => [
                { type: 'PatientAppointmentConfig', id: `DRAFT_${pageType}` },
            ],
        }),

        // Update individual field configs within draft
        updatePatientAppointmentFields: builder.mutation({
            query: ({ pageType, fields }) => ({
                url: `${API_BASE}/admin/${pageType}/draft/fields`,
                method: 'PUT',
                data: { fields },
            }),
            invalidatesTags: (result, error, { pageType }) => [
                { type: 'PatientAppointmentConfig', id: `DRAFT_${pageType}` },
            ],
        }),

        // Delete a non-default admin-added field from draft
        deletePatientAppointmentFieldConfig: builder.mutation({
            query: ({ pageType, fieldId }) => ({
                url: `${API_BASE}/admin/${pageType}/draft/fields/${fieldId}`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, { pageType }) => [
                { type: 'PatientAppointmentConfig', id: `DRAFT_${pageType}` },
            ],
        }),

        // Promote draft to preview
        promotePatientAppointmentToPreview: builder.mutation({
            query: (pageType) => ({
                url: `${API_BASE}/admin/${pageType}/preview`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: (result, error, pageType) => [
                { type: 'PatientAppointmentConfig', id: `DRAFT_${pageType}` },
            ],
        }),

        // Publish preview to live
        publishPatientAppointmentConfig: builder.mutation({
            query: (pageType) => ({
                url: `${API_BASE}/admin/${pageType}/publish`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: (result, error, pageType) => [
                { type: 'PatientAppointmentConfig', id: `DRAFT_${pageType}` },
                { type: 'PatientAppointmentConfig', id: `PUBLIC_${pageType}` },
            ],
        }),

        // Get version history
        getPatientAppointmentHistory: builder.query({
            query: ({ pageType, limit = 10 }) => ({
                url: `${API_BASE}/admin/${pageType}/history`,
                method: 'GET',
                params: { limit },
            }),
            transformResponse: (response) => response?.data || [],
        }),
    }),
    overrideExisting: false,
});

export const {
    // Public
    useGetPublicPatientAppointmentConfigQuery,
    // Admin config
    useGetPatientAppointmentDraftQuery,
    useUpdatePatientAppointmentDraftMutation,
    useUpdatePatientAppointmentFieldsMutation,
    useDeletePatientAppointmentFieldConfigMutation,
    usePromotePatientAppointmentToPreviewMutation,
    usePublishPatientAppointmentConfigMutation,
    useGetPatientAppointmentHistoryQuery,
    // Per-module lifecycle, FILTER side (Round 9, Phase 4)
    useListPatientAppointmentFilterModulesQuery,
    useGetPatientAppointmentFilterModuleDraftQuery,
    useUpdatePatientAppointmentFilterModuleFieldsMutation,
    useDeletePatientAppointmentFilterModuleFieldMutation,
    usePromotePatientAppointmentFilterModuleToPreviewMutation,
    useGetPatientAppointmentFilterModulePreviewQuery,
    usePublishPatientAppointmentFilterModuleMutation,
    useGetPatientAppointmentFilterModuleHistoryQuery,
    useRestorePatientAppointmentFilterModuleVersionMutation,
    // Per-module lifecycle, SYMPTOMS side (Round 9, Phase 4)
    useListPatientAppointmentSymptomsModulesQuery,
    useGetPatientAppointmentSymptomsModuleDraftQuery,
    useUpdatePatientAppointmentSymptomsModuleFieldsMutation,
    useDeletePatientAppointmentSymptomsModuleFieldMutation,
    usePromotePatientAppointmentSymptomsModuleToPreviewMutation,
    useGetPatientAppointmentSymptomsModulePreviewQuery,
    usePublishPatientAppointmentSymptomsModuleMutation,
    useGetPatientAppointmentSymptomsModuleHistoryQuery,
    useRestorePatientAppointmentSymptomsModuleVersionMutation,
} = patientAppointmentConfigEndpoints;

export default patientAppointmentConfigEndpoints;
