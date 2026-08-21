/**
 * ASSUMED backend endpoints for the new-look patient pages.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NOTHING IN THIS FILE EXISTS ON THE BACKEND YET. Every endpoint below is a
 * frontend-side assumption, written so the mobile MVP's remaining features
 * (wallet, notifications, recovery plans, recommendations) can ship on the
 * web now and light up the moment the backend implements the contract.
 * The backend has NOT been altered. Every page that consumes one of these
 * shows an honest notice when the call 404s instead of rendering blanks.
 *
 * ASSUMED CONTRACT (all JWT-authenticated as the patient; the usual
 * success_response envelope { success, data, message }):
 *
 * | # | Method & path                              | Request                        | Expected data                                                                 |
 * |---|--------------------------------------------|--------------------------------|-------------------------------------------------------------------------------|
 * | 1 | GET  /api/patient/wallet                   | —                              | { balance, currency, transactions: [{ id, description, amount(signed),        |
 * |   |                                            |                                |   method, date, balance_after }] }                                             |
 * | 2 | POST /api/patient/wallet/top-up            | { amount, method }             | { order_id, payment_url? } — Razorpay order for the deposit                    |
 * | 3 | GET  /api/patient/notifications            | —                              | { notifications: [{ id, kind(appointment|prescription|payment|general),       |
 * |   |                                            |                                |   title, message, date, read }] }                                              |
 * | 4 | POST /api/patient/notifications/read       | { ids?: [..] } (absent = all)  | { updated }                                                                    |
 * | 5 | GET  /api/patient/recovery-plans           | —                              | { plans: [{ id, name, condition, description, duration_days, duration_label,  |
 * |   |                                            |                                |   price, includes: [..] }] }                                                   |
 * | 6 | GET  /api/patient/recovery-plans/orders    | —                              | { orders: [{ id, plan_id, plan_name, status(pending|confirmed|in_process|     |
 * |   |                                            |                                |   completed|cancelled|rejected), ordered_on, amount }] }                       |
 * | 7 | POST /api/patient/recovery-plans/<id>/order| { }                            | { order_id, payment: {...} } — settles via the normal payment pipeline        |
 * | 8 | GET  /api/patient/recommendations          | —                              | { shelves: [{ key, title, subtitle, items: [{ id, name, provider, kind,       |
 * |   |                                            |                                |   price, meta, reason, route_hint(marketplace|health-plans|recovery|doctor) }] }] } |
 * | 9 | POST /api/patient/agent/messages           | { message, history?: [..] }    | { reply, suggestions?: [{ label, route_hint }] } — guided-booking assistant    |
 * | 10| GET  /api/patient/facilities?type=<t>      | type: clinic | hospital        | { facilities: [{ id, name, type, city, address, specialities: [..],           |
 * |   |                                            |                                |   profile_image, services_count }] }                                           |
 * | 11| GET  /api/patient/product-categories       | —                              | { categories: [{ key, items: [{ id, name, short_name,                          |
 * |   |                                            |                                |   kind(appointment|service|group_service), description, price, meta }] }] }    |
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Scope note: written unscoped (self only) for now; when implemented these
 * should ride the same act-on-behalf plumbing as api/patientScope.js.
 */
import { apiSlice } from '../../../../app/api/apiSlice';

const P = '/api/patient';

/**
 * True when the failure smells like "endpoint not built yet", not a real error.
 *
 * Two shapes count: an explicit 404/405/501, and a status-less network error —
 * the backend's 404 handler sends no CORS headers, so the browser hides the
 * status and axios reports a NETWORK failure. A genuinely unreachable backend
 * looks the same, which is why the notice wording owns that ambiguity.
 */
export const isMissingEndpoint = (error) => {
    if (!error) return false;
    if ([404, 405, 501].includes(error.status)) return true;
    return error.status == null || error.status === 'FETCH_ERROR' || error.status === 'NETWORK';
};

const assumedEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ── #1 Wallet ────────────────────────────────────────────────
        getNLWallet: builder.query({
            query: () => ({ url: `${P}/wallet`, method: 'GET' }),
            transformResponse: (r) => r?.data || { balance: 0, currency: 'INR', transactions: [] },
            providesTags: ['NLWallet'],
        }),
        // ── #2 Wallet top-up ─────────────────────────────────────────
        topUpNLWallet: builder.mutation({
            query: (body) => ({ url: `${P}/wallet/top-up`, method: 'POST', data: body }),
            transformResponse: (r) => r?.data,
            invalidatesTags: ['NLWallet'],
        }),
        // ── #3 Notifications ─────────────────────────────────────────
        getNLNotifications: builder.query({
            query: () => ({ url: `${P}/notifications`, method: 'GET' }),
            transformResponse: (r) => r?.data?.notifications || [],
            providesTags: ['NLNotification'],
        }),
        // ── #4 Mark read ─────────────────────────────────────────────
        markNLNotificationsRead: builder.mutation({
            query: (ids) => ({
                url: `${P}/notifications/read`,
                method: 'POST',
                data: ids?.length ? { ids } : {},
            }),
            invalidatesTags: ['NLNotification'],
        }),
        // ── #5 Recovery plan catalogue ───────────────────────────────
        getNLRecoveryPlans: builder.query({
            query: () => ({ url: `${P}/recovery-plans`, method: 'GET' }),
            transformResponse: (r) => r?.data?.plans || [],
            providesTags: ['NLRecoveryPlan'],
        }),
        // ── #6 My recovery plan orders ───────────────────────────────
        getNLRecoveryPlanOrders: builder.query({
            query: () => ({ url: `${P}/recovery-plans/orders`, method: 'GET' }),
            transformResponse: (r) => r?.data?.orders || [],
            providesTags: ['NLRecoveryPlan'],
        }),
        // ── #7 Order a recovery plan ─────────────────────────────────
        orderNLRecoveryPlan: builder.mutation({
            query: (planId) => ({ url: `${P}/recovery-plans/${planId}/order`, method: 'POST', data: {} }),
            transformResponse: (r) => r?.data,
            invalidatesTags: ['NLRecoveryPlan'],
        }),
        // ── #8 Recommendations ───────────────────────────────────────
        getNLRecommendations: builder.query({
            query: () => ({ url: `${P}/recommendations`, method: 'GET' }),
            transformResponse: (r) => r?.data?.shelves || [],
        }),
        // ── #10 Clinic / hospital directory ──────────────────────────
        // The doctor list filters on User.role == DOCTOR, so facilities never
        // appear in it — a patient-facing directory doesn't exist yet.
        getNLFacilities: builder.query({
            query: (type) => ({ url: `${P}/facilities`, method: 'GET', params: { type } }),
            transformResponse: (r) => r?.data?.facilities || [],
        }),
        // ── #11 Category catalogues ──────────────────────────────────
        // What's inside each of the eight booking categories (the category
        // DEFINITIONS ship as config in data/categories.js; the priced items
        // are the backend's to provide).
        getNLProductCategories: builder.query({
            query: () => ({ url: `${P}/product-categories`, method: 'GET' }),
            transformResponse: (r) => r?.data?.categories || [],
        }),
        // ── #9 Guided-booking agent ──────────────────────────────────
        sendNLAgentMessage: builder.mutation({
            query: (body) => ({ url: `${P}/agent/messages`, method: 'POST', data: body }),
            transformResponse: (r) => r?.data,
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetNLWalletQuery,
    useTopUpNLWalletMutation,
    useGetNLNotificationsQuery,
    useMarkNLNotificationsReadMutation,
    useGetNLRecoveryPlansQuery,
    useGetNLRecoveryPlanOrdersQuery,
    useOrderNLRecoveryPlanMutation,
    useGetNLRecommendationsQuery,
    useSendNLAgentMessageMutation,
    useGetNLFacilitiesQuery,
    useGetNLProductCategoriesQuery,
} = assumedEndpoints;

export default assumedEndpoints;
