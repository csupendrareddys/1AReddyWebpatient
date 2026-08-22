/**
 * Page Configuration Endpoints (RTK Query)
 * Replaces: pageConfigApi.js admin endpoints
 *
 * NOTE: fetchPublicPageConfig is kept as a standalone export for backward
 * compatibility with features/auth/hooks/usePageConfig.js
 */
import { apiSlice } from '../../../app/api/apiSlice';

const API_BASE = '/api/v1/page-config';

const pageConfigEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // Get list of available page types
        getPageTypes: builder.query({
            query: () => ({
                url: `${API_BASE}/types`,
                method: 'GET',
            }),
        }),

        // Fetch all configs (draft, preview, live) for a page type
        getAdminPageConfigs: builder.query({
            query: (pageType) => ({
                url: `${API_BASE}/admin/${pageType}`,
                method: 'GET',
            }),
            providesTags: (result, error, pageType) => [
                { type: 'PageConfig', id: pageType },
            ],
        }),

        // Get or create draft configuration
        getDraftConfig: builder.query({
            query: (pageType) => ({
                url: `${API_BASE}/admin/${pageType}/draft`,
                method: 'GET',
            }),
            providesTags: (result, error, pageType) => [
                { type: 'PageConfig', id: `${pageType}-draft` },
            ],
        }),

        // Update draft configuration
        updateDraftConfig: builder.mutation({
            query: ({ pageType, data }) => ({
                url: `${API_BASE}/admin/${pageType}/draft`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, { pageType }) => [
                { type: 'PageConfig', id: `${pageType}-draft` },
                { type: 'PageConfig', id: pageType },
            ],
        }),

        // Promote draft to preview
        promoteToPreview: builder.mutation({
            query: (pageType) => ({
                url: `${API_BASE}/admin/${pageType}/preview`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: (result, error, pageType) => [
                { type: 'PageConfig', id: pageType },
            ],
        }),

        // Get preview configuration
        getPreviewConfig: builder.query({
            query: (pageType) => ({
                url: `${API_BASE}/admin/${pageType}/preview`,
                method: 'GET',
            }),
        }),

        // Publish preview to live
        publishConfig: builder.mutation({
            query: (pageType) => ({
                url: `${API_BASE}/admin/${pageType}/publish`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: (result, error, pageType) => [
                { type: 'PageConfig', id: pageType },
            ],
        }),

        // Get version history for a page type
        getVersionHistory: builder.query({
            query: ({ pageType, limit = 10 }) => ({
                url: `${API_BASE}/admin/${pageType}/history`,
                method: 'GET',
                params: { limit },
            }),
            transformResponse: (response) => response?.data || [],
        }),

        // Restore a specific version to draft
        restoreVersion: builder.mutation({
            query: ({ pageType, versionId }) => ({
                url: `${API_BASE}/admin/${pageType}/restore/${versionId}`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: (result, error, { pageType }) => [
                { type: 'PageConfig', id: `${pageType}-draft` },
                { type: 'PageConfig', id: pageType },
            ],
        }),

        // Get audit logs for page configurations
        getPageConfigAuditLogs: builder.query({
            query: ({ pageType = null, limit = 50 } = {}) => ({
                url: `${API_BASE}/admin/audit-logs`,
                method: 'GET',
                params: { page_type: pageType, limit },
            }),
            transformResponse: (response) => response?.data || [],
        }),

        // List all assets
        getAssets: builder.query({
            query: (assetType = null) => ({
                url: `${API_BASE}/admin/assets`,
                method: 'GET',
                params: assetType ? { type: assetType } : undefined,
            }),
        }),

        // Get asset by ID with presigned URL
        getAsset: builder.query({
            query: (assetId) => ({
                url: `${API_BASE}/admin/assets/${assetId}`,
                method: 'GET',
            }),
        }),

        // Delete an asset
        deleteAsset: builder.mutation({
            query: (assetId) => ({
                url: `${API_BASE}/admin/assets/${assetId}`,
                method: 'DELETE',
            }),
        }),

        // Get presigned URL for an asset
        getAssetUrl: builder.query({
            query: ({ assetId, expiration = 3600 }) => ({
                url: `${API_BASE}/admin/assets/${assetId}/url`,
                method: 'GET',
                params: { expiration },
            }),
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetPageTypesQuery,
    useGetAdminPageConfigsQuery,
    useGetDraftConfigQuery,
    useUpdateDraftConfigMutation,
    usePromoteToPreviewMutation,
    useGetPreviewConfigQuery,
    usePublishConfigMutation,
    useGetVersionHistoryQuery,
    useRestoreVersionMutation,
    useGetPageConfigAuditLogsQuery,
    useGetAssetsQuery,
    useGetAssetQuery,
    useDeleteAssetMutation,
    useGetAssetUrlQuery,
} = pageConfigEndpoints;

// Page type display names (preserved from old pageConfigApi.js)
export const PAGE_TYPE_LABELS = {
    patient_login: 'Service Receiver Login',
    doctor_login: 'Service Provider Login',
    admin_login: 'Admin Login',
    patient_signup: 'Service Receiver Signup',
    doctor_signup: 'Service Provider Signup',
    pharmacy_signup: 'Pharmacy Signup',
    diagnosis_signup: 'Diagnosis Center Signup',
};

// Asset type labels (preserved from old pageConfigApi.js)
export const ASSET_TYPE_LABELS = {
    logo: 'Logo',
    favicon: 'Favicon',
    background_image: 'Background Image',
    terms_document: 'Terms & Conditions',
    privacy_document: 'Privacy Policy',
};

// ============================================================================
// STANDALONE UTILITIES (Backward Compatibility & Special Cases)
// ============================================================================

import axiosInstance from '../../../api/axiosConfig';

/**
 * Fetch the LIVE configuration for a page type (public, no auth required).
 *
 * Pass ``tenantSlug`` so the backend resolves the right tenant's LIVE
 * config — e.g. an ``acme`` visitor gets acme's branded login page, not
 * the default platform copy. Omit to get the default tenant.
 */
export const fetchPublicPageConfig = async (pageType, lang = 'en', tenantSlug = null) => {
    const params = {};
    if (lang && lang !== 'en') params.lang = lang;
    if (tenantSlug) params.tenant_slug = tenantSlug;
    const response = await axiosInstance.get(
        `/api/v1/page-config/public/${pageType}`, { params },
    );
    return response.data;
};

/**
 * Fetch available page types (public)
 */
export const fetchPageTypes = async () => {
    const response = await axiosInstance.get('/api/v1/page-config/public/types');
    return response.data;
};

/**
 * Upload a new asset (File Upload requires FormData)
 * Not handled by RTK Query JSON base query
 */
export const uploadAsset = async (file, assetType, name) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('asset_type', assetType);
    formData.append('name', name);

    const response = await axiosInstance.post('/api/v1/page-config/admin/assets', formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    });
    return response.data;
};
