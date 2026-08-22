import { apiSlice } from '../../../app/api/apiSlice';
import {
    splitScope, scopeOf, patientScopedUrl,
} from '../../service-receiver/api/patientScope';
import {
    splitScope as splitDoctorScope, doctorScopedUrl,
} from '../../service-provider/api/doctorScope';

/**
 * Both scopes appear in this file. The doctor helpers carry the two surfaces
 * an admin drives from the Operations doctor tabs — the catalog ("Manage
 * Appointments / Services") and the order tracking that sits beside it ("My
 * Appointments / Service List"); the patient ones carry buying from the
 * Operations booking tab. Each pair reads its own arg key, so a plain arg
 * passes through both untouched and every unscoped caller keeps its existing
 * URL + cache key.
 */

export const marketplaceApi = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // Doctor Marketplace Management (scoped — the Service List side of the
        // doctor's Manage page, which Operations mounts)
        getDoctorMarketplaceProducts: builder.query({
            query: (arg) => ({
                url: doctorScopedUrl(splitDoctorScope(arg)[0], '/marketplace/my-products'),
                method: 'GET',
            }),
            transformResponse: (res) => res.data?.products || res.products || [],
            providesTags: ['MarketplaceProduct'],
        }),
        selectMarketplaceProduct: builder.mutation({
            query: (arg) => {
                const [ops, data] = splitDoctorScope(arg);
                return {
                    url: doctorScopedUrl(ops, '/marketplace/my-products'),
                    method: 'POST',
                    data,
                };
            },
            invalidatesTags: ['MarketplaceProduct', { type: 'AdminMarketplaceProduct', id: 'LIST' }],
        }),
        updateMarketplaceProduct: builder.mutation({
            query: (arg) => {
                const [ops, { id, ...data }] = splitDoctorScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/marketplace/my-products/${id}`),
                    method: 'PUT',
                    data,
                };
            },
            invalidatesTags: ['MarketplaceProduct', { type: 'AdminMarketplaceProduct', id: 'LIST' }],
        }),
        removeMarketplaceProduct: builder.mutation({
            query: (arg) => {
                const [ops, id] = splitDoctorScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/marketplace/my-products/${id}`),
                    method: 'DELETE',
                };
            },
            invalidatesTags: ['MarketplaceProduct'],
        }),
        // Incoming orders — the tracking side of the catalog above, on the
        // doctor's "My Appointments / Service List" page (scoped; Operations
        // mounts that page too).
        getDoctorMarketplaceSales: builder.query({
            query: (arg) => ({
                url: doctorScopedUrl(splitDoctorScope(arg)[0], '/marketplace/sales'),
                method: 'GET',
            }),
            transformResponse: (res) => res.data?.sales || res.sales || [],
            providesTags: ['MarketplaceOrder'],
        }),
        updateMarketplaceOrder: builder.mutation({
            query: (arg) => {
                const [ops, { id, ...data }] = splitDoctorScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/marketplace/sales/${id}`),
                    method: 'PUT',
                    data,
                };
            },
            invalidatesTags: ['MarketplaceOrder'],
        }),

        // ── Group Service Offerings (multi-doctor, admin-approved) ── (scoped)
        getServiceGroups: builder.query({
            query: (arg) => ({
                url: doctorScopedUrl(splitDoctorScope(arg)[0], '/marketplace/service-groups'),
                method: 'GET',
            }),
            transformResponse: (res) => res.data?.groups || res.groups || [],
            providesTags: ['ServiceGroup'],
        }),
        createServiceGroup: builder.mutation({
            query: (arg) => {
                const [ops, data] = splitDoctorScope(arg);
                return {
                    url: doctorScopedUrl(ops, '/marketplace/service-groups'),
                    method: 'POST',
                    data,
                };
            },
            invalidatesTags: ['ServiceGroup'],
        }),
        updateServiceGroup: builder.mutation({
            query: (arg) => {
                const [ops, { id, ...data }] = splitDoctorScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/marketplace/service-groups/${id}`),
                    method: 'PUT',
                    data,
                };
            },
            invalidatesTags: ['ServiceGroup'],
        }),
        deleteServiceGroup: builder.mutation({
            query: (arg) => {
                const [ops, id] = splitDoctorScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/marketplace/service-groups/${id}`),
                    method: 'DELETE',
                };
            },
            invalidatesTags: ['ServiceGroup'],
        }),

        // Item 3D — group-offering invitations (co-doctor consent) (scoped)
        getGroupInvitations: builder.query({
            query: (arg) => ({
                url: doctorScopedUrl(
                    splitDoctorScope(arg)[0], '/marketplace/service-groups/invitations',
                ),
                method: 'GET',
            }),
            transformResponse: (res) => res.data?.invitations || [],
            providesTags: ['ServiceGroup'],
        }),

        // Group Offering plan teams — the doctor's own memberships (own fee +
        // installment schedule only), for the Plan Teams / Earnings view.
        getMyPlanTeams: builder.query({
            query: () => ({ url: '/api/v1/doctor/group-offering-teams', method: 'GET' }),
            transformResponse: (res) => res.data?.memberships || [],
            providesTags: ['ServiceGroup'],
        }),
        // Active plan bookings this doctor's team serves — used to deliver the
        // completion document to the patient.
        getMyPlanBookings: builder.query({
            query: () => ({ url: '/api/v1/doctor/group-offering-bookings', method: 'GET' }),
            transformResponse: (res) => res.data?.bookings || [],
            providesTags: ['PlanBooking'],
        }),
        // Paid plan bookings awaiting the team LEAD's acceptance (mirrors a paid
        // service order awaiting the provider's accept). Accepting opens chat.
        // Scoped alongside the sales rows above — same page, same bargain.
        getIncomingPlanBookings: builder.query({
            query: (arg) => ({
                url: doctorScopedUrl(
                    splitDoctorScope(arg)[0], '/group-offering-bookings/incoming',
                ),
                method: 'GET',
            }),
            transformResponse: (res) => res.data?.bookings || [],
            providesTags: ['PlanBooking'],
        }),
        acceptPlanBooking: builder.mutation({
            query: (arg) => {
                const [ops, bookingId] = splitDoctorScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/group-offering-bookings/${bookingId}/accept`),
                    method: 'POST',
                };
            },
            invalidatesTags: ['PlanBooking'],
        }),
        rejectPlanBooking: builder.mutation({
            query: (arg) => {
                const [ops, bookingId] = splitDoctorScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/group-offering-bookings/${bookingId}/reject`),
                    method: 'POST',
                };
            },
            invalidatesTags: ['PlanBooking'],
        }),
        respondGroupInvite: builder.mutation({
            query: (arg) => {
                const [ops, { id, accept }] = splitDoctorScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/marketplace/service-groups/${id}/respond`),
                    method: 'POST',
                    data: { accept },
                };
            },
            invalidatesTags: ['ServiceGroup'],
        }),

        // ── Patient marketplace browsing + buying ──
        // Scope-aware: a super-admin in Operations drives these same four
        // endpoints on a patient's behalf through the act-on-behalf proxy.
        // See features/service-receiver/api/patientScope.js.
        browseMarketplace: builder.query({
            query: (arg) => {
                const [scope, params] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, '/marketplace/products'),
                    method: 'GET',
                    params,
                };
            },
            transformResponse: (res) => res.data?.products || res.products || [],
            providesTags: ['MarketplaceProduct'],
        }),
        purchaseMarketplaceProduct: builder.mutation({
            query: (arg) => {
                const [scope, data] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, '/marketplace/purchase'),
                    method: 'POST',
                    data,
                };
            },
            invalidatesTags: ['MarketplaceOrder'],
        }),
        // Attach one file to a just-booked order (multipart), so the doctor can
        // review it before accepting/rejecting.
        uploadOrderAttachment: builder.mutation({
            query: (arg) => {
                const [scope, { orderId, file }] = splitScope(arg);
                const formData = new FormData();
                formData.append('file', file);
                return {
                    url: patientScopedUrl(scope, `/marketplace/orders/${orderId}/attachment`),
                    method: 'POST',
                    data: formData,
                    headers: { 'Content-Type': 'multipart/form-data' },
                };
            },
            invalidatesTags: ['MarketplaceOrder'],
        }),
        getPatientMarketplaceOrders: builder.query({
            query: (arg) => ({
                url: patientScopedUrl(scopeOf(arg), '/marketplace/orders'),
                method: 'GET',
            }),
            transformResponse: (res) => res.data?.orders || res.orders || [],
            providesTags: ['MarketplaceOrder'],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetDoctorMarketplaceProductsQuery,
    useSelectMarketplaceProductMutation,
    useUpdateMarketplaceProductMutation,
    useRemoveMarketplaceProductMutation,
    useGetDoctorMarketplaceSalesQuery,
    useUpdateMarketplaceOrderMutation,
    useGetServiceGroupsQuery,
    useCreateServiceGroupMutation,
    useUpdateServiceGroupMutation,
    useDeleteServiceGroupMutation,
    useGetGroupInvitationsQuery,
    useRespondGroupInviteMutation,
    useGetMyPlanTeamsQuery,
    useGetMyPlanBookingsQuery,
    useGetIncomingPlanBookingsQuery,
    useAcceptPlanBookingMutation,
    useRejectPlanBookingMutation,
    useBrowseMarketplaceQuery,
    usePurchaseMarketplaceProductMutation,
    useUploadOrderAttachmentMutation,
    useGetPatientMarketplaceOrdersQuery,
} = marketplaceApi;
