/**
 * Platform marketing landing — RTK Query endpoints.
 *
 * Reads & writes the apex marketing site (``larazen.in``). Schema is
 * physically separated from the per-tenant landing system, so this
 * endpoint surface is parallel to ``landingPageConfigEndpoints.js`` but
 * never touches ``landing_*`` tables.
 *
 * Mounted at ``/api/v1/platform-landing/*`` (admin) and
 * ``/api/v1/public/platform-landing`` (public read).
 */
import { apiSlice } from '../../../app/api/apiSlice';

const ADMIN = '/api/v1/platform-landing/admin';
const PUBLIC = '/api/v1/public/platform-landing';

// Helper — append ``?scope=<scope>`` only when set, so the marketing
// scope (the default) keeps URLs short.
const withScope = (url, scope) =>
    scope && scope !== 'marketing' ? `${url}?scope=${scope}` : url;

const platformLandingEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ── Public (anonymous) ─────────────────────────────────────
        getPublicPlatformLanding: builder.query({
            query: () => ({ url: PUBLIC, method: 'GET' }),
            transformResponse: (response) => response?.data || null,
            providesTags: [{ type: 'PlatformLanding', id: 'PUBLIC' }],
        }),
        // Public single-module + single-feature fetches for the apex.
        // Without these, ``ModulePage`` and ``ServiceDetailPage`` would
        // keep calling ``/api/v1/landing/public/...`` on the apex too, which
        // reads the per-tenant table — the platform_owner's modules
        // wouldn't be found and the page would render "Module not found".
        getPublicPlatformLandingModule: builder.query({
            query: ({ slug, lang, mode }) => ({
                url: `${PUBLIC}/modules/${encodeURIComponent(slug)}`,
                method: 'GET',
                params: { lang, mode },
            }),
            transformResponse: (response) => response?.data || null,
            providesTags: (result, error, arg) => [
                { type: 'PlatformLandingModule', id: `PUBLIC-${arg.slug}` },
            ],
        }),
        getPublicPlatformLandingFeature: builder.query({
            query: ({ slug, lang, mode }) => ({
                url: `${PUBLIC}/features/${encodeURIComponent(slug)}`,
                method: 'GET',
                params: { lang, mode },
            }),
            transformResponse: (response) => response?.data || null,
            providesTags: (result, error, arg) => [
                { type: 'PlatformLandingFeature', id: `PUBLIC-${arg.slug}` },
            ],
        }),
        // Mirrors the per-tenant ``getPublicRecognitions`` shape so the
        // apex Recognitions carousel can swap endpoints based on host
        // without changing its data binding.
        getPublicPlatformLandingRecognitions: builder.query({
            query: () => ({
                url: `${PUBLIC}/recognitions`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'PlatformLandingRecognition', id: 'PUBLIC-LIST' }],
        }),
        // Mirrors the per-tenant ``getPublicVideos`` shape so apex pages can
        // swap endpoints based on host without changing their consumer.
        getPublicPlatformLandingVideos: builder.query({
            query: ({ limit } = {}) => ({
                url: `${PUBLIC}/videos`,
                method: 'GET',
                params: limit ? { limit } : undefined,
            }),
            transformResponse: (response) => response?.data || { videos: [], total_count: 0 },
            // Only provide our own tag — sharing ``PlatformLanding/PUBLIC``
            // with the parent landing query causes a re-fetch loop because
            // both queries see each other's invalidations on mutations.
            providesTags: [{ type: 'PlatformLandingVideo', id: 'PUBLIC-LIST' }],
        }),

        // ── Admin: root config (draft / preview / live lifecycle) ──
        // Mirrors the per-tenant landing surface — same Save Draft →
        // Promote → Publish flow, same status chips. The previous
        // "publish-in-place" endpoints (PUT /admin/<config_id>) wrote
        // straight to LIVE, which broke the page-config standard the
        // rest of the admin uses.
        getPlatformLandingSummary: builder.query({
            query: (scope = 'marketing') => ({
                url: withScope(`${ADMIN}/summary`, scope), method: 'GET',
            }),
            transformResponse: (response) => response?.data || { draft: null, preview: null, live: null },
            providesTags: (result, error, scope = 'marketing') => [
                { type: 'PlatformLanding', id: `SUMMARY-${scope}` },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
            ],
        }),
        getPlatformLandingDraft: builder.query({
            query: (scope = 'marketing') => ({
                url: withScope(`${ADMIN}/draft`, scope), method: 'GET',
            }),
            transformResponse: (response) => response?.data || null,
            providesTags: (result, error, scope = 'marketing') => [
                { type: 'PlatformLanding', id: `DRAFT-${scope}` },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                ...(result ? [{ type: 'PlatformLanding', id: result.id }] : []),
            ],
        }),
        getPlatformLandingById: builder.query({
            query: (configId) => ({ url: `${ADMIN}/${configId}`, method: 'GET' }),
            transformResponse: (response) => response?.data || null,
            providesTags: (result, error, configId) => [
                { type: 'PlatformLanding', id: configId },
            ],
        }),
        updatePlatformLandingDraft: builder.mutation({
            query: ({ scope = 'marketing', data }) => ({
                url: withScope(`${ADMIN}/draft`, scope), method: 'PUT', data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlatformLanding', id: `DRAFT-${arg.scope || 'marketing'}` },
                { type: 'PlatformLanding', id: `SUMMARY-${arg.scope || 'marketing'}` },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
            ],
        }),
        promotePlatformLandingToPreview: builder.mutation({
            query: (scope = 'marketing') => ({
                url: withScope(`${ADMIN}/draft/preview`, scope), method: 'POST', data: {},
            }),
            invalidatesTags: (result, error, scope = 'marketing') => [
                { type: 'PlatformLanding', id: `DRAFT-${scope}` },
                { type: 'PlatformLanding', id: `SUMMARY-${scope}` },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
            ],
        }),

        // ── Admin: recognitions (scope-filtered) ───────────────────
        listPlatformLandingRecognitions: builder.query({
            query: (scope = 'marketing') => ({
                url: withScope(`${ADMIN}/recognitions`, scope), method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = [], error, scope = 'marketing') => [
                { type: 'PlatformLandingRecognition', id: `LIST-${scope}` },
                ...result.map((r) => ({ type: 'PlatformLandingRecognition', id: r.id })),
            ],
        }),
        createPlatformLandingRecognition: builder.mutation({
            query: ({ scope = 'marketing', data }) => ({
                url: withScope(`${ADMIN}/recognitions`, scope),
                method: 'POST',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlatformLandingRecognition', id: `LIST-${arg.scope || 'marketing'}` },
                { type: 'PlatformLandingRecognition', id: 'PUBLIC-LIST' },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                { type: 'PlatformLanding', id: 'PUBLIC' },
            ],
        }),
        updatePlatformLandingRecognition: builder.mutation({
            query: ({ recognitionId, data }) => ({
                url: `${ADMIN}/recognitions/${recognitionId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlatformLandingRecognition', id: arg.recognitionId },
                { type: 'PlatformLandingRecognition', id: 'PUBLIC-LIST' },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                { type: 'PlatformLanding', id: 'PUBLIC' },
            ],
        }),
        deletePlatformLandingRecognition: builder.mutation({
            query: (recognitionId) => ({
                url: `${ADMIN}/recognitions/${recognitionId}`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, recognitionId) => [
                { type: 'PlatformLandingRecognition', id: recognitionId },
                { type: 'PlatformLandingRecognition', id: 'LIST' },
                { type: 'PlatformLandingRecognition', id: 'PUBLIC-LIST' },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                { type: 'PlatformLanding', id: 'PUBLIC' },
            ],
        }),

        // ── Admin: videos (scope-filtered) ─────────────────────────
        listPlatformLandingVideos: builder.query({
            query: (scope = 'marketing') => ({
                url: withScope(`${ADMIN}/videos`, scope), method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = [], error, scope = 'marketing') => [
                { type: 'PlatformLandingVideo', id: `LIST-${scope}` },
                ...result.map((v) => ({ type: 'PlatformLandingVideo', id: v.id })),
            ],
        }),
        // Platform-owner twin of ``uploadLandingAsset`` — uploads an image or
        // video file to S3 and returns its public URL. Same multipart shape
        // (``image`` file + optional ``kind``) and same ``{ url, s3_key, ... }``
        // response; only the auth-gated route differs. Used by the module /
        // feature gallery editors when running in the platform-landing surface.
        uploadPlatformLandingAsset: builder.mutation({
            query: ({ file, kind = 'logo' }) => {
                const formData = new FormData();
                formData.append('image', file);
                formData.append('kind', kind);
                return {
                    url: `${ADMIN}/upload-asset`,
                    method: 'POST',
                    data: formData,
                    // See uploadLandingAsset — axios' default JSON content-type
                    // would stringify FormData to ``{}``; force multipart so the
                    // file reaches Flask's ``request.files``.
                    headers: { 'Content-Type': 'multipart/form-data' },
                };
            },
            transformResponse: (response) => response?.data || response,
        }),
        createPlatformLandingVideo: builder.mutation({
            query: ({ scope = 'marketing', data }) => ({
                url: withScope(`${ADMIN}/videos`, scope),
                method: 'POST',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlatformLandingVideo', id: `LIST-${arg.scope || 'marketing'}` },
                { type: 'PlatformLandingVideo', id: 'PUBLIC-LIST' },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                { type: 'PlatformLanding', id: 'PUBLIC' },
            ],
        }),
        updatePlatformLandingVideo: builder.mutation({
            query: ({ videoId, data }) => ({
                url: `${ADMIN}/videos/${videoId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlatformLandingVideo', id: arg.videoId },
                { type: 'PlatformLandingVideo', id: 'PUBLIC-LIST' },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                { type: 'PlatformLanding', id: 'PUBLIC' },
            ],
        }),
        deletePlatformLandingVideo: builder.mutation({
            query: (videoId) => ({
                url: `${ADMIN}/videos/${videoId}`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, videoId) => [
                { type: 'PlatformLandingVideo', id: videoId },
                { type: 'PlatformLandingVideo', id: 'LIST' },
                { type: 'PlatformLandingVideo', id: 'PUBLIC-LIST' },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                { type: 'PlatformLanding', id: 'PUBLIC' },
            ],
        }),

        // ── Admin: modules ─────────────────────────────────────────
        listPlatformLandingModules: builder.query({
            query: (configId) => ({
                url: `${ADMIN}/${configId}/modules`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = [], error, configId) => [
                { type: 'PlatformLandingModule', id: `LIST-${configId}` },
                ...result.map((m) => ({ type: 'PlatformLandingModule', id: m.id })),
            ],
        }),
        // Single-module fetch by id (parallel to tenant ``getLandingModule``)
        // so the shared ModuleConfigEditor can load a platform module when
        // mounted under /dashboard/platform/landing-config/modules/<id>.
        getPlatformLandingModule: builder.query({
            query: (moduleId) => ({ url: `${ADMIN}/modules/${moduleId}`, method: 'GET' }),
            transformResponse: (response) => response?.data || null,
            providesTags: (result, error, moduleId) => [
                { type: 'PlatformLandingModule', id: moduleId },
            ],
        }),
        createPlatformLandingModule: builder.mutation({
            query: ({ configId, data }) => ({
                url: `${ADMIN}/${configId}/modules`,
                method: 'POST',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlatformLandingModule', id: `LIST-${arg.configId}` },
                { type: 'PlatformLanding', id: arg.configId },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                { type: 'PlatformLanding', id: 'PUBLIC' },
            ],
        }),
        updatePlatformLandingModule: builder.mutation({
            query: ({ moduleId, data }) => ({
                url: `${ADMIN}/modules/${moduleId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlatformLandingModule', id: arg.moduleId },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                { type: 'PlatformLanding', id: 'PUBLIC' },
            ],
        }),
        deletePlatformLandingModule: builder.mutation({
            query: (moduleId) => ({
                url: `${ADMIN}/modules/${moduleId}`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, moduleId) => [
                { type: 'PlatformLandingModule', id: moduleId },
                { type: 'PlatformLandingModule', id: 'LIST' },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                { type: 'PlatformLanding', id: 'PUBLIC' },
            ],
        }),

        // ── Admin: features ────────────────────────────────────────
        listPlatformLandingFeatures: builder.query({
            query: (moduleId) => ({
                url: `${ADMIN}/modules/${moduleId}/features`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = [], error, moduleId) => [
                { type: 'PlatformLandingFeature', id: `LIST-${moduleId}` },
                ...result.map((f) => ({ type: 'PlatformLandingFeature', id: f.id })),
            ],
        }),
        // Single-feature fetch by module_id + slug (parallel to tenant
        // ``getLandingFeature``). Powers the shared FeatureConfigEditor
        // when mounted under /dashboard/platform/landing-config/modules/
        // <module_id>/features/<slug>.
        getPlatformLandingFeature: builder.query({
            query: ({ moduleId, slug }) => ({
                url: `${ADMIN}/modules/${moduleId}/features/${slug}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || null,
            providesTags: (result, error, arg) => [
                { type: 'PlatformLandingFeature', id: `${arg.moduleId}/${arg.slug}` },
            ],
        }),
        // Apex twin of the tenant ``getCareTeamCandidates`` — same payload
        // shape, drawn from the default tenant since platform_landing_* rows
        // are not themselves tenant-scoped.
        getPlatformCareTeamCandidates: builder.query({
            query: ({ search } = {}) => ({
                url: `${ADMIN}/care-team/doctors`,
                method: 'GET',
                params: search ? { search } : undefined,
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'PlatformLandingFeature', id: 'CARE_TEAM_CANDIDATES' }],
        }),
        // Parallel to tenant ``updateLandingFeature`` — addresses the
        // feature by module_id+slug to match the editor's URL pattern.
        // The existing ``updatePlatformLandingFeature`` (by feature_id)
        // stays for collection-style callers.
        updatePlatformLandingFeatureBySlug: builder.mutation({
            query: ({ moduleId, slug, data }) => ({
                url: `${ADMIN}/modules/${moduleId}/features/${slug}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlatformLandingFeature', id: `${arg.moduleId}/${arg.slug}` },
                { type: 'PlatformLandingFeature', id: `LIST-${arg.moduleId}` },
                { type: 'PlatformLandingModule', id: arg.moduleId },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                { type: 'PlatformLanding', id: 'PUBLIC' },
            ],
        }),
        createPlatformLandingFeature: builder.mutation({
            query: ({ moduleId, data }) => ({
                url: `${ADMIN}/modules/${moduleId}/features`,
                method: 'POST',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlatformLandingFeature', id: `LIST-${arg.moduleId}` },
                { type: 'PlatformLandingModule', id: arg.moduleId },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                { type: 'PlatformLanding', id: 'PUBLIC' },
            ],
        }),
        updatePlatformLandingFeature: builder.mutation({
            query: ({ featureId, data }) => ({
                url: `${ADMIN}/features/${featureId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlatformLandingFeature', id: arg.featureId },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                { type: 'PlatformLanding', id: 'PUBLIC' },
            ],
        }),
        deletePlatformLandingFeature: builder.mutation({
            query: (featureId) => ({
                url: `${ADMIN}/features/${featureId}`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, featureId) => [
                { type: 'PlatformLandingFeature', id: featureId },
                { type: 'PlatformLandingFeature', id: 'LIST' },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                { type: 'PlatformLanding', id: 'PUBLIC' },
            ],
        }),

        // ── Publish + history ──────────────────────────────────────
        // Publish takes the PREVIEW row for ``scope`` and flips it to
        // LIVE (archiving prior LIVE). Mirrors tenant landing's publish.
        publishPlatformLanding: builder.mutation({
            query: ({ scope = 'marketing', note }) => ({
                url: withScope(`${ADMIN}/publish`, scope),
                method: 'POST',
                data: { note },
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlatformLanding', id: `DRAFT-${arg.scope || 'marketing'}` },
                { type: 'PlatformLanding', id: `SUMMARY-${arg.scope || 'marketing'}` },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                { type: 'PlatformLanding', id: 'PUBLIC' },
                { type: 'PlatformLandingHistory', id: arg.scope || 'marketing' },
            ],
        }),
        getPlatformLandingHistory: builder.query({
            query: (scope = 'marketing') => ({
                url: withScope(`${ADMIN}/history`, scope),
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result, error, scope = 'marketing') => [
                { type: 'PlatformLandingHistory', id: scope },
            ],
        }),
        restorePlatformLandingSnapshot: builder.mutation({
            query: ({ snapshotId, scope = 'marketing' }) => ({
                url: withScope(`${ADMIN}/restore/${snapshotId}`, scope),
                method: 'POST',
                data: {},
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'PlatformLanding', id: `SUMMARY-${arg.scope || 'marketing'}` },
                { type: 'PlatformLanding', id: `DRAFT-${arg.scope || 'marketing'}` },
                { type: 'PlatformLanding', id: 'LIVE-ANY' },
                { type: 'PlatformLandingHistory', id: arg.scope || 'marketing' },
            ],
        }),
    }),
});

export const {
    useGetPublicPlatformLandingQuery,
    useGetPublicPlatformLandingModuleQuery,
    useGetPublicPlatformLandingFeatureQuery,
    useGetPublicPlatformLandingRecognitionsQuery,
    useGetPublicPlatformLandingVideosQuery,
    useGetPlatformLandingSummaryQuery,
    useGetPlatformLandingDraftQuery,
    useGetPlatformLandingByIdQuery,
    useUpdatePlatformLandingDraftMutation,
    usePromotePlatformLandingToPreviewMutation,
    useListPlatformLandingModulesQuery,
    useGetPlatformLandingModuleQuery,
    useCreatePlatformLandingModuleMutation,
    useUpdatePlatformLandingModuleMutation,
    useDeletePlatformLandingModuleMutation,
    useListPlatformLandingFeaturesQuery,
    useGetPlatformLandingFeatureQuery,
    useCreatePlatformLandingFeatureMutation,
    useUpdatePlatformLandingFeatureMutation,
    useUpdatePlatformLandingFeatureBySlugMutation,
    useGetPlatformCareTeamCandidatesQuery,
    useDeletePlatformLandingFeatureMutation,
    usePublishPlatformLandingMutation,
    useGetPlatformLandingHistoryQuery,
    useRestorePlatformLandingSnapshotMutation,
    // Recognitions + videos (scope-aware)
    useListPlatformLandingRecognitionsQuery,
    useCreatePlatformLandingRecognitionMutation,
    useUpdatePlatformLandingRecognitionMutation,
    useDeletePlatformLandingRecognitionMutation,
    useUploadPlatformLandingAssetMutation,
    useListPlatformLandingVideosQuery,
    useCreatePlatformLandingVideoMutation,
    useUpdatePlatformLandingVideoMutation,
    useDeletePlatformLandingVideoMutation,
} = platformLandingEndpoints;
