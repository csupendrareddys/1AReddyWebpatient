/**
 * Admin Marketplace & Availability Approval Endpoints (RTK Query)
 * Covers: product catalog CRUD + availability approval actions
 */
import { apiSlice } from '../../../app/api/apiSlice';

const ADMIN_URL = '/api/v1/admin';

const marketplaceEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ────── Product Catalog ──────

        getAdminProducts: builder.query({
            query: () => ({ url: `${ADMIN_URL}/products`, method: 'GET' }),
            transformResponse: (res) => res.data?.products || res.products || [],
            providesTags: (result) =>
                result
                    ? [
                          ...result.map((p) => ({ type: 'Product', id: p.id })),
                          { type: 'Product', id: 'LIST' },
                      ]
                    : [{ type: 'Product', id: 'LIST' }],
        }),

        createAdminProduct: builder.mutation({
            query: (data) => ({ url: `${ADMIN_URL}/products`, method: 'POST', data }),
            invalidatesTags: [{ type: 'Product', id: 'LIST' }],
        }),

        // ────── Feature ↔ Product linking grid (persisted per offering) ──────
        // Tagged so the standalone lab page and the feature editor's linking
        // section — which read/write the SAME rows — stay in sync: a save in
        // one invalidates the other's cache.
        getFeatureProductLinks: builder.query({
            query: (offering) => ({
                url: `${ADMIN_URL}/feature-product-links?offering=${encodeURIComponent(offering)}`,
                method: 'GET',
            }),
            transformResponse: (res) => res.data?.links || [],
            providesTags: (r, e, offering) => [{ type: 'FeatureProductLink', id: offering }],
        }),
        // All offerings' links in one shot, grouped by offering — for the
        // feature editor's section which shows every offering at once.
        getAllFeatureProductLinks: builder.query({
            query: () => ({ url: `${ADMIN_URL}/feature-product-links/all`, method: 'GET' }),
            transformResponse: (res) => res.data?.links_by_offering || {},
            providesTags: [{ type: 'FeatureProductLink', id: 'ALL' }],
        }),
        saveFeatureProductLinks: builder.mutation({
            query: ({ offering, rows }) => ({
                url: `${ADMIN_URL}/feature-product-links?offering=${encodeURIComponent(offering)}`,
                method: 'PUT',
                data: { rows },
            }),
            transformResponse: (res) => res.data?.links || [],
            invalidatesTags: (r, e, { offering }) => [
                { type: 'FeatureProductLink', id: offering },
                { type: 'FeatureProductLink', id: 'ALL' },
            ],
        }),
        // Landing-page features → options for the grid's "List of features".
        getLandingFeatureOptions: builder.query({
            query: () => ({ url: `${ADMIN_URL}/feature-product-links/landing-features`, method: 'GET' }),
            transformResponse: (res) => res.data?.features || [],
        }),
        // Providers that actually offer a product (teams for group / listing
        // doctors for service / all for consultation).
        getFeatureProductProviders: builder.query({
            query: ({ offering, productId, flat }) => ({
                url: `${ADMIN_URL}/feature-product-links/providers?offering=${encodeURIComponent(offering || '')}`
                    + `${productId ? `&product_id=${productId}` : ''}${flat ? '&flat=1' : ''}`,
                method: 'GET',
            }),
            transformResponse: (res) => res.data?.providers || [],
        }),

        updateAdminProduct: builder.mutation({
            query: ({ productId, ...data }) => ({
                url: `${ADMIN_URL}/products/${productId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (res, err, { productId }) => [
                { type: 'Product', id: productId },
                { type: 'Product', id: 'LIST' },
            ],
        }),

        deleteAdminProduct: builder.mutation({
            query: (productId) => ({
                url: `${ADMIN_URL}/products/${productId}`,
                method: 'DELETE',
            }),
            invalidatesTags: [{ type: 'Product', id: 'LIST' }],
        }),

        // ────── Availability Approvals ──────

        getAvailabilityApprovals: builder.query({
            // ``status`` filters the queue server-side (pending|completed|
            // rejected|all per the backend's ApprovalRequestStatus enum).
            // No-arg call still works — backend defaults to ``pending``.
            query: (params = {}) => {
                const qs = new URLSearchParams(params).toString();
                return {
                    url: `${ADMIN_URL}/availability-approvals${qs ? `?${qs}` : ''}`,
                    method: 'GET',
                };
            },
            transformResponse: (res) => res.data?.requests || res.requests || [],
            providesTags: [{ type: 'AvailabilityApproval', id: 'LIST' }],
        }),

        approveAvailability: builder.mutation({
            query: (requestId) => ({
                url: `${ADMIN_URL}/availability-approvals/${requestId}/approve`,
                method: 'POST',
            }),
            invalidatesTags: [{ type: 'AvailabilityApproval', id: 'LIST' }],
        }),

        // Approve every pending availability request at once (optionally one
        // doctor's) — clears the per-slot flood in a single action.
        approveAllAvailability: builder.mutation({
            query: (doctorId) => ({
                url: `${ADMIN_URL}/availability-approvals/approve-all${doctorId ? `?doctor_id=${doctorId}` : ''}`,
                method: 'POST',
            }),
            invalidatesTags: [{ type: 'AvailabilityApproval', id: 'LIST' }],
        }),

        // Approve a chosen set of requests (ticked rows / a doctor's batch).
        approveBatchAvailability: builder.mutation({
            query: (requestIds) => ({
                url: `${ADMIN_URL}/availability-approvals/approve-batch`,
                method: 'POST',
                data: { request_ids: requestIds },
            }),
            invalidatesTags: [{ type: 'AvailabilityApproval', id: 'LIST' }],
        }),

        rejectAvailability: builder.mutation({
            query: ({ requestId, reason }) => ({
                url: `${ADMIN_URL}/availability-approvals/${requestId}/reject`,
                method: 'POST',
                data: { reason },
            }),
            invalidatesTags: [{ type: 'AvailabilityApproval', id: 'LIST' }],
        }),

        // ────── Group Service Offering Approvals ──────

        getAdminServiceGroups: builder.query({
            query: (status = 'pending') => ({
                url: `${ADMIN_URL}/service-groups`,
                method: 'GET',
                params: status ? { status } : undefined,
            }),
            transformResponse: (res) => res.data?.groups || res.groups || [],
            providesTags: [{ type: 'AdminServiceGroup', id: 'LIST' }],
        }),

        approveServiceGroup: builder.mutation({
            query: (groupId) => ({
                url: `${ADMIN_URL}/service-groups/${groupId}/approve`,
                method: 'POST',
            }),
            invalidatesTags: [{ type: 'AdminServiceGroup', id: 'LIST' }],
        }),

        rejectServiceGroup: builder.mutation({
            query: ({ groupId, reason }) => ({
                url: `${ADMIN_URL}/service-groups/${groupId}/reject`,
                method: 'POST',
                data: { reason },
            }),
            invalidatesTags: [{ type: 'AdminServiceGroup', id: 'LIST' }],
        }),

        // Item 3D — admin fills a missing specialty
        getGroupCandidates: builder.query({
            query: ({ groupId, specializationId }) => ({
                url: `${ADMIN_URL}/service-groups/${groupId}/candidates`,
                method: 'GET',
                params: { specialization_id: specializationId },
            }),
            transformResponse: (res) => res.data?.candidates || [],
        }),
        assignGroupMember: builder.mutation({
            query: ({ groupId, doctorId }) => ({
                url: `${ADMIN_URL}/service-groups/${groupId}/assign-member`,
                method: 'POST',
                data: { doctor_id: doctorId },
            }),
            invalidatesTags: [{ type: 'AdminServiceGroup', id: 'LIST' }],
        }),

        // ────── Individual Marketplace-Product Approvals ──────

        getAdminMarketplaceProducts: builder.query({
            query: (status = 'pending') => ({
                url: `${ADMIN_URL}/marketplace-products`,
                method: 'GET',
                params: status ? { status } : undefined,
            }),
            transformResponse: (res) => res.data?.products || res.products || [],
            providesTags: [{ type: 'AdminMarketplaceProduct', id: 'LIST' }],
        }),

        approveMarketplaceProductAdmin: builder.mutation({
            query: (arg) => {
                const mpId = typeof arg === 'string' ? arg : arg.mpId;
                const payoutInstallments = typeof arg === 'string' ? undefined : arg.payout_installments;
                return {
                    url: `${ADMIN_URL}/marketplace-products/${mpId}/approve`,
                    method: 'POST',
                    data: payoutInstallments ? { payout_installments: payoutInstallments } : {},
                };
            },
            invalidatesTags: [
                { type: 'AdminMarketplaceProduct', id: 'LIST' },
                'MarketplaceProduct',
            ],
        }),

        rejectMarketplaceProductAdmin: builder.mutation({
            query: ({ mpId, reason }) => ({
                url: `${ADMIN_URL}/marketplace-products/${mpId}/reject`,
                method: 'POST',
                data: { reason },
            }),
            invalidatesTags: [
                { type: 'AdminMarketplaceProduct', id: 'LIST' },
                'MarketplaceProduct',
            ],
        }),

        // Work-qualification master list — the admin-curated options a product
        // can require and a doctor picks from on their profile.
        getWorkQualifications: builder.query({
            query: () => ({ url: `${ADMIN_URL}/products/work-qualifications`, method: 'GET' }),
            transformResponse: (res) => res.data?.work_qualifications || [],
            providesTags: [{ type: 'WorkQualification', id: 'LIST' }],
        }),
        createWorkQualification: builder.mutation({
            query: (data) => ({
                url: `${ADMIN_URL}/products/work-qualifications`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [{ type: 'WorkQualification', id: 'LIST' }],
        }),
        updateWorkQualification: builder.mutation({
            query: ({ qualificationId, ...data }) => ({
                url: `${ADMIN_URL}/products/work-qualifications/${qualificationId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [{ type: 'WorkQualification', id: 'LIST' }],
        }),

        // ────── Product Categories ──────
        // Catalog-level reference data (like work qualifications): a product
        // falls under one main category. Managed from the Product Catalog
        // toolbar so it sits with the catalog, not inside one product.
        getProductCategories: builder.query({
            query: (params = {}) => {
                const qs = new URLSearchParams(params).toString();
                return {
                    url: `${ADMIN_URL}/products/product_category${qs ? `?${qs}` : ''}`,
                    method: 'GET',
                };
            },
            transformResponse: (res) => res.data?.product_categories || [],
            providesTags: [{ type: 'ProductCategory', id: 'LIST' }],
        }),
        createProductCategory: builder.mutation({
            query: (data) => ({
                url: `${ADMIN_URL}/products/product_category`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [{ type: 'ProductCategory', id: 'LIST' }],
        }),
        updateProductCategory: builder.mutation({
            query: ({ categoryId, ...data }) => ({
                url: `${ADMIN_URL}/products/product_category/${categoryId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: [{ type: 'ProductCategory', id: 'LIST' }],
        }),
        addProductSubcategory: builder.mutation({
            query: ({ categoryId, name }) => ({
                url: `${ADMIN_URL}/products/product_category/${categoryId}/subcategory`,
                method: 'POST',
                data: { name },
            }),
            invalidatesTags: [{ type: 'ProductCategory', id: 'LIST' }],
        }),
        deleteProductSubcategory: builder.mutation({
            query: ({ categoryId, subcategoryId }) => ({
                url: `${ADMIN_URL}/products/product_category/${categoryId}/subcategory/${subcategoryId}`,
                method: 'DELETE',
            }),
            invalidatesTags: [{ type: 'ProductCategory', id: 'LIST' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetAdminProductsQuery,
    useGetFeatureProductLinksQuery,
    useGetAllFeatureProductLinksQuery,
    useSaveFeatureProductLinksMutation,
    useGetLandingFeatureOptionsQuery,
    useGetFeatureProductProvidersQuery,
    useCreateAdminProductMutation,
    useUpdateAdminProductMutation,
    useDeleteAdminProductMutation,
    useGetWorkQualificationsQuery,
    useCreateWorkQualificationMutation,
    useUpdateWorkQualificationMutation,
    useGetProductCategoriesQuery,
    useCreateProductCategoryMutation,
    useUpdateProductCategoryMutation,
    useAddProductSubcategoryMutation,
    useDeleteProductSubcategoryMutation,
    useGetAvailabilityApprovalsQuery,
    useApproveAvailabilityMutation,
    useApproveAllAvailabilityMutation,
    useApproveBatchAvailabilityMutation,
    useRejectAvailabilityMutation,
    useGetAdminServiceGroupsQuery,
    useApproveServiceGroupMutation,
    useRejectServiceGroupMutation,
    useLazyGetGroupCandidatesQuery,
    useAssignGroupMemberMutation,
    useGetAdminMarketplaceProductsQuery,
    useApproveMarketplaceProductAdminMutation,
    useRejectMarketplaceProductAdminMutation,
} = marketplaceEndpoints;
