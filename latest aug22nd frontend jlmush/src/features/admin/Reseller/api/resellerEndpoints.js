/**
 * Reseller console endpoints (RTK Query) — an APEX tenant operating its
 * child tenants. Plan CRUD is NOT here: the scope-aware plan endpoints in
 * ``pricingEndpoints.js`` cover both consoles.
 */
import { apiSlice } from '../../../../app/api/apiSlice';

const RESELLER_BASE = '/api/v1/admin/reseller';

const resellerEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getResellerQuota: builder.query({
            query: () => ({ url: `${RESELLER_BASE}/quota`, method: 'GET' }),
            transformResponse: (response) => response?.data || null,
            providesTags: [{ type: 'ResellerQuota', id: 'ME' }],
        }),
        listResellerTenants: builder.query({
            query: () => ({ url: `${RESELLER_BASE}/tenants`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: (result = []) => [
                { type: 'ResellerTenant', id: 'LIST' },
                ...result.map((t) => ({ type: 'ResellerTenant', id: t.id })),
            ],
        }),
        // Child add-ons: the apex buys VENDOR add-ons for a child at
        // that child's tier price; the grant lands on the child.
        listResellerAddonCatalogue: builder.query({
            query: () => ({ url: `${RESELLER_BASE}/addons`, method: 'GET' }),
            transformResponse: (response) => response?.data || [],
        }),
        getResellerChildAddons: builder.query({
            query: (childId) => ({
                url: `${RESELLER_BASE}/tenants/${childId}/addons`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || null,
            providesTags: (r, e, childId) => [
                { type: 'ResellerChildAddons', id: childId }],
        }),
        createResellerChildAddonOrder: builder.mutation({
            query: ({ childId, ...data }) => ({
                url: `${RESELLER_BASE}/tenants/${childId}/addon-order`,
                method: 'POST',
                data,
            }),
            invalidatesTags: (r, e, { childId }) => [
                { type: 'ResellerChildAddons', id: childId }],
        }),

        // Buy resale STOCK: units the apex holds to sell on. Priced at
        // the vendor's child tier; free stock lands instantly, paid
        // stock returns a Razorpay order.
        buyResaleStock: builder.mutation({
            query: (data) => ({
                url: `${RESELLER_BASE}/addon-stock`,
                method: 'POST',
                data,
            }),
            invalidatesTags: ['ResaleLedger'],
        }),

        getResaleLedger: builder.query({
            query: () => ({ url: `${RESELLER_BASE}/resale-ledger`,
                method: 'GET' }),
            transformResponse: (response) => response?.data || [],
            providesTags: ['ResaleLedger'],
        }),

        createResellerTenant: builder.mutation({
            query: (data) => ({
                url: `${RESELLER_BASE}/tenants`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [
                { type: 'ResellerTenant', id: 'LIST' },
                { type: 'ResellerQuota', id: 'ME' },
            ],
        }),
        updateResellerTenant: builder.mutation({
            query: ({ id, data }) => ({
                url: `${RESELLER_BASE}/tenants/${id}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'ResellerTenant', id: 'LIST' },
                { type: 'ResellerTenant', id: arg.id },
            ],
        }),

        // One bell message to the admins of all (or selected)
        // children. Same payload/response shape as the vendor's
        // /platform/announcements.
        announceToChildren: builder.mutation({
            query: (data) => ({
                url: `${RESELLER_BASE}/announcements`,
                method: 'POST',
                data,
            }),
        }),

        // ── My DNS zone (apex-owned Cloudflare, P4) ─────────────────
        // Payload: {config, ready, effective_child_base,
        // platform_base_domain, children_zones:{apex_zone, platform_zone}}.
        getResellerDns: builder.query({
            query: () => ({ url: `${RESELLER_BASE}/dns`, method: 'GET' }),
            transformResponse: (response) => response?.data || null,
            providesTags: [{ type: 'ResellerDns', id: 'ME' }],
        }),
        saveResellerDns: builder.mutation({
            query: (data) => ({
                url: `${RESELLER_BASE}/dns`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [{ type: 'ResellerDns', id: 'ME' }],
        }),
        testResellerDns: builder.mutation({
            query: () => ({ url: `${RESELLER_BASE}/dns/test`, method: 'POST' }),
            invalidatesTags: [{ type: 'ResellerDns', id: 'ME' }],
        }),
        disconnectResellerDns: builder.mutation({
            query: () => ({ url: `${RESELLER_BASE}/dns`, method: 'DELETE' }),
            invalidatesTags: [{ type: 'ResellerDns', id: 'ME' }],
        }),
    }),
});

export const {
    useBuyResaleStockMutation,
    useGetResaleLedgerQuery,
    useListResellerAddonCatalogueQuery,
    useGetResellerChildAddonsQuery,
    useCreateResellerChildAddonOrderMutation,
    useGetResellerQuotaQuery,
    useListResellerTenantsQuery,
    useCreateResellerTenantMutation,
    useUpdateResellerTenantMutation,
    useAnnounceToChildrenMutation,
    useGetResellerDnsQuery,
    useSaveResellerDnsMutation,
    useTestResellerDnsMutation,
    useDisconnectResellerDnsMutation,
} = resellerEndpoints;

export default resellerEndpoints;
