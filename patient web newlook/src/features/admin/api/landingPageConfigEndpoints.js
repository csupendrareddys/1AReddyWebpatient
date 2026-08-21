/**
 * Landing Config Endpoints (RTK Query) — v2 3-level hierarchy.
 *
 * Root: :class:`LandingConfig` holds hero + translations + lifecycle. Child
 * modules are dynamic (Startup, MCA, …); each module has its own features
 * (Proprietorship, LLP, …). Publish is atomic at the landing level and snap-
 * shots the whole tree into ``LandingConfigSnapshot`` so module/feature
 * history tabs can read and restore from a single source.
 *
 * Backend: ``Backend/app/api/landing_page_config/routes.py``.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const API_BASE = '/api/landing';

const landingPageConfigEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ----- Public (unauthenticated when mode=live; JWT required for
        //         mode=draft|preview so tenant context resolves correctly).
        getPublicLanding: builder.query({
            query: ({ lang = 'en', mode = 'live' } = {}) => ({
                url: `${API_BASE}/public`,
                method: 'GET',
                params: { lang, mode },
            }),
            transformResponse: (response) => response?.data || response,
        }),
        getPublicModule: builder.query({
            query: ({ slug, lang = 'en', mode = 'live' }) => ({
                url: `${API_BASE}/public/modules/${slug}`,
                method: 'GET',
                params: { lang, mode },
            }),
            transformResponse: (response) => response?.data || response,
        }),
        getPublicFeature: builder.query({
            query: ({ slug, lang = 'en', mode = 'live' }) => ({
                url: `${API_BASE}/public/features/${slug}`,
                method: 'GET',
                params: { lang, mode },
            }),
            transformResponse: (response) => response?.data || response,
        }),

        // ----- Admin: landing root ---------------------------------------
        getLandingConfigSummary: builder.query({
            query: () => ({ url: `${API_BASE}/admin/summary`, method: 'GET' }),
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'LandingConfig', id: 'SUMMARY' }],
        }),
        getLandingDraft: builder.query({
            query: () => ({ url: `${API_BASE}/admin/draft`, method: 'GET' }),
            transformResponse: (response) => response?.data || response,
            providesTags: [{ type: 'LandingConfig', id: 'DRAFT' }],
        }),
        updateLandingDraft: builder.mutation({
            query: (data) => ({ url: `${API_BASE}/admin/draft`, method: 'PUT', data }),
            invalidatesTags: [
                { type: 'LandingConfig', id: 'DRAFT' },
                { type: 'LandingConfig', id: 'SUMMARY' },
            ],
        }),
        // Upload an image (logo / hero / partner) → S3 → returns public URL.
        // Multipart shape: ``image`` (file) + ``kind`` (string, optional —
        // used as the S3 path prefix). Returns ``{ url, s3_key, content_type,
        // file_size_bytes }``. Caller drops ``url`` into the matching
        // landing-config field (``brand_logo_url`` etc.) and saves via
        // ``updateLandingDraft``. No side effects on the DB until that save.
        uploadLandingAsset: builder.mutation({
            query: ({ file, kind = 'logo' }) => {
                const formData = new FormData();
                formData.append('image', file);
                formData.append('kind', kind);
                return {
                    url: `${API_BASE}/admin/upload-asset`,
                    method: 'POST',
                    data: formData,
                    // ``axiosInstance`` has a default
                    // ``Content-Type: application/json`` header which
                    // axios would otherwise keep, causing FormData to
                    // be JSON-stringified to ``{}`` and Flask's
                    // ``request.files`` to come up empty (the "No
                    // image file in request" 400). Setting it
                    // explicitly to ``multipart/form-data`` lets axios
                    // append the right boundary parameter and send
                    // the file. Same pattern doctor-signup uses
                    // (``submitSignup.js`` line ~59).
                    headers: { 'Content-Type': 'multipart/form-data' },
                };
            },
            transformResponse: (response) => response?.data || response,
        }),
        promoteLandingToPreview: builder.mutation({
            query: () => ({ url: `${API_BASE}/admin/preview`, method: 'POST', data: {} }),
            invalidatesTags: [
                { type: 'LandingConfig', id: 'DRAFT' },
                { type: 'LandingConfig', id: 'SUMMARY' },
            ],
        }),
        publishLandingConfig: builder.mutation({
            query: (note) => ({
                url: `${API_BASE}/admin/publish`,
                method: 'POST',
                data: { note },
            }),
            invalidatesTags: [
                { type: 'LandingConfig', id: 'SUMMARY' },
                // Invalidate the DRAFT cache so RTK re-fetches it after
                // publish. The server returns null (draft was consumed),
                // which makes draftRow fall through to summary.live — the
                // editor then shows the freshly-published live content
                // instead of the stale pre-publish draft.
                { type: 'LandingConfig', id: 'DRAFT' },
                { type: 'LandingSnapshot', id: 'LIST' },
            ],
        }),

        // ----- Admin: history / snapshots --------------------------------
        getLandingHistory: builder.query({
            query: (limit = 20) => ({
                url: `${API_BASE}/admin/history`,
                method: 'GET',
                params: { limit },
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = []) => [
                { type: 'LandingSnapshot', id: 'LIST' },
                ...result.map((s) => ({ type: 'LandingSnapshot', id: s.id })),
            ],
        }),
        getLandingSnapshot: builder.query({
            query: (snapshotId) => ({
                url: `${API_BASE}/admin/snapshots/${snapshotId}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, id) => [{ type: 'LandingSnapshot', id }],
        }),
        restoreLandingSnapshot: builder.mutation({
            query: (snapshotId) => ({
                url: `${API_BASE}/admin/restore/${snapshotId}`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: [
                { type: 'LandingConfig', id: 'DRAFT' },
                { type: 'LandingConfig', id: 'SUMMARY' },
                { type: 'LandingModule', id: 'LIST' },
                { type: 'LandingFeature', id: 'LIST' },
            ],
        }),

        // ----- Admin: modules --------------------------------------------
        listLandingModules: builder.query({
            query: () => ({ url: `${API_BASE}/admin/modules`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = []) => [
                { type: 'LandingModule', id: 'LIST' },
                ...result.map((m) => ({ type: 'LandingModule', id: m.id })),
            ],
        }),
        getLandingModule: builder.query({
            query: (moduleId) => ({
                url: `${API_BASE}/admin/modules/${moduleId}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, id) => [{ type: 'LandingModule', id }],
        }),
        createLandingModule: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/admin/modules`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [
                { type: 'LandingModule', id: 'LIST' },
                { type: 'LandingConfig', id: 'DRAFT' },
            ],
        }),
        updateLandingModule: builder.mutation({
            query: ({ moduleId, data }) => ({
                url: `${API_BASE}/admin/modules/${moduleId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'LandingModule', id: arg.moduleId },
                { type: 'LandingModule', id: 'LIST' },
            ],
        }),
        deleteLandingModule: builder.mutation({
            query: (moduleId) => ({
                url: `${API_BASE}/admin/modules/${moduleId}`,
                method: 'DELETE',
            }),
            invalidatesTags: [
                { type: 'LandingModule', id: 'LIST' },
                { type: 'LandingConfig', id: 'DRAFT' },
            ],
        }),
        reorderLandingModules: builder.mutation({
            query: (items) => ({
                url: `${API_BASE}/admin/modules/reorder`,
                method: 'POST',
                data: { items },
            }),
            invalidatesTags: [{ type: 'LandingModule', id: 'LIST' }],
        }),
        restoreLandingModule: builder.mutation({
            query: ({ moduleId, snapshotId }) => ({
                url: `${API_BASE}/admin/modules/${moduleId}/restore/${snapshotId}`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'LandingModule', id: arg.moduleId },
                { type: 'LandingModule', id: 'LIST' },
                { type: 'LandingFeature', id: `MOD_${arg.moduleId}` },
            ],
        }),

        // ----- Admin: features -------------------------------------------
        listLandingFeatures: builder.query({
            query: (moduleId) => ({
                url: `${API_BASE}/admin/modules/${moduleId}/features`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = [], error, moduleId) => [
                { type: 'LandingFeature', id: `MOD_${moduleId}` },
                ...result.map((f) => ({ type: 'LandingFeature', id: f.id })),
            ],
        }),
        getLandingFeature: builder.query({
            query: ({ moduleId, slug }) => ({
                url: `${API_BASE}/admin/modules/${moduleId}/features/${slug}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (result, error, arg) => [{ type: 'LandingFeature', id: `${arg.moduleId}/${arg.slug}` }],
        }),
        // Doctors in this tenant that can be pinned to a feature's care team.
        // Returns every field unfiltered (photo / experience / languages /
        // location / work qualification) so the editor can preview what a
        // toggle would actually reveal before the admin turns it on.
        getCareTeamCandidates: builder.query({
            query: ({ search } = {}) => ({
                url: `${API_BASE}/admin/care-team/doctors`,
                method: 'GET',
                params: search ? { search } : undefined,
            }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'LandingFeature', id: 'CARE_TEAM_CANDIDATES' }],
        }),
        createLandingFeature: builder.mutation({
            query: ({ moduleId, data }) => ({
                url: `${API_BASE}/admin/modules/${moduleId}/features`,
                method: 'POST',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'LandingFeature', id: `MOD_${arg.moduleId}` },
                { type: 'LandingModule', id: arg.moduleId },
            ],
        }),
        updateLandingFeature: builder.mutation({
            query: ({ moduleId, slug, data }) => ({
                url: `${API_BASE}/admin/modules/${moduleId}/features/${slug}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'LandingFeature', id: `${arg.moduleId}/${arg.slug}` },
                { type: 'LandingFeature', id: `MOD_${arg.moduleId}` },
            ],
        }),
        deleteLandingFeature: builder.mutation({
            query: ({ moduleId, slug }) => ({
                url: `${API_BASE}/admin/modules/${moduleId}/features/${slug}`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'LandingFeature', id: `MOD_${arg.moduleId}` },
                { type: 'LandingModule', id: arg.moduleId },
            ],
        }),
        restoreLandingFeature: builder.mutation({
            query: ({ moduleId, slug, snapshotId }) => ({
                url: `${API_BASE}/admin/modules/${moduleId}/features/${slug}/restore/${snapshotId}`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'LandingFeature', id: `${arg.moduleId}/${arg.slug}` },
                { type: 'LandingFeature', id: `MOD_${arg.moduleId}` },
            ],
        }),

        // ----- Public: Recognitions + Videos (anonymous reads) -----------
        getPublicRecognitions: builder.query({
            query: () => ({ url: `${API_BASE}/public/recognitions`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'LandingRecognition', id: 'PUBLIC_LIST' }],
        }),
        getPublicVideos: builder.query({
            // The public endpoint returns ``{videos, total_count}`` so the
            // caller can decide whether to render the "More" CTA without a
            // second round-trip.
            query: ({ limit } = {}) => ({
                url: `${API_BASE}/public/videos`,
                method: 'GET',
                params: limit ? { limit } : undefined,
            }),
            transformResponse: (response) => response?.data
                || { videos: [], total_count: 0 },
            providesTags: [{ type: 'LandingVideo', id: 'PUBLIC_LIST' }],
        }),

        // ----- Admin: Recognitions ---------------------------------------
        listLandingRecognitions: builder.query({
            query: () => ({ url: `${API_BASE}/admin/recognitions`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = []) => [
                { type: 'LandingRecognition', id: 'LIST' },
                ...result.map((r) => ({ type: 'LandingRecognition', id: r.id })),
            ],
        }),
        createLandingRecognition: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/admin/recognitions`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [
                { type: 'LandingRecognition', id: 'LIST' },
                { type: 'LandingRecognition', id: 'PUBLIC_LIST' },
            ],
        }),
        updateLandingRecognition: builder.mutation({
            query: ({ recognitionId, data }) => ({
                url: `${API_BASE}/admin/recognitions/${recognitionId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'LandingRecognition', id: arg.recognitionId },
                { type: 'LandingRecognition', id: 'LIST' },
                { type: 'LandingRecognition', id: 'PUBLIC_LIST' },
            ],
        }),
        deleteLandingRecognition: builder.mutation({
            query: (recognitionId) => ({
                url: `${API_BASE}/admin/recognitions/${recognitionId}`,
                method: 'DELETE',
            }),
            invalidatesTags: [
                { type: 'LandingRecognition', id: 'LIST' },
                { type: 'LandingRecognition', id: 'PUBLIC_LIST' },
            ],
        }),
        reorderLandingRecognitions: builder.mutation({
            query: (items) => ({
                url: `${API_BASE}/admin/recognitions/reorder`,
                method: 'POST',
                data: { items },
            }),
            invalidatesTags: [
                { type: 'LandingRecognition', id: 'LIST' },
                { type: 'LandingRecognition', id: 'PUBLIC_LIST' },
            ],
        }),

        // ----- Admin: Videos ---------------------------------------------
        listLandingVideos: builder.query({
            query: () => ({ url: `${API_BASE}/admin/videos`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = []) => [
                { type: 'LandingVideo', id: 'LIST' },
                ...result.map((v) => ({ type: 'LandingVideo', id: v.id })),
            ],
        }),
        createLandingVideo: builder.mutation({
            query: (data) => ({
                url: `${API_BASE}/admin/videos`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [
                { type: 'LandingVideo', id: 'LIST' },
                { type: 'LandingVideo', id: 'PUBLIC_LIST' },
            ],
        }),
        updateLandingVideo: builder.mutation({
            query: ({ videoId, data }) => ({
                url: `${API_BASE}/admin/videos/${videoId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'LandingVideo', id: arg.videoId },
                { type: 'LandingVideo', id: 'LIST' },
                { type: 'LandingVideo', id: 'PUBLIC_LIST' },
            ],
        }),
        deleteLandingVideo: builder.mutation({
            query: (videoId) => ({
                url: `${API_BASE}/admin/videos/${videoId}`,
                method: 'DELETE',
            }),
            invalidatesTags: [
                { type: 'LandingVideo', id: 'LIST' },
                { type: 'LandingVideo', id: 'PUBLIC_LIST' },
            ],
        }),
        reorderLandingVideos: builder.mutation({
            query: (items) => ({
                url: `${API_BASE}/admin/videos/reorder`,
                method: 'POST',
                data: { items },
            }),
            invalidatesTags: [
                { type: 'LandingVideo', id: 'LIST' },
                { type: 'LandingVideo', id: 'PUBLIC_LIST' },
            ],
        }),

        // ----- Public + Admin: Doctors / Reviews / Trusted Brands -------
        // Three structurally-identical CRUD resources. Each has a public
        // anonymous list + admin list / create / update / delete /
        // reorder. ``invalidatesTags`` for any mutation refreshes both
        // the admin and public lists so the public landing reflects edits
        // without a manual reload.

        // Doctors
        getPublicDoctors: builder.query({
            query: () => ({ url: `${API_BASE}/public/doctors`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'LandingDoctor', id: 'PUBLIC_LIST' }],
        }),
        listLandingDoctors: builder.query({
            query: () => ({ url: `${API_BASE}/admin/doctors`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = []) => [
                { type: 'LandingDoctor', id: 'LIST' },
                ...result.map((d) => ({ type: 'LandingDoctor', id: d.id })),
            ],
        }),
        createLandingDoctor: builder.mutation({
            query: (data) => ({ url: `${API_BASE}/admin/doctors`, method: 'POST', data }),
            invalidatesTags: [
                { type: 'LandingDoctor', id: 'LIST' },
                { type: 'LandingDoctor', id: 'PUBLIC_LIST' },
            ],
        }),
        updateLandingDoctor: builder.mutation({
            query: ({ doctorId, data }) => ({
                url: `${API_BASE}/admin/doctors/${doctorId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'LandingDoctor', id: arg.doctorId },
                { type: 'LandingDoctor', id: 'LIST' },
                { type: 'LandingDoctor', id: 'PUBLIC_LIST' },
            ],
        }),
        deleteLandingDoctor: builder.mutation({
            query: (doctorId) => ({
                url: `${API_BASE}/admin/doctors/${doctorId}`,
                method: 'DELETE',
            }),
            invalidatesTags: [
                { type: 'LandingDoctor', id: 'LIST' },
                { type: 'LandingDoctor', id: 'PUBLIC_LIST' },
            ],
        }),
        reorderLandingDoctors: builder.mutation({
            query: (items) => ({
                url: `${API_BASE}/admin/doctors/reorder`,
                method: 'POST',
                data: { items },
            }),
            invalidatesTags: [
                { type: 'LandingDoctor', id: 'LIST' },
                { type: 'LandingDoctor', id: 'PUBLIC_LIST' },
            ],
        }),

        // Reviews
        getPublicReviews: builder.query({
            query: () => ({ url: `${API_BASE}/public/reviews`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'LandingReview', id: 'PUBLIC_LIST' }],
        }),
        listLandingReviews: builder.query({
            query: () => ({ url: `${API_BASE}/admin/reviews`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = []) => [
                { type: 'LandingReview', id: 'LIST' },
                ...result.map((r) => ({ type: 'LandingReview', id: r.id })),
            ],
        }),
        createLandingReview: builder.mutation({
            query: (data) => ({ url: `${API_BASE}/admin/reviews`, method: 'POST', data }),
            invalidatesTags: [
                { type: 'LandingReview', id: 'LIST' },
                { type: 'LandingReview', id: 'PUBLIC_LIST' },
            ],
        }),
        updateLandingReview: builder.mutation({
            query: ({ reviewId, data }) => ({
                url: `${API_BASE}/admin/reviews/${reviewId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'LandingReview', id: arg.reviewId },
                { type: 'LandingReview', id: 'LIST' },
                { type: 'LandingReview', id: 'PUBLIC_LIST' },
            ],
        }),
        deleteLandingReview: builder.mutation({
            query: (reviewId) => ({
                url: `${API_BASE}/admin/reviews/${reviewId}`,
                method: 'DELETE',
            }),
            invalidatesTags: [
                { type: 'LandingReview', id: 'LIST' },
                { type: 'LandingReview', id: 'PUBLIC_LIST' },
            ],
        }),
        reorderLandingReviews: builder.mutation({
            query: (items) => ({
                url: `${API_BASE}/admin/reviews/reorder`,
                method: 'POST',
                data: { items },
            }),
            invalidatesTags: [
                { type: 'LandingReview', id: 'LIST' },
                { type: 'LandingReview', id: 'PUBLIC_LIST' },
            ],
        }),

        // Trusted Brands
        getPublicTrustedBrands: builder.query({
            query: () => ({ url: `${API_BASE}/public/trusted-brands`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: [{ type: 'LandingTrustedBrand', id: 'PUBLIC_LIST' }],
        }),
        listLandingTrustedBrands: builder.query({
            query: () => ({ url: `${API_BASE}/admin/trusted-brands`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = []) => [
                { type: 'LandingTrustedBrand', id: 'LIST' },
                ...result.map((b) => ({ type: 'LandingTrustedBrand', id: b.id })),
            ],
        }),
        createLandingTrustedBrand: builder.mutation({
            query: (data) => ({ url: `${API_BASE}/admin/trusted-brands`, method: 'POST', data }),
            invalidatesTags: [
                { type: 'LandingTrustedBrand', id: 'LIST' },
                { type: 'LandingTrustedBrand', id: 'PUBLIC_LIST' },
            ],
        }),
        updateLandingTrustedBrand: builder.mutation({
            query: ({ brandId, data }) => ({
                url: `${API_BASE}/admin/trusted-brands/${brandId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'LandingTrustedBrand', id: arg.brandId },
                { type: 'LandingTrustedBrand', id: 'LIST' },
                { type: 'LandingTrustedBrand', id: 'PUBLIC_LIST' },
            ],
        }),
        deleteLandingTrustedBrand: builder.mutation({
            query: (brandId) => ({
                url: `${API_BASE}/admin/trusted-brands/${brandId}`,
                method: 'DELETE',
            }),
            invalidatesTags: [
                { type: 'LandingTrustedBrand', id: 'LIST' },
                { type: 'LandingTrustedBrand', id: 'PUBLIC_LIST' },
            ],
        }),
        reorderLandingTrustedBrands: builder.mutation({
            query: (items) => ({
                url: `${API_BASE}/admin/trusted-brands/reorder`,
                method: 'POST',
                data: { items },
            }),
            invalidatesTags: [
                { type: 'LandingTrustedBrand', id: 'LIST' },
                { type: 'LandingTrustedBrand', id: 'PUBLIC_LIST' },
            ],
        }),
    }),
});

export const {
    useGetPublicLandingQuery,
    useGetPublicModuleQuery,
    useGetPublicFeatureQuery,
    useGetLandingConfigSummaryQuery,
    useGetLandingDraftQuery,
    useUpdateLandingDraftMutation,
    useUploadLandingAssetMutation,
    usePromoteLandingToPreviewMutation,
    usePublishLandingConfigMutation,
    useGetLandingHistoryQuery,
    useGetLandingSnapshotQuery,
    useRestoreLandingSnapshotMutation,
    useListLandingModulesQuery,
    useGetLandingModuleQuery,
    useCreateLandingModuleMutation,
    useUpdateLandingModuleMutation,
    useDeleteLandingModuleMutation,
    useReorderLandingModulesMutation,
    useRestoreLandingModuleMutation,
    useListLandingFeaturesQuery,
    useGetLandingFeatureQuery,
    useGetCareTeamCandidatesQuery,
    useCreateLandingFeatureMutation,
    useUpdateLandingFeatureMutation,
    useDeleteLandingFeatureMutation,
    useRestoreLandingFeatureMutation,
    // Recognitions
    useGetPublicRecognitionsQuery,
    useListLandingRecognitionsQuery,
    useCreateLandingRecognitionMutation,
    useUpdateLandingRecognitionMutation,
    useDeleteLandingRecognitionMutation,
    useReorderLandingRecognitionsMutation,
    // Videos
    useGetPublicVideosQuery,
    useListLandingVideosQuery,
    useCreateLandingVideoMutation,
    useUpdateLandingVideoMutation,
    useDeleteLandingVideoMutation,
    useReorderLandingVideosMutation,
    // Doctors
    useGetPublicDoctorsQuery,
    useListLandingDoctorsQuery,
    useCreateLandingDoctorMutation,
    useUpdateLandingDoctorMutation,
    useDeleteLandingDoctorMutation,
    useReorderLandingDoctorsMutation,
    // Reviews
    useGetPublicReviewsQuery,
    useListLandingReviewsQuery,
    useCreateLandingReviewMutation,
    useUpdateLandingReviewMutation,
    useDeleteLandingReviewMutation,
    useReorderLandingReviewsMutation,
    // Trusted Brands
    useGetPublicTrustedBrandsQuery,
    useListLandingTrustedBrandsQuery,
    useCreateLandingTrustedBrandMutation,
    useUpdateLandingTrustedBrandMutation,
    useDeleteLandingTrustedBrandMutation,
    useReorderLandingTrustedBrandsMutation,
} = landingPageConfigEndpoints;

export default landingPageConfigEndpoints;
