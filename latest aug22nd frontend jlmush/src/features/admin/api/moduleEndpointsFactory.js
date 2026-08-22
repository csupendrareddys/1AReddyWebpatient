/**
 * Per-module lifecycle RTK Query factory (Round 9, Phase 4).
 *
 * Each of the five page_type endpoint files (doctorProfile,
 * adminProfile, doctorSignup, patientProfile, patientAppointment)
 * exposes the same per-module REST surface:
 *
 *   GET    /admin/<page_type>/modules
 *   GET    /admin/<page_type>/<module>/draft
 *   PUT    /admin/<page_type>/<module>/draft/fields
 *   POST   /admin/<page_type>/<module>/preview
 *   GET    /admin/<page_type>/<module>/preview
 *   POST   /admin/<page_type>/<module>/publish
 *   GET    /admin/<page_type>/<module>/history
 *   POST   /admin/<page_type>/<module>/restore/<version_id>
 *
 * Rather than 5×9 hand-written hooks, this factory takes the
 * blueprint base URL + tag-type and returns an `endpoints(builder)`
 * function that you pass to `apiSlice.injectEndpoints`. The hook
 * names come back capitalised per page_type so each file's existing
 * named exports keep working.
 *
 * Usage from a page-type endpoint file:
 *
 *   import { buildModuleEndpoints } from './moduleEndpointsFactory';
 *   const moduleEp = buildModuleEndpoints({
 *     basePath: '/api/v1/doctor-profile-config/admin/doctor_profile',
 *     tagType: 'DoctorProfileModule',
 *     prefix: 'DoctorProfile',
 *   });
 *   const doctorProfileConfigEndpoints = apiSlice.injectEndpoints({
 *     endpoints: (builder) => ({
 *       ...existingPageWideEndpoints(builder),
 *       ...moduleEp(builder),
 *     }),
 *   });
 *
 * Exported hook names (camel-cased ``prefix`` is interpolated):
 *   useList<Prefix>ModulesQuery
 *   useGet<Prefix>ModuleDraftQuery
 *   useUpdate<Prefix>ModuleFieldsMutation
 *   useDelete<Prefix>ModuleFieldMutation
 *   usePromote<Prefix>ModuleToPreviewMutation
 *   useGet<Prefix>ModulePreviewQuery
 *   usePublish<Prefix>ModuleMutation
 *   useGet<Prefix>ModuleHistoryQuery
 *   useRestore<Prefix>ModuleVersionMutation
 */

export function buildModuleEndpoints({ basePath, tagType, prefix }) {
    /**
     * basePath: e.g. '/api/v1/doctor-profile-config/admin/doctor_profile'
     *   (NO trailing slash — the factory appends '/...').
     * tagType:  RTK Query tag string used for cache invalidation —
     *   e.g. 'DoctorProfileModule'. Distinct from the page-wide
     *   ``DoctorProfileConfig`` tag so per-module invalidation
     *   doesn't sweep the legacy hook caches.
     * prefix:   CamelCase prefix interpolated into hook names —
     *   e.g. 'DoctorProfile' → ``useGetDoctorProfileModuleDraftQuery``.
     */
    return (builder) => ({
        // ------------------------------------------------------------
        // List + draft
        // ------------------------------------------------------------

        [`list${prefix}Modules`]: builder.query({
            query: () => ({
                url: `${basePath}/modules`,
                method: 'GET',
            }),
            transformResponse: (resp) => resp?.data || [],
            providesTags: [{ type: tagType, id: 'LIST' }],
        }),

        [`get${prefix}ModuleDraft`]: builder.query({
            query: (moduleKey) => ({
                url: `${basePath}/${moduleKey}/draft`,
                method: 'GET',
            }),
            transformResponse: (resp) => resp?.data || resp,
            providesTags: (result, error, moduleKey) => [
                { type: tagType, id: `DRAFT_${moduleKey}` },
            ],
        }),

        [`update${prefix}ModuleFields`]: builder.mutation({
            query: ({ moduleKey, fields }) => ({
                url: `${basePath}/${moduleKey}/draft/fields`,
                method: 'PUT',
                data: { fields },
            }),
            invalidatesTags: (result, error, { moduleKey }) => [
                { type: tagType, id: `DRAFT_${moduleKey}` },
                { type: tagType, id: 'LIST' },
            ],
        }),

        [`delete${prefix}ModuleField`]: builder.mutation({
            query: ({ moduleKey, fieldId }) => ({
                url: `${basePath}/${moduleKey}/draft/fields/${fieldId}`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, { moduleKey }) => [
                { type: tagType, id: `DRAFT_${moduleKey}` },
            ],
        }),

        // ------------------------------------------------------------
        // Workflow transitions
        // ------------------------------------------------------------

        [`promote${prefix}ModuleToPreview`]: builder.mutation({
            query: (moduleKey) => ({
                url: `${basePath}/${moduleKey}/preview`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: (result, error, moduleKey) => [
                { type: tagType, id: `DRAFT_${moduleKey}` },
                { type: tagType, id: `PREVIEW_${moduleKey}` },
                { type: tagType, id: 'LIST' },
            ],
        }),

        [`get${prefix}ModulePreview`]: builder.query({
            query: (moduleKey) => ({
                url: `${basePath}/${moduleKey}/preview`,
                method: 'GET',
            }),
            transformResponse: (resp) => resp?.data || resp,
            providesTags: (result, error, moduleKey) => [
                { type: tagType, id: `PREVIEW_${moduleKey}` },
            ],
        }),

        [`publish${prefix}Module`]: builder.mutation({
            query: ({ moduleKey, note }) => ({
                url: `${basePath}/${moduleKey}/publish`,
                method: 'POST',
                data: { note: (note || '').trim() || undefined },
            }),
            // Publish bumps both per-module state AND the public
            // signature, so invalidate the LIST + the public-page
            // query that mounts on the public read endpoint.
            invalidatesTags: (result, error, { moduleKey }) => [
                { type: tagType, id: `DRAFT_${moduleKey}` },
                { type: tagType, id: `PREVIEW_${moduleKey}` },
                { type: tagType, id: 'LIST' },
                { type: tagType, id: 'PUBLIC' },
            ],
        }),

        [`get${prefix}ModuleHistory`]: builder.query({
            query: (moduleKey) => ({
                url: `${basePath}/${moduleKey}/history`,
                method: 'GET',
                params: { limit: 25 },
            }),
            transformResponse: (resp) => resp?.data || [],
            providesTags: (result, error, moduleKey) => [
                { type: tagType, id: `HISTORY_${moduleKey}` },
            ],
        }),

        [`restore${prefix}ModuleVersion`]: builder.mutation({
            query: ({ moduleKey, versionId }) => ({
                url: `${basePath}/${moduleKey}/restore/${versionId}`,
                method: 'POST',
                data: {},
            }),
            invalidatesTags: (result, error, { moduleKey }) => [
                { type: tagType, id: `DRAFT_${moduleKey}` },
                { type: tagType, id: `HISTORY_${moduleKey}` },
            ],
        }),
    });
}
