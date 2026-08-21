/**
 * Admin Profile Configuration Endpoints (RTK Query)
 * Manages admin profile page config, field configs, and profile data CRUD.
 * Mirrors doctorProfileConfigEndpoints but scoped to admin_profile page type.
 */
import { apiSlice } from '../../../app/api/apiSlice';
import { buildModuleEndpoints } from './moduleEndpointsFactory';

const API_BASE = '/api/admin-profile-config';

// Per-module lifecycle endpoints (Round 9, Phase 4) — see
// ``moduleEndpointsFactory.js`` for the full per-module REST shape.
const adminProfileModuleEndpoints = buildModuleEndpoints({
    basePath: `${API_BASE}/admin/admin_profile`,
    tagType: 'AdminProfileModule',
    prefix: 'AdminProfile',
});

const adminProfileConfigEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        ...adminProfileModuleEndpoints(builder),
        // ---- Public endpoint ----

        getPublicAdminProfileConfig: builder.query({
            query: ({ lang = 'en', userType } = {}) => ({
                url: `${API_BASE}/public/admin_profile`,
                method: 'GET',
                params: { lang, user_type: userType },
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'AdminProfileConfig', id: 'PUBLIC' }],
        }),

        // ---- Admin config endpoints ----

        getAdminProfileConfigs: builder.query({
            query: () => ({
                url: `${API_BASE}/admin/admin_profile`,
                method: 'GET',
            }),
            providesTags: [{ type: 'AdminProfileConfig', id: 'LIST' }],
        }),

        getAdminProfileDraft: builder.query({
            query: (section) => ({
                url: `${API_BASE}/admin/admin_profile/draft`,
                method: 'GET',
                params: section ? { section } : undefined,
            }),
            providesTags: (result, error, section) => [
                { type: 'AdminProfileConfig', id: section ? `DRAFT_${section}` : 'DRAFT' },
            ],
        }),

        updateAdminProfileDraft: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/admin/admin_profile/draft`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [
                { type: 'AdminProfileConfig', id: 'DRAFT' },
                { type: 'AdminProfileConfig', id: 'LIST' },
            ],
        }),

        updateAdminProfileFields: builder.mutation({
            query: (fields) => ({
                url: `${API_BASE}/admin/admin_profile/draft/fields`,
                method: 'PUT',
                data: { fields },
            }),
            invalidatesTags: [
                { type: 'AdminProfileConfig', id: 'DRAFT' },
                { type: 'AdminProfileConfig', id: 'LIST' },
            ],
        }),

        promoteAdminProfileToPreview: builder.mutation({
            query: () => ({
                url: `${API_BASE}/admin/admin_profile/preview`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: [{ type: 'AdminProfileConfig', id: 'LIST' }],
        }),

        getAdminProfilePreview: builder.query({
            query: () => ({
                url: `${API_BASE}/admin/admin_profile/preview`,
                method: 'GET',
            }),
        }),

        publishAdminProfileConfig: builder.mutation({
            query: () => ({
                url: `${API_BASE}/admin/admin_profile/publish`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: [
                { type: 'AdminProfileConfig', id: 'LIST' },
                { type: 'AdminProfileConfig', id: 'PUBLIC' },
            ],
        }),

        getAdminProfileHistory: builder.query({
            query: (limit = 10) => ({
                url: `${API_BASE}/admin/admin_profile/history`,
                method: 'GET',
                params: { limit },
            }),
            transformResponse: (response) => response?.data || [],
        }),

        restoreAdminProfileVersion: builder.mutation({
            query: (versionId) => ({
                url: `${API_BASE}/admin/admin_profile/restore/${versionId}`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: [
                { type: 'AdminProfileConfig', id: 'DRAFT' },
                { type: 'AdminProfileConfig', id: 'LIST' },
            ],
        }),

        getAdminProfileAuditLogs: builder.query({
            query: (limit = 50) => ({
                url: `${API_BASE}/admin/admin_profile/audit-logs`,
                method: 'GET',
                params: { limit },
            }),
            transformResponse: (response) => response?.data || [],
        }),

        // ---- Profile Data CRUD ----

        getAdminMyProfile: builder.query({
            query: () => ({
                url: `${API_BASE}/profile/me`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'AdminProfile', id: 'ME' }],
        }),

        updateAdminMyProfile: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/profile/me`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [{ type: 'AdminProfile', id: 'ME' }],
        }),

        updateAdminExtendedProfile: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/profile/me/extended`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [{ type: 'AdminProfile', id: 'ME' }],
        }),

        getAdminMySignatures: builder.query({
            query: () => ({
                url: `${API_BASE}/profile/me/signatures`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'AdminProfile', id: 'SIGNATURES' }],
        }),

        updateAdminMySignatures: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/profile/me/signatures`,
                method: 'PUT',
                data,
                headers: data instanceof FormData ? { 'Content-Type': 'multipart/form-data' } : undefined,
            }),
            invalidatesTags: [{ type: 'AdminProfile', id: 'SIGNATURES' }],
        }),

        getAdminMyAbout: builder.query({
            query: () => ({
                url: `${API_BASE}/profile/me/about`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'AdminProfile', id: 'ABOUT' }],
        }),

        updateAdminMyAbout: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/profile/me/about`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [{ type: 'AdminProfile', id: 'ABOUT' }],
        }),

        getAdminMyEducation: builder.query({
            query: () => ({
                url: `${API_BASE}/profile/me/education`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'AdminProfile', id: 'EDUCATION' }],
        }),

        updateAdminMyEducation: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/profile/me/education`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [{ type: 'AdminProfile', id: 'EDUCATION' }],
        }),

        getAdminMyBankAccounts: builder.query({
            query: () => ({
                url: `${API_BASE}/profile/me/bank-accounts`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'AdminProfile', id: 'BANK' }],
        }),

        updateAdminMyBankAccounts: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/profile/me/bank-accounts`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [{ type: 'AdminProfile', id: 'BANK' }],
        }),

        getAdminMyDeclarations: builder.query({
            query: () => ({
                url: `${API_BASE}/profile/me/declarations`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'AdminProfile', id: 'DECLARATIONS' }],
        }),

        updateAdminMyDeclarations: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/profile/me/declarations`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [{ type: 'AdminProfile', id: 'DECLARATIONS' }],
        }),

        getAdminMyDocuments: builder.query({
            query: () => ({
                url: `${API_BASE}/profile/me/documents`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'AdminProfile', id: 'DOCUMENTS' }],
        }),

        updateAdminMyDocuments: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/profile/me/documents`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [{ type: 'AdminProfile', id: 'DOCUMENTS' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    // Public config
    useGetPublicAdminProfileConfigQuery,
    // Admin config management
    useGetAdminProfileConfigsQuery,
    useGetAdminProfileDraftQuery,
    useUpdateAdminProfileDraftMutation,
    useUpdateAdminProfileFieldsMutation,
    usePromoteAdminProfileToPreviewMutation,
    useGetAdminProfilePreviewQuery,
    usePublishAdminProfileConfigMutation,
    useGetAdminProfileHistoryQuery,
    useRestoreAdminProfileVersionMutation,
    useGetAdminProfileAuditLogsQuery,
    // Profile data CRUD
    useGetAdminMyProfileQuery,
    useUpdateAdminMyProfileMutation,
    useUpdateAdminExtendedProfileMutation,
    useGetAdminMySignaturesQuery,
    useUpdateAdminMySignaturesMutation,
    useGetAdminMyAboutQuery,
    useUpdateAdminMyAboutMutation,
    useGetAdminMyEducationQuery,
    useUpdateAdminMyEducationMutation,
    useGetAdminMyBankAccountsQuery,
    useUpdateAdminMyBankAccountsMutation,
    useGetAdminMyDeclarationsQuery,
    useUpdateAdminMyDeclarationsMutation,
    useGetAdminMyDocumentsQuery,
    useUpdateAdminMyDocumentsMutation,
    // Per-module lifecycle (Round 9, Phase 4)
    useListAdminProfileModulesQuery,
    useGetAdminProfileModuleDraftQuery,
    useUpdateAdminProfileModuleFieldsMutation,
    useDeleteAdminProfileModuleFieldMutation,
    usePromoteAdminProfileModuleToPreviewMutation,
    useGetAdminProfileModulePreviewQuery,
    usePublishAdminProfileModuleMutation,
    useGetAdminProfileModuleHistoryQuery,
    useRestoreAdminProfileModuleVersionMutation,
} = adminProfileConfigEndpoints;

export default adminProfileConfigEndpoints;
