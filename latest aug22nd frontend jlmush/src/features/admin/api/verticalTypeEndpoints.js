/**
 * Vertical-type endpoints (RTK Query) — PLATFORM_OWNER CRUD over the
 * marketplace verticals.
 *
 * A vertical type is one funnel: its ``code`` keys ``/join?vertical=`` (or
 * ``/join_receiver?vertical=`` when ``is_receiver``) and the membership-plan
 * catalog underneath it, its ``name`` / ``description`` / ``icon_key`` are the
 * copy the /register tiles and both join pages render. Creating a row here is
 * what makes a new vertical exist across the public site — nothing hardcodes
 * the list any more.
 *
 * Mirrors the plan-type CRUD in :file:`pricingEndpoints.js`. The two are
 * different axes despite the similar shape: plan types classify the SaaS
 * subdomain catalog at /pricing, vertical types classify the marketplace.
 *
 * Writes invalidate the PUBLIC_LIST tag as well as LIST — the public site
 * reads the same rows through ``listPublicVerticalTypes``, and without that
 * the operator would publish a vertical and still see the old /register tiles
 * until a reload.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const PLATFORM_BASE = '/api/v1/platform';
// Plural, to match its siblings — ``/api/v1/platform/plan-types`` and the public
// read at ``/api/v1/public/vertical-plan-types``. These routes don't exist on the
// backend yet; this is the shape they need to land on.
const VERTICAL_TYPES = `${PLATFORM_BASE}/vertical-plan-types`;

// Every write touches the list both audiences read.
const INVALIDATES_BOTH_LISTS = [
    { type: 'VerticalType', id: 'LIST' },
    { type: 'VerticalType', id: 'PUBLIC_LIST' },
];

const verticalTypeEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        listVerticalTypes: builder.query({
            query: () => ({ url: VERTICAL_TYPES, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = []) => [
                { type: 'VerticalType', id: 'LIST' },
                ...result.map((vt) => ({ type: 'VerticalType', id: vt.id })),
            ],
        }),

        createVerticalType: builder.mutation({
            query: (data) => ({ url: VERTICAL_TYPES, method: 'POST', data }),
            invalidatesTags: INVALIDATES_BOTH_LISTS,
        }),

        updateVerticalType: builder.mutation({
            query: ({ id, data }) => ({
                url: `${VERTICAL_TYPES}/${id}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                ...INVALIDATES_BOTH_LISTS,
                { type: 'VerticalType', id: arg.id },
            ],
        }),

        deleteVerticalType: builder.mutation({
            query: (id) => ({ url: `${VERTICAL_TYPES}/${id}`, method: 'DELETE' }),
            invalidatesTags: INVALIDATES_BOTH_LISTS,
        }),
    }),
});

export const {
    useListVerticalTypesQuery,
    useCreateVerticalTypeMutation,
    useUpdateVerticalTypeMutation,
    useDeleteVerticalTypeMutation,
} = verticalTypeEndpoints;
